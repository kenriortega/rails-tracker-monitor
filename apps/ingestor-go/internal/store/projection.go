package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/projection"
)

// CursorName identifica el cursor de proyección en `projection_state`.
const CursorName = "movement"

// Cursor marca hasta dónde llegó la proyección. Zero significa que no hay.
type Cursor struct {
	LastReceivedAt time.Time
	LastEventID    string
}

// Exists distingue "no hay cursor" de "cursor en el origen del tiempo".
func (c Cursor) Exists() bool { return c.LastEventID != "" }

// PendingEvent es una fila de `raw_events` por proyectar.
type PendingEvent struct {
	ID         string
	Payload    json.RawMessage
	ReceivedAt time.Time
}

// ReadCursor devuelve el cursor de proyección, o uno vacío si no existe.
func (s *Store) ReadCursor(ctx context.Context) (Cursor, error) {
	var c Cursor
	err := s.pool.QueryRow(ctx,
		`SELECT last_received_at, last_event_id FROM projection_state WHERE name = $1`,
		CursorName).Scan(&c.LastReceivedAt, &c.LastEventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Cursor{}, nil
	}
	if err != nil {
		return Cursor{}, fmt.Errorf("store: no se pudo leer el cursor: %w", err)
	}
	return c, nil
}

// ResetCursor borra el cursor para reproyectar desde cero.
func (s *Store) ResetCursor(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM projection_state WHERE name = $1`, CursorName)
	if err != nil {
		return fmt.Errorf("store: no se pudo borrar el cursor: %w", err)
	}
	return nil
}

// SaveCursor avanza el cursor hasta el último evento de la página.
func (s *Store) SaveCursor(ctx context.Context, c Cursor) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO projection_state (name, last_received_at, last_event_id, updated_at)
		VALUES ($1::text, $2::timestamptz, $3::uuid, now())
		ON CONFLICT (name) DO UPDATE SET
			last_received_at = excluded.last_received_at,
			last_event_id = excluded.last_event_id,
			updated_at = now()`,
		CursorName, c.LastReceivedAt, c.LastEventID)
	if err != nil {
		return fmt.Errorf("store: no se pudo guardar el cursor: %w", err)
	}
	return nil
}

// PendingEvents lee la siguiente página con un cursor estable sobre
// (received_at, id). El par es necesario: `received_at` no es único.
func (s *Store) PendingEvents(ctx context.Context, c Cursor, feed string, limit int) ([]PendingEvent, error) {
	const base = `
		SELECT id, payload, received_at FROM raw_events
		WHERE feed = $1::text`
	const ordered = ` ORDER BY received_at, id LIMIT $2`

	var rows pgx.Rows
	var err error
	if c.Exists() {
		rows, err = s.pool.Query(ctx,
			base+` AND (received_at, id) > ($3::timestamptz, $4::uuid)`+
				` ORDER BY received_at, id LIMIT $2`,
			feed, limit, c.LastReceivedAt, c.LastEventID)
	} else {
		rows, err = s.pool.Query(ctx, base+ordered, feed, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("store: no se pudieron leer los eventos: %w", err)
	}
	defer rows.Close()

	var events []PendingEvent
	for rows.Next() {
		var e PendingEvent
		if err := rows.Scan(&e.ID, &e.Payload, &e.ReceivedAt); err != nil {
			return nil, fmt.Errorf("store: fila ilegible: %w", err)
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

const upsertActivationSQL = `
INSERT INTO service_runs (provider, provider_run_id, service_date, status, toc_id, headcode, scheduled_departure)
VALUES ($1::text, $2::text, $3::date, 'activated', $4, $5, $6::timestamptz)
ON CONFLICT (provider, service_date, provider_run_id) DO UPDATE SET
	toc_id = coalesce(service_runs.toc_id, excluded.toc_id),
	headcode = coalesce(service_runs.headcode, excluded.headcode),
	scheduled_departure = coalesce(excluded.scheduled_departure, service_runs.scheduled_departure)
RETURNING id`

// UpsertActivation registra la circulación activada y devuelve su id.
//
// Una activación no debe degradar a un tren que ya circula: si la circulación
// existe, solo se completan los datos que falten y el estado se deja como
// está. Por eso el `coalesce` va con el valor existente primero.
func (s *Store) UpsertActivation(ctx context.Context, a projection.Activation) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, upsertActivationSQL,
		projection.Provider, a.ProviderRunID, a.ServiceDate,
		nullable(a.TocID), nullable(a.Headcode), nullableTime(a.ScheduledDeparture)).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("store: no se pudo guardar la activación: %w", err)
	}
	return id, nil
}

const upsertMovementSQL = `
INSERT INTO service_runs (provider, provider_run_id, service_date, status, delay_seconds, toc_id, headcode)
VALUES ($1::text, $2::text, $3::date, $4::text, $5, $6, $7)
ON CONFLICT (provider, service_date, provider_run_id) DO UPDATE SET
	status = excluded.status,
	delay_seconds = coalesce(excluded.delay_seconds, service_runs.delay_seconds),
	toc_id = coalesce(excluded.toc_id, service_runs.toc_id),
	headcode = coalesce(excluded.headcode, service_runs.headcode)
RETURNING id`

// UpsertMovement registra el movimiento y devuelve el id de la circulación.
func (s *Store) UpsertMovement(ctx context.Context, m projection.Movement) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, upsertMovementSQL,
		projection.Provider, m.ProviderRunID, m.ServiceDate, string(m.Status),
		m.DelaySeconds, nullable(m.TocID), nullable(m.Headcode)).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("store: no se pudo guardar el movimiento: %w", err)
	}
	return id, nil
}

