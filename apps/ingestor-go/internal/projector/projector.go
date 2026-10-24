// Package projector lee `raw_events` con un cursor y mantiene
// `service_runs` y `train_positions`.
//
// Va aparte de la ingesta a propósito: un error de proyección no detiene la
// captura, y se puede rehacer desde cero tras corregir la lógica.
package projector

import (
	"context"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/projection"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/records"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

// PageSize es cuántos eventos se leen por vuelta.
const PageSize = 1000

// Totals resume lo que hizo una pasada.
type Totals struct {
	Read        int
	Projected   int
	Activations int
	Skipped     int
	Positions   int
	Unresolved  int
}

// Store es lo que el proyector necesita de la base. Como interfaz y no como
// tipo concreto para poder probar el bucle sin Postgres.
type Store interface {
	ReadCursor(context.Context) (store.Cursor, error)
	SaveCursor(context.Context, store.Cursor) error
	PendingEvents(context.Context, store.Cursor, string, int) ([]store.PendingEvent, error)
	UpsertActivation(context.Context, projection.Activation) (string, error)
	UpsertMovement(context.Context, projection.Movement) (string, error)
	ResolveStanox(context.Context, string) (string, bool, error)
	UpsertPosition(ctx context.Context, runID, point string, observedAt, receivedAt time.Time) error
	LinkSchedules(context.Context) (store.ScheduleCoverage, error)
	ReadState(context.Context) (store.State, error)
}

// Projector mantiene la proyección al día.
type Projector struct {
	store Store
	feed  string
}

// New construye un proyector sobre el feed dado.
func New(s Store, feed string) *Projector {
	if feed == "" {
		feed = records.MovementFeed
	}
	return &Projector{store: s, feed: feed}
}

// Pass procesa todo lo pendiente, página a página, y devuelve el resumen.
func (p *Projector) Pass(ctx context.Context) (Totals, error) {
	var totals Totals
	for {
		more, err := p.page(ctx, &totals)
		if err != nil {
			return totals, err
		}
		if !more {
			return totals, nil
		}
	}
}

// page proyecta una página. Devuelve true cuando puede quedar más.
//
// No hay transacción por página, igual que en la versión de TypeScript: todas
// las escrituras son idempotentes, así que si el proceso muere antes de
// guardar el cursor, la página se repite sin consecuencias.
func (p *Projector) page(ctx context.Context, totals *Totals) (bool, error) {
	cursor, err := p.store.ReadCursor(ctx)
	if err != nil {
		return false, err
	}
	events, err := p.store.PendingEvents(ctx, cursor, p.feed, PageSize)
	if err != nil {
		return false, err
	}
	if len(events) == 0 {
		return false, nil
	}

	for _, event := range events {
		totals.Read++
		if err := p.projectOne(ctx, event, totals); err != nil {
			return false, err
		}
	}

	last := events[len(events)-1]
	if err := p.store.SaveCursor(ctx, store.Cursor{
		LastReceivedAt: last.ReceivedAt,
		LastEventID:    last.ID,
	}); err != nil {
		return false, err
	}
	return len(events) == PageSize, nil
}

func (p *Projector) projectOne(ctx context.Context, event store.PendingEvent, totals *Totals) error {
	if activation, ok := projection.ProjectActivation(event.Payload, event.ReceivedAt); ok {
		totals.Activations++
		runID, err := p.store.UpsertActivation(ctx, activation)
		if err != nil {
			return err
		}
		// Marcador sin coordenada: el tren se conoce, su posición todavía no.
		return p.store.UpsertPosition(ctx, runID, "", activation.ObservedAt, event.ReceivedAt)
	}

	movement, ok := projection.ProjectMovement(event.Payload, event.ReceivedAt)
	if !ok {
		totals.Skipped++
		return nil
	}
	totals.Projected++

	runID, err := p.store.UpsertMovement(ctx, movement)
	if err != nil {
		return err
	}

	point, resolved, err := p.store.ResolveStanox(ctx, movement.Stanox)
	if err != nil {
		return err
	}
	if resolved {
		totals.Positions++
	} else {
		totals.Unresolved++
	}
	return p.store.UpsertPosition(ctx, runID, point, movement.ObservedAt, event.ReceivedAt)
}
