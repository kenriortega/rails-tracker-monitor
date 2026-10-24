// Comando import-schedule: carga en la tabla schedules los horarios vigentes
// una fecha dada, desde el feed del portal o desde un fichero ya descargado.
//
// El horario nacional comprimido ronda los cientos de MB, así que se lee en
// streaming y se escribe por lotes: nunca está entero en memoria.
//
//	import-schedule                        descarga el feed, fecha de hoy
//	import-schedule --file=toc-full.json.gz --date=2026-10-24
package main

import (
	"context"
	"flag"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/config"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/domain"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/jsonlog"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/networkrail"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/schedule"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

const (
	downloadTimeout = 15 * time.Minute
	downloadLimit   = 2 << 30 // 2 GiB
	// Un fichero local no viaja por la red, pero el mismo tope evita que un
	// gzip malformado descomprima sin fin.
	fileLimit = 8 << 30
)

func main() {
	if err := run(); err != nil {
		jsonlog.Fail(jsonlog.Fields{"status": "import-failed", "detail": jsonlog.Describe(err)})
		os.Exit(1)
	}
}

// source abre el origen de los horarios y devuelve también de dónde salió,
// para que la línea de inicio lo diga.
func source(ctx context.Context, file string) (io.ReadCloser, string, error) {
	if file != "" {
		handle, err := os.Open(file)
		if err != nil {
			return nil, "", err
		}
		// Se descomprime por los bytes de cabecera y no por la extensión: el
		// fichero descargado a mano puede no llevar .gz.
		decoded, err := networkrail.DecodedBody(handle, fileLimit)
		if err != nil {
			_ = handle.Close()
			return nil, "", err
		}
		return both{decoded, handle}, "file", nil
	}

	credentials := config.NetworkRail()
	if !credentials.Present() {
		jsonlog.Info(jsonlog.Fields{"status": "credentials-missing"})
		os.Exit(1)
	}
	response, err := networkrail.FetchFeed(ctx, networkrail.SchedulePath,
		networkrail.Credentials{Username: credentials.Username, Password: credentials.Password},
		downloadTimeout)
	if err != nil {
		jsonlog.Fail(jsonlog.Fields{"step": "download", "error": networkrail.SafeErrorCode(err)})
		os.Exit(1)
	}
	if response.StatusCode != 200 {
		_ = response.Body.Close()
		jsonlog.Info(jsonlog.Fields{"status": "http-rejected", "httpStatus": response.StatusCode})
		os.Exit(1)
	}
	decoded, err := networkrail.DecodedBody(response.Body, downloadLimit)
	if err != nil {
		_ = response.Body.Close()
		return nil, "", err
	}
	return both{decoded, response.Body}, "feed", nil
}

// both cierra el descompresor y el origen que tiene debajo.
type both struct {
	io.ReadCloser
	under io.Closer
}

func (b both) Close() error {
	err := b.ReadCloser.Close()
	if closeErr := b.under.Close(); err == nil {
		err = closeErr
	}
	return err
}

func run() error {
	file := flag.String("file", "", "fichero ya descargado; si falta, se baja del portal")
	date := flag.String("date", "", "fecha ISO que debe cubrir el horario (por omisión, hoy en Londres)")
	flag.Parse()

	config.LoadDotEnv("")
	databaseURL, err := config.DatabaseURL()
	if err != nil {
		jsonlog.Info(jsonlog.Fields{"status": "configuration-missing"})
		os.Exit(1)
	}
	covering := *date
	if covering == "" {
		// La fecha de servicio sigue el reloj de Londres, no el del servidor.
		covering = domain.LondonServiceDate(time.Now())
	}
	if !isISODate(covering) {
		jsonlog.Info(jsonlog.Fields{"status": "invalid-date"})
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	reader, origin, err := source(ctx, *file)
	if err != nil {
		return err
	}
	defer reader.Close()
	jsonlog.Info(jsonlog.Fields{"step": "start", "coveringDate": covering, "source": origin})

	database, err := store.Open(ctx, databaseURL, 2)
	if err != nil {
		return err
	}
	defer database.Close()

	var pending []schedule.Record
	written := 0
	flush := func() error {
		if len(pending) == 0 {
			return nil
		}
		count, err := database.UpsertSchedules(ctx, pending)
		if err != nil {
			return err
		}
		written += count
		pending = pending[:0]
		return nil
	}

	totals, err := schedule.Read(reader, covering, func(record schedule.Record) error {
		pending = append(pending, record)
		if len(pending) >= store.BatchSize {
			return flush()
		}
		return nil
	})
	if err != nil {
		return err
	}
	if err := flush(); err != nil {
		return err
	}

	counted, err := database.CountSchedules(ctx)
	if err != nil {
		return err
	}
	jsonlog.Info(jsonlog.Fields{
		"step": "done", "lines": totals.Lines, "schedules": totals.Schedules,
		"skipped": totals.Skipped, "outsideWindow": totals.OutsideWindow,
		"cancellations": totals.Cancellations, "written": written,
		"stored": jsonlog.Fields{"total": counted.Total, "bytes": counted.Bytes},
	})
	return nil
}

func isISODate(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil && len(value) == 10
}
