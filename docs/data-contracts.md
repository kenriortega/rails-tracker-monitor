# Contratos y auditoría de fuentes

Estado: análisis documental y primera comprobación autenticada satisfactoria de CORPUS, SCHEDULE y MOVEMENT. Fecha de revisión: 19 de octubre de 2026. Los mensajes se analizaron en memoria; no se guardaron payloads originales.

## Primera evidencia de acceso real

La escucha de 45 segundos recibió 19 lotes con 445 registros: 420 movimientos (`0003`) y 25 activaciones (`0001`), con 395 identificadores de tren distintos y ningún error de JSON/estructura. Los 420 movimientos tenían STANOX válido y encontraron correspondencia en CORPUS. Esto verifica códigos de ubicación para esta muestra, no coordenadas ni cobertura de toda la red.

CORPUS contenía 55.981 registros, 11.621 con STANOX no vacío. SCHEDULE permitió leer y reconocer un registro inicial `JsonTimetableV1`; no se importó ni validó el horario completo. TD, SMART y VSTP todavía no se comprobaron.

La diferencia sin corregir entre recepción y `actual_timestamp` fue negativa en los 420 movimientos, con mediana de −3.574 segundos. La causa quedó identificada y corregida: TRUST codifica la hora de pared de Londres como si fuera UTC. Ver «Semántica temporal de TRUST».

Resumen reproducible en `network-rail-diagnostic.json`; funcionamiento del comando en `network-rail-access.md`.

## Semántica temporal de TRUST

Medido el 19 de octubre de 2026 sobre cinco escuchas acotadas, unos 3.500 reportes de movimiento. Los recuentos son de esas muestras, no de la red completa ni de un día entero.

### Desplazamiento horario

`actual_timestamp` es epoch en milisegundos con la hora de pared de Londres ya incorporada: codifica hora local como si fuera UTC. `resolveLondonLocalEpoch` en `packages/domain/src/time.ts` recupera el instante real con el offset vigente en cada evento. **No aplicar un desplazamiento fijo de una hora**: rompe en los cambios de horario y no distingue las horas locales ambiguas de las inexistentes.

### Granularidad de un minuto

**Los ~3.500 timestamps observados estaban alineados al minuto exacto, sin excepciones.** TRUST no publica segundos en este campo.

Consecuencia directa: alrededor del 30 % de los reportes llega con una marca de tiempo *posterior* al momento de recepción. Un evento real de las 10:00:10 publicado como 10:01:00 y transmitido a las 10:00:15 aparece 45 segundos por delante de sí mismo. Entre el 78 % y el 84 % de esos adelantos, según la muestra, cabe dentro de esa ventana de un minuto.

No calcular ni publicar latencias por debajo de unos 60 segundos: serían ruido de cuantización. No mostrar segundos en la interfaz.

### Llegadas adelantadas sin causa confirmada

Queda un ~5 % de los reportes, 41 a 44 por muestra, con marcas de hasta unos cuatro minutos y medio por delante de la recepción. Perfil constante en todas las muestras:

| Rasgo | Observación |
|---|---|
| Tipo de evento | `ARRIVAL` en el 100 % de los casos |
| Origen | `AUTOMATIC` siempre; los reportes `MANUAL` nunca aparecen adelantados |
| Corrección | `correction_ind: false` siempre |
| Ubicación | 44 eventos en 44 STANOX distintos, 22 operadores: sin agrupación |
| Horario previsto | No son copias de `planned_timestamp`: 6 coincidencias de 40 |

**La causa no está establecida.** Se probó la hipótesis de que fueran previsiones (`planned_timestamp` más el retraso vigente): coincidió en 28 de 44, pero la prueba es circular si `timetable_variation` se deriva de la diferencia entre real y previsto, así que no concluye nada. Que no coincida en el 100 % tampoco tiene explicación.

Se descartó un desfase del reloj local: la máquina de medición estaba a 2 ms de NTP.

### Consecuencias para la persistencia

- `observed_at` puede ser **posterior** a `received_at`. No añadir una restricción que lo prohíba ni descartar esos eventos.
- Deduplicar y ordenar por `received_at` o por secuencia, nunca por `observed_at`.
- Tratar `observed_at` como un valor con resolución de un minuto, no como un instante exacto.

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

Guardar el evento original antes de proyectar. Confirmar mensajes únicamente después de persistencia duradera. Ambas reglas ya se cumplen en `apps/ingestor/src/consumer.ts`.

La clave de deduplicación de `raw_events` es el **SHA-256 del registro serializado con las claves ordenadas**. Deduplica reentregas del mismo mensaje, que es lo que un registro de auditoría debe evitar; no intenta decidir si dos eventos distintos describen lo mismo. Esa decisión semántica corresponde a la proyección, que sí tiene contexto. Se descartó una clave compuesta por `msg_type`, `train_id`, `event_type`, `loc_stanox` y `actual_timestamp`: con marcas de resolución de un minuto, dos eventos legítimos del mismo tren en la misma ubicación y el mismo minuto habrían colapsado en uno. El orden de claves de `jsonb` no afecta al hash, verificado releyendo 200 payloads almacenados. Guardar orden de recepción y tiempo del evento por separado. No descartar automáticamente correcciones por tener timestamp antiguo. Registrar los huecos por desconexión y reconstruir cuando sea posible; nunca prometer replay de intervalos que no se capturaron.

Interpretar fechas de servicio en Europe/London y almacenar instantes en UTC mediante `resolveLondonLocalEpoch`, nunca con una resta fija de una hora. Respetar las reglas de «Semántica temporal de TRUST»: `observed_at` con resolución de minuto, que puede ser posterior a `received_at`, y orden por recepción. Cubrir medianoche, cambio DST y horarios que sobrepasan las 24 horas en la integración real.

## Auditoría adicional pendiente

La autenticación y recepción inicial de MOVEMENT, acceso a CORPUS y muestra de SCHEDULE ya se comprobaron. Falta verificar TD/SMART/VSTP, reconexiones e intervalos más representativos. Auditar un corredor y medir nulos, duplicados, cambios de identidad, cancelaciones y ubicaciones sin resolver. Resolver y validar las coordenadas antes de prometer precisión espacial; normalizar los campos temporales antes de publicar latencia.

Fuentes documentales: [TRUST](https://wiki.openraildata.com/index.php/Train_Movements), [TD](https://wiki.openraildata.com/index.php/C_Class_Messages), [referencias](https://wiki.openraildata.com/index.php/Reference_data), [conexión](https://wiki.openraildata.com/index.php/Connecting_with_Stomp). Los accesos directos a algunas páginas devolvieron 403; se consultaron sus extractos indexados. Confirmar detalles con los mensajes reales.
