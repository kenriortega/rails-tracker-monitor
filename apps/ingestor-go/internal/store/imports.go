package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/naptan"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/schedule"
)

// BatchSize es cuántas filas se escriben por sentencia en los imports.
const BatchSize = 500

// LocationCounts resume el catálogo de ubicaciones.
type LocationCounts struct {
	Total      int
	WithPoint  int
	WithStanox int
}

// UpsertLocations guarda las estaciones. La carga es idempotente: repetirla
// actualiza las filas en lugar de duplicarlas.
//
// El punto se escribe con SQL explícito y SRID: sin él, la restricción
// `location_point_wgs84` lo rechazaría.
func (s *Store) UpsertLocations(ctx context.Context, stations []naptan.RailStation, stanoxByTiploc map[string]string) (int, error) {
	written := 0
	for start := 0; start < len(stations); start += BatchSize {
		end := min(start+BatchSize, len(stations))
		chunk := stations[start:end]

		err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			batch := &pgx.Batch{}
			for _, station := range chunk {
				batch.Queue(`
					INSERT INTO locations (name, tiploc, stanox, crs, point)
					VALUES ($1, $2::text, $3, $4,
					        ST_SetSRID(ST_MakePoint($5::double precision, $6::double precision), 4326))
					ON CONFLICT (tiploc) DO UPDATE SET
						name = excluded.name, stanox = excluded.stanox,
						crs = excluded.crs, point = excluded.point`,
					nullable(station.Name), station.Tiploc,
					nullable(stanoxByTiploc[station.Tiploc]), nullable(station.CRS),
					station.Longitude, station.Latitude)
			}
			results := tx.SendBatch(ctx, batch)
			for range chunk {
				if _, err := results.Exec(); err != nil {
					_ = results.Close()
					return fmt.Errorf("store: no se pudo guardar la ubicación: %w", err)
				}
			}
			return results.Close()
		})
		if err != nil {
			return written, err
		}
		written += len(chunk)
	}
	return written, nil
}

// CountLocations resume lo que quedó en el catálogo.
func (s *Store) CountLocations(ctx context.Context) (LocationCounts, error) {
	var c LocationCounts
	err := s.pool.QueryRow(ctx, `
		SELECT count(*)::int, count(point)::int,
		       count(*) FILTER (WHERE stanox IS NOT NULL)::int
		FROM locations`).Scan(&c.Total, &c.WithPoint, &c.WithStanox)
	if err != nil {
		return c, fmt.Errorf("store: no se pudieron contar las ubicaciones: %w", err)
	}
	return c, nil
}

// UpsertSchedules guarda un lote de horarios.
func (s *Store) UpsertSchedules(ctx context.Context, records []schedule.Record) (int, error) {
	if len(records) == 0 {
		return 0, nil
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		batch := &pgx.Batch{}
		for _, r := range records {
			batch.Queue(`
				INSERT INTO schedules (uid, valid_from, valid_to, stp_indicator, payload)
				VALUES ($1::text, $2::date, $3::date, $4::text, $5::jsonb)
				ON CONFLICT (uid, valid_from, stp_indicator) DO UPDATE SET
					valid_to = excluded.valid_to, payload = excluded.payload`,
				r.UID, r.ValidFrom, r.ValidTo, r.StpIndicator, string(r.Payload))
		}
		results := tx.SendBatch(ctx, batch)
		for range records {
			if _, err := results.Exec(); err != nil {
				_ = results.Close()
				return fmt.Errorf("store: no se pudo guardar el horario: %w", err)
			}
		}
		return results.Close()
	})
	if err != nil {
		return 0, err
	}
	return len(records), nil
}

// ScheduleCounts resume la tabla de horarios.
type ScheduleCounts struct {
	Total int
	Bytes int64
}

// CountSchedules mide la tabla de horarios.
func (s *Store) CountSchedules(ctx context.Context) (ScheduleCounts, error) {
	var c ScheduleCounts
	err := s.pool.QueryRow(ctx,
		`SELECT count(*)::int, pg_total_relation_size('schedules') FROM schedules`).
		Scan(&c.Total, &c.Bytes)
	if err != nil {
		return c, fmt.Errorf("store: no se pudieron contar los horarios: %w", err)
	}
	return c, nil
}

