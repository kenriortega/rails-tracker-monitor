// Comando prune: borra los eventos fuera de la ventana de retención y las
// proyecciones que ya no se sirven.
//
// Nunca borra por delante del cursor de proyección. El coste de esta política
// es explícito: más allá de la ventana no se puede reproyectar, y esa
// capacidad es la que permite corregir la lógica y rehacer el estado, así que
// la ventana no debería acortarse sin motivo.
//
//	prune --days=7 --dry-run    dice qué borraría y por qué retiene el resto
package main

import (
	"context"
	"errors"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/config"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/jsonlog"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

const defaultDays = 7

func main() {
	if err := run(); err != nil {
		jsonlog.Fail(jsonlog.Fields{"status": "prune-failed", "detail": jsonlog.Describe(err)})
		os.Exit(1)
	}
}

func run() error {
	days := flag.Int("days", defaultDays, "ventana de retención en días")
	dryRun := flag.Bool("dry-run", false, "no borra nada; solo informa")
	flag.Parse()

	if *days < 1 {
		jsonlog.Info(jsonlog.Fields{"status": "invalid-days", "minimum": 1})
		os.Exit(1)
	}

	config.LoadDotEnv("")
	databaseURL, err := config.DatabaseURL()
	if err != nil {
		jsonlog.Info(jsonlog.Fields{"status": "configuration-missing"})
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	database, err := store.Open(ctx, databaseURL, 2)
	if err != nil {
		return err
	}
	defer database.Close()

	report, err := database.Prune(ctx, *days, *dryRun)
	if errors.Is(err, store.ErrNoCursor) {
		// Sin cursor la proyección no ha corrido nunca: borrar sería perder
		// eventos sin proyectar, así que se sale en fallo y sin tocar nada.
		jsonlog.Info(jsonlog.Fields{
			"status": "blocked", "reason": "projection-cursor-missing",
			"events": report.EventsBefore, "bytes": report.BytesBefore, "expired": report.Expired,
		})
		os.Exit(1)
	}
	if err != nil {
		return err
	}

	fields := jsonlog.Fields{
		"days": report.Days, "projectedUpTo": report.ProjectedUpTo,
		"events": report.EventsBefore, "bytes": report.BytesBefore, "expired": report.Expired,
		"deletable": report.Deletable, "heldByCursor": report.HeldByCursor,
	}
	if *dryRun {
		fields["status"] = "dry-run"
		jsonlog.Info(fields)
		return nil
	}
	fields["status"] = "pruned"
	fields["deletedEvents"] = report.DeletedEvents
	fields["deletedPositions"] = report.DeletedPositions
	fields["deletedRuns"] = report.DeletedRuns
	fields["after"] = jsonlog.Fields{"events": report.EventsAfter, "bytes": report.BytesAfter}
	jsonlog.Info(fields)
	return nil
}
