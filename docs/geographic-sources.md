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

## TPS: accesible ya, pero sin coordenadas

Medido el 20 de octubre de 2026. Antes de evaluar accesos nuevos conviene saber qué alcanzan las credenciales actuales. Probando los tipos documentados del portal:

| Tipo | Respuesta |
|---|---|
| CORPUS | 200, 788 KB |
| SMART | 200, 365 KB |
| **TPS** | **200, 24 MB** |
| BPLAN, GEOGRAPHY, NWK, REFERENCE | 404 |

TPS se descarga **sin registro adicional**. Llega en bzip2, no en gzip, y descomprime a unos 617 MB de XML con el modelo de red del Train Planning System. Contiene 18.101 elementos `<station>` con `abbrev` (TIPLOC), `stanox`, `crscode` y atributos `easting` y `northing`: seis veces más ubicaciones que NaPTAN y justo las claves de unión que necesitamos.

**Solo 27 de esas 18.101 estaciones tienen coordenada no nula.** El resto llevan ceros:

```xml
<station abbrev="ADLESTN" stanox="86011" crscode="ASN" easting="0" northing="0" ...>
```

TPS posiciona con referencias kilométricas (`<stationposition kmvalue="33615">`), no geográficas: es un modelo de planificación, no un mapa. **No resuelve el 23 % de eventos sin posición**, y eso queda medido en lugar de supuesto.

## BPLAN en Rail Data Marketplace

El catálogo es navegable sin cuenta. Hay dos productos, ambos marcados **OPEN**:

| Producto | Publicador | Actualización |
|---|---|---|
| NWR BPLAN Geography v3.0 | Network Rail | Dos veces al año |
| BPLAN Geography | OpenTrainTimes Ltd. | Extractos semanales |

La ficha declara que los suscriptores acceden gratis durante su suscripción, con licencia abierta descargable. **No es de pago: el obstáculo es el registro.** Para cruces y bucles conviene considerar el extracto semanal antes que el oficial semestral, porque seis meses de desfase pesan en infraestructura que cambia.

**Sin verificar: la mecánica de entrega.** Hay indicios de que los productos de fichero se empujan a almacenamiento en la nube o por SFTP, sin descarga bajo demanda, mientras que la ayuda del propio sitio habla de ficheros descargables. La contradicción no se resuelve desde fuera de una cuenta, y decide si BPLAN se integra con una orden o exige infraestructura de recepción. Tampoco se descargó el PDF de la licencia ni se creó cuenta alguna.

## Comparación de fuentes

| Fuente | Cubre | Licencia | Acceso | Problema principal |
|---|---|---|---|---|
| **NaPTAN** (DfT) | Estaciones GB | OGL v3 | XML directo, sin registro | 579 MB; el CSV no vale; 76,7 % de los eventos |
| **BPLAN Geography** (Network Rail) | Todas las ubicaciones del plan | Abierta, gratuita | Rail Data Marketplace, con registro | Coordenadas "no garantizadas exactas"; semestral; entrega sin verificar |
| **BPLAN Geography** (OpenTrainTimes) | Extracto de lo anterior | Abierta, gratuita | Rail Data Marketplace, con registro | Semanal, lo que compensa el desfase del oficial |
| TPS (Network Rail) | 18.101 ubicaciones con TIPLOC y STANOX | OGL v3 | **Ya accesible, sin registro** | **Solo 27 traen coordenada**: no sirve para posicionar |
| Hoja FOI de eastings/northings | TIPLOC | OGL v3 | Enlace en el wiki | Instantánea sin mantenimiento |
| `raileasyuk/railway-gis-data` | Vías y TIPLOC | CC-BY-SA 4.0 | GitHub | Copyleft; posiciones ajustadas a mano |
| OpenStreetMap | Estaciones y vías | ODbL | Overpass | Copyleft; `ref:tiploc` incompleto |
| Vail Data | TIPLOC | OGL v3 | Solo consulta individual | Sin descarga masiva: no sirve |
| RailMaps | TIPLOC lat/long | No declarada | Descarga | Centros promediados, no posiciones oficiales |

## Estado de la carga

NaPTAN ya está cargado en `locations` mediante `npm run import:naptan`. La medición contra los datos almacenados reproduce exactamente las cifras de esta auditoría: 784 de 1.074 ubicaciones y 1.217 de 1.586 eventos. Los nueve STANOX ambiguos afectan a 36 eventos y se conservan sin resolver.

## Recomendación

**NaPTAN como primaria y BPLAN Geography como segunda fuente necesaria**, no opcional. Con NaPTAN sola, uno de cada cuatro eventos queda sin posición, y los que faltan son precisamente los cruces. Ambas están bajo OGL v3, compatible con un proyecto permisivo.

**Las fuentes copyleft quedan descartadas** mientras no se decida lo contrario: CC-BY-SA y ODbL obligan a publicar las obras derivadas bajo la misma licencia. Es una decisión de proyecto que conviene tomar antes de incorporar datos, no después.

## Qué no se verificó

- El wiki de Open Rail Data tiene verificación anti-bots y devolvió 403 por obtención directa y por navegador. **No se intentó sortearla.** Lo que aquí se dice de la estructura de BPLAN y de la hoja FOI procede de resultados de búsqueda, no de la fuente original.
- No se creó cuenta en Rail Data Marketplace, así que la mecánica de entrega de sus productos de fichero sigue sin comprobarse.
- La medición de cobertura usa una muestra de unos tres minutos de feed. Una muestra de un día entero, con horas valle y servicios nocturnos, podría mover las proporciones.

## Referencias

- [NaPTAN, descarga](https://beta-naptan.dft.gov.uk/download) y [guía del esquema](https://www.gov.uk/government/publications/national-public-transport-access-node-schema/naptan-guide-for-data-managers)
- [Colección de transporte en data.gov.uk](https://www.data.gov.uk/collections/transport/public-transport-stations-and-stops)
- [BPLAN Geography](https://wiki.openraildata.com/index.php/BPLAN_Geography) y [estructura BPLAN](https://wiki.openraildata.com/index.php/BPLAN_data_structure)
- [Vail Data, TIPLOC](https://vaildata.uk/bplan/tiploc) · [railway-gis-data](https://github.com/raileasyuk/railway-gis-data) · [RailMaps](https://railmap.azurewebsites.net/Downloads)
