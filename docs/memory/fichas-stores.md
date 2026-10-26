# Fichas de App Store y Google Play

Copia de los metadatos de las tiendas. La fuente de verdad sigue siendo App
Store Connect y Play Console: tras cambiar una ficha, actualizar este archivo
en el mismo cambio. Las notas de versión viven en `docs/releases/`.
Auditoría, propuesta y datos de partida:
`docs/informes/aso-auditoria-20261025.md`.

Última lectura y edición: 2026-10-25.

## App Store (iOS)

- ID de Apple `6761902611`, bundle `app.calendariociclismo`, SKU
  `calendariociclismo`.
- Idioma principal: Español (España). Categorías: Deportes (principal) y
  Noticias. Clasificación por edades: 17+ global (16+ en 173 países).
- Límites: nombre 30, subtítulo 30, palabras clave 100, texto promocional 170,
  descripción 4000. Indexan nombre, subtítulo, palabras clave y nombre del
  desarrollador; la descripción y el texto promocional no indexan.

### Estado

- Publicada: 5.1.3, solo en Español (España), con nombre `Calendario
  Ciclismo`, subtítulo `Horarios, TV e info esencial` y palabras clave
  `ciclismo,calendario,carreras,etapas,Tour,Giro,Vuelta,Roubaix,Flandes,danibici,pelotón,cycling`.
  El texto promocional de la 5.1.3 ya es el nuevo (se cambia sin versión).
- En preparación: 5.1.4, creada el 2026-10-25 en App Store Connect sin build.
  Lleva los metadatos de las tablas siguientes, que se publican cuando la 5.1.4
  se apruebe. Falta el texto de novedades de cada idioma. El build debe salir
  con `MARKETING_VERSION` y `versionName` 5.1.4.

### Metadatos de la 5.1.4

| Idioma | Nombre | Subtítulo | Palabras clave |
| --- | --- | --- | --- |
| Español (España) | `Calendario Ciclismo` | `Resultados, TV y horarios` | `directo,carreras,etapas,clasificación,ciclocross,fichajes,Tour,Francia,Giro,Italia,Vuelta,España` |
| Español (México) | `Calendario Ciclismo` | `Resultados, TV y horarios` | `vivo,carreras,etapas,clasificación,ciclocross,fichajes,Tour,Francia,Giro,Italia,Vuelta,España` |
| Inglés (Reino Unido) | `Calendario Ciclismo: Cycling` | `Pro cycling results & TV` | `calendar,road,race,live,stage,startlist,transfers,cyclocross,uci,tour,france,giro,vuelta,women` |
| Inglés (EE. UU.) | `Calendario Ciclismo: Cycling` | `Pro cycling results & TV` | `calendar,road,race,live,stage,startlist,transfers,cyclocross,uci,tour,france,giro,vuelta,women` |

Texto promocional (5.1.3 publicada y 5.1.4, español de España y México):

```text
El ciclocross también se vive en Calendario Ciclismo: resultados, TV y horarios de la Copa del Mundo, Superprestige, X2O y todas las pruebas locales en España.
```

Texto promocional (5.1.4, inglés de Reino Unido y EE. UU.):

```text
Cyclocross lives in Calendario Ciclismo too: results, TV and schedules for the World Cup, Superprestige, X2O and every local race in Spain.
```

Descripción en español (5.1.4, España y México; Play usa el mismo texto sin la
última línea):

```text
Calendario Ciclismo es la app definitiva para seguir el ciclismo profesional en ruta y el ciclocross. Consulta todas las carreras del calendario internacional masculino y femenino, desde el WorldTour hasta las pruebas continentales, en un solo lugar.

CALENDARIO, RESULTADOS, FICHAJES Y MUCHO MÁS
· Hoy: descubre de un vistazo qué carreras se disputan cada día, con horarios de salida y llegada estimada. Al terminar la carrera, repasa los resultados (sin spoilers) y revive la prueba por streaming.
· Mes y Temporada: visualiza el calendario completo en formato agenda y mensual para disfrutar a tope del ciclismo.
· Resultados: consulta el listado cronológico con las últimas clasificaciones de las carreras.
· Mercado de Fichajes: rumores, renovaciones, situación de plantilla y los últimos anuncios.

CICLOCROSS
El modo Ciclocross reúne cada día todas las pruebas con sus horarios por categoría, la televisión, los dorsales y los resultados de cada manga: Copa del Mundo, Superprestige, X2O y todas las pruebas locales en España.

INFORMACIÓN DETALLADA DE CADA ETAPA
Consulta perfiles interactivos con detalle de puertos, mapas de recorrido y rutómetros oficiales. Cada jornada incluye localidad de salida y llegada, distancia, tipo de etapa (llana, montaña, contrarreloj...), web oficial y, en las pruebas de máxima categoría, descripción editorial experta en español con las claves de la jornada.

HORARIOS DE TELEVISIÓN
Comprueba en qué cadenas se emite cada carrera para no perderte la acción en directo.

LISTAS DE INSCRITOS Y ÓRDENES DE SALIDA
Consulta los participantes para cualquier carrera del calendario UCI sin salir a ninguna otra web, o accede a los órdenes de salida de contrarreloj individual o por equipos.

NOTIFICACIONES PERSONALIZADAS
Activa las notificaciones push para recibir avisos sobre eventos clave y grandes actualizaciones de contenido, sin spam, o activa avisos para las carreras que te interesen.

Calendario Ciclismo cubre el ciclismo profesional en ruta a nivel UCI, tanto masculino como femenino, y el ciclocross: Giro d'Italia, Tour de Francia, La Vuelta, las Clásicas de Primavera, los Mundiales, la Copa del Mundo de ciclocross y mucho más.

Diseñada con cariño por un periodista con 20 años de experiencia en el pelotón. Por amor al ciclismo. Es un proyecto Open Source con código abierto y accesible. Consulta nuestro perfil de X, @CalCiclismo, para acceder a más info.

Términos de uso: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

Descripción en inglés (5.1.4, Reino Unido y EE. UU.; Play en-US usa el mismo
texto sin la última línea):

```text
Calendario Ciclismo is the ultimate app for following pro cycling, on the road and in cyclocross. Check every race on the men's and women's international calendar, from the WorldTour to continental events, in one place.

