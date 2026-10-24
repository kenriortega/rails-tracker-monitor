# ADR 0001: Ingestores en Go

**Estado:** aceptado, desplegado y cerrado el 24 de octubre de 2026. Los tres
criterios de terminación están cumplidos.

## Contexto

El destino es un VPS de 1 vCPU y 2 GB compartido con `Norway-Ship-Tracker`. El
presupuesto de memoria medido en esa máquina deja poco margen:

| Proceso | RSS |
|---|---|
| PostgreSQL + PostGIS | 500-600 MB |
| ships ingestor (TypeScript) | ~120 MB |
| rails consumer | ~150 MB |
| rails projection | ~150 MB |
| las dos webs | ~400 MB |
| **Total con el SO** | **~1,6 GB de 2 GB** |

Postgres y las webs son el 60 % y no se mueven. Los workers sí: en rails son
dos procesos permanentes, que es el doble de lo que ships pone.

El piloto ya se hizo. El ingestor de ships pasó a Go (ADR 0004 de ese
repositorio) y en producción ocupa **7,7 MB de RSS** frente a los ~120 MB de la
versión en Node, con una imagen de 10,5 MB. Eso es lo que hace que este port
deje de ser una conjetura.

El análisis que bloqueaba empezar era además erróneo. En una sesión anterior se
dijo que `packages/domain` estaba "genuinamente compartido" entre el ingestor y
la web, y que por eso el port saldría caro. Comprobado símbolo a símbolo: **no
comparten ni una función.** La web usa `freshness` y `operators`; el ingestor
usa el tiempo de Londres y la identidad del tren. Son dos conjuntos disjuntos
dentro del mismo paquete.

## Decisión

1. **`apps/ingestor-go` porta los cinco programas**: `ingestor` (el consumidor
   STOMP), `project`, `prune`, `import-naptan` e `import-schedule`. `diagnose`
   **no** se porta: es una herramienta de diagnóstico que se ejecuta a mano en
   una máquina de desarrollo, donde Node ya está y nada de esto aplica.

2. **La clave de deduplicación manda sobre cualquier idea de diseño.** Es el
   SHA-256 de la forma canónica de cada registro y ya está escrita en
   `raw_events`. Si Go serializara aunque fuera un número distinto a como lo
   hace `JSON.stringify`, los eventos que ya están en la base dejarían de
   reconocerse como duplicados y la reentrega del broker los escribiría otra
   vez.

   Por eso `internal/records/canonical.go` es un serializador escrito a mano y
   no `encoding/json`, que difiere en tres puntos que aquí importan: escapa
   `<`, `>` y `&`; rellena los exponentes (`1e-07` donde JavaScript escribe
   `1e-7`); y escribe `-0`. La paridad se fija con una prueba sobre ocho cargas
   —caracteres HTML, `-0`, `1e-7`, enteros grandes, unicode, emoji— cuyos
   hashes se compararon contra los que produce el TypeScript.

3. **`pgx/v5` sin ORM.** El TypeScript ya escribía SQL crudo a través de
   `sql` de Drizzle en los cuatro programas que no son el consumidor; solo el
   consumidor usaba el constructor de inserciones, y eso son quince líneas.

4. **`go-stomp/v3` con `client-individual`, confirmando después del commit.**
   Con ack automático una caída entre recibir y escribir perdería eventos sin
   dejar rastro. El `ack` se manda cuando la transacción ya ha hecho commit; si
   la escritura falla no se confirma, el broker reentrega, y la clave de
   deduplicación evita el duplicado. Es la misma política que tenía `stompit`.

5. **El modo de ack es configurable, y eso es una concesión a las pruebas.** El
   servidor STOMP embebido de `go-stomp` no manda la cabecera `ack`, sin la
   cual `client-individual` no se puede ejercitar contra él. En producción el
   valor por omisión es `client-individual`; las pruebas que necesitan el
   servidor embebido lo bajan a `auto`, y la secuencia escribir-antes-de-
   confirmar se prueba aparte, sobre una costura interna que no pasa por la
   red.

6. **La guarda del cursor en `prune` se conserva tal cual.** Nunca se borra por
   delante del cursor de proyección: si la proyección va retrasada o está
   detenida, los eventos caducados se retienen en lugar de perderlos sin
   proyectar. El coste es explícito —más allá de la ventana no se puede
   reproyectar— y es justo esa capacidad la que permite corregir la lógica y
   rehacer el estado.

7. **La base de zonas horarias va embebida en los binarios** (`time/tzdata` en
   `internal/domain`). TRUST codifica sus marcas con el reloj de pared de
   Londres, así que Europe/London es parte de la lógica y no de la máquina. En
   una imagen `scratch` no hay `/usr/share/zoneinfo` y el programa moriría en el
   init del paquete.

