// Comando ingestor: mantiene la suscripción al feed MOVEMENT de Network Rail y
// guarda cada lote en raw_events.
//
// Es el equivalente en Go de `apps/ingestor/src/index.ts`. Los dos arrancan con
// el mismo .env y escriben las mismas filas.
package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/config"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/jsonlog"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/networkrail"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

func main() {
	if err := run(); err != nil {
		jsonlog.Fail(jsonlog.Fields{"status": "ingest-failed", "detail": jsonlog.Describe(err)})
		os.Exit(1)
	}
}

func run() error {
	config.LoadDotEnv("")

	credentials := config.NetworkRail()
	databaseURL, databaseErr := config.DatabaseURL()
	if !credentials.Present() || databaseErr != nil {
		// Se dice qué falta, nunca qué valor tenía.
		jsonlog.Info(jsonlog.Fields{
			"status":             "configuration-missing",
			"credentialsPresent": credentials.Present(),
			"databaseUrlPresent": databaseErr == nil,
		})
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := store.Open(ctx, databaseURL, 5)
	if err != nil {
		return err
	}
	defer database.Close()

	jsonlog.Info(jsonlog.Fields{"status": "starting", "valuesRedacted": true})

	consumer := networkrail.NewConsumer(
		networkrail.Options{
			Credentials: networkrail.Credentials{
				Username: credentials.Username,
				Password: credentials.Password,
			},
		},
		func(ctx context.Context, rows []records.RawEvent) (int, error) {
			return database.InsertRawEvents(ctx, rows)
		},
		networkrail.Callbacks{
			OnConnected: func(attempt int64) {
				jsonlog.Info(jsonlog.At(jsonlog.Fields{
					"event": "connected", "destination": networkrail.Destination, "attempt": attempt,
				}))
			},
			OnGap: func(unreachable time.Duration) {
				jsonlog.Info(jsonlog.At(jsonlog.Fields{
					"event":              "gap",
					"unreachableSeconds": int(unreachable.Round(time.Second).Seconds()),
					"recoverable":        false,
				}))
			},
			OnError: func(event, code string) {
				jsonlog.Fail(jsonlog.At(jsonlog.Fields{"event": event, "error": code}))
			},
		},
	)

	err = consumer.Run(ctx)
	totals := consumer.Totals()
	jsonlog.Info(jsonlog.At(jsonlog.Fields{
		"event": "stopped", "batches": totals.Batches, "rows": totals.Rows,
		"inserted": totals.Inserted, "duplicates": totals.Duplicates,
		"skipped": totals.Skipped, "reconnects": totals.Reconnects,
	}))
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
