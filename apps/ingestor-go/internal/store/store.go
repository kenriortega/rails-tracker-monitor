// Package store escribe en PostgreSQL. Es la mitad de escritura de
// `packages/db`; la de lectura la sirve la web desde TypeScript con su propio
// SQL y no tiene reflejo aquí.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
)

// Store es el pool de conexiones contra la base.
type Store struct {
	pool *pgxpool.Pool
}

// Open abre el pool. maxConnections replica el 5 del `createDatabase` de
// TypeScript.
func Open(ctx context.Context, databaseURL string, maxConnections int32) (*Store, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("store: DATABASE_URL es obligatoria")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("store: la cadena de conexión no es válida: %w", err)
	}
	if maxConnections > 0 {
		config.MaxConns = maxConnections
	}
	config.MaxConnIdleTime = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("store: no se pudo crear el pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: la base no responde: %w", err)
	}
	return &Store{pool: pool}, nil
}

// Pool da acceso al pool para los comandos que escriben su propio SQL.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Close cierra el pool y espera a las conexiones en uso.
func (s *Store) Close() { s.pool.Close() }

const insertRawEventSQL = `
INSERT INTO raw_events (feed, deduplication_key, observed_at, received_at, payload)
VALUES ($1::text, $2::text, $3::timestamptz, $4::timestamptz, $5::jsonb)
ON CONFLICT (feed, deduplication_key) DO NOTHING`

// InsertRawEvents guarda un lote y devuelve cuántas filas eran nuevas.
//
// Va todo en una transacción: el consumidor confirma el mensaje al broker solo
// después del commit, así que lo que se confirma tiene que haber entrado
// entero o no haber entrado.
//
// El `ON CONFLICT DO NOTHING` sobre (feed, deduplication_key) es lo que hace
// inofensiva una reentrega tras reconectar: el broker puede repetir mensajes y
// aquí no se duplican.
func (s *Store) InsertRawEvents(ctx context.Context, rows []records.RawEvent) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}

	inserted := 0
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		batch := &pgx.Batch{}
		for _, row := range rows {
			var observedAt any
			if row.HasObservedAt() {
				observedAt = row.ObservedAt
			}
			batch.Queue(insertRawEventSQL, row.Feed, row.DeduplicationKey,
				observedAt, row.ReceivedAt, string(row.Payload))
		}

		results := tx.SendBatch(ctx, batch)
		defer results.Close()
		for range rows {
			tag, err := results.Exec()
			if err != nil {
				return fmt.Errorf("store: no se pudo guardar el evento: %w", err)
			}
			inserted += int(tag.RowsAffected())
		}
		// Cerrar aquí y no solo en el defer: SendBatch deja la conexión
		// ocupada hasta que se agota, y el commit no puede correr antes.
		return results.Close()
	})
	if err != nil {
		return 0, err
	}
	return inserted, nil
}
