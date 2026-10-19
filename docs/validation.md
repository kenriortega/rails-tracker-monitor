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

- Doce pruebas aisladas satisfactorias: cuatro de dominio y ocho del diagnóstico. Cubren redirecciones sin fuga de autorización, rechazo de destinos ajenos, gzip fragmentado, cancelación temprana del horario, rechazo de HTML, cobertura de códigos, entradas malformadas y errores sin datos sensibles.
- Revisión de tipos satisfactoria de dominio, web, base de datos e ingestor.
- Ejecución real de `npm run diagnose:network-rail -- --seconds=45` finalizada con código cero. CORPUS válido (55.981 registros), muestra inicial de SCHEDULE válida y autenticación STOMP aceptada.
- MOVEMENT: 19 lotes, 445 registros, 420 movimientos, 25 activaciones, 395 identificadores distintos, cero errores de JSON/estructura.
- Los 420 movimientos con STANOX encontraron correspondencia en CORPUS. Sin validación geográfica todavía.
- Diferencias temporales negativas en toda la muestra: mediana sin corregir de −3.574 segundos. Pendiente de normalización y análisis; no se considera una métrica de latencia validada.
- No se modificó la interfaz ni se conectó a datos reales; no hubo cambios en esquema, migraciones ni infraestructura. No se repitió la compilación web porque esta entrega modifica únicamente diagnóstico, comandos y documentación.

Informe de ejecución: `network-rail-diagnostic.json`. Las credenciales y los mensajes originales no se guardan en el informe.
