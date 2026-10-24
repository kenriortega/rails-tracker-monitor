# Ingestores en Go

Port de los cinco programas de `apps/ingestor`. Las razones y lo que queda
pendiente están en el [ADR 0001](../../docs/decisions/0001-ingestores-en-go.md).

**Todavía no es lo que se ejecuta.** `apps/ingestor` sigue siendo el que corre;
estos dos árboles conviven hasta que el port se despliegue y se mida.

## Los cinco programas

| Programa | Qué hace | Equivale a |
|---|---|---|
| `ingestor` | Mantiene la suscripción a MOVEMENT y escribe `raw_events` | `npm run ingest` |
| `project` | Proyecta `raw_events` sobre `service_runs` y `train_positions` | `npm run project` |
| `prune` | Borra lo que cae fuera de la ventana de retención | `npm run prune` |
| `import-naptan` | Carga las estaciones en `locations` | `npm run import:naptan` |
| `import-schedule` | Carga los horarios vigentes en `schedules` | `npm run import:schedule` |

Leen la misma configuración que los de TypeScript: `DATABASE_URL`,
`NETWORK_RAIL_USERNAME` y `NETWORK_RAIL_PASSWORD`, del entorno o del `.env` de
la raíz del repositorio. Lo que venga del entorno manda sobre el fichero.

## En desarrollo

```sh
go test ./...
```

Las pruebas que necesitan Postgres se saltan solas si no hay base; para
ejecutarlas, apunta `RAILS_TEST_DATABASE_URL` a una con las migraciones
aplicadas.

```sh
go run ./cmd/project --loop=60
go run ./cmd/prune --days=7 --dry-run
go run ./cmd/import-naptan --file=naptan.xml
go run ./cmd/import-schedule --date=2026-10-24
```

`go run` no reenvía SIGTERM al programa, así que para el consumidor conviene
compilar primero:

```sh
go build -o bin/ingestor ./cmd/ingestor && ./bin/ingestor
```

## En contenedor

Los cinco binarios van en una imagen `scratch` de unos 49 MB. El consumidor es
el `ENTRYPOINT`; los otros cuatro se eligen al lanzarlos:

```sh
docker build -t rails-ingestor-go .
docker run --rm --env-file ../../.env rails-ingestor-go
docker run --rm --env-file ../../.env --entrypoint /prune rails-ingestor-go --days=7 --dry-run
```
