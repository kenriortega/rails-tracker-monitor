package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/naptan"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/schedule"
)

func TestLaCargaDeUbicacionesEsIdempotente(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()

	stations := []naptan.RailStation{
		{Tiploc: "YORK", CRS: "YRK", Name: "York", Longitude: -1.093, Latitude: 53.958},
		{Tiploc: "LEEDS", CRS: "LDS", Name: "Leeds", Longitude: -1.547, Latitude: 53.795},
	}
	stanox := map[string]string{"YORK": "27000"}

	for vuelta := 1; vuelta <= 2; vuelta++ {
		written, err := s.UpsertLocations(ctx, stations, stanox)
		if err != nil {
			t.Fatalf("vuelta %d: %v", vuelta, err)
		}
		if written != 2 {
			t.Errorf("vuelta %d escribió %d", vuelta, written)
		}
	}

	counts, err := s.CountLocations(ctx)
	if err != nil {
		t.Fatalf("CountLocations: %v", err)
	}
	// Repetir la carga actualiza, no duplica.
	if counts.Total != 2 || counts.WithPoint != 2 || counts.WithStanox != 1 {
		t.Errorf("recuento = %+v", counts)
	}

	// Y el punto lleva SRID, sin el cual la restricción lo rechazaría.
	var srid int
	if err := s.pool.QueryRow(ctx,
		"SELECT ST_SRID(point) FROM locations WHERE tiploc = 'YORK'").Scan(&srid); err != nil {
		t.Fatalf("no se pudo leer el SRID: %v", err)
	}
	if srid != 4326 {
		t.Errorf("SRID = %d", srid)
	}
}

func TestLaCargaDeHorariosActualiza(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, "TRUNCATE schedules CASCADE"); err != nil {
		t.Fatalf("no se pudo limpiar: %v", err)
	}

	record := schedule.Record{
		UID: "C12345", ValidFrom: "2026-10-19", ValidTo: "2026-10-25", StpIndicator: "P",
		Payload: json.RawMessage(`{"CIF_train_uid":"C12345"}`),
	}
	if _, err := s.UpsertSchedules(ctx, []schedule.Record{record}); err != nil {
		t.Fatalf("primera: %v", err)
	}
	// La misma clave con otra fecha de fin actualiza en lugar de duplicar.
	record.ValidTo = "2026-11-30"
	if _, err := s.UpsertSchedules(ctx, []schedule.Record{record}); err != nil {
		t.Fatalf("segunda: %v", err)
	}

	counts, err := s.CountSchedules(ctx)
	if err != nil {
		t.Fatalf("CountSchedules: %v", err)
	}
	if counts.Total != 1 {
		t.Errorf("horarios = %d, se esperaba 1", counts.Total)
	}
	var validTo time.Time
	if err := s.pool.QueryRow(ctx,
		"SELECT valid_to FROM schedules WHERE uid = 'C12345'").Scan(&validTo); err != nil {
		t.Fatalf("no se pudo leer: %v", err)
	}
	if validTo.Format("2006-01-02") != "2026-11-30" {
		t.Errorf("valid_to = %s", validTo.Format("2006-01-02"))
	}
}

// sembrarEvento mete un evento con la antigüedad pedida.
func sembrarEvento(t *testing.T, s *Store, key string, age time.Duration) (string, time.Time) {
	t.Helper()
	receivedAt := time.Now().UTC().Add(-age).Truncate(time.Millisecond)
	var id string
	err := s.pool.QueryRow(context.Background(), `
		INSERT INTO raw_events (feed, deduplication_key, received_at, payload)
		VALUES ($1, $2, $3::timestamptz, '{"header":{},"body":{}}'::jsonb) RETURNING id`,
		records.MovementFeed, key, receivedAt).Scan(&id)
	if err != nil {
		t.Fatalf("no se pudo sembrar: %v", err)
	}
	return id, receivedAt
}

// Sin cursor no se borra nada: la proyección no ha corrido y perder eventos
// sin proyectar sería irreversible.
func TestSinCursorLaPodaSeNiega(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, "TRUNCATE raw_events"); err != nil {
		t.Fatalf("no se pudo limpiar: %v", err)
	}
	sembrarEvento(t, s, "viejo", 10*24*time.Hour)

	if _, err := s.Prune(ctx, 7, false); !errors.Is(err, ErrNoCursor) {
		t.Errorf("error = %v, se esperaba ErrNoCursor", err)
	}
	var total int
	_ = s.pool.QueryRow(ctx, "SELECT count(*)::int FROM raw_events").Scan(&total)
	if total != 1 {
		t.Errorf("se borró algo sin cursor: quedan %d", total)
	}
}

// Nunca borra por delante del cursor: si la proyección va retrasada, retiene
// los eventos en lugar de perderlos sin proyectar.
func TestLaPodaNoBorraPorDelanteDelCursor(t *testing.T) {
	s := testStore(t)
	limpiar(t, s)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, "TRUNCATE raw_events"); err != nil {
		t.Fatalf("no se pudo limpiar: %v", err)
	}

	// Dos eventos caducados; el cursor solo alcanza al primero.
	idViejo, cuandoViejo := sembrarEvento(t, s, "proyectado", 10*24*time.Hour)
	sembrarEvento(t, s, "sin-proyectar", 9*24*time.Hour)
	sembrarEvento(t, s, "reciente", time.Hour)

	if err := s.SaveCursor(ctx, Cursor{LastReceivedAt: cuandoViejo, LastEventID: idViejo}); err != nil {
		t.Fatalf("SaveCursor: %v", err)
	}

	report, err := s.Prune(ctx, 7, true)
	if err != nil {
		t.Fatalf("Prune en seco: %v", err)
	}
	if report.Expired != 2 || report.Deletable != 1 || report.HeldByCursor != 1 {
		t.Errorf("informe = caducados %d, borrables %d, retenidos %d",
			report.Expired, report.Deletable, report.HeldByCursor)
	}
	// En seco no borra nada.
	if report.DeletedEvents != 0 {
		t.Errorf("la pasada en seco borró %d", report.DeletedEvents)
	}

	report, err = s.Prune(ctx, 7, false)
	if err != nil {
		t.Fatalf("Prune: %v", err)
	}
	if report.DeletedEvents != 1 {
		t.Errorf("borrados = %d, se esperaba 1", report.DeletedEvents)
	}

	var claves []string
	rows, err := s.pool.Query(ctx, "SELECT deduplication_key FROM raw_events ORDER BY 1")
	if err != nil {
		t.Fatalf("no se pudo listar: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		claves = append(claves, k)
	}
	if fmt.Sprint(claves) != "[reciente sin-proyectar]" {
		t.Errorf("quedaron %v; debía retenerse el no proyectado", claves)
	}
}
