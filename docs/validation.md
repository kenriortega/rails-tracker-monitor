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

## Entrega del consumidor persistente

- Veinticinco pruebas y revisión de tipos satisfactorias: nueve de dominio y dieciséis del ingestor, siete de ellas nuevas sobre el mapeo de registros. La suite sigue sin tocar red ni base de datos.
- Ejecución real de 169 segundos contra MOVEMENT: 70 lotes, 1.640 filas, 1.640 insertadas, cero duplicados y cero registros descartados. Apagado limpio con SIGINT.
- Deduplicación verificada de extremo a extremo: se releyeron 200 payloads ya almacenados y se reinsertaron por la misma ruta. Los 200 hashes coincidieron pese al reordenamiento de claves de `jsonb` y no se creó ninguna fila nueva.
- Coherencia de lo almacenado con la investigación previa: los 1.586 `observed_at` están alineados al minuto exacto, 494 de ellos (31,1 %) son posteriores a `received_at`, y el desfase va de −279 a +4.748 segundos con mediana de +25. Los 54 registros sin `observed_at` son activaciones y cancelaciones, que no traen `actual_timestamp`.
- Fuera de alcance y sin hacer: proyecciones, SSE, interfaz y política de retención. La tabla `raw_events` crece sin límite mientras el consumidor esté en marcha.

## Entrega de carga de NaPTAN

- Veintinueve pruebas y revisión de tipos satisfactorias. Cuatro nuevas cubren el parser con un XML de muestra: se emite solo la parada ferroviaria con TIPLOC y coordenadas, se descartan la parada de autobús, la que no tiene TIPLOC y la que tiene códigos válidos con geometría nula, y un XML mal formado se rechaza en vez de devolver un resultado parcial.
- Migración `0002` generada y aplicada: índice único sobre `locations.tiploc`, necesario para que la carga sea idempotente. Tres migraciones registradas.
- Carga real en 7,8 segundos desde un XML de 552 MB: 436.793 paradas recorridas, 2.716 ferroviarias, 43 sin TIPLOC, 11 sin coordenadas y 2.662 estaciones escritas. 2.649 obtuvieron STANOX desde CORPUS.
- Verificado en la base: las 2.662 filas tienen SRID 4326 y ninguna cae fuera del rango geográfico de Gran Bretaña.
- Idempotencia demostrada: una segunda carga deja el mismo total de 2.662 filas.
- Coherencia con la auditoría: la consulta de cobertura sobre lo almacenado devuelve 784 de 1.074 ubicaciones (73,0 %) y 1.217 de 1.586 eventos (76,7 %), las mismas cifras medidas antes de implementar. Los nueve STANOX ambiguos afectan a 36 eventos.
- Fuera de alcance y sin hacer: proyección a `train_positions`, interfaz, BPLAN y el 23,3 % de eventos sin posición. La web sigue en modo demo.

## Entrega de proyección

- Treinta y siete pruebas y revisión de tipos satisfactorias. Ocho nuevas cubren el signo del retraso según `variation_status`, el rechazo de variaciones no interpretables, el relleno de códigos de ubicación, la derivación de la fecha de servicio y el arrastre de terminación y renumeración.
- Un fallo real salió en las pruebas antes de ejecutar nada: `Number("")` es cero, así que una variación ausente se proyectaba como retraso de cero minutos en lugar de nulo.
- Migración `0003` aplicada: tabla `projection_state` con el cursor. Cuatro migraciones registradas.
- Proyección de los 1.640 eventos almacenados en 6,8 segundos: 1.586 movimientos proyectados y 54 omitidos, que son exactamente las activaciones y cancelaciones.
- Resultado: 965 circulaciones, 900 en curso y 65 terminadas; 965 posiciones, 721 `reported` y 244 `unknown`.
- Conciliación con la auditoría geográfica: 1.181 eventos resolvieron a un punto único, que son los 1.217 resolubles menos los 36 afectados por STANOX ambiguos. La proyección los deja `unknown` a propósito.
- Invariantes verificados en la base: todos los puntos en SRID 4326, ninguna posición `unknown` con coordenada y ninguna `reported` sin ella.
- Reproyección completa con `--reset`: cifras idénticas.
- Sin validar: el retraso mínimo es de −3.780 segundos, un tren 63 minutos adelantado. Puede ser legítimo en mercancías; no se ha comprobado.
- Fuera de alcance: snapshot, SSE, interfaz y la calidad `stale`, que exige fijar un umbral de frescura con medidas. La web sigue en modo demo.

## Entrega de snapshot y SSE

- Treinta y siete pruebas, revisión de tipos y `npm run build` satisfactorios. Ambas rutas de API quedan dinámicas en el informe de compilación: sin cacheo accidental.
- Migración `0004` aplicada: columna `version` con secuencia, índice, trigger que la avanza en las actualizaciones y trigger de `pg_notify`. Cinco migraciones registradas. La parte de secuencia y triggers se escribió a mano porque Drizzle no la genera.
- `GET /api/snapshot` devuelve las 965 circulaciones con versión 965, 721 `reported` y 244 `unknown`, con las versiones estrictamente ordenadas. Coincide con la proyección.
- Reanudación determinista: pedir desde la versión 960 entrega solo lo posterior; pedir desde la última no entrega nada.
- Entrega en vivo verificada con ingesta y proyección en marcha: cinco deltas empujados por `LISTEN/NOTIFY`, 239 entregas sin ningún duplicado, cursor siempre creciente y la cabecera `id:` igual al cursor en todos los casos.
- Conciliación sin pérdidas: esas 239 entregas corresponden a 194 circulaciones distintas, exactamente las 194 filas que la base tenía por encima del cursor inicial. Las 45 entregas extra son 40 circulaciones actualizadas más de una vez, es decir estados sucesivos.
- Fuera de alcance: la interfaz, que sigue en modo demo, la autenticación y cualquier límite de conexiones.

## Entrega de la interfaz en vivo

- Treinta y ocho pruebas, revisión de tipos y `npm run build` satisfactorios. Las tres rutas de API quedan dinámicas.
- Migración `0005` aplicada: columna `toc_id` en `service_runs`, que recupera el filtro de operador. Reproyección completa: 1.202 circulaciones, todas con operador, 38 operadores distintos.
- Verificado en el navegador a 1440 píxeles: métricas, lista, mapa, inspector y barra de estado en su sitio. El mapa dibuja el trazado reconocible de la red británica a partir de las propias posiciones.
- Selección comprobada: al elegir una circulación el inspector muestra identificador, operador, retraso, estado, calidad, coordenada, hora observada y fecha de servicio.
- Las circulaciones sin posición aparecen en un grupo aparte de la lista, con su recuento, y **no se dibujan en el mapa**.
- **Actualización en vivo sin recargar**: con el consumidor y la proyección en marcha, la página pasó por sí sola de 1.202 a 1.224 circulaciones, y de 866 a 883 en el mapa, coincidiendo exactamente con lo que devolvió la proyección.
- Un error propio durante la verificación: el primer intento de maquetado no respetaba la estructura que espera la hoja de estilos —el contenedor de tres columnas es `.operations`, no `.map-grid`— y la página salió superpuesta. Se corrigió ajustando el componente a las clases existentes.
- Fuera de alcance: autenticación, límite de conexiones, `stale`, interpolación, y origen, destino y headcode.
