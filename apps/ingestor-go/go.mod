// El ingestor en Go vive junto al de TypeScript mientras dure la migración:
// así se pueden arrancar los dos contra la misma base y comparar. Es el mismo
// montaje que se usó en norway-ship-tracker.
module github.com/kenriortega/rails-tracker-monitor/apps/ingestor-go

go 1.25.0

require (
	github.com/go-stomp/stomp/v3 v3.2.1
	github.com/jackc/pgx/v5 v5.11.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.17.0 // indirect
	golang.org/x/text v0.29.0 // indirect
)
