package store

import (
	"context"
	"testing"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/projection"
)

// limpiar deja las tablas de proyección vacías entre pruebas.
func limpiar(t *testing.T, s *Store) {
	t.Helper()
	ctx := context.Background()
	for _, table := range []string{"train_positions", "service_runs", "projection_state", "locations"} {
		if _, err := s.pool.Exec(ctx, "TRUNCATE "+table+" CASCADE"); err != nil {
			t.Fatalf("no se pudo limpiar %s: %v", table, err)
		}
	}
}

func unaActivacion(runID string) projection.Activation {
	return projection.Activation{
		ProviderRunID: runID, ServiceDate: "2026-10-20",
		Headcode: "5N79", TocID: "25",
		ObservedAt: time.Now().UTC().Truncate(time.Second),
	}
}

func unMovimiento(runID string, status projection.RunStatus) projection.Movement {
	return projection.Movement{
		ProviderRunID: runID, ServiceDate: "2026-10-20", Status: status,
		Headcode: "5N79", ObservedAt: time.Now().UTC().Truncate(time.Second),
	}
}

func TestElCursorSeGuardaYSeLee(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	if c, err := s.ReadCursor(ctx); err != nil || c.Exists() {
		t.Fatalf("sin cursor debería venir vacío: %+v, %v", c, err)
	}

	// Un id real: la columna es uuid.
	var id string
	if err := s.pool.QueryRow(ctx, "SELECT gen_random_uuid()::text").Scan(&id); err != nil {
		t.Fatalf("no se pudo generar el uuid: %v", err)
	}
	when := time.Now().UTC().Truncate(time.Millisecond)
	if err := s.SaveCursor(ctx, Cursor{LastReceivedAt: when, LastEventID: id}); err != nil {
		t.Fatalf("SaveCursor: %v", err)
	}

	c, err := s.ReadCursor(ctx)
	if err != nil || c.LastEventID != id {
		t.Fatalf("cursor = %+v, err = %v", c, err)
	}
	if err := s.ResetCursor(ctx); err != nil {
		t.Fatalf("ResetCursor: %v", err)
	}
	if c, _ := s.ReadCursor(ctx); c.Exists() {
		t.Error("tras el reset no debería quedar cursor")
	}
}

// Una activación no debe degradar a un tren que ya circula: si la circulación
// existe, solo se completan los datos que falten y el estado se deja como
// está.
func TestLaActivacionNoDegradaUnTrenEnMarcha(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	if _, err := s.UpsertMovement(ctx, unMovimiento("A", projection.Running)); err != nil {
		t.Fatalf("UpsertMovement: %v", err)
	}
	if _, err := s.UpsertActivation(ctx, unaActivacion("A")); err != nil {
		t.Fatalf("UpsertActivation: %v", err)
	}

	var status string
	if err := s.pool.QueryRow(ctx,
		"SELECT status::text FROM service_runs WHERE provider_run_id = 'A'").Scan(&status); err != nil {
		t.Fatalf("no se pudo leer el estado: %v", err)
	}
	if status != "running" {
		t.Errorf("estado = %q, la activación no debía degradarlo", status)
	}
}

// Un movimiento sí actualiza el estado, y los datos que faltan se completan
// sin borrar los que ya había.
func TestElMovimientoActualizaSinBorrar(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	first := unMovimiento("B", projection.Running)
	first.TocID = "25"
	if _, err := s.UpsertMovement(ctx, first); err != nil {
		t.Fatalf("primera: %v", err)
	}

	// Un movimiento posterior sin operador no debe borrar el que ya estaba.
	second := unMovimiento("B", projection.Terminated)
	second.TocID = ""
	if _, err := s.UpsertMovement(ctx, second); err != nil {
		t.Fatalf("segunda: %v", err)
	}

	var status, tocID string
	if err := s.pool.QueryRow(ctx,
		"SELECT status::text, coalesce(toc_id,'') FROM service_runs WHERE provider_run_id = 'B'").
		Scan(&status, &tocID); err != nil {
		t.Fatalf("no se pudo leer: %v", err)
	}
	if status != "terminated" {
		t.Errorf("estado = %q", status)
	}
	if tocID != "25" {
		t.Errorf("toc_id = %q, no debía perderse", tocID)
	}
}

