# Guía de diseño — Central de monitoreo Rails

**Proyecto de referencia:** rails-tracker-monitor  
**Fecha:** 19 de octubre de 2026  
**Aplicación:** mapas, GPS, flotas, AIS y operaciones en tiempo real.

## 1. La idea que organiza el diseño

Diseñamos Rails como una sala de operaciones: un espacio donde el usuario reconoce la situación general, encuentra un vehículo y examina su recorrido sin perder el contexto geográfico.

La dirección visual combina una base oscura con matices verdes, cartografía discreta, líneas finas, tipografía contenida y señales luminosas reservadas para la información relevante. Podemos llamarla **«central de operaciones de contraste contenido»** como nombre descriptivo de esta guía.

No partimos de un tema comercial ni de un sistema de diseño externo con ese nombre. La identidad se construyó para este proyecto. Next.js aporta la aplicación; shadcn/ui, una base de componentes; Tailwind y el CSS específico, la composición y el acabado. La guía general de Sites orientó la preparación y revisión visual, pero no prescribe esta paleta ni esta distribución.

La sensación buscada es precisión, calma y actividad. El carácter aparece en cómo se relacionan mapa, datos y selección, además de en los colores.

## 2. Jerarquía: entender, localizar y profundizar

La pantalla se organiza en tres niveles de lectura:

1. **Situación general:** región, modo de funcionamiento y pocos indicadores que resumen la operación.
2. **Exploración:** lista filtrable y mapa, visibles a la vez en escritorio.
3. **Detalle contextual:** información del vehículo seleccionado, recorrido y calidad de posición.

La línea de tiempo añade una dimensión transversal: el usuario puede explorar el mismo escenario en otro instante. La actividad reciente y el estado del sistema completan la lectura.

Esta jerarquía evita que cada dato necesite una tarjeta del mismo tamaño y relevancia. Las métricas orientan; el mapa sitúa; el inspector explica.

## 3. Composición de la pantalla

| Zona | Función | Referencia actual de escritorio |
|---|---|---|
| Navegación lateral | Cambiar de contexto con pocos iconos | 66 px de ancho |
| Cabecera | Marca, región y modo demo | 76 px de alto |
| Resumen | Introducción breve y cuatro indicadores | Mínimo de 147 px de alto |
| Lista de flota | Buscar, filtrar y elegir servicios | 275 px de ancho |
| Mapa central | Relacionar posiciones y recorridos | Columna flexible |
| Inspector | Profundizar en un servicio | 292 px de ancho |
| Línea de tiempo | Pausar, reproducir y retroceder | Franja horizontal |
| Actividad | Explicar cambios recientes | Dos o tres eventos visibles según ancho |
| Estado inferior | Comunicar conexión y contexto técnico mínimo | Franja discreta |

Las medidas son referencias del prototipo, no proporciones universales. En Rails el mapa ocupa la columna central disponible; su porcentaje cambia con el ancho de pantalla. Para otra flota conviene ajustar los paneles a la longitud real de nombres, identificadores y acciones.

La estructura se siente continua porque comparte bordes, fondos y alineaciones. Los paneles se separan mediante líneas de un píxel y pequeños cambios de tono. Los espacios exteriores habituales rondan los 20–28 px; dentro de paneles se utilizan aproximadamente 12–20 px.

## 4. Paleta y significado del color

### Superficies y lectura

| Papel | Color de referencia | Uso |
|---|---|---|
| Fondo general | `#0B1011` | Base de la aplicación |
| Panel | `#101718` | Superficies de trabajo |
| Texto principal | `#E4EAE7` | Información prioritaria |
| Texto secundario | `#83918D` | Contexto y metadatos |
| Borde | `#25302F` | Separación estructural |
| Acento de interacción | `#A0EBBC` | Acción activa, foco y selección |

Los negros llevan matices verdes y grises. Esto permite relacionar la interfaz con el mapa sin crear grandes saltos entre ambos. El texto principal tampoco es blanco puro: conserva presencia con un acabado más suave.

### Estados de la flota

| Estado | Color del marcador | Tratamiento complementario |
|---|---|---|
| En hora | `#91EDB4` | Etiqueta textual de estado |
| Retraso | `#F4C76A` | Minutos de retraso visibles |
| Retraso de 10 minutos o más, en esta demo | `#FF8073` | Mayor intensidad de aviso |
| Posición sin actualización | `#8B99AD` | Etiqueta y ubicación retenida |

El umbral de diez minutos pertenece al escenario de demostración; otra operación requiere sus propias reglas. El color del estado y el color de selección tienen funciones diferentes. Una selección debe poder reconocerse mediante contorno, fondo, etiqueta o grosor aunque el estado sea ámbar o rojo.

**Regla reutilizable:** cada uso de color debe responder a una función: estructura, interacción, categoría o estado. Mantener los avisos acompañados de texto o iconos.

## 5. Tipografía: producto y telemetría

Se combinan dos familias:

