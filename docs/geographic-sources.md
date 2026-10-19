# Auditoría de fuentes geográficas

Fecha: 19 de octubre de 2026. Objetivo: encontrar una fuente que convierta los códigos de ubicación de TRUST en coordenadas para el mapa.

**CORPUS no contiene coordenadas.** Trae STANOX, TIPLOC, CRS (`3ALPHA`) y descripciones. El 100 % de cobertura que reporta el diagnóstico es correspondencia de códigos, exactamente como advierte su nota. Hace falta una fuente geográfica aparte.

## Qué reporta realmente el feed

Medido sobre los 1.586 reportes de movimiento almacenados en `raw_events`. Es una muestra de unos tres minutos, no un día completo ni toda la red.

| | Ubicaciones distintas | Eventos |
|---|---|---|
| Observadas | 1.074 | 1.586 |
| Con CRS, es decir estaciones | 837 (77,9 %) | 1.296 (81,7 %) |
| Sin CRS: cruces, bucles, señales | 237 (22,1 %) | 290 (18,3 %) |
| Con TIPLOC | 1.074 (**100 %**) | 1.586 (100 %) |

Dos consecuencias de diseño:

- **La clave de unión es TIPLOC, no STANOX.** Lo trae el 100 % de los registros y es lo que usan todas las fuentes candidatas. En CORPUS solo el 28,2 % de los STANOX tiene CRS.
- **Una fuente que solo cubra estaciones deja fuera cerca de uno de cada cinco eventos.** Ese resto no es ruido: son los cruces por donde un tren pasa sin detenerse.

## Cobertura real de NaPTAN, medida

No estimada: se descargó NaPTAN y se cruzó contra las ubicaciones observadas.

| | Ubicaciones | Eventos |
|---|---|---|
| Resueltas | 784 (73,0 %) | 1.217 (**76,7 %**) |
| Sin resolver | 290 | 369 (23,3 %) |

El techo teórico por estaciones era 81,7 %; el real es 76,7 %. La diferencia son 53 ubicaciones con CRS en CORPUS cuyo TIPLOC no aparece en NaPTAN.

Dentro de NaPTAN hay 2.716 paradas de tipo `RLY`, de las cuales 2.673 traen TIPLOC y 2.662 traen TIPLOC y coordenadas.

### Advertencia sobre el formato

**El CSV de NaPTAN no sirve para esto.** Sus columnas llegan hasta `StopType` y no incluyen ninguna referencia ferroviaria. El TIPLOC está únicamente en el XML, dentro de `AnnotatedRailRef`, y ese fichero pesa **579 MB** para extraer 2.716 estaciones. El parámetro `stopTypes` de la API se ignora y el formato comprimido se rechaza. La carga exigirá análisis en streaming.

A favor: el XML da longitud y latitud en WGS84 ya calculadas, así que no hace falta transformar desde la cuadrícula de Ordnance Survey.

### Un STANOX no identifica un punto único

Nueve de las ubicaciones observadas se corresponden con varios TIPLOC cuyas coordenadas **difieren entre sí**. Hace falta una regla explícita de resolución, y para los casos que no se puedan decidir, dejar la posición como `unknown` en lugar de escoger en silencio la primera coincidencia. El contrato de posición ya contempla esa calidad.

## Comparación de fuentes

| Fuente | Cubre | Licencia | Acceso | Problema principal |
|---|---|---|---|---|
| **NaPTAN** (DfT) | Estaciones GB | OGL v3 | XML directo, sin registro | 579 MB; el CSV no vale; 76,7 % de los eventos |
| **BPLAN Geography** (Network Rail) | Todas las ubicaciones del plan | OGL v3 | Rail Data Marketplace, con registro | Coordenadas "no garantizadas exactas"; se publica dos veces al año |
| Hoja FOI de eastings/northings | TIPLOC | OGL v3 | Enlace en el wiki | Instantánea sin mantenimiento |
| `raileasyuk/railway-gis-data` | Vías y TIPLOC | CC-BY-SA 4.0 | GitHub | Copyleft; posiciones ajustadas a mano |
| OpenStreetMap | Estaciones y vías | ODbL | Overpass | Copyleft; `ref:tiploc` incompleto |
| Vail Data | TIPLOC | OGL v3 | Solo consulta individual | Sin descarga masiva: no sirve |
| RailMaps | TIPLOC lat/long | No declarada | Descarga | Centros promediados, no posiciones oficiales |

## Recomendación

**NaPTAN como primaria y BPLAN Geography como segunda fuente necesaria**, no opcional. Con NaPTAN sola, uno de cada cuatro eventos queda sin posición, y los que faltan son precisamente los cruces. Ambas están bajo OGL v3, compatible con un proyecto permisivo.

**Las fuentes copyleft quedan descartadas** mientras no se decida lo contrario: CC-BY-SA y ODbL obligan a publicar las obras derivadas bajo la misma licencia. Es una decisión de proyecto que conviene tomar antes de incorporar datos, no después.

## Qué no se verificó

- El wiki de Open Rail Data tiene verificación anti-bots y devolvió 403 por obtención directa y por navegador. **No se intentó sortearla.** Lo que aquí se dice de la estructura de BPLAN y de la hoja FOI procede de resultados de búsqueda, no de la fuente original.
- No se comprobó el acceso real a Rail Data Marketplace ni sus condiciones de registro.
- La medición de cobertura usa una muestra de unos tres minutos de feed. Una muestra de un día entero, con horas valle y servicios nocturnos, podría mover las proporciones.

## Referencias

- [NaPTAN, descarga](https://beta-naptan.dft.gov.uk/download) y [guía del esquema](https://www.gov.uk/government/publications/national-public-transport-access-node-schema/naptan-guide-for-data-managers)
- [Colección de transporte en data.gov.uk](https://www.data.gov.uk/collections/transport/public-transport-stations-and-stops)
- [BPLAN Geography](https://wiki.openraildata.com/index.php/BPLAN_Geography) y [estructura BPLAN](https://wiki.openraildata.com/index.php/BPLAN_data_structure)
- [Vail Data, TIPLOC](https://vaildata.uk/bplan/tiploc) · [railway-gis-data](https://github.com/raileasyuk/railway-gis-data) · [RailMaps](https://railmap.azurewebsites.net/Downloads)
