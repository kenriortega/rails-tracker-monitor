# Rails Tracker Monitor

Central ferroviaria experimental con Next.js, shadcn/ui, MapLibre y una base de persistencia Drizzle + PostgreSQL/PostGIS.

## Entrega actual

Central de operaciones sobre **datos reales** de Network Rail. El feed MOVEMENT se ingiere, se proyecta y se sirve al navegador: snapshot inicial y cambios en vivo por SSE, con el mapa dibujando las posiciones reportadas sobre capas WebGL.

También se proyectan las **activaciones**: trenes previstos para hoy que aún no han reportado posición. Aparecen con estado «activado», con su hora de salida prevista y su recorrido según horario, pero sin punto en el mapa. Su ventana **no se mide por antigüedad del último reporte**, porque no tienen ninguno: se ancla a la salida prevista del origen, desde tres horas antes hasta una hora después. Sin ellos solo se verían los que ya circulan, y su horario ya se conoce.

Al seleccionar una circulación se dibuja **por dónde ha pasado**, reconstruido desde `raw_events`. `train_positions` guarda solo la posición actual, así que el recorrido no está proyectado: se deriva de los eventos y por tanto solo alcanza hasta donde llegue la retención. La línea es discontinua a propósito, porque une puntos reportados y **no sigue la vía**; además salta por encima de las ubicaciones que no resuelven a coordenada, que son mayoría en cruces y bucles.

Solo se sirven las circulaciones que han reportado en las últimas dos horas; las que llevan más de quince minutos sin señal se marcan como tales y se atenúan en el mapa. Más límites que la propia interfaz declara: son **reportes de paso por ubicaciones, no GPS**; las marcas de tiempo tienen **resolución de un minuto**; y alrededor de una cuarta parte de las circulaciones **no resuelve a una coordenada** y solo aparece en una lista aparte. El headcode se extrae del identificador de circulación y está confirmado contra SCHEDULE. Origen y destino dependen de enlazar el tren con su horario, lo que exige haber capturado su activación: con unas horas de ingesta continua ronda el 9 % de las circulaciones almacenadas, y sube según avanza el día. Nunca usar este proyecto para decisiones operativas o de viaje.

## Qué tienes que hacer

Guía completa de operación. Las secciones siguientes detallan cada pieza; esta dice el orden.

### Antes de nada

- Node.js 22 o superior y Docker en marcha.
- `npm install` en la raíz.
- Credenciales del portal de Network Rail en `.env` de la raíz, copiando `.env.example`. Son las del portal, no las del wiki de Open Rail Data. Si la contraseña lleva `#`, encierra el valor entre comillas.

### Primera vez, o tras borrar el volumen

La base ya no vive en este repositorio: la levanta `infra-common`, compartida
con los demás proyectos del workspace, con separación lógica por esquema. Este
proyecto ocupa el esquema `rails` y entra con el rol `rails_app`, cuyo
`search_path` lo apunta ahí, de modo que las consultas no cualifican ningún
nombre de tabla.

```sh
cd ../infra-common && docker compose --env-file .env up -d && cd -
```

```sh
npm run db:migrate
```

Los programas de ingesta son los de `apps/ingestor-go`; todas las órdenes que siguen se lanzan desde ese directorio.

```sh
curl -o naptan.xml "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=xml"
cd apps/ingestor-go
go run ./cmd/import-naptan --file=../../naptan.xml
```

```sh
go run ./cmd/import-schedule
```

La descarga de NaPTAN ronda los 580 MB y la carga tarda unos ocho segundos. El horario se descarga solo y tarda unos ocho minutos. Después puedes borrar `naptan.xml`.

### Cada vez que quieras ver datos

Tres terminales, o los dos primeros en segundo plano:

```sh
cd ../infra-common && docker compose --env-file .env up -d && cd -
```

```sh
cd apps/ingestor-go && go build -o bin/ingestor ./cmd/ingestor && ./bin/ingestor
```

```sh
cd apps/ingestor-go && go run ./cmd/project --loop=60
```

```sh
npm run dev
```

Abrir http://127.0.0.1:3000. Tarda un par de minutos en tener trenes suficientes para que la pantalla resulte útil.

### Mantenimiento

**La poda no se ejecuta sola en local.** Con el consumidor en marcha de forma permanente, la base crece unos 370 MB al día:

```sh
go run ./cmd/prune --dry-run
go run ./cmd/prune
```

**El horario caduca.** Vuelve a importarlo cada día, o el origen y el destino dejarán de resolverse para los trenes nuevos:

```sh
go run ./cmd/import-schedule
```