// Un evento más antiguo no puede pisar una posición más reciente: el feed no
// garantiza orden y sin esa guarda el tren retrocedería en el mapa.
func TestUnEventoViejoNoPisaUnaPosicionNueva(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	runID, err := s.UpsertMovement(ctx, unMovimiento("C", projection.Running))
	if err != nil {
		t.Fatalf("UpsertMovement: %v", err)
	}
	now := time.Now().UTC().Truncate(time.Second)

	if err := s.UpsertPosition(ctx, runID, "SRID=4326;POINT(-1 53)", now, now); err != nil {
		t.Fatalf("posición reciente: %v", err)
	}
	// Una hora antes, con otro punto: debe ignorarse.
	older := now.Add(-time.Hour)
	if err := s.UpsertPosition(ctx, runID, "SRID=4326;POINT(-2 54)", older, now); err != nil {
		t.Fatalf("posición vieja: %v", err)
	}

	var observedAt time.Time
	var wkt string
	if err := s.pool.QueryRow(ctx,
		"SELECT observed_at, ST_AsText(point) FROM train_positions WHERE run_id = $1", runID).
		Scan(&observedAt, &wkt); err != nil {
		t.Fatalf("no se pudo leer la posición: %v", err)
	}
	if !observedAt.Equal(now) {
		t.Errorf("observed_at = %v, la vieja pisó a la nueva", observedAt)
	}
	if wkt != "POINT(-1 53)" {
		t.Errorf("punto = %q", wkt)
	}
}

// Sin punto, la posición queda `unknown` en vez de con una coordenada
// inventada.
func TestSinPuntoLaCalidadEsUnknown(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	runID, err := s.UpsertActivation(ctx, unaActivacion("D"))
	if err != nil {
		t.Fatalf("UpsertActivation: %v", err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	if err := s.UpsertPosition(ctx, runID, "", now, now); err != nil {
		t.Fatalf("UpsertPosition: %v", err)
	}

	var quality string
	var point *string
	if err := s.pool.QueryRow(ctx,
		"SELECT quality::text, ST_AsText(point) FROM train_positions WHERE run_id = $1", runID).
		Scan(&quality, &point); err != nil {
		t.Fatalf("no se pudo leer: %v", err)
	}
	if quality != "unknown" || point != nil {
		t.Errorf("calidad = %q, punto = %v", quality, point)
	}
}

// Un STANOX con dos puntos distintos no resuelve: no se elige uno.
func TestUnStanoxAmbiguoNoResuelve(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	for _, wkt := range []string{"POINT(-1 53)", "POINT(-2 54)"} {
		if _, err := s.pool.Exec(ctx, `
			INSERT INTO locations (tiploc, stanox, name, point)
			VALUES (md5(random()::text), '87701', 'prueba', ST_SetSRID(ST_GeomFromText($1), 4326))`, wkt); err != nil {
			t.Fatalf("no se pudo sembrar la ubicación: %v", err)
		}
	}

	if _, ok, err := s.ResolveStanox(ctx, "87701"); err != nil || ok {
		t.Errorf("dos puntos distintos no deberían resolver: ok = %v, err = %v", ok, err)
	}
	if _, ok, err := s.ResolveStanox(ctx, "99999"); err != nil || ok {
		t.Errorf("un stanox sin ubicación no resuelve: ok = %v, err = %v", ok, err)
	}
	if _, ok, err := s.ResolveStanox(ctx, ""); err != nil || ok {
		t.Errorf("sin stanox no hay consulta: ok = %v, err = %v", ok, err)
	}
}

func TestUnStanoxUnicoSiResuelve(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	if _, err := s.pool.Exec(ctx, `
		INSERT INTO locations (tiploc, stanox, name, point)
		VALUES ('TIPLOC1', '12345', 'prueba', ST_SetSRID(ST_GeomFromText('POINT(-1 53)'), 4326))`); err != nil {
		t.Fatalf("no se pudo sembrar: %v", err)
	}
	point, ok, err := s.ResolveStanox(ctx, "12345")
	if err != nil || !ok || point == "" {
		t.Fatalf("debería resolver: point = %q, ok = %v, err = %v", point, ok, err)
	}

	// Y el punto que devuelve se puede volver a insertar tal cual.
	runID, err := s.UpsertMovement(ctx, unMovimiento("E", projection.Running))
	if err != nil {
		t.Fatalf("UpsertMovement: %v", err)
	}
	now := time.Now().UTC().Truncate(time.Second)
	if err := s.UpsertPosition(ctx, runID, point, now, now); err != nil {
		t.Fatalf("el punto resuelto no se pudo guardar: %v", err)
	}
	var wkt string
	if err := s.pool.QueryRow(ctx,
		"SELECT ST_AsText(point) FROM train_positions WHERE run_id = $1", runID).Scan(&wkt); err != nil {
		t.Fatalf("no se pudo leer: %v", err)
	}
	if wkt != "POINT(-1 53)" {
		t.Errorf("punto = %q", wkt)
	}
}
