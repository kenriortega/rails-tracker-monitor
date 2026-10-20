# Rails Tracker Monitor

Central ferroviaria experimental con Next.js, shadcn/ui, MapLibre y una base de persistencia Drizzle + PostgreSQL/PostGIS.

## Entrega actual

Central de operaciones sobre **datos reales** de Network Rail. El feed MOVEMENT se ingiere, se proyecta y se sirve al navegador: snapshot inicial y cambios en vivo por SSE, con el mapa dibujando las posiciones reportadas sobre capas WebGL.

Solo se sirven las circulaciones que han reportado en las últimas dos horas; las que llevan más de quince minutos sin señal se marcan como tales y se atenúan en el mapa. Más límites que la propia interfaz declara: son **reportes de paso por ubicaciones, no GPS**; las marcas de tiempo tienen **resolución de un minuto**; y alrededor de una cuarta parte de las circulaciones **no resuelve a una coordenada** y solo aparece en una lista aparte. El headcode se extrae del identificador de circulación. Origen y destino dependen del horario, enlazado en una fracción mínima de los trenes. Nunca usar este proyecto para decisiones operativas o de viaje.

## Ejecutar

Requiere Node.js 22+.

```sh
npm install
npm run dev
```

Abrir http://127.0.0.1:3000. La interfaz **requiere la base levantada y datos proyectados**: ver las secciones siguientes. El mapa base descarga teselas vectoriales de OpenFreeMap/OpenStreetMap: necesita conexión a internet. Si falla, los trazados de demostración siguen disponibles sobre fondo oscuro; si WebGL no está disponible, permanecen la lista y el inspector. Se usa Webpack porque Turbopack no pudo iniciar sus procesos locales en el entorno de desarrollo inicial.

```sh
npm run typecheck
npm test
npm run build
npm run db:generate
```

## Base de datos local

La demo no la necesita. Hace falta para la ingesta persistente que viene.

```sh
docker compose up -d
npm run db:migrate
```

Levanta PostgreSQL 16 con PostGIS 3.5 en `127.0.0.1:5434` y aplica las migraciones de `packages/db/drizzle`. El puerto no es el 5432 habitual porque en la máquina de desarrollo ya lo ocupaban otros proyectos; `DATABASE_URL` en `.env` debe coincidir con el del `compose.yaml`. La imagen solo publica amd64, así que en Apple Silicon corre emulada.

Las credenciales del contenedor son triviales a propósito: escucha solo en localhost y nunca recibe datos de producción. `docker compose down` lo detiene; añadir `-v` borra también el volumen y con él los datos.

## Carga de ubicaciones

```sh
curl -o naptan.xml "https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=xml"
npm run import:naptan -- --file=naptan.xml
```

Carga las estaciones de NaPTAN en `locations` con sus coordenadas WGS84. El fichero ronda los 580 MB porque el TIPLOC solo aparece en el XML; el CSV de NaPTAN no lo incluye. La carga es idempotente: repetirla actualiza las filas existentes en lugar de duplicarlas. Si hay credenciales de Network Rail, además rellena el STANOX desde CORPUS.

Cubre **el 76,7 % de los eventos observados**: NaPTAN solo tiene estaciones, y los cruces, bucles y señales quedan sin posición. Nueve STANOX se corresponden con puntos distintos entre sí; esa ambigüedad se conserva en los datos en lugar de resolverse en la carga. Ver la [auditoría de fuentes geográficas](docs/geographic-sources.md).

