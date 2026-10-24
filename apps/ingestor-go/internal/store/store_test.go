package store

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
)

// Estas pruebas necesitan PostgreSQL con el esquema migrado. Sin
// RAILS_TEST_DATABASE_URL se saltan, para que `go test ./...` siga siendo
// ejecutable sin infraestructura.
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("RAILS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("RAILS_TEST_DATABASE_URL no está definida")
	}
	ctx := context.Background()
	s, err := Open(ctx, url, 5)
	if err != nil {
		t.Fatalf("no se pudo abrir la base: %v", err)
	}
	t.Cleanup(s.Close)
	if _, err := s.pool.Exec(ctx, "TRUNCATE raw_events"); err != nil {
		t.Fatalf("no se pudo limpiar: %v", err)
	}
	return s
}

func event(key string, observedAt time.Time, payload string) records.RawEvent {
	return records.RawEvent{
		Feed:             records.MovementFeed,
		DeduplicationKey: key,
		ObservedAt:       observedAt,
		ReceivedAt:       time.Now().UTC(),
		Payload:          json.RawMessage(payload),
	}
}

func TestInsertaYCuentaLasNuevas(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	observed := time.Now().UTC().Truncate(time.Second)

	inserted, err := s.InsertRawEvents(ctx, []records.RawEvent{
		event("aaa", observed, `{"header":{"msg_type":"0003"},"body":{"train_id":"A"}}`),
		event("bbb", observed, `{"header":{"msg_type":"0003"},"body":{"train_id":"B"}}`),
	})
	if err != nil {
		t.Fatalf("InsertRawEvents devolvió error: %v", err)
	}
	if inserted != 2 {
		t.Errorf("insertadas = %d, se esperaban 2", inserted)
	}
}

// La reentrega tras reconectar no debe crear filas: es para lo que está la
// clave de deduplicación.
func TestLaReentregaNoDuplica(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	observed := time.Now().UTC().Truncate(time.Second)
	rows := []records.RawEvent{event("repetida", observed, `{"header":{},"body":{}}`)}

	if _, err := s.InsertRawEvents(ctx, rows); err != nil {
		t.Fatalf("primera: %v", err)
	}
	inserted, err := s.InsertRawEvents(ctx, rows)
	if err != nil {
		t.Fatalf("segunda: %v", err)
	}
	if inserted != 0 {
		t.Errorf("la repetición insertó %d filas", inserted)
	}

	var total int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_events").Scan(&total); err != nil {
		t.Fatalf("no se pudo contar: %v", err)
	}
	if total != 1 {
		t.Errorf("filas en la tabla = %d, se esperaba 1", total)
	}
}

// Un evento sin marca utilizable guarda NULL, no la hora cero.
func TestSinMarcaGuardaNulo(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	if _, err := s.InsertRawEvents(ctx, []records.RawEvent{
		event("sin-marca", time.Time{}, `{"header":{},"body":{}}`),
	}); err != nil {
		t.Fatalf("InsertRawEvents devolvió error: %v", err)
	}

	var observedAt *time.Time
	if err := s.pool.QueryRow(ctx,
		"SELECT observed_at FROM raw_events WHERE deduplication_key = 'sin-marca'").Scan(&observedAt); err != nil {
		t.Fatalf("no se pudo leer: %v", err)
	}
	if observedAt != nil {
		t.Errorf("observed_at = %v, se esperaba NULL", *observedAt)
	}
}

// El payload se guarda como jsonb consultable, que es de lo que dependen los
// índices sobre `payload->'body'->>'train_id'`.
func TestElPayloadEsConsultableComoJsonb(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	if _, err := s.InsertRawEvents(ctx, []records.RawEvent{
		event("consultable", time.Now().UTC(),
			`{"header":{"msg_type":"0003"},"body":{"train_id":"725N79M919"}}`),
	}); err != nil {
		t.Fatalf("InsertRawEvents devolvió error: %v", err)
	}

	var trainID string
	if err := s.pool.QueryRow(ctx,
		`SELECT payload->'body'->>'train_id' FROM raw_events WHERE deduplication_key = 'consultable'`).
		Scan(&trainID); err != nil {
		t.Fatalf("no se pudo consultar el payload: %v", err)
	}
	if trainID != "725N79M919" {
		t.Errorf("train_id = %q", trainID)
	}
}

// Un lote entero falla o entra entero: el consumidor confirma el mensaje al
// broker solo después del commit.
func TestElLoteEsAtomico(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()

	_, err := s.InsertRawEvents(ctx, []records.RawEvent{
		event("buena", time.Now().UTC(), `{"header":{},"body":{}}`),
		// jsonb inválido: la transacción entera debe caer.
		event("mala", time.Now().UTC(), `{no es json`),
	})
	if err == nil {
		t.Fatal("se esperaba un error por el payload inválido")
	}

	var total int
	if err := s.pool.QueryRow(ctx, "SELECT count(*) FROM raw_events").Scan(&total); err != nil {
		t.Fatalf("no se pudo contar: %v", err)
	}
	if total != 0 {
		t.Errorf("quedaron %d filas; el lote debía deshacerse entero", total)
	}
}

func TestVacioNoHaceNada(t *testing.T) {
	s := testStore(t)
	if inserted, err := s.InsertRawEvents(context.Background(), nil); err != nil || inserted != 0 {
		t.Errorf("inserted = %d, err = %v", inserted, err)
	}
}
