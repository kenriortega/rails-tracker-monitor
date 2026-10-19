# Diagnóstico de Network Rail

Esta herramienta comprueba acceso real sin activar todavía la persistencia ni cambiar los datos que muestra el mapa.

## Ejecución

Desde la raíz del proyecto, `npm run diagnose:network-rail`. Usa `-- --seconds=60` para escuchar durante un minuto. El valor predeterminado es 45 segundos, con límites de 10 a 120. Las peticiones HTTP tienen un plazo de 30 segundos y la conexión STOMP tiene un plazo adicional propio; el tiempo total puede superar la ventana de escucha.

## Comprobaciones

1. Carga el `.env` raíz mediante Node.js; solo registra presencia de credenciales.
2. Descarga CORPUS por HTTPS y valida el contenedor `TIPLOCDATA`.
3. Solicita SCHEDULE JSON y lee una muestra limitada del archivo, descomprimiendo gzip cuando corresponde. Cancela la descarga después de identificar un registro reconocido.
4. Abre una conexión STOMP a `publicdatafeeds.networkrail.co.uk:61618` y una suscripción temporal a `/topic/TRAIN_MVT_ALL_TOC`.
5. Cuenta lotes, eventos, tipos e identificadores distintos. Para movimientos `0003`, comprueba códigos STANOX contra CORPUS.
6. Cierra la conexión y escribe `docs/network-rail-diagnostic.json` con resultados agregados.

La suscripción es efímera y usa reconocimiento automático: es un diagnóstico que deliberadamente no conserva eventos para reconstrucción. El consumidor operativo necesitará persistir antes de confirmar mensajes, manejar reconexión, deduplicación e intervalos perdidos. No se crea un identificador de cliente ni se reutiliza una suscripción durable de producción.

## Lectura de resultados

| Resultado | Interpretación |
|---|---|
| CORPUS `valid` | Se descargó y reconoció una referencia utilizable |
| SCHEDULE `sample-valid` | Acceso y formato inicial comprobados; importación completa pendiente |
| MOVEMENT authentication `accepted` | El broker aceptó la sesión STOMP |
| subscription `receipt-confirmed` | El broker confirmó el procesamiento de la suscripción |
| subscription `messages-received` | Se recibieron mensajes de la suscripción |
| status `received` | Se reconoció al menos un registro durante la ventana |
| `no-records-in-window` | No hay evidencia suficiente de datos en ese intervalo; no demuestra credenciales incorrectas |
| HTTP 401/403 | Revisar credenciales, activación y suscripciones del portal |
| `AUTHENTICATION_REJECTED` / `ACCESS_REJECTED` | Revisar la cuenta y sus permisos; no se reintenta indefinidamente |
| `ENOTFOUND`, `ECONNREFUSED`, `TIMEOUT` | Fallo de red o transporte; la validez de las credenciales puede seguir sin comprobarse |

El código de salida es cero únicamente si CORPUS y la muestra de horario son válidos y MOVEMENT entrega registros sin errores de estructura. Un fallo parcial conserva el resumen para poder distinguirlo de una prueba totalmente satisfactoria.

## Precisión de las métricas

La cobertura indica qué porcentaje de **reportes de movimiento con STANOX válido** encontró correspondencia en CORPUS. No es el porcentaje de trenes localizados, ni mide precisión geográfica. Los identificadores distintos tampoco equivalen necesariamente a vehículos físicos distintos.

El informe publica dos diferencias entre recepción y `actual_timestamp`. `rawDifferenceSeconds` se conserva sin corregir como evidencia. `correctedDifferenceSeconds` resuelve antes el instante real: TRUST codifica la hora de pared de Londres como si fuera UTC, así que el valor se ajusta con el offset de `Europe/London` vigente en ese momento, **nunca con un desplazamiento fijo de una hora**.

El bloque `correction` acompaña a esa métrica con la zona aplicada, cuántos valores se corrigieron y los offsets observados. Una hora local no siempre identifica un instante único: en el pliegue de otoño ocurre dos veces y se cuenta en `ambiguous`, y en el salto de primavera no ocurre nunca y se cuenta en `nonexistent`. Esos casos se informan en lugar de resolverse en silencio.

Ninguna de las dos es una latencia validada, y por debajo de unos 60 segundos no significan nada: `actual_timestamp` tiene resolución de un minuto. Por eso cerca del 30 % de los reportes llega con una marca posterior a su propia recepción. El detalle de la medición y el ~5 % de llegadas adelantadas sin causa confirmada están en [contratos y auditoría de fuentes](data-contracts.md).

## Protección de credenciales y límites

No imprime valores del `.env`, errores originales del broker, payloads, cabeceras Authorization ni URLs firmadas. El informe tampoco contiene esos elementos. La autorización HTTP se envía únicamente al portal HTTPS canónico; se elimina al seguir redirecciones a S3. Se rechazan destinos ajenos al portal/S3 y cambios a HTTP. Se utilizan límites de tiempo y tamaño para las respuestas.

Los datos CORPUS se mantienen solo durante la ejecución para resolver códigos. La prueba no descarga deliberadamente el horario completo ni guarda capturas extensas. El informe es un resumen agregado con permisos locales privados.

## Archivos y verificación

- `apps/ingestor/src/diagnose.ts`: coordinación, entorno y resumen.
- `apps/ingestor/src/diagnostics/http.ts`: acceso HTTPS, redirecciones y lectura gzip.
- `apps/ingestor/src/diagnostics/stomp.ts`: conexión STOMP acotada.
- `apps/ingestor/src/diagnostics/audit.ts`: conteos y correspondencias.
- `apps/ingestor/src/diagnostics/diagnostics.test.ts`: nueve pruebas aisladas de red, credenciales y métricas temporales.
- `packages/domain/src/time.ts`: conversión de hora local de Londres a instante UTC, compartida con la futura persistencia.

`npm test` ejecuta estas nueve pruebas junto con las nueve del dominio, cinco de ellas sobre la conversión horaria. `npm run typecheck` verifica ingestor, dominio, esquema y web. El resultado concreto de la última comprobación real está en el archivo JSON generado.