// ResolveStanox busca el punto de un código de ubicación.
//
// Un STANOX puede corresponder a varios TIPLOC con puntos distintos. En ese
// caso no se elige uno: devuelve ok=false y la posición queda `unknown` en
// lugar de inventada.
func (s *Store) ResolveStanox(ctx context.Context, stanox string) (point string, ok bool, err error) {
	if stanox == "" {
		return "", false, nil
	}
	var points int
	var wkt *string
	err = s.pool.QueryRow(ctx, `
		SELECT count(DISTINCT point)::int, min(point)::text
		FROM locations WHERE stanox = $1::text AND point IS NOT NULL`, stanox).Scan(&points, &wkt)
	if err != nil {
		return "", false, fmt.Errorf("store: no se pudo resolver el STANOX: %w", err)
	}
	if points != 1 || wkt == nil {
		return "", false, nil
	}
	return *wkt, true, nil
}

const upsertPositionSQL = `
INSERT INTO train_positions (run_id, point, quality, source, observed_at, received_at)
VALUES ($1::uuid, $2::geometry, $3::position_quality, 'TRUST', $4::timestamptz, $5::timestamptz)
ON CONFLICT (run_id) DO UPDATE SET
	point = excluded.point, quality = excluded.quality, source = excluded.source,
	observed_at = excluded.observed_at, received_at = excluded.received_at
WHERE excluded.observed_at >= train_positions.observed_at`

// UpsertPosition guarda la posición. El `WHERE` del DO UPDATE impide que un
// evento más antiguo pise una posición más reciente: el feed no garantiza
// orden y sin esa guarda el tren retrocedería en el mapa.
func (s *Store) UpsertPosition(ctx context.Context, runID, point string, observedAt, receivedAt time.Time) error {
	quality := "unknown"
	var geometry any
	if point != "" {
		quality = "reported"
		geometry = point
	}
	_, err := s.pool.Exec(ctx, upsertPositionSQL, runID, geometry, quality, observedAt, receivedAt)
	if err != nil {
		return fmt.Errorf("store: no se pudo guardar la posición: %w", err)
	}
	return nil
}

// ScheduleCoverage resume cuántas circulaciones tienen horario enlazado.
type ScheduleCoverage struct {
	LinkedNow    int
	Runs         int
	WithSchedule int
}

// LinkSchedules enlaza circulaciones con su horario a través de la activación
// `0001`, que es el único mensaje que trae `train_uid`. Los movimientos no lo
// llevan, así que sin haber capturado la activación no hay enlace posible.
//
// La unión es por `train_uid` y fecha de inicio, sin el indicador STP. El
// campo `schedule_type` de la activación no es ese indicador: sobre 63
// activaciones reales decía `O` donde el horario de esa fecha era `P`, y al
// revés. Por uid y fecha coincidieron 53 de 63 sin una sola ambigüedad.
func (s *Store) LinkSchedules(ctx context.Context) (ScheduleCoverage, error) {
	var coverage ScheduleCoverage

	tag, err := s.pool.Exec(ctx, `
		UPDATE service_runs r SET schedule_id = s.id
		FROM raw_events e
		JOIN schedules s
			ON s.uid = e.payload->'body'->>'train_uid'
		   AND s.valid_from = (e.payload->'body'->>'schedule_start_date')::date
		WHERE e.payload->'header'->>'msg_type' = '0001'
		  AND r.provider_run_id = e.payload->'body'->>'train_id'
		  AND r.schedule_id IS NULL`)
	if err != nil {
		return coverage, fmt.Errorf("store: no se pudieron enlazar los horarios: %w", err)
	}
	coverage.LinkedNow = int(tag.RowsAffected())

	err = s.pool.QueryRow(ctx, `
		SELECT count(*)::int, count(schedule_id)::int FROM service_runs`).
		Scan(&coverage.Runs, &coverage.WithSchedule)
	if err != nil {
		return coverage, fmt.Errorf("store: no se pudo contar la cobertura: %w", err)
	}
	return coverage, nil
}

// State es el resumen que la proyección publica al terminar cada pasada.
type State struct {
	Runs      int
	Positions int
	Reported  int
	Unknown   int
	Activated int
}

// ReadState cuenta lo que hay tras proyectar.
func (s *Store) ReadState(ctx context.Context) (State, error) {
	var st State
	err := s.pool.QueryRow(ctx, `
		SELECT (SELECT count(*)::int FROM service_runs),
		       (SELECT count(*)::int FROM train_positions),
		       (SELECT count(*)::int FROM train_positions WHERE quality = 'reported'),
		       (SELECT count(*)::int FROM train_positions WHERE quality = 'unknown'),
		       (SELECT count(*)::int FROM service_runs WHERE status = 'activated')`).
		Scan(&st.Runs, &st.Positions, &st.Reported, &st.Unknown, &st.Activated)
	if err != nil {
		return st, fmt.Errorf("store: no se pudo leer el estado: %w", err)
	}
	return st, nil
}

// nullable convierte la cadena vacía en NULL: la base distingue "sin dato" de
// "cadena vacía" y los `coalesce` de los upsert dependen de ello.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}