8. **La cabecera `Authorization` solo viaja al portal.** Las descargas de
   CORPUS y del horario terminan en una URL firmada de S3 que ya lleva su
   propia autorización en la query; mandar allí también las credenciales
   básicas las expondría a un tercero sin ninguna necesidad. Por eso el cliente
   HTTP sigue los redirecciones a mano en vez de dejárselo a `net/http`.

9. **Las migraciones se quedan en TypeScript.** Portarlas daría dos registros
   de migración sobre las mismas tablas. El esquema necesita un solo dueño.

10. **Una sola imagen con los cinco binarios.** Son el mismo despliegue y
    comparten casi todo el código; separarlos daría cinco imágenes con las
    mismas dependencias dentro y una matriz de versiones que mantener. El
    proceso se elige con `--entrypoint`.

## Consecuencias

**Lo que cuesta.** 3.057 líneas de Go donde había 923 de TypeScript. Casi todo
el exceso está en tres sitios: el serializador canónico escrito a mano, el
manejo explícito de errores, y las estructuras que en TypeScript eran objetos
literales. A cambio hay 1.833 líneas de prueba y 79 pruebas donde el
TypeScript tenía cuatro ficheros de test.

**El tamaño de la imagen es peor que en ships.** 49,3 MB para los cinco
binarios, frente a los 10,5 MB de la imagen de un solo programa de ships. Cada
binario pesa entre 9,3 y 10,4 MB y los cinco enlazan estáticamente las mismas
dependencias, así que el grueso está repetido cinco veces. Un binario único con
subcomandos bajaría la imagen a unos 11 MB; se descartó por ahora para no
mezclar un cambio de estructura con el port, y queda anotado como lo primero
que mirar si el tamaño llega a molestar.

**La memoria todavía no está medida.** El número que justifica el port es el de
ships, no el de rails: aquí no se ha desplegado nada. Hasta que los dos
procesos corran en el VPS, la cifra esperada es una extrapolación.

**La paridad de filas no está verificada contra tráfico real.** En ships se
comprobó escribiendo el mismo fixture por los dos caminos y comparando columna
a columna. Aquí la paridad está cubierta por pruebas —incluidos los hashes de
deduplicación contra los que produce JavaScript— pero no por una ejecución en
paralelo de los dos consumidores sobre el mismo feed.

**Los dos ingestores convivieron**, y mientras lo hicieron cualquier cambio de
lógica había que hacerlo dos veces. Esa deuda se cerró el mismo día que se
desplegó el de Go, así que la convivencia duró horas y no semanas.

## Lo medido al desplegar

El 24 de octubre de 2026 los dos procesos entraron en el VPS y se comprobaron
los dos primeros criterios.

**El RSS, que hasta entonces era una extrapolación del de ships:**

| Proceso | RSS |
|---|---|
| `rails-ingestor` | 6,77 MiB |
| `rails-project` | 6,83 MiB |

13,6 MiB entre los dos, por debajo de los ~20 MB estimados.

**La paridad contra tráfico real**, con los dos consumidores suscritos al mismo
feed y escribiendo sobre la misma base durante cuatro minutos —el de Go en el
VPS, el de TypeScript en el portátil por un túnel SSH—:

| Ventana | Filas | Filas/min | Duplicados |
|---|---|---|---|
| Solo Go | 7.078 | 499,1 | **0** |
| Go + TypeScript | 2.488 | 483,6 | **0** |

`count(*)` y `count(DISTINCT deduplication_key)` coincidieron en todo momento.

Lo que cierra la cuestión no es solo el cero de duplicados, sino el ritmo: con
dos consumidores escribiendo el mismo feed, las filas por minuto no subieron
—bajaron un 3 %, dentro del ruido del propio feed—. Si la clave de
deduplicación no estuviera colapsando los dos flujos, el ritmo habría llegado
a doblarse. La forma canónica compatible con `JSON.stringify` produce el mismo
hash en los dos lenguajes sobre datos reales, y no solo sobre las ocho cargas
de la prueba.

## Cómo se decidirá que está terminado

1. ~~Los dos procesos permanentes corriendo en el VPS con el RSS medido.~~
   **Hecho** el 24 de octubre de 2026.
2. ~~Un periodo con los dos consumidores escribiendo sobre la misma base, que la
   clave de deduplicación hace seguro, comprobando que no aparecen duplicados.~~
   **Hecho** el 24 de octubre de 2026: cero duplicados en 9.701 filas.
3. ~~`apps/ingestor` retirado, dejando `diagnose` como único programa en
   TypeScript.~~ **Hecho** el 24 de octubre de 2026: se fueron los cinco
   programas y los módulos que solo ellos usaban, 1.221 líneas.