En producción las dos tareas sí van solas, con temporizadores de systemd: `trackers-rails-schedule.timer` a las 02:00 y `trackers-rails-prune.timer` a las 03:30. Están definidos en el repositorio `infra-common`.

NaPTAN cambia poco: con rehacerlo cada pocos meses basta.

### Apagar

```sh
cd ../infra-common && docker compose --env-file .env down && cd -
```

Detén antes el consumidor, la proyección y el servidor de desarrollo con Ctrl+C. `docker compose down` en `infra-common` **conserva los datos** en su volumen; añadir `-v` los borra, y con ellos los de todos los proyectos que comparten esa base.

### Comprobar que todo sigue sano

```sh
npm test
npm run typecheck
npm run build
npm run diagnose:network-rail
```

## Ingestores en Go

Los cinco programas de ingesta están portados a Go en
[`apps/ingestor-go`](apps/ingestor-go/), por memoria: en el proyecto hermano el
mismo cambio bajó un worker de ~120 MB de RSS a 7,7 MB, y aquí los procesos
permanentes son dos. **Todavía no es lo que se ejecuta**; los dos árboles
conviven hasta desplegarlo y medirlo. El [ADR 0001](docs/decisions/0001-ingestores-en-go.md)
explica las decisiones y lo que falta para darlo por terminado.

## Notas del entorno

El mapa base descarga teselas vectoriales de OpenFreeMap/OpenStreetMap, así que necesita conexión a internet. Si fallan, los trenes se siguen dibujando sobre el fondo oscuro; si no hay WebGL, el mapa desaparece pero la lista y el inspector siguen funcionando.

Se usa Webpack en lugar de Turbopack porque este último no pudo abrir sus puertos internos en el entorno de desarrollo inicial.

`npm run db:generate` regenera las migraciones tras tocar el esquema. Drizzle no genera secuencias ni triggers: las migraciones `0004` y `0007` llevan SQL escrito a mano.

## Base de datos local

La demo no la necesita. Hace falta para la ingesta persistente que viene.

```sh
cd ../infra-common && docker compose --env-file .env up -d && cd -
npm run db:migrate
```

Levanta PostgreSQL 16 con PostGIS 3.5 en `127.0.0.1:5435` y aplica las migraciones de `packages/db/drizzle`. La base es compartida por los proyectos del workspace, con separación lógica por esquema: este ocupa `rails` y entra con el rol `rails_app`, cuyo `search_path` lo apunta ahí. La imagen solo publica amd64, así que en Apple Silicon corre emulada.

Las credenciales son triviales a propósito: escucha solo en localhost y nunca recibe datos de producción. **Cuidado con `-v`:** esa base la comparten varios proyectos, así que `docker compose down -v` en `infra-common` borra también los datos de los demás.

## Carga de ubicaciones

```sh
curl -o naptan.xml "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=xml"
cd apps/ingestor-go && go run ./cmd/import-naptan --file=../../naptan.xml
```

Carga las estaciones de NaPTAN en `locations` con sus coordenadas WGS84. El fichero ronda los 580 MB porque el TIPLOC solo aparece en el XML; el CSV de NaPTAN no lo incluye. La carga es idempotente: repetirla actualiza las filas existentes en lugar de duplicarlas. Si hay credenciales de Network Rail, además rellena el STANOX desde CORPUS.

Cubre **el 76,7 % de los eventos observados**: NaPTAN solo tiene estaciones, y los cruces, bucles y señales quedan sin posición. Nueve STANOX se corresponden con puntos distintos entre sí; esa ambigüedad se conserva en los datos en lugar de resolverse en la carga. Ver la [auditoría de fuentes geográficas](docs/geographic-sources.md).

