# Rails Tracker Monitor

Central ferroviaria experimental con Next.js, shadcn/ui, MapLibre y una base de persistencia Drizzle + PostgreSQL/PostGIS.

## Entrega actual

Prototipo local de operaciones: ocho servicios sintéticos, tres corredores esquemáticos, búsqueda, filtros de operador y estado, selección en lista/mapa, seguimiento de cámara, capas de estaciones y reproducción de 30 minutos. El motor está en el navegador; no es streaming real ni historial de producción. Los eventos del panel son narrativos del escenario.

Todos los servicios, horarios y retrasos son inventados. Las coordenadas de estaciones son aproximadas; las líneas unen estaciones y **no son geometría real de las vías**. Nunca usar esta demo para decisiones operativas o de viaje.

## Ejecutar

Requiere Node.js 22+.

```sh
npm install
npm run dev
```

Abrir http://127.0.0.1:3000. No se requiere PostgreSQL ni una cuenta Network Rail para esta demo. El mapa base descarga teselas vectoriales de OpenFreeMap/OpenStreetMap: necesita conexión a internet. Si falla, los trazados de demostración siguen disponibles sobre fondo oscuro; si WebGL no está disponible, permanecen la lista y el inspector. Se usa Webpack porque Turbopack no pudo iniciar sus procesos locales en el entorno de desarrollo inicial.

```sh
npm run typecheck
npm test
npm run build
npm run db:generate
```

## Estructura

- `apps/web`: Next.js App Router; componentes shadcn/ui, MapLibre y central de operaciones.
- `apps/ingestor`: diagnóstico real de CORPUS, SCHEDULE y MOVEMENT. El ingestor persistente sigue pendiente.
- `packages/domain`: contratos, identidades por fecha, fixtures e interpolación geográfica de demostración.
- `packages/db`: cliente PostgreSQL bajo demanda y esquema Drizzle con índices GiST.
- `docs`: análisis de fuentes, arquitectura y siguiente entrega.
- `fixtures`: reglas para capturas reales futuras. Los fixtures sintéticos actuales viven en `packages/domain/src/fixtures.ts` para compartirlos con la interfaz.

## Diagnóstico de acceso real

Configura `NETWORK_RAIL_USERNAME` y `NETWORK_RAIL_PASSWORD` en `.env` en la raíz del proyecto. Son las credenciales del portal de Network Rail, no las de Open Rail Data Wiki. Si la contraseña contiene `#`, encierra el valor completo entre comillas para que no se interprete como comentario.

```sh
npm run diagnose:network-rail
npm run diagnose:network-rail -- --seconds=60
```

El comando carga `.env` sin depender del directorio de trabajo del workspace; las variables ya presentes en el entorno tienen prioridad. Descarga CORPUS en memoria, verifica una muestra acotada del horario y abre una suscripción temporal de MOVEMENT durante 45 segundos (configurable de 10 a 120). No modifica suscripciones del portal ni utiliza una suscripción durable existente. Requiere salida HTTPS al portal y a sus descargas firmadas de S3, y TCP al puerto 61618 del broker.

Guarda exclusivamente un resumen sin credenciales ni mensajes originales en `docs/network-rail-diagnostic.json`. Cada ejecución reemplaza el resumen anterior. La muestra del horario **no valida ni importa el archivo completo**. La correspondencia de códigos CORPUS **no certifica coordenadas geográficas**. Un intervalo sin mensajes es inconcluso y se distingue de un rechazo de autenticación.

Los errores se muestran como categorías controladas para evitar que mensajes del servidor expongan datos de la cuenta. Las pruebas usan datos sintéticos y respuestas simuladas; no requieren credenciales ni red.

Más detalle: [diagnóstico de Network Rail](docs/network-rail-access.md).

## Integración operativa pendiente

1. Revisar el resultado del diagnóstico de acceso y cobertura.
2. Ampliar la auditoría a intervalos representativos y documentar los campos necesarios.
3. Resolver identidades, códigos y geometría del corredor piloto.
4. Implementar ingesta persistente, deduplicación, reconexión, snapshots y SSE.
5. Provisionar PostgreSQL con PostGIS, revisar y aplicar migraciones.

No hay infraestructura creada, migraciones aplicadas ni despliegue. La interfaz continúa en modo demo. El diagnóstico ya carga las credenciales de `.env`; las credenciales jamás llevan prefijo `NEXT_PUBLIC_`.

## Referencias

- [Catálogo Network Rail](https://www.networkrail.co.uk/who-we-are/transparency-and-ethics/transparency/open-data-feeds/)
- [TRUST](https://wiki.openraildata.com/index.php/Train_Movements)
- [TD C-Class](https://wiki.openraildata.com/index.php/C_Class_Messages)
- [Datos de referencia](https://wiki.openraildata.com/index.php/Reference_data)
- [STOMP](https://wiki.openraildata.com/index.php/Connecting_with_Stomp)

Este proyecto no está afiliado a Network Rail ni se presenta como servicio oficial.
