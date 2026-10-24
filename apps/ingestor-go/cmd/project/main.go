// Comando project: lee raw_events con un cursor estable y mantiene al día
// service_runs y train_positions.
//
// Va aparte de la ingesta a propósito: un error de proyección no detiene la
// captura, y la proyección puede rehacerse desde cero tras corregir la lógica.
//
//	project               una pasada y termina
//	project --loop=30     repite cada 30 s hasta recibir una señal
//	project --reset       olvida el cursor y reproyecta lo que quede
package main

import (
	"context"
	"errors"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/config"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/jsonlog"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/projector"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

// minimumLoopSeconds evita un bucle que machaque la base sin descanso.
const minimumLoopSeconds = 5

func main() {
	if err := run(); err != nil {
		jsonlog.Fail(jsonlog.Fields{"status": "projection-failed", "detail": jsonlog.Describe(err)})
		os.Exit(1)
	}
}

func run() error {
	reset := flag.Bool("reset", false, "olvida el cursor antes de proyectar")
	loop := flag.Int("loop", 0, "repetir cada n segundos (0 = una sola pasada)")
	flag.Parse()

	if *loop != 0 && *loop < minimumLoopSeconds {
		jsonlog.Info(jsonlog.Fields{"status": "invalid-loop", "minimumSeconds": minimumLoopSeconds})
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

	database, err := store.Open(ctx, databaseURL, 5)
	if err != nil {
		return err
	}
	defer database.Close()

	if *reset {
		if err := database.ResetCursor(ctx); err != nil {
			return err
		}
		jsonlog.Info(jsonlog.Fields{"step": "reset", "cursor": store.CursorName})
	}

	engine := projector.New(database, records.MovementFeed)
	for {
		totals, err := engine.Pass(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return nil
			}
			return err
		}
		schedules, err := database.LinkSchedules(ctx)
		if err != nil {
			return err
		}
		state, err := database.ReadState(ctx)
		if err != nil {
			return err
		}
		jsonlog.Info(jsonlog.At(jsonlog.Fields{
			"step": "done",
			"read": totals.Read, "projected": totals.Projected, "activations": totals.Activations,
			"skipped": totals.Skipped, "positions": totals.Positions, "unresolved": totals.Unresolved,
			"state": jsonlog.Fields{
				"runs": state.Runs, "positions": state.Positions, "reported": state.Reported,
				"unknown": state.Unknown, "activated": state.Activated,
			},
			"schedules": jsonlog.Fields{
				"linkedNow": schedules.LinkedNow, "runs": schedules.Runs,
				"withSchedule": schedules.WithSchedule,
			},
		}))

		if *loop == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(time.Duration(*loop) * time.Second):
		}
	}
}
