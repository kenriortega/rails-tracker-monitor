package projector

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/projection"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

var recibido = time.Date(2026, 10, 19, 21, 0, 0, 0, time.UTC)

// falsa implementa Store en memoria para probar el bucle sin Postgres.
type falsa struct {
	cursor     store.Cursor
	paginas    [][]store.PendingEvent
	leidas     int
	cursores   []store.Cursor
	activadas  []projection.Activation
	movidas    []projection.Movement
	posiciones []posicion
	puntos     map[string]string
	fallo      error
}

type posicion struct {
	runID, point string
	observedAt   time.Time
}

func (f *falsa) ReadCursor(context.Context) (store.Cursor, error) { return f.cursor, f.fallo }
func (f *falsa) SaveCursor(_ context.Context, c store.Cursor) error {
	f.cursor = c
	f.cursores = append(f.cursores, c)
	return nil
}
func (f *falsa) PendingEvents(context.Context, store.Cursor, string, int) ([]store.PendingEvent, error) {
	if f.leidas >= len(f.paginas) {
		return nil, nil
	}
	page := f.paginas[f.leidas]
	f.leidas++
	return page, nil
}
func (f *falsa) UpsertActivation(_ context.Context, a projection.Activation) (string, error) {
	f.activadas = append(f.activadas, a)
	return "run-" + a.ProviderRunID, nil
}
func (f *falsa) UpsertMovement(_ context.Context, m projection.Movement) (string, error) {
	f.movidas = append(f.movidas, m)
	return "run-" + m.ProviderRunID, nil
}
func (f *falsa) ResolveStanox(_ context.Context, stanox string) (string, bool, error) {
	point, ok := f.puntos[stanox]
	return point, ok, nil
}
func (f *falsa) UpsertPosition(_ context.Context, runID, point string, observedAt, _ time.Time) error {
	f.posiciones = append(f.posiciones, posicion{runID, point, observedAt})
	return nil
}
func (f *falsa) LinkSchedules(context.Context) (store.ScheduleCoverage, error) {
	return store.ScheduleCoverage{}, nil
}
func (f *falsa) ReadState(context.Context) (store.State, error) { return store.State{}, nil }

func evento(id, payload string) store.PendingEvent {
	return store.PendingEvent{ID: id, Payload: json.RawMessage(payload), ReceivedAt: recibido}
}

const unMovimiento = `{"header":{"msg_type":"0003"},"body":{"train_id":"725N79M919","loc_stanox":"87701"}}`
const unaActivacion = `{"header":{"msg_type":"0001"},"body":{"train_id":"725N79M919","tp_origin_timestamp":"2026-10-20"}}`

func TestProyectaMovimientosYActivaciones(t *testing.T) {
	f := &falsa{
		paginas: [][]store.PendingEvent{{
			evento("e1", unaActivacion),
			evento("e2", unMovimiento),
			evento("e3", `{"header":{"msg_type":"9999"},"body":{}}`),
		}},
		puntos: map[string]string{"87701": "POINT(-1 53)"},
	}
	totals, err := New(f, "TRUST_MVT").Pass(context.Background())
	if err != nil {
		t.Fatalf("Pass devolvió error: %v", err)
	}
	if totals.Read != 3 || totals.Activations != 1 || totals.Projected != 1 || totals.Skipped != 1 {
		t.Errorf("totales = %+v", totals)
	}
	if totals.Positions != 1 || totals.Unresolved != 0 {
		t.Errorf("posiciones = %d, sin resolver = %d", totals.Positions, totals.Unresolved)
	}
}

// Un STANOX que no resuelve a un punto único deja la posición sin coordenada
// en lugar de inventar una.
func TestStanoxAmbiguoDejaLaPosicionSinPunto(t *testing.T) {
	f := &falsa{
		paginas: [][]store.PendingEvent{{evento("e1", unMovimiento)}},
		puntos:  map[string]string{}, // 87701 no resuelve
	}
	totals, err := New(f, "TRUST_MVT").Pass(context.Background())
	if err != nil {
		t.Fatalf("Pass devolvió error: %v", err)
	}
	if totals.Unresolved != 1 || totals.Positions != 0 {
		t.Errorf("totales = %+v", totals)
	}
	if len(f.posiciones) != 1 || f.posiciones[0].point != "" {
		t.Errorf("posiciones = %+v, se esperaba sin punto", f.posiciones)
	}
}

// Una activación guarda un marcador sin coordenada: el tren se conoce, su
// posición todavía no.
func TestLaActivacionGuardaMarcadorSinCoordenada(t *testing.T) {
	f := &falsa{paginas: [][]store.PendingEvent{{evento("e1", unaActivacion)}}}
	if _, err := New(f, "TRUST_MVT").Pass(context.Background()); err != nil {
		t.Fatalf("Pass devolvió error: %v", err)
	}
	if len(f.posiciones) != 1 || f.posiciones[0].point != "" {
		t.Errorf("posiciones = %+v", f.posiciones)
	}
	if len(f.activadas) != 1 || f.activadas[0].ServiceDate != "2026-10-20" {
		t.Errorf("activadas = %+v", f.activadas)
	}
}

// El cursor avanza al último evento de cada página, no al primero.
func TestElCursorAvanzaAlUltimoDeLaPagina(t *testing.T) {
	f := &falsa{paginas: [][]store.PendingEvent{{
		evento("primero", unMovimiento),
		evento("ultimo", unMovimiento),
	}}}
	if _, err := New(f, "TRUST_MVT").Pass(context.Background()); err != nil {
		t.Fatalf("Pass devolvió error: %v", err)
	}
	if len(f.cursores) != 1 || f.cursores[0].LastEventID != "ultimo" {
		t.Errorf("cursores = %+v", f.cursores)
	}
}

// Una página vacía no guarda cursor ni da otra vuelta.
func TestSinEventosNoSeGuardaCursor(t *testing.T) {
	f := &falsa{}
	totals, err := New(f, "TRUST_MVT").Pass(context.Background())
	if err != nil {
		t.Fatalf("Pass devolvió error: %v", err)
	}
	if totals.Read != 0 || len(f.cursores) != 0 {
		t.Errorf("totales = %+v, cursores = %d", totals, len(f.cursores))
	}
}

// Una página llena pide otra vuelta; una a medias termina.
func TestUnaPaginaLlenaPideOtraVuelta(t *testing.T) {
	llena := make([]store.PendingEvent, PageSize)
	for i := range llena {
		llena[i] = evento(fmt.Sprintf("e%d", i), unMovimiento)
	}
	f := &falsa{paginas: [][]store.PendingEvent{llena, {evento("ultima", unMovimiento)}}}
	totals, err := New(f, "TRUST_MVT").Pass(context.Background())
	if err != nil {
		t.Fatalf("Pass devolvió error: %v", err)
	}
	if totals.Read != PageSize+1 {
		t.Errorf("leídos = %d, se esperaban %d", totals.Read, PageSize+1)
	}
	// Dos peticiones y no tres: la segunda página viene a medias, y eso ya
	// significa que no queda nada. No hace falta una vuelta en vacío.
	if f.leidas != 2 {
		t.Errorf("páginas pedidas = %d, se esperaban 2", f.leidas)
	}
}

// Un error al leer el cursor aborta la pasada en vez de proyectar a ciegas.
func TestUnErrorAbortaLaPasada(t *testing.T) {
	f := &falsa{fallo: fmt.Errorf("la base no responde")}
	if _, err := New(f, "TRUST_MVT").Pass(context.Background()); err == nil {
		t.Error("se esperaba que el error se propagara")
	}
}
