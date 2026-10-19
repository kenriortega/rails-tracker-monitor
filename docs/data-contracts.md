# Contratos y auditoría de fuentes

Estado: análisis documental y primera comprobación autenticada satisfactoria de CORPUS, SCHEDULE y MOVEMENT. Fecha de revisión: 19 de octubre de 2026. Los mensajes se analizaron en memoria; no se guardaron payloads originales.

## Primera evidencia de acceso real

La escucha de 45 segundos recibió 19 lotes con 445 registros: 420 movimientos (`0003`) y 25 activaciones (`0001`), con 395 identificadores de tren distintos y ningún error de JSON/estructura. Los 420 movimientos tenían STANOX válido y encontraron correspondencia en CORPUS. Esto verifica códigos de ubicación para esta muestra, no coordenadas ni cobertura de toda la red.

CORPUS contenía 55.981 registros, 11.621 con STANOX no vacío. SCHEDULE permitió leer y reconocer un registro inicial `JsonTimetableV1`; no se importó ni validó el horario completo. TD, SMART y VSTP todavía no se comprobaron.

La diferencia sin corregir entre recepción y `actual_timestamp` fue negativa en los 420 movimientos, con mediana de −3.574 segundos. Es evidencia de una discrepancia temporal que debe investigarse antes de interpretar retrasos/latencia; es compatible con el problema horario documentado para campos TRUST durante BST, pero esta prueba no identifica por sí sola su causa. No se aplicó una corrección automática.

Resumen reproducible en `network-rail-diagnostic.json`; funcionamiento del comando en `network-rail-access.md`.

## Fuentes previstas

| Feed | Uso | Límite relevante |
|---|---|---|
| MOVEMENT / TRUST | Activación, movimiento, cancelación y cambios de servicio | Reportes de eventos; no GPS continuo ni predicciones; puede haber correcciones tardías |
| TD | Descripciones de trenes entre berths por área | CA mueve, CB elimina, CC intercala, CT indica heartbeat; un cambio de descripción no equivale siempre a movimiento físico |
| SCHEDULE | Planificación base y actualizaciones | Resolver versiones, fechas, días de operación y precedencia STP |
| VSTP | Servicios/cambios de muy corto plazo | Correlacionar con planificación y activaciones |
| CORPUS | Correspondencias STANOX, TIPLOC, CRS, NLC | No asumir coordenadas ni correspondencias completas o unívocas |
| SMART | Interpretación de parte del stepping TD | No garantiza la geolocalización exacta de cada berth |
| TPS / geografía | Candidatos para infraestructura | Auditar acceso, formato, licencia y cobertura antes de seleccionar |
| TSR | Restricciones temporales | Evaluar resolución espacial y vigencia; no tratar como evento continuo |
| RTPPM | Rendimiento agregado | No mezclar con indicadores de la demo ni con métricas por servicio |

## Identidad

Separar horario planificado, circulación de una fecha operativa y alias de señalización. La clave de circulación combina proveedor, fecha operativa e identificador del proveedor. El headcode no es globalmente único. Las futuras correspondencias entre TD y TRUST deben tener ámbito temporal/área, evidencia y posibilidad de quedar sin resolver.

## Envoltorio de posición

Definido en `packages/domain/src/index.ts`: coordenada nullable WGS84 `[longitud, latitud]`, fuente, `observedAt`, `receivedAt` y calidad:

- `reported`: coordenada derivada de una ubicación reportada y correspondencia geográfica verificada; no implica GPS.
- `estimated`: posición inferida con una regla identificable; preservar el ancla observada original en la futura proyección.
- `stale`: última posición conocida fuera del umbral de frescura.
- `unknown`: sin ubicación fiable; no inventar una coordenada.

La UI actual emplea únicamente fixtures `demo`. Los umbrales de frescura reales se decidirán con medidas del feed; no se han fijado arbitrariamente.

## Reglas de la próxima ingesta

Guardar el evento original antes de proyectar. Confirmar mensajes únicamente después de persistencia duradera. Diseñar deduplicación por feed y mensaje/contenido según los identificadores auditados. Guardar orden de recepción y tiempo del evento por separado. No descartar automáticamente correcciones por tener timestamp antiguo. Registrar los huecos por desconexión y reconstruir cuando sea posible; nunca prometer replay de intervalos que no se capturaron.

Interpretar fechas de servicio en Europe/London y almacenar instantes en UTC. Auditar individualmente los campos horarios TRUST, incluidos los problemas históricos documentados durante BST; no aplicar una resta de una hora a todos los timestamps. Cubrir medianoche, cambio DST y horarios que sobrepasan las 24 horas en la integración real.

## Auditoría adicional pendiente

La autenticación y recepción inicial de MOVEMENT, acceso a CORPUS y muestra de SCHEDULE ya se comprobaron. Falta verificar TD/SMART/VSTP, reconexiones e intervalos más representativos. Auditar un corredor y medir nulos, duplicados, cambios de identidad, cancelaciones y ubicaciones sin resolver. Resolver y validar las coordenadas antes de prometer precisión espacial; normalizar los campos temporales antes de publicar latencia.

Fuentes documentales: [TRUST](https://wiki.openraildata.com/index.php/Train_Movements), [TD](https://wiki.openraildata.com/index.php/C_Class_Messages), [referencias](https://wiki.openraildata.com/index.php/Reference_data), [conexión](https://wiki.openraildata.com/index.php/Connecting_with_Stomp). Los accesos directos a algunas páginas devolvieron 403; se consultaron sus extractos indexados. Confirmar detalles con los mensajes reales.