- **Sans serif:** títulos, nombres de estaciones, operadores, acciones y explicaciones.
- **Monoespaciada:** identificadores, relojes, coordenadas, porcentajes y pequeñas etiquetas de contexto.

La configuración declara `Inter`, `Helvetica Neue` y `Arial` para la primera familia. **No se descarga ni se incluye Inter**: la tipografía efectiva depende de las fuentes instaladas. La segunda familia usa `SFMono-Regular`, `Consolas` y `Liberation Mono` como alternativas del sistema.

| Elemento | Referencia actual |
|---|---|
| Título principal | 27 px, peso 500 y espaciado ligeramente cerrado |
| Marca | 31 px |
| Valor de una métrica | 32 px, monoespaciada |
| Identificador del tren en el inspector | 24 px, monoespaciada |
| Título de panel | 11–13 px |
| Contexto secundario y etiquetas | 7–10 px en varias zonas de la demo |

El contraste de tamaños produce ritmo sin llenar la pantalla de títulos grandes. Los rótulos en mayúsculas y con letras separadas recuerdan la instrumentación de una central.

**Mejora necesaria al convertirlo en un sistema de producción:** revisar los textos de 6–10 px que aparecen en el prototipo, aumentar la información útil a tamaños cómodos y verificar contraste, zoom y lectura en pantallas reales. La densidad visual puede conservarse reduciendo contenido secundario. Esta guía no certifica que todos los colores y tamaños actuales cumplan requisitos de accesibilidad.

## 6. Cartografía que acompaña la operación

La cartografía de fondo debe aportar orientación y dejar espacio a la información de la flota.

| Capa | Tratamiento actual |
|---|---|
| Territorio | Fondo `#182320` |
| Cobertura del suelo | Verde oscuro, opacidad 0,25 |
| Agua | `#0E191C` |
| Vías de agua | Trazo fino, opacidad 0,55 |
| Límites | Trazo discontinuo, opacidad 0,4 |
| Transporte de contexto | Trazo de 0,6 px, opacidad 0,14 |
| Corredores de la demo | Trazo de 1,7 px, opacidad 0,6 |
| Recorrido seleccionado | Trazo claro de 2,5 px, opacidad 0,9 |

El resplandor de los corredores es suave: una línea ancha con opacidad 0,07 y desenfoque. Su función es facilitar la separación del fondo. Usarlo en todas las superficies restaría jerarquía.

Los vehículos se representan con un pequeño rombo y una etiqueta monoespaciada. Las estaciones usan puntos más discretos y nombres secundarios. Seleccionar un vehículo ilumina su etiqueta y destaca su recorrido.

Los controles se agrupan en una columna compacta. La leyenda y la atribución permanecen en los bordes. La retícula decorativa es casi imperceptible y no captura eventos del puntero.

**Límite del prototipo:** los corredores son líneas esquemáticas entre estaciones y las posiciones son simuladas. El estilo cartográfico no convierte esas líneas en vías verificadas. En una adaptación AIS, los trayectos deberán conservar su significado real: posiciones observadas, historial o estimaciones identificadas.

## 7. Componentes e interacciones

### Lista de flota

Cada fila responde rápidamente a cuatro preguntas: qué vehículo es, de dónde viene, hacia dónde va y en qué estado está. El operador aparece después. La selección utiliza fondo ligeramente más claro y un borde vertical de acento.

Buscar y filtrar afecta tanto a la lista como a los marcadores. Si el elemento seleccionado queda fuera del filtro, el inspector muestra una invitación a seleccionar otro. Un resultado vacío ofrece una acción para restablecer filtros.

### Inspector contextual

Su orden es identidad, recorrido principal, estado, acción de seguimiento, progreso y explicación de la posición. La información de calidad de datos tiene un lugar propio y visible.

La acción «Seguir tren» cambia de aspecto al activarse. Así se reconoce que la cámara tiene un comportamiento persistente. El control de vista general permite recuperar el contexto territorial.

### Botones y superficies

Se utiliza un componente Button basado en shadcn/ui, con variantes principal, contorno y discreta. La personalidad se añade mediante tokens y estilos del producto.

Los radios habituales son de 4–6 px para controles y etiquetas, de 6–9 px para tarjetas e iconos destacados y de 12 px para el diálogo. Las sombras se concentran en elementos superpuestos. El desenfoque se reserva principalmente para el fondo de los diálogos.

### Tiempo y movimiento

El movimiento tiene una explicación operativa: avance del vehículo, seguimiento de cámara o cambio de instante. La demo permite pausar, cambiar entre 1×, 5× y 15× y desplazarse por treinta minutos.

La hora incluye contexto `Europe/London · BST`. Una implementación de producción deberá determinar el huso y su etiqueta según la fecha, especialmente alrededor de cambios de horario.

La hoja de estilos contempla movimiento reducido. Las futuras animaciones añadidas en JavaScript también deberán comprobar esa preferencia.

## 8. Calidad del dato como parte del diseño

Una central necesita explicar qué se sabe y cuándo se supo. Por eso el modo demo, las posiciones simuladas, la ausencia de conexión real y los trazados esquemáticos aparecen en la interfaz.

