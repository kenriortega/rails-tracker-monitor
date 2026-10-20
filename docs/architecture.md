# Decisiones de arquitectura

## Implementado

Monorepo npm con Next.js App Router en `apps/web`, TypeScript estricto y shadcn/ui (Button con Slot, CVA, utilidades clsx/tailwind-merge y configuración para añadir componentes). Tailwind 4 y CSS específico definen una identidad de central oscura con verde suave y acentos ámbar.

El mapa dibuja las circulaciones como **capas WebGL sobre una fuente GeoJSON**, no como marcadores DOM. La estrategia DOM anterior servía para ocho trenes de demostración; el feed nacional entrega centenares a la vez y miles a lo largo del día, y el DOM no sostiene ese volumen. La selección se resuelve con los eventos de capa de MapLibre y el color por retraso con estilo dirigido por datos, que se evalúa en el GPU.

MapLibre se carga exclusivamente en cliente. Las teselas vectoriales OpenFreeMap/OpenStreetMap, con un estilo oscuro local, aportan el contexto geográfico; las estaciones, corredores y trenes proceden de fixtures locales. MapLibre 6 requiere configurar explícitamente la URL de su worker; Next.js lo empaqueta como recurso local. Los ocho marcadores son elementos accesibles; no estamos proponiendo esta estrategia DOM para decenas de miles de vehículos. En ese volumen se sustituirán por capas WebGL y consultas por viewport.

Se usa el compilador Webpack compatible con Next.js 16. Turbopack falló al abrir puertos internos bajo las restricciones del entorno. La compilación Webpack sí completó correctamente.

La reproducción es determinista a partir de un instante fijo (19 de octubre de 2026, 14:42 BST) y un reloj de 0 a 1800 segundos. La interpolación pondera distancias entre estaciones, congela posiciones sin señal y limita los extremos de la ruta. Es una animación de demostración; no estima trenes reales ni aplica restricciones ferroviarias.

## Preparado

Drizzle describe ubicaciones, segmentos, horarios, circulaciones, eventos originales y posiciones actuales. La conexión PostgreSQL es explícita y bajo demanda, nunca necesaria para compilar o abrir la demo. `compose.yaml` provisiona PostgreSQL 16 con PostGIS 3.5 para desarrollo local y las dos migraciones ya se aplicaron y verificaron contra esa instancia. PostGIS almacena puntos WGS84 y líneas; los índices GiST permitirán filtros espaciales. No usar grados como unidades métricas para distancias operativas: transformar a proyección adecuada o usar geography según la consulta.

## Próxima arquitectura operativa

El consumidor persistente de MOVEMENT ya existe en `apps/ingestor/src/consumer.ts`: `ConnectFailover` aporta la reconexión con retroceso exponencial, la suscripción usa ack `client-individual` y cada mensaje se confirma después del commit de su transacción. Las proyecciones se mantienen en una pasada separada, `apps/ingestor/src/project.ts`, con un cursor estable sobre `(received_at, id)` guardado en `projection_state`. La separación es deliberada: desacopla los fallos de proyección de la ingesta y permite reprocesar `raw_events` tras corregir la lógica, que es justamente lo que esta tabla hacía posible en teoría y ahora lo es en la práctica. El orden y la deduplicación se apoyarán en la recepción, nunca en `observed_at`: las marcas de TRUST tienen resolución de un minuto y alrededor del 30 % resultan posteriores a su propia recepción, así que el esquema no debe prohibir ese caso. Ver «Semántica temporal de TRUST» en `data-contracts.md`. El servidor web ya entrega un snapshot inicial y cambios mediante SSE. El cursor reanudable es la columna `version` de `train_positions`, respaldada por una secuencia y avanzada por trigger también en las actualizaciones: sin eso no hay deltas fiables, porque `received_at` se repite en las escrituras por lote y una actualización rechazada por llegar desordenada deja la fila intacta.

Los avisos llegan por `LISTEN/NOTIFY` con una única conexión de escucha por proceso, repartida entre todos los clientes mediante un emisor. La notificación es una señal sin contenido y cada cliente consulta su delta desde su propio cursor, de modo que un aviso perdido mientras la escucha se reconecta no pierde datos: al reconectar se emite una señal y los clientes se ponen al día. Las credenciales permanecen en procesos del servidor. Limitar por viewport, filtros y permisos.

La tabla `raw_events` permite reconstrucción futura, pero no basta por sí sola: hacen falta versiones de la lógica, estados iniciales, referencias históricas y retención definida. Medido el volumen, se descarta particionar: con una ventana de siete días basta borrar por lotes, y el índice sobre `received_at` que añade la migración `0006` evita recorrer la tabla. El almacenamiento de archivo sigue sin decidirse. La poda está guardada por el cursor de proyección, de modo que nunca elimina eventos que la proyección no haya procesado. Redis/colas adicionales no se incorporan sin evidencia de necesidad.

Existe un diagnóstico STOMP acotado en `apps/ingestor/src/diagnose.ts`, comprobado contra Network Rail. No se han implementado SSE, importadores completos, proyecciones ni alertas reales. El panel de fuentes y la barra inferior comunican los límites reales de los datos: reportes de paso en lugar de GPS, resolución de un minuto, cobertura geográfica parcial y ausencia de horario.

## Revisión de dependencias

La instalación inicial detectó cuatro entradas moderadas en la cadena de desarrollo `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`. El aviso es sobre un servidor de desarrollo de esbuild antiguo; no aparece en la aplicación web de producción. La corrección automática propuesta por npm degrada Drizzle Kit a una versión mayor anterior: no se aplicó. Revisar un reemplazo compatible en una actualización posterior; no exponer servidores de herramientas de desarrollo.
