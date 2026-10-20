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
| CORPUS | Correspondencias STANOX, TIPLOC, CRS (`3ALPHA`), NLC | **No contiene coordenadas.** Un STANOX puede tener varios TIPLOC, y nueve de los observados apuntan a puntos distintos |
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

La proyección produce `reported` cuando el STANOX resuelve a un punto único y `unknown` en cualquier otro caso, incluidos los STANOX que apuntan a puntos distintos. `stale` ya se aplica por antigüedad del último reporte: hasta quince minutos la posición se sirve tal cual, entre quince minutos y dos horas se marca `stale`, y más allá no se sirve. Los quince minutos salen de triplicar el p90 medido entre reportes consecutivos de un mismo tren, que fue de cinco minutos. **El umbral es provisional**: la cola de esa distribución se midió con captura intermitente y está contaminada por los huecos de la propia captura, así que debe revisarse con un día de ingesta continua. `estimated` sigue sin emitirse: exige una regla de inferencia que no se fijará sin medidas. La UI actual emplea únicamente fixtures `demo`.

## Reglas de la próxima ingesta

Guardar el evento original antes de proyectar. Confirmar mensajes únicamente después de persistencia duradera. Ambas reglas ya se cumplen en `apps/ingestor/src/consumer.ts`.

La clave de deduplicación de `raw_events` es el **SHA-256 del registro serializado con las claves ordenadas**. Deduplica reentregas del mismo mensaje, que es lo que un registro de auditoría debe evitar; no intenta decidir si dos eventos distintos describen lo mismo. Esa decisión semántica corresponde a la proyección, que sí tiene contexto. Se descartó una clave compuesta por `msg_type`, `train_id`, `event_type`, `loc_stanox` y `actual_timestamp`: con marcas de resolución de un minuto, dos eventos legítimos del mismo tren en la misma ubicación y el mismo minuto habrían colapsado en uno. El orden de claves de `jsonb` no afecta al hash, verificado releyendo 200 payloads almacenados. Guardar orden de recepción y tiempo del evento por separado. No descartar automáticamente correcciones por tener timestamp antiguo. Registrar los huecos por desconexión y reconstruir cuando sea posible; nunca prometer replay de intervalos que no se capturaron.

Interpretar fechas de servicio en Europe/London y almacenar instantes en UTC mediante `resolveLondonLocalEpoch`, nunca con una resta fija de una hora. Respetar las reglas de «Semántica temporal de TRUST»: `observed_at` con resolución de minuto, que puede ser posterior a `received_at`, y orden por recepción. Cubrir medianoche, cambio DST y horarios que sobrepasan las 24 horas en la integración real.

## Contrato de cable

Definido en `packages/domain/src/wire.ts` y compartido por servidor y navegador para que no se desincronicen. Expone identidad, fecha de servicio, estado, retraso, calidad, coordenada nullable, instante observado y versión. **No expone payloads originales del feed.**

`version` es monótona por escritura y es el cursor de reanudación. Un mismo `runId` puede entregarse varias veces con versiones crecientes: son estados sucesivos de la misma circulación, no duplicados.

## Identidad y horario

El `train_id` de TRUST lleva el **headcode en las posiciones 3 a 6**. **Confirmado contra SCHEDULE**, que es un sistema distinto de TRUST: cruzando las activaciones con los horarios importados, esos cuatro caracteres coinciden con `signalling_id` en **117 de 118** casos. Antes la evidencia eran 63 coincidencias con `schedule_wtt_id`, pero ambos campos los emite TRUST y concordaban dos valores del mismo origen; ese contraste independiente ya está hecho. Queda una discrepancia sin explicar. Cuando los caracteres no cumplen `[0-9][A-Z][0-9]{2}` el headcode queda nulo.

El horario se enlaza por `train_uid` y fecha de inicio, **sin** el indicador STP. **`schedule_type` de la activación no es ese indicador**: sobre las 63 activaciones decía `O` donde el horario de esa fecha era `P`, y al revés. Por uid y fecha coincidieron 53 de 63 sin una sola ambigüedad. No se interpreta `schedule_type` mientras su significado no esté verificado.

El enlace depende por completo de haber capturado la activación, que es el único mensaje con `train_uid` y se emite horas antes de la circulación. Con los datos actuales alcanza a **2 de 1.229 circulaciones**.

## Operador

Los movimientos traen `toc_id`, un código numérico que no nombra a nadie. El nombre se arma en dos pasos, con orígenes distintos que conviene no confundir.

El primero sale de los datos propios, cruzando activaciones y horarios:

```sql
select e.payload->'body'->>'toc_id', s.payload->>'atoc_code', count(*)
from raw_events e
join schedules s on s.uid = e.payload->'body'->>'train_uid'
                and s.valid_from = (e.payload->'body'->>'schedule_start_date')::date
where e.payload->'header'->>'msg_type' = '0001'
group by 1, 2 order by 1;
```

Dio 19 códigos ATOC para otros tantos `toc_id`. Dos avisos: un mismo `toc_id` puede dar varias marcas —el 88 aparece como TL y GN— y los operadores de mercancías salen como `ZZ`, que es un comodín y no identifica compañía.

El segundo paso, de código ATOC a nombre comercial, es una **lista curada que no sale de los datos** y que envejece con los cambios de concesión. Un código sin nombre curado se muestra tal cual, y un `toc_id` que no hayamos visto conserva su número: menos informativo, pero nunca incorrecto.

## Auditoría adicional pendiente

La autenticación y recepción inicial de MOVEMENT, acceso a CORPUS y muestra de SCHEDULE ya se comprobaron. Falta verificar TD/SMART/VSTP, reconexiones e intervalos más representativos. Auditar un corredor y medir nulos, duplicados, cambios de identidad, cancelaciones y ubicaciones sin resolver. Resolver y validar las coordenadas antes de prometer precisión espacial. La normalización temporal ya está hecha; ver «Semántica temporal de TRUST». Las fuentes geográficas candidatas y su cobertura medida están en [auditoría de fuentes geográficas](geographic-sources.md): NaPTAN resuelve el 76,7 % de los eventos observados y hace falta una segunda fuente para los cruces.

Fuentes documentales: [TRUST](https://wiki.openraildata.com/index.php/Train_Movements), [TD](https://wiki.openraildata.com/index.php/C_Class_Messages), [referencias](https://wiki.openraildata.com/index.php/Reference_data), [conexión](https://wiki.openraildata.com/index.php/Connecting_with_Stomp). Los accesos directos a algunas páginas devolvieron 403; se consultaron sus extractos indexados. Confirmar detalles con los mensajes reales.