// PruneReport describe una poda, hecha o simulada.
type PruneReport struct {
	Days             int
	ProjectedUpTo    time.Time
	HasCursor        bool
	EventsBefore     int
	BytesBefore      int64
	Expired          int
	Deletable        int
	HeldByCursor     int
	DeletedEvents    int
	DeletedPositions int
	DeletedRuns      int
	EventsAfter      int
	BytesAfter       int64
}

// pruneBatch es cuántas filas borra cada vuelta.
const pruneBatch = 5000

// ErrNoCursor señala que la proyección no ha corrido nunca.
var ErrNoCursor = errors.New("store: no hay cursor de proyección")

// Prune borra los eventos fuera de la ventana y las proyecciones que ya no se
// sirven.
//
// Nunca borra por delante del cursor de proyección: si la proyección va
// retrasada o está detenida, retiene los eventos en lugar de perderlos sin
// proyectar. El coste de esta política es explícito: más allá de la ventana no
// se puede reproyectar, y esa capacidad es la que permite corregir la lógica y
// rehacer el estado.
func (s *Store) Prune(ctx context.Context, days int, dryRun bool) (PruneReport, error) {
	report := PruneReport{Days: days}

	err := s.pool.QueryRow(ctx, `
		SELECT (SELECT count(*)::int FROM raw_events),
		       pg_total_relation_size('raw_events'),
		       (SELECT count(*)::int FROM raw_events
		        WHERE received_at < now() - make_interval(days => $1))`, days).
		Scan(&report.EventsBefore, &report.BytesBefore, &report.Expired)
	if err != nil {
		return report, fmt.Errorf("store: no se pudo medir la tabla: %w", err)
	}

	cursor, err := s.ReadCursor(ctx)
	if err != nil {
		return report, err
	}
	if !cursor.Exists() {
		return report, ErrNoCursor
	}
	report.ProjectedUpTo, report.HasCursor = cursor.LastReceivedAt, true

	err = s.pool.QueryRow(ctx, `
		SELECT count(*)::int FROM raw_events
		WHERE received_at < now() - make_interval(days => $1) AND received_at <= $2::timestamptz`,
		days, cursor.LastReceivedAt).Scan(&report.Deletable)
	if err != nil {
		return report, fmt.Errorf("store: no se pudo contar lo borrable: %w", err)
	}
	report.HeldByCursor = report.Expired - report.Deletable

	if dryRun {
		return report, nil
	}

	for {
		tag, err := s.pool.Exec(ctx, `
			DELETE FROM raw_events WHERE id IN (
				SELECT id FROM raw_events
				WHERE received_at < now() - make_interval(days => $1)
				  AND received_at <= $2::timestamptz
				ORDER BY received_at LIMIT $3)`,
			days, cursor.LastReceivedAt, pruneBatch)
		if err != nil {
			return report, fmt.Errorf("store: no se pudieron borrar los eventos: %w", err)
		}
		if tag.RowsAffected() == 0 {
			break
		}
		report.DeletedEvents += int(tag.RowsAffected())
	}

	// Las proyecciones sin reporte dentro de la ventana ya no se sirven.
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM train_positions WHERE observed_at < now() - make_interval(days => $1)`, days)
	if err != nil {
		return report, fmt.Errorf("store: no se pudieron borrar las posiciones: %w", err)
	}
	report.DeletedPositions = int(tag.RowsAffected())

	tag, err = s.pool.Exec(ctx, `
		DELETE FROM service_runs r
		WHERE NOT EXISTS (SELECT 1 FROM train_positions p WHERE p.run_id = r.id)`)
	if err != nil {
		return report, fmt.Errorf("store: no se pudieron borrar las circulaciones: %w", err)
	}
	report.DeletedRuns = int(tag.RowsAffected())

	err = s.pool.QueryRow(ctx,
		`SELECT count(*)::int, pg_total_relation_size('raw_events') FROM raw_events`).
		Scan(&report.EventsAfter, &report.BytesAfter)
	if err != nil {
		return report, fmt.Errorf("store: no se pudo medir tras la poda: %w", err)
	}
	return report, nil
}