CALENDAR, RESULTS, TRANSFERS AND MORE
· Today: see at a glance which races are on each day, with start and estimated finish times. Once the race is over, check the results (spoiler-free) and relive it via streaming.
· Month and Season: browse the full calendar as a list or month by month.
· Results: a chronological list with the latest race classifications.
· Transfer Market: rumours, renewals, roster status and the latest announcements.

CYCLOCROSS
Cyclocross mode brings together every race of the day with its schedule by category, TV coverage, startlists and results: World Cup, Superprestige, X2O and every local race in Spain.

DETAILED STAGE INFORMATION
Interactive profiles with climb details, route maps and official route books. Each stage includes start and finish towns, distance, stage type (flat, mountain, time trial...), official website and, for the top races, an expert editorial preview in Spanish.

TV GUIDE
Find out which channels broadcast each race so you never miss the live action.

STARTLISTS AND START ORDERS
See the riders for any race on the UCI calendar without leaving the app, and the start orders for individual and team time trials.

CUSTOM NOTIFICATIONS
Turn on push notifications for key events and major content updates, without spam, or set alerts for the races you follow.

Calendario Ciclismo covers UCI men's and women's road racing and cyclocross: Giro d'Italia, Tour de France, La Vuelta, the Spring Classics, the World Championships, the Cyclocross World Cup and much more.

Built with care by a journalist with 20 years in the peloton. For the love of cycling. An open-source project with public code. Follow @CalCiclismo on X for more.

Terms of use: https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
```

### Edición en App Store Connect

- Nombre, subtítulo y localizaciones de «Información de la app» solo se editan
  con una versión en preparación.
- Guardar un idioma por vez y recargar la página antes de editar el siguiente.
  La página reenvía los demás idiomas con su estado anterior: al guardar dos
  idiomas nuevos con el mismo nombre devuelve «el nombre de la app que has
  introducido ya se utiliza», puede descartar una localización recién creada y
  llegó a guardar `&amp;` en lugar de `&`.
- Comprobar lo guardado con la API interna de la sesión (`/iris/v1/apps/<id>/
  appInfos?include=appInfoLocalizations` y `appStoreVersions?include=
  appStoreVersionLocalizations`), no con el aviso «Guardado».

## Google Play (Android)

- Paquete `app.calendariociclismo.android`. Descargas: 1K+ (ficha pública).
- Límites: título 30, descripción breve 80, descripción completa 4000. Play
  indexa los tres campos; no tiene campo de palabras clave.
- Idiomas de la ficha predeterminada: Español (España) y, desde el
  2026-10-25, Inglés (Estados Unidos). Antes de esa fecha el inglés de la ficha
  pública era la traducción automática de Google.
- Declaración de recursos de IA: «Etiquetar recursos como creados o editados con
  IA».
- Publicación gestionada desactivada: los cambios guardados quedan en «Resumen
  de publicación» hasta enviarlos a revisión.

### Estado

Enviados a revisión el 2026-10-25 (tres cambios: idioma en-US, descripción
breve y descripción completa en castellano).

| Idioma | Título | Descripción breve |
| --- | --- | --- |
| Español (España) | `Calendario Ciclismo` | `Calendario, resultados y TV de ciclismo en ruta y ciclocross, sin spoilers` |
| Inglés (Estados Unidos) | `Calendario Ciclismo` | `Pro cycling calendar, results and TV guide, road and cyclocross, spoiler-free` |

Descripciones completas: las de App Store de cada idioma sin la línea final de
términos de uso.

Valores anteriores: descripción breve `Ciclismo al instante: TV, horarios e
info esencial`; descripción completa igual a la de App Store 5.1.3 sin
ciclocross.