Al trasladarlo a un sistema real, diferenciar al menos:

- Ubicación reportada y fuente de ese reporte.
- Ubicación estimada y su ancla observada.
- Última ubicación conocida sin actualización reciente.
- Ubicación desconocida.
- Hora del evento y hora de recepción cuando la diferencia sea relevante.

La conexión del sistema y la frescura de un vehículo son estados distintos. Un servidor conectado puede mostrar una posición antigua. La interfaz debe poder expresar ambas cosas sin contradicciones.

Este principio es especialmente transferible a AIS: un marcador que deja de recibir datos conserva su última posición conocida con una indicación de antigüedad; una extrapolación necesita una representación y etiqueta propias.

## 9. Adaptación a pantallas pequeñas

Rails define ajustes a 1600, 1280, 1050, 900 y 650 px. Estas son las decisiones principales:

- En pantallas amplias aumentan los paneles y la cantidad de eventos visibles.
- Al reducir ancho desaparecen primero detalles secundarios de cabecera y resumen.
- Por debajo de 900 px el inspector pasa debajo del mapa.
- Por debajo de 650 px la lista se abre mediante un botón y ocupa una superficie independiente.
- La línea de tiempo se reorganiza para conservar el control de reproducción.

El criterio es preservar la tarea y reorganizar el contexto. La adaptación móvil está definida en CSS, pero no se verificó en un dispositivo móvil en esta entrega. Al reutilizarla conviene probar controles táctiles, zoom del navegador, textos largos y orientación horizontal.

## 10. Qué cambia respecto al tracker AIS de Norway

La referencia encontrada en el workspace se llama `norway-ship-tracker`. Esta comparación se basa en sus estilos y componentes locales actuales; no es una evaluación visual completa en navegador ni presupone otro proyecto llamado `norway-tracker-ais`.

| Aspecto | Norway Ship Tracker | Rails Tracker Monitor |
|---|---|---|
| Base global | Tema claro con superficies blancas y acento azul | Tema oscuro continuo con acento verde suave |
| Relación con el mapa | El popup ya tiene un acabado oscuro propio | Paneles y mapa comparten desde el inicio la misma familia de tonos |
| Presentación de datos | Tarjetas redondeadas y grupos de métricas | Franjas, separadores finos y paneles unidos |
| Tipografía | Arial/Helvetica global | Sans serif y monoespaciada diferenciadas por función |
| Identidad | Presentación de dashboard mediante componentes | Composición explícita de sala de operaciones |

Mi interpretación de la preferencia expresada por Rails es que su continuidad visual, su selección contextual y su jerarquía transmiten una central más cohesionada. Cambiar únicamente el fondo de Norway no reproduciría esa experiencia.

Una adaptación de Norway podría conservar sus capacidades AIS y reorganizar la presentación en este orden:

1. Unificar superficies, mapa, popups, paneles y estados bajo una misma paleta.
2. Introducir una navegación discreta y un resumen de operación compacto.
3. Relacionar una lista de barcos con el mapa y un inspector persistente del barco seleccionado.
4. Reservar la monoespaciada para MMSI, rumbo, velocidad, coordenadas y tiempos.
5. Diferenciar selección, tipo de barco y frescura del dato mediante señales independientes.
6. Dar contexto temporal al historial y mostrar los huecos de cobertura.
7. Verificar legibilidad y rendimiento con la flota real.

Estas son recomendaciones de adaptación. No se modificó Norway al exportar esta guía.

## 11. Brief reutilizable

> Diseñar una central de monitoreo de flotas con un mapa como espacio principal de exploración. Utilizar superficies oscuras con matices verdes y grises, un acento verde suave para interacción y colores de estado acompañados de texto. Organizar una lista filtrable a la izquierda, mapa flexible al centro e inspector contextual a la derecha en escritorio. Emplear separadores finos, radios contenidos y sombras reservadas para elementos superpuestos. Combinar sans serif para lectura y monoespaciada para identificadores y telemetría. Atenuar la cartografía de contexto y destacar vehículos, recorridos y selección. Mantener visibles la procedencia, antigüedad y calidad de las posiciones. Adaptar los paneles a móvil sin sacrificar legibilidad. Verificar que cada control tenga una función real y que las animaciones representen datos o estimaciones identificadas.

El brief describe una dirección visual. El dominio decide los campos, colores semánticos, reglas de frescura y precisión geográfica.

## 12. Referencias del proyecto

- `apps/web/app/globals.css`: tokens, distribución, componentes y adaptación responsive.
- `apps/web/components/monitor.tsx`: jerarquía y estados de la central.
- `apps/web/components/rail-map.tsx`: estilo cartográfico y representación geográfica.
- `apps/web/components/ui/button.tsx`: base de botones.
- `docs/validation.md`: verificaciones y límites de la entrega.
- `docs/monitor-preview.png`: captura de escritorio revisada.

Esta guía documenta el diseño realmente implementado y separa sus decisiones actuales de las mejoras recomendadas para producción.
