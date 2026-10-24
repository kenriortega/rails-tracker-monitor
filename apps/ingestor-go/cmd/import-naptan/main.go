// Comando import-naptan: carga las estaciones de ferrocarril del fichero
// NaPTAN en la tabla locations.
//
// NaPTAN aporta nombre, CRS y coordenada; el STANOX, que es por donde los
// movimientos de TRUST dicen dónde está el tren, solo está en CORPUS. Si no
// hay credenciales del portal, la carga sigue sin él y las posiciones se
// quedarán sin resolver hasta que se repita con credenciales.
//
//	import-naptan --file=NaPTAN.xml
package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/config"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/jsonlog"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/naptan"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/networkrail"
	"github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go/internal/store"
)

// corpusTimeout: el fichero son unos pocos MB.
const corpusTimeout = 5 * time.Minute

// corpusLimit acota la descarga; CORPUS ronda los 10 MB.
const corpusLimit = 64 << 20

func main() {
	if err := run(); err != nil {
		jsonlog.Fail(jsonlog.Fields{"status": "import-failed", "detail": jsonlog.Describe(err)})
		os.Exit(1)
	}
}

// stanoxByTiploc descarga CORPUS. Sin credenciales devuelve un mapa vacío, que
// es una carga peor pero no un fallo.
func stanoxByTiploc(ctx context.Context) map[string]string {
	credentials := config.NetworkRail()
	if !credentials.Present() {
		jsonlog.Info(jsonlog.Fields{"step": "corpus", "skipped": "credentials-missing"})
		return map[string]string{}
	}
	response, err := networkrail.FetchFeed(ctx, networkrail.CorpusPath,
		networkrail.Credentials{Username: credentials.Username, Password: credentials.Password},
		corpusTimeout)
	if err != nil {
		// Los errores del portal pueden llevar el usuario: solo la categoría.
		jsonlog.Fail(jsonlog.Fields{"step": "corpus", "error": networkrail.SafeErrorCode(err)})
		return map[string]string{}
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		jsonlog.Fail(jsonlog.Fields{"step": "corpus", "httpStatus": response.StatusCode})
		return map[string]string{}
	}
	body, err := networkrail.DecodedBody(response.Body, corpusLimit)
	if err != nil {
		jsonlog.Fail(jsonlog.Fields{"step": "corpus", "error": networkrail.SafeErrorCode(err)})
		return map[string]string{}
	}
	defer body.Close()
	byTiploc, err := networkrail.StanoxByTiploc(body)
	if err != nil {
		jsonlog.Fail(jsonlog.Fields{"step": "corpus", "error": networkrail.SafeErrorCode(err)})
		return map[string]string{}
	}
	return byTiploc
}

func run() error {
	// --file=<ruta>, la misma forma que usan los scripts de npm.
	file := flag.String("file", "", "ruta del fichero NaPTAN XML")
	flag.Parse()

	config.LoadDotEnv("")
	databaseURL, err := config.DatabaseURL()
	if *file == "" || err != nil {
		jsonlog.Info(jsonlog.Fields{"status": "usage", "need": "--file=<naptan.xml> y DATABASE_URL"})
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	stanox := stanoxByTiploc(ctx)
	jsonlog.Info(jsonlog.Fields{"step": "corpus", "tiplocsWithStanox": len(stanox)})

	handle, err := os.Open(*file)
	if err != nil {
		return err
	}
	defer handle.Close()

	// El XML pesa cientos de MB, pero las estaciones que salen son unos pocos
	// miles: se lee en streaming y solo se acumula lo extraído.
	var stations []naptan.RailStation
	totals, err := naptan.ParseRailStations(handle, func(station naptan.RailStation) {
		stations = append(stations, station)
	})
	if err != nil {
		return err
	}
	jsonlog.Info(jsonlog.Fields{
		"step": "parse", "stopPoints": totals.StopPoints,
		"railStopPoints": totals.RailStopPoints, "stations": totals.Stations,
		"withoutTiploc": totals.WithoutTiploc, "withoutCoordinates": totals.WithoutCoordinates,
	})

	database, err := store.Open(ctx, databaseURL, 2)
	if err != nil {
		return err
	}
	defer database.Close()

	written, err := database.UpsertLocations(ctx, stations, stanox)
	if err != nil {
		return err
	}
	counted, err := database.CountLocations(ctx)
	if err != nil {
		return err
	}
	jsonlog.Info(jsonlog.Fields{
		"step": "done", "written": written,
		"locations": jsonlog.Fields{
			"total": counted.Total, "withPoint": counted.WithPoint, "withStanox": counted.WithStanox,
		},
	})
	return nil
}
