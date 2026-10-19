# Verificación de la primera entrega

- TypeScript: revisión de tipos del dominio, ingestor, esquema y aplicación web.
- Compilación: Next.js 16.4.2 con Webpack; página prerenderizada correctamente.
- Pruebas de dominio: cuatro pruebas verifican interpolación ponderada por distancia y límites, geometría vacía/duplicada, identidad por fecha de servicio y posición congelada sin señal.
- Drizzle: generación de migraciones SQL para seis tablas e índices GiST. PostGIS se habilita en la primera migración y existen restricciones de SRID en puntos. No se ejecutaron las migraciones contra PostgreSQL.
- HTTP: página principal con respuesta 200.
- Navegador de escritorio: mapa OpenFreeMap con trazados y marcadores visibles; pausa, búsqueda `1B46`, filtro de retrasos (3 resultados), filtro de operador Great Western Railway (3 resultados), selección e inspector, cámara de seguimiento, salto a 600 segundos (14:52 BST), capas de estaciones y panel de fuentes.

Problemas corregidos durante QA: proveedor raster inicial que exigía clave; worker MapLibre 6 sin URL explícita; compilador Turbopack bloqueado por permisos de procesos/puertos; barra de porcentaje con valor fijo.

La vista móvil tiene reglas de adaptación (lista desplegable e inspector debajo del mapa), pero no se verificó en un dispositivo móvil. Ingesta real, latencia del feed, PostgreSQL/PostGIS activo, rendimiento con flota nacional y reconexiones SSE quedan fuera de esta entrega.

## Entrega de diagnóstico autenticado

- Dieciocho pruebas aisladas satisfactorias: nueve de dominio y nueve del diagnóstico. Cubren redirecciones sin fuga de autorización, rechazo de destinos ajenos, gzip fragmentado, cancelación temprana del horario, rechazo de HTML, cobertura de códigos, entradas malformadas y errores sin datos sensibles.
- Revisión de tipos satisfactoria de dominio, web, base de datos e ingestor.
- Ejecución real de `npm run diagnose:network-rail -- --seconds=45` finalizada con código cero. CORPUS válido (55.981 registros), muestra inicial de SCHEDULE válida y autenticación STOMP aceptada.
- MOVEMENT: 19 lotes, 445 registros, 420 movimientos, 25 activaciones, 395 identificadores distintos, cero errores de JSON/estructura.
- Los 420 movimientos con STANOX encontraron correspondencia en CORPUS. Sin validación geográfica todavía.
- Diferencias temporales negativas en toda la muestra: mediana sin corregir de −3.574 segundos. Origen identificado: TRUST codifica la hora de pared de Londres como si fuera UTC. El informe ahora publica también `correctedDifferenceSeconds`, resuelta con el offset de `Europe/London` vigente en cada evento. Ninguna de las dos se considera latencia validada.
- No se modificó la interfaz ni se conectó a datos reales; no hubo cambios en esquema, migraciones ni infraestructura. No se repitió la compilación web porque esta entrega modifica únicamente diagnóstico, comandos y documentación.

Informe de ejecución: `network-rail-diagnostic.json`. Las credenciales y los mensajes originales no se guardan en el informe.

## Entrega de normalización horaria

- Dieciocho pruebas y revisión de tipos satisfactorias. Cinco pruebas nuevas cubren un instante en BST, uno en GMT, el pliegue del 25 de octubre de 2026, el hueco del 29 de marzo de 2026 y que el offset siga la transición en lugar de un desplazamiento fijo. Una prueba nueva del diagnóstico comprueba que el resumen conserva la diferencia cruda junto a la corregida.
- Ejecución real de `npm run diagnose:network-rail -- --seconds=45` con código cero: 18 lotes, 401 registros, 394 movimientos, 355 identificadores distintos, cobertura CORPUS del 100 %.
- Diferencias crudas entre −3.800 y −3.219 segundos, mediana −3.572. Corregidas entre −200 y +381 segundos, mediana **+28**. Offset aplicado a los 394 valores, un único offset observado (3.600 s), cero casos ambiguos o inexistentes.
- Quedan 153 valores negativos tras la corrección: eventos con marca de tiempo por delante de la recepción, hasta unos 200 segundos. No está comprobado si corresponden a reportes manuales, previsiones o desajustes de reloj. No se presenta ninguna de las dos métricas como latencia validada.
- No se tocó la interfaz, el esquema ni la infraestructura. La web sigue en modo demo.

## Investigación de las marcas adelantadas

- Cinco escuchas acotadas del feed real, unos 3.500 reportes de movimiento, mediante una sonda temporal que no se incorporó al repositorio. Solo se agregaron recuentos de campos enumerados; no se guardaron payloads ni identificadores.
- Resultado principal: el 100 % de los `actual_timestamp` observados está alineado al minuto exacto. Esa cuantización explica entre el 78 % y el 84 % de los eventos adelantados, según la muestra.
- Resultado secundario: entre 41 y 44 eventos por muestra quedan hasta unos cuatro minutos y medio por delante, todos `ARRIVAL`, todos automáticos, sin agrupación por ubicación ni operador. **Causa no establecida**; la hipótesis de previsión no se pudo comprobar sin circularidad.
- Descartado como causa: el reloj local, verificado a 2 ms contra NTP.
- Sin cambios de código. La investigación solo produjo documentación.

## Entrega de base de datos local

- `docker compose up -d` levanta PostgreSQL 16 con PostGIS 3.5 y pasa el healthcheck en siete segundos. Puerto 5434 del host: 5432 y 5433 ya estaban ocupados por otros proyectos, y `DATABASE_URL` apuntaba al 5432, es decir a la base de un proyecto ajeno. Se corrigió en `.env` y `.env.example`.
- La imagen `postgis/postgis:16-3.5` solo publica amd64 y corre emulada en Apple Silicon. Se eligió la versión 16 porque ya estaba descargada en la máquina; el esquema no usa nada exclusivo de la 17.
- `npm run db:migrate` aplicó las dos migraciones. Verificado contra la base: PostGIS 3.5.2, las seis tablas, los tres índices GiST, las dos restricciones de SRID, los tres índices únicos y dos filas en `drizzle.__drizzle_migrations`.
- Comprobaciones funcionales con reversión: un punto en SRID 4326 se acepta y uno en 3857 se rechaza por restricción; una clave de deduplicación repetida se rechaza; un `observed_at` posterior a `received_at` **se acepta**, como exige la semántica temporal de TRUST.
- El cliente `createDatabase` de `packages/db` conecta y consulta contra la instancia real.
- Dieciocho pruebas y revisión de tipos satisfactorias. No se ingirió ningún dato ni se tocó la interfaz: las tablas están vacías.