Contiene datos de NaPTAN del Department for Transport, bajo [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

## Proyección

```sh
npm run project
npm run project -- --loop=60
npm run project -- --reset
```

Lee `raw_events` con un cursor y mantiene `service_runs` y `train_positions`. Va **aparte de la ingesta a propósito**: un error de proyección no detiene la captura, y `--reset` permite rehacerla desde cero tras corregir la lógica.

Para ingesta continua se lanzan los dos procesos a la vez, el consumidor y la proyección con `--loop`. Ambos paran con Ctrl+C o `SIGTERM`. **La poda no se ejecuta sola**: con el consumidor en marcha de forma permanente, `npm run prune` debe ejecutarse periódicamente o la base crecerá unos 370 MB diarios.

Una posición solo es `reported` cuando su STANOX resuelve a un punto único en `locations`. Si no resuelve, o si resuelve a puntos distintos, queda `unknown` **sin coordenada inventada**.

Dos limitaciones declaradas: la fecha de servicio se deriva de la fecha londinense del evento, así que un tren que cruce medianoche producirá dos circulaciones; y el headcode queda nulo porque la descomposición de `train_id` no está verificada.

## Importación del horario

```sh
npm run import:schedule
npm run import:schedule -- --date=2026-10-21 --file=schedule.json.gz
```

Descarga SCHEDULE, conserva solo los horarios cuya validez cubre la fecha indicada y los guarda en `schedules`. Medido: 815.030 líneas, **94.505 horarios vigentes y 241 MB de tabla**, en unos ocho minutos. Importar el fichero entero multiplicaría ese volumen sin poder aprovecharlo.

**El enlace es hoy casi inexistente: 2 de 1.229 circulaciones.** Un horario solo se puede asociar a través del mensaje de activación, que es el único que trae `train_uid` y se emite horas antes de que el tren circule. Con capturas cortas no se ven. Origen y destino aparecen únicamente en las circulaciones enlazadas; el resto muestra «sin enlace». La proporción debería subir con ingesta continua, y conviene medirla antes de sacar conclusiones.

## Retención

```sh
npm run prune -- --dry-run
npm run prune -- --days=7
```

Borra los eventos originales fuera de la ventana y las proyecciones que ya no se sirven. **Nunca borra por delante del cursor de proyección**: si la proyección va retrasada o está detenida, retiene los eventos en lugar de perderlos sin proyectar.

Medido sobre datos reales: 1.229 bytes por fila y unos 210 eventos por minuto de captura, es decir del orden de 300.000 registros y **370 MB al día**. Con siete días son unos 2,6 GB.

El coste de esta política es explícito: **más allá de la ventana no se puede reproyectar**. Esa capacidad es la que permite corregir la lógica y rehacer el estado, así que acortar la ventana tiene un precio real.

El comando se ejecuta a mano. Programarlo es una decisión de operación, no de código.

## Ingesta persistente

```sh
npm run ingest
```

Consume MOVEMENT y guarda cada registro en `raw_events`. Requiere la base levantada y las credenciales en `.env`. Se detiene con Ctrl+C: deja de confirmar mensajes, espera la escritura en curso y cierra la conexión y el pool.

Confirma cada mensaje al broker **después** de que su transacción haya hecho commit, nunca antes. La clave de deduplicación es el SHA-256 del registro con las claves ordenadas, así que una reentrega tras reconectar no crea filas nuevas. Reconecta con retroceso exponencial hasta 60 segundos y registra los huecos; **lo emitido mientras no había sesión no se puede recuperar**: el broker no lo reenvía.

Esta entrega solo escribe `raw_events`. No proyecta posiciones ni alimenta la interfaz, que sigue en modo demo. **No hay política de retención**: la tabla crece sin límite mientras el proceso corra.

## API en vivo

Con la base levantada y la proyección al día, el servidor de desarrollo expone:

- `GET /api/snapshot`: circulaciones con reporte en las últimas dos horas, con una `version` que sirve de cursor.
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

## Integración operativa pendiente

1. Revisar el resultado del diagnóstico de acceso y cobertura.
2. Ampliar la auditoría a intervalos representativos y explicar los eventos cuya marca de tiempo sigue por delante de la recepción tras corregir el offset.
3. Resolver identidades, códigos y geometría del corredor piloto; ver la [auditoría de fuentes geográficas](docs/geographic-sources.md).
4. Proyectar circulaciones y posiciones desde `raw_events`, y publicar snapshots y SSE.
5. Definir retención y archivado de `raw_events` antes de ingerir de forma continuada.

No hay despliegue. La base de desarrollo y las migraciones ya existen en local. La interfaz continúa en modo demo. El diagnóstico ya carga las credenciales de `.env`; las credenciales jamás llevan prefijo `NEXT_PUBLIC_`.

## Referencias

- [Catálogo Network Rail](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/)
- [TRUST](https://wiki.openraildata.com/index.php/Train_Movements)
- [TD C-Class](https://wiki.openraildata.com/index.php/C_Class_Messages)
- [Datos de referencia](https://wiki.openraildata.com/index.php/Reference_data)
- [STOMP](https://wiki.openraildata.com/index.php/Connecting_with_Stomp)

Este proyecto no está afiliado a Network Rail ni se presenta como servicio oficial.