Contiene datos de NaPTAN del Department for Transport, bajo [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## Proyección

```sh
go run ./cmd/project
go run ./cmd/project --loop=60
go run ./cmd/project --reset
```

Lee `raw_events` con un cursor y mantiene `service_runs` y `train_positions`. Va **aparte de la ingesta a propósito**: un error de proyección no detiene la captura, y `--reset` permite rehacerla desde cero tras corregir la lógica.

Para ingesta continua se lanzan los dos procesos a la vez, el consumidor y la proyección con `--loop`. Ambos paran con Ctrl+C o `SIGTERM`, pero **`go run` no reenvía SIGTERM**: para un proceso de larga vida hay que compilar primero (`go build -o bin/ingestor ./cmd/ingestor`), o un Ctrl+C deja el ingestor huérfano hablando con el feed. **La poda no se ejecuta sola en local**: con el consumidor en marcha de forma permanente, `go run ./cmd/prune` debe ejecutarse periódicamente o la base crecerá unos 370 MB diarios.

Una posición solo es `reported` cuando su STANOX resuelve a un punto único en `locations`. Si no resuelve, o si resuelve a puntos distintos, queda `unknown` **sin coordenada inventada**.

Dos limitaciones declaradas: la fecha de servicio se deriva de la fecha londinense del evento, así que un tren que cruce medianoche producirá dos circulaciones; y el headcode queda nulo porque la descomposición de `train_id` no está verificada.

## Importación del horario

```sh
go run ./cmd/import-schedule
go run ./cmd/import-schedule --date=2026-10-21 --file=schedule.json.gz
```

Descarga SCHEDULE, conserva solo los horarios cuya validez cubre la fecha indicada y los guarda en `schedules`. Medido: 815.030 líneas, **94.505 horarios vigentes y 241 MB de tabla**, en unos ocho minutos. Importar el fichero entero multiplicaría ese volumen sin poder aprovecharlo.

**El enlace es hoy casi inexistente: 2 de 1.229 circulaciones.** Un horario solo se puede asociar a través del mensaje de activación, que es el único que trae `train_uid` y se emite horas antes de que el tren circule. Con capturas cortas no se ven. Origen y destino aparecen únicamente en las circulaciones enlazadas; el resto muestra «sin enlace». La proporción debería subir con ingesta continua, y conviene medirla antes de sacar conclusiones.

## Retención

```sh
go run ./cmd/prune --dry-run
go run ./cmd/prune --days=7
```

Borra los eventos originales fuera de la ventana y las proyecciones que ya no se sirven. **Nunca borra por delante del cursor de proyección**: si la proyección va retrasada o está detenida, retiene los eventos en lugar de perderlos sin proyectar.

Medido sobre datos reales: 1.229 bytes por fila y unos 210 eventos por minuto de captura, es decir del orden de 300.000 registros y **370 MB al día**. Con siete días son unos 2,6 GB.

El coste de esta política es explícito: **más allá de la ventana no se puede reproyectar**. Esa capacidad es la que permite corregir la lógica y rehacer el estado, así que acortar la ventana tiene un precio real.

En local el comando se ejecuta a mano. En el VPS lo lanza `trackers-rails-prune.timer` cada madrugada, con la misma imagen y otro `entrypoint`.

## Ingesta persistente

```sh
go build -o bin/ingestor ./cmd/ingestor && ./bin/ingestor
```

Compilar antes de ejecutar no es manía: `go run` no reenvía SIGTERM, así que un proceso interrumpido así se queda huérfano hablando con el feed.

Consume MOVEMENT y guarda cada registro en `raw_events`. Requiere la base levantada y las credenciales en `.env`. Se detiene con Ctrl+C: deja de confirmar mensajes, espera la escritura en curso y cierra la conexión y el pool.

Confirma cada mensaje al broker **después** de que su transacción haya hecho commit, nunca antes. La clave de deduplicación es el SHA-256 del registro con las claves ordenadas, así que una reentrega tras reconectar no crea filas nuevas. Reconecta con retroceso exponencial hasta 60 segundos y registra los huecos; **lo emitido mientras no había sesión no se puede recuperar**: el broker no lo reenvía.

Esta entrega solo escribe `raw_events`. No proyecta posiciones ni alimenta la interfaz, que sigue en modo demo. **No hay política de retención**: la tabla crece sin límite mientras el proceso corra.

## API en vivo

Con la base levantada y la proyección al día, el servidor de desarrollo expone:

- `GET /api/snapshot`: circulaciones con reporte en las últimas dos horas, con una `version` que sirve de cursor.
- `GET /api/runs/<id>/trail`: por dónde ha pasado esa circulación, reconstruido desde los eventos originales.
- `GET /api/stations`: estaciones con coordenada, para la capa de contexto.
- `GET /api/stream`: cambios por SSE. Acepta `?since=<version>` y respeta la cabecera `Last-Event-ID`, así que una reconexión entrega solo lo posterior.

Los cambios se empujan con `LISTEN/NOTIFY` de PostgreSQL: un trigger sobre `train_positions` avisa, y cada cliente consulta su propio delta desde su cursor. La notificación no lleva contenido a propósito; así, un aviso perdido durante una reconexión no pierde datos.

**Sin autenticación ni límite de conexiones.** Solo escucha en `127.0.0.1`, como el resto. No exponerlo fuera sin añadir ambas cosas.

## Estructura

- `apps/web`: Next.js App Router; componentes shadcn/ui, MapLibre, central de operaciones y la API en vivo.
- `apps/ingestor`: diagnóstico real de CORPUS, SCHEDULE y MOVEMENT, y el consumidor persistente de MOVEMENT hacia `raw_events`.
- `packages/domain`: contratos, identidades por fecha, conversión de hora local de Londres a UTC, fixtures e interpolación geográfica de demostración.
- `packages/db`: cliente PostgreSQL bajo demanda y esquema Drizzle con índices GiST.
- `docs`: análisis de fuentes, auditoría geográfica, arquitectura y siguiente entrega.
- `fixtures`: reglas para capturas reales futuras. Los fixtures sintéticos actuales viven en `packages/domain/src/fixtures.ts` para compartirlos con la interfaz.

## Diagnóstico de acceso real

Configura `NETWORK_RAIL_USERNAME` y `NETWORK_RAIL_PASSWORD` en `.env` en la raíz del proyecto. Son las credenciales del portal de Network Rail, no las de Open Rail Data Wiki. Si la contraseña contiene `#`, encierra el valor completo entre comillas para que no se interprete como comentario.

```sh
npm run diagnose:network-rail
npm run diagnose:network-rail -- --seconds=60
```

El comando carga `.env` sin depender del directorio de trabajo del workspace; las variables ya presentes en el entorno tienen prioridad. Descarga CORPUS en memoria, verifica una muestra acotada del horario y abre una suscripción temporal de MOVEMENT durante 45 segundos (configurable de 10 a 120). No modifica suscripciones del portal ni utiliza una suscripción durable existente. Requiere salida HTTPS al portal y a sus descargas firmadas de S3, y TCP al puerto 61618 del broker.

Guarda exclusivamente un resumen sin credenciales ni mensajes originales en `docs/network-rail-diagnostic.json`, que es un artefacto local excluido del control de versiones. Cada ejecución reemplaza el resumen anterior. La muestra del horario **no valida ni importa el archivo completo**. La correspondencia de códigos CORPUS **no certifica coordenadas geográficas**. Un intervalo sin mensajes es inconcluso y se distingue de un rechazo de autenticación. Las marcas de tiempo se publican crudas y corregidas: TRUST codifica la hora de pared de Londres como si fuera UTC, y la corrección usa el offset vigente en cada evento en lugar de un desplazamiento fijo.

Los errores se muestran como categorías controladas para evitar que mensajes del servidor expongan datos de la cuenta. Las pruebas usan datos sintéticos y respuestas simuladas; no requieren credenciales ni red.

Más detalle: [diagnóstico de Network Rail](docs/network-rail-access.md).

## Decisiones que dependen de ti

Esto no es trabajo pendiente de programar, sino cosas que solo puedes resolver tú.

**Registrarte en Rail Data Marketplace** si quieres cerrar el 23 % de ubicaciones sin coordenada. Los dos productos de BPLAN tienen licencia abierta y son gratuitos para suscriptores; el obstáculo es el alta. Conviene el extracto semanal de OpenTrainTimes antes que el oficial, que se publica dos veces al año. Queda sin comprobar si los ficheros se descargan a demanda o se empujan por SFTP, y eso cambia bastante el trabajo de integrarlos. Ver la [auditoría de fuentes geográficas](docs/geographic-sources.md).

**Decidir si programas la poda.** Hoy es un comando manual. Automatizarla es una decisión de operación, no de código, y nadie debería hacerlo por ti en tu máquina.

**Decidir si aceptas licencias copyleft.** Hay fuentes geográficas con mejor cobertura bajo CC-BY-SA y ODbL, descartadas por ahora porque obligan a publicar las obras derivadas bajo la misma licencia.

## Trabajo pendiente de programar

1. **Lista de paradas y progreso.** El horario ya está en la base con sus `schedule_location` y el recorrido real se sabe reconstruir: es cruzar lo que hay.
2. **Medir con un día completo de ingesta.** La tasa de enlace con el horario y el umbral de frescura se fijaron con muestras cortas; los quince minutos de frescura salen de una distribución contaminada por capturas intermitentes.
3. **Explicar dos cosas sin resolver.** Las llegadas con marca más de un minuto por delante de la recepción, y el significado de `schedule_type` en la activación, que no es el indicador STP.
4. **Geometría real de vía.** Las líneas del mapa unen puntos reportados y no siguen el trazado; eso necesita BPLAN.

No hay despliegue ni infraestructura fuera de tu máquina. Las credenciales jamás llevan prefijo `NEXT_PUBLIC_`.

## Referencias

- [Catálogo Network Rail](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/)
- [TRUST](https://wiki.openraildata.com/index.php/Train_Movements)
- [TD C-Class](https://wiki.openraildata.com/index.php/C_Class_Messages)
- [Datos de referencia](https://wiki.openraildata.com/index.php/Reference_data)
- [STOMP](https://wiki.openraildata.com/index.php/Connecting_with_Stomp)

Este proyecto no está afiliado a Network Rail ni se presenta como servicio oficial.
