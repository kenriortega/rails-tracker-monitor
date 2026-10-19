# Decisiones de arquitectura

## Implementado

Monorepo npm con Next.js App Router en `apps/web`, TypeScript estricto y shadcn/ui (Button con Slot, CVA, utilidades clsx/tailwind-merge y configuración para añadir componentes). Tailwind 4 y CSS específico definen una identidad de central oscura con verde suave y acentos ámbar.

MapLibre se carga exclusivamente en cliente. Las teselas vectoriales OpenFreeMap/OpenStreetMap, con un estilo oscuro local, aportan el contexto geográfico; las estaciones, corredores y trenes proceden de fixtures locales. MapLibre 6 requiere configurar explícitamente la URL de su worker; Next.js lo empaqueta como recurso local. Los ocho marcadores son elementos accesibles; no estamos proponiendo esta estrategia DOM para decenas de miles de vehículos. En ese volumen se sustituirán por capas WebGL y consultas por viewport.

Se usa el compilador Webpack compatible con Next.js 16. Turbopack falló al abrir puertos internos bajo las restricciones del entorno. La compilación Webpack sí completó correctamente.

La reproducción es determinista a partir de un instante fijo (19 de octubre de 2026, 14:42 BST) y un reloj de 0 a 1800 segundos. La interpolación pondera distancias entre estaciones, congela posiciones sin señal y limita los extremos de la ruta. Es una animación de demostración; no estima trenes reales ni aplica restricciones ferroviarias.

## Preparado

Drizzle describe ubicaciones, segmentos, horarios, circulaciones, eventos originales y posiciones actuales. La conexión PostgreSQL es explícita y bajo demanda, nunca necesaria para compilar o abrir la demo. `compose.yaml` provisiona PostgreSQL 16 con PostGIS 3.5 para desarrollo local y las dos migraciones ya se aplicaron y verificaron contra esa instancia. PostGIS almacena puntos WGS84 y líneas; los índices GiST permitirán filtros espaciales. No usar grados como unidades métricas para distancias operativas: transformar a proyección adecuada o usar geography según la consulta.

## Próxima arquitectura operativa

El consumidor persistente de MOVEMENT ya existe en `apps/ingestor/src/consumer.ts`: `ConnectFailover` aporta la reconexión con retroceso exponencial, la suscripción usa ack `client-individual` y cada mensaje se confirma después del commit de su transacción. Las proyecciones se mantienen en una pasada separada, `apps/ingestor/src/project.ts`, con un cursor estable sobre `(received_at, id)` guardado en `projection_state`. La separación es deliberada: desacopla los fallos de proyección de la ingesta y permite reprocesar `raw_events` tras corregir la lógica, que es justamente lo que esta tabla hacía posible en teoría y ahora lo es en la práctica. El orden y la deduplicación se apoyarán en la recepción, nunca en `observed_at`: las marcas de TRUST tienen resolución de un minuto y alrededor del 30 % resultan posteriores a su propia recepción, así que el esquema no debe prohibir ese caso. Ver «Semántica temporal de TRUST» en `data-contracts.md`. El servidor web entregará un snapshot inicial y cambios mediante SSE. Versionar snapshots/deltas, usar IDs reanudables y resincronizar al reconectar. Las credenciales permanecen en procesos del servidor. Limitar por viewport, filtros y permisos.

La tabla `raw_events` permite reconstrucción futura, pero no basta por sí sola: hacen falta versiones de la lógica, estados iniciales, referencias históricas y retención definida. Particionado y almacenamiento de archivo se decidirán después de medir el volumen. Redis/colas adicionales no se incorporan sin evidencia de necesidad.

Existe un diagnóstico STOMP acotado en `apps/ingestor/src/diagnose.ts`, comprobado contra Network Rail. No se han implementado SSE, importadores completos, proyecciones ni alertas reales. El panel de fuentes y la barra inferior de la web continúan comunicando que esa interfaz usa demostración.

## Revisión de dependencias

La instalación inicial detectó cuatro entradas moderadas en la cadena de desarrollo `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`. El aviso es sobre un servidor de desarrollo de esbuild antiguo; no aparece en la aplicación web de producción. La corrección automática propuesta por npm degrada Drizzle Kit a una versión mayor anterior: no se aplicó. Revisar un reemplazo compatible en una actualización posterior; no exponer servidores de herramientas de desarrollo.
