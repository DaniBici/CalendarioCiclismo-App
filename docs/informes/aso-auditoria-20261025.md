# Auditoría ASO y propuesta de palabras clave (2026-10-25)

Auditoría sin cambios en las tiendas. Objeto: medir la visibilidad de búsqueda
de la versión 5.1.3 en España y en mercados de habla inglesa y proponer
metadatos para App Store y Google Play. Metadatos vigentes:
`docs/memory/fichas-stores.md`.

## Método y límites

- Posiciones: API pública de búsqueda de iTunes (`itunes.apple.com/search`,
  `entity=software`, 50 resultados), tiendas `es`, `gb` y `us`. Aproxima el
  buscador de la App Store, pero no coincide con él: sirve para detectar
  presencia o ausencia, no para fijar posiciones exactas.
- Demanda: sugerencias de autocompletado de la App Store
  (`MZSearchHints`), que ordenan por popularidad sin dar volumen. La
  popularidad numérica (5-100) solo está en Apple Search Ads y no se ha
  consultado.
- Competidores: título y subtítulo de sus fichas públicas en España y Reino
  Unido.
- Localizaciones indexadas por país: tabla de Apple «App Store
  localizations» (developer.apple.com, consultada el 2026-10-25).
- Sin datos de App Store Connect Analytics ni de Play Console: no hay línea
  base de impresiones, visitas a la ficha ni conversión.

## Hallazgos

1. **Una sola localización en App Store.** La ficha solo existe en Español
   (España). En EE. UU. y Reino Unido se muestra la descripción en castellano
   y ningún subtítulo. La app no aparece en ninguna de las 26 búsquedas
   inglesas medidas, incluidas `pro cycling` y `cycling results`.
2. **España: solo posiciona en lo que ya figura en los metadatos.**

   | Búsqueda | Posición | Primeros resultados |
   | --- | --- | --- |
   | calendario ciclismo | 1 | — |
   | cal ciclismo | 1 | — |
   | ciclismo tv | 1 | — |
   | horarios ciclismo | 1 | — |
   | etapas ciclismo | 2 | Cycling Fantasy |
   | carreras ciclismo | 5 | Mad Skills BMX 2, Garmin Connect |
   | ciclismo | 6 | Tour de France Cycling Legends, Strava, Cyclingoo |
   | resultados ciclismo | — | Eurosport, Cyclingoo, Bidon, Attaqo |
   | ciclismo en directo | — | Tour Tracker |
   | ciclismo hoy | — | Cyclingoo |
   | clasificación ciclismo | — | Cycling Fantasy, FanLine |
   | ciclismo femenino | — | Cyclingoo |
   | tour de francia | — | Tour de France by ŠKODA, Cyclingoo |
   | la vuelta | — | La Vuelta presented by ŠKODA, Cyclingoo |
   | vuelta a españa | — | La Vuelta presented by ŠKODA, Cyclingoo |
   | giro de italia | — | Giro d'Italia, Tour Tracker |
   | ciclocross | — | 3 apps sin valoraciones |
   | fichajes ciclismo | — | sin resultados |

   `Tour`, `Giro` y `Vuelta` están en las palabras clave, pero las búsquedas
   reales incluyen `francia`, `italia` y `españa`, que no figuran.
3. **Palabras clave desaprovechadas.** `ciclismo` y `calendario` (19
   caracteres) repiten el nombre, que ya indexa. `cycling` apenas tiene valor
   en la tienda española. `info esencial` ocupa 13 caracteres del subtítulo
   sin demanda de búsqueda.
4. **`cycling calendar` no sirve en inglés.** En `gb` y `us`, los 49-50
   resultados son apps de ciclo menstrual. El término útil es `pro cycling`
   (sugerencias: `fuente externa`, `tour tracker pro cycling`,
   `cyclingnews: pro cycling news`).
5. **Ciclocross ausente de la ficha.** Ni los metadatos de App Store ni las
   descripciones de Play lo mencionan desde que existe el modo Ciclocross
   (5.1). En `ciclocross` (España) y `cyclocross` (Reino Unido y EE. UU.)
   no aparece ninguna app de seguimiento de carreras.
6. **Texto promocional vacío.** Son 170 caracteres que no indexan, pero se
   muestran sobre la descripción y se cambian sin publicar versión.
7. **Valoraciones.** 49 en App Store (4,9) frente a 1.519 de Cyclingoo en
   España. La app ya pide valoración (`ContentView.swift`,
   `AppNavHost.kt`); no se ha medido cuándo ni con qué frecuencia.

### Competidores (título / subtítulo)

| App | España | Reino Unido |
| --- | --- | --- |
| Cyclingoo | Resultados ciclismo / Clasificaciones y estadísticas | Cycling results / Results, stats, live and more |
| Tour Tracker | Ciclismo Live / Vuelta a España en Directo | Pro Cycling / Vuelta a España Live Coverage |
| Bidon | Widgets de ciclismo / La Vuelta a España Ranking | Pro Cycling Widgets / La Vuelta a España Standings |
| Attaqo | Pro Cycling / Carreras, etapas, resultados | Pro Cycling / Races, stages, results, teams |
| FanLine | Ciclismo Pro Tracker / Recordatorios y clasificación | Pro Cycling Tracker / Race-day reminders & standings |
| Cyclingnews | Pro Cycling News / — | Pro Cycling News / Live race results & bike tech |

Todos llevan `pro cycling` o `results` en el título en inglés. Tour Tracker y
Bidon cambian el subtítulo según la carrera en curso.

## Localizaciones que indexa cada tienda

| Tienda | Principal | Adicionales |
| --- | --- | --- |
| España | Español (España) | Catalán, Inglés (Reino Unido) |
| Reino Unido, Irlanda | Inglés (Reino Unido) | — |
| EE. UU. | Inglés (EE. UU.) | Español (México) y otras siete |
| México, Argentina, Colombia | Español (México) | Inglés (Reino Unido) |
| Australia | Inglés (Australia) | Inglés (Reino Unido) |

Consecuencias:

- Una localización Inglés (Reino Unido) cubre Reino Unido e Irlanda y además
  suma su nombre, subtítulo y palabras clave a la búsqueda en España,
  Latinoamérica y Australia.
- Inglés (EE. UU.) es necesaria para mostrar la ficha en inglés en EE. UU.
- Catalán añade en España otro bloque de nombre, subtítulo y 100 caracteres de
  palabras clave. Exige una ficha traducida al catalán, que verán los
  dispositivos en catalán.
- Español (México) indexa en Latinoamérica y como adicional en EE. UU.

## Propuesta App Store

Criterios: el nombre no cambia (marca, web, icono y @CalCiclismo); las
palabras clave no repiten palabras del nombre ni del subtítulo de la misma
localización, van en singular, sin espacios tras las comas, y cubren las
palabras de las búsquedas completas (`tour` + `francia`). App Store combina
palabras de nombre, subtítulo y palabras clave de una misma localización.

### Español (España)

| Campo | Actual | Propuesta | Longitud |
| --- | --- | --- | --- |
| Nombre | `Calendario Ciclismo` | sin cambios | 19/30 |
| Subtítulo | `Horarios, TV e info esencial` | `Resultados, TV y horarios` | 25/30 |
| Palabras clave | ver ficha | `directo,carreras,etapas,clasificación,ciclocross,fichajes,Tour,Francia,Giro,Italia,Vuelta,España` | 96/100 |

Entran `resultados`, `directo`, `clasificación`, `ciclocross`, `fichajes`,
`Francia`, `Italia` y `España`. Se mantienen `TV` y `horarios`, donde la app
ya es primera. Salen `ciclismo` y `calendario` (repetidas), `cycling` (pasa a
inglés), `Roubaix`, `Flandes`, `pelotón` y `danibici` (pasan a catalán si se
crea esa localización).

### Inglés (Reino Unido) e Inglés (EE. UU.)

| Campo | Propuesta | Longitud |
| --- | --- | --- |
| Nombre | `Calendario Ciclismo` | 19/30 |
| Subtítulo | `Pro cycling races, results, TV` | 30/30 |
| Palabras clave | `calendar,road,classics,live,stage,startlist,transfers,cyclocross,uci,tour,france,giro,vuelta,women` | 98/100 |
| Descripción | traducción de la española, tomando como base la de Play en inglés | — |

Alternativa con más peso de búsqueda y menos marca: nombre
`Pro Cycling Calendar & Results` (30/30) solo en inglés. Decisión de producto;
no se recomienda sin datos de conversión.

### Español (México)

| Campo | Propuesta | Longitud |
| --- | --- | --- |
| Nombre | `Calendario Ciclismo` | 19/30 |
| Subtítulo | `Resultados, TV y horarios` | 25/30 |
| Palabras clave | `vivo,carreras,etapas,clasificación,ciclocross,fichajes,Tour,Francia,Giro,Italia,Vuelta,España` | 93/100 |

`vivo` sustituye a `directo` («en vivo» es la forma habitual en
Latinoamérica).

### Catalán (opcional, segunda fase)

| Campo | Propuesta | Longitud |
| --- | --- | --- |
| Nombre | `Calendario Ciclismo` | 19/30 |
| Subtítulo | `Resultats, TV i horaris` | 23/30 |
| Palabras clave | `inscritos,femenino,Roubaix,Flandes,UCI,mundial,clásicas,crono,resultats,curses,ciclisme,directe` | 95/100 |

El campo de palabras clave no se muestra; las palabras en castellano indexan
en España igual que las catalanas. La descripción debe traducirse al catalán.

### Texto promocional (Español)

Propuesta inicial descartada por errónea (ver «Aplicación»). Texto aplicado,
de Dani: `El ciclocross también se vive en Calendario Ciclismo: resultados, TV
y horarios de la Copa del Mundo, Superprestige, X2O y todas las pruebas locales
en España.` (159/170). Se cambia sin enviar versión; renovar al empezar la
temporada de carretera.

### Descripción

No indexa en App Store. Añadir un bloque de ciclocross tras «Calendario,
resultados, fichajes y mucho más» y actualizar la frase de cobertura, que
limita la app al «ciclismo profesional en ruta».

## Propuesta Google Play

Play indexa título, descripción breve y descripción completa; la repetición
natural de términos en la descripción completa cuenta.

| Campo | Actual | Propuesta | Longitud |
| --- | --- | --- | --- |
| Descripción breve (ES) | `Ciclismo al instante: TV, horarios e info esencial` | `Calendario, resultados y TV de ciclismo en ruta y ciclocross, sin spoilers` | 74/80 |
| Descripción breve (EN) | `Cycling in an instant: TV, schedules and essential info` | `Pro cycling calendar, results and TV guide, road and cyclocross, spoiler-free` | 77/80 |

Descripción completa: el mismo bloque de ciclocross que en App Store, y en
inglés `pro cycling` y `cycling results` en el primer párrafo. La versión
inglesa empieza por «Cycling Calendar is…»: conviene mantener el nombre
`Calendario Ciclismo` como en el título.

## Orden de aplicación y medida

1. Español (España): subtítulo y palabras clave en la próxima versión que se
   envíe; texto promocional en cualquier momento.
2. Inglés (Reino Unido), Inglés (EE. UU.) y Español (México): crear las
   localizaciones en la misma versión. Requieren descripción y capturas por
   localización (si no se suben, App Store usa las del idioma principal).
3. Play: descripciones breves y completas, sin versión.
4. Medir a las 2 y 6 semanas: repetir estas búsquedas y comparar en App Store
   Connect Analytics las impresiones por búsqueda y la conversión por país.
   Cambiar una sola variable por ciclo para atribuir el efecto.
5. Catalán y pruebas A/B de la primera captura (Product Page Optimization),
   después de tener la línea base.

## Aplicación (2026-10-25)

Aplicado el mismo día por Claude in Chrome con la sesión de Dani, pantalla a
pantalla y con su aprobación. Valores vigentes: `docs/memory/fichas-stores.md`.

- App Store, texto promocional de la 5.1.3 (publicado): el texto de Dani
  sustituye a la propuesta de esta auditoría, que afirmaba que Hoy de
  carretera volvía el 1 de enero; desde la 5.1.3 la carretera sigue visible
  con el selector de Hoy.
- App Store, versión 5.1.4 creada en preparación, con Español (España),
  Español (México), Inglés (Reino Unido) e Inglés (EE. UU.). Diferencias con la
  propuesta:
  - Nombre en inglés `Calendario Ciclismo: Cycling`. `Calendario Ciclismo`
    falló en inglés con «nombre ya utilizado»; el fallo resultó ser del
    guardado conjunto de idiomas (ver «Edición en App Store Connect» en
    `fichas-stores.md`), no de otra app.
  - Subtítulo en inglés `Pro cycling results & TV`;
    `Pro cycling races, results & TV` ocupa 31 caracteres.
  - Palabras clave en inglés: `race` sustituye a `classics`.
  - Textos promocionales en las cuatro localizaciones de la 5.1.4: sin ellos,
    la ficha perdería el texto al publicar la versión.
- Google Play: descripciones breve y completa en castellano y nuevo idioma
  en-US, enviados a revisión. Título sin cambios en los dos idiomas.
- Sin aplicar: catalán, pruebas A/B de capturas y novedades de la 5.1.4.

## Datos de partida

Play Console, «Fichas de Play Store», del 2026-09-24 al 2026-10-21, frente a
los 28 días anteriores:

| Métrica | Valor | Variación |
| --- | --- | --- |
| Visitantes | 255 | +6 % |
| Clics de instalación de usuarios únicos | 135 | +24 % |
| Porcentaje de clics | 53 % | +17 % |

## Pendiente

- Novedades de la 5.1.4 en los cuatro idiomas y envío de la versión.
- Popularidad de las palabras clave en Apple Search Ads (requiere la cuenta de
  Dani).
- Línea base de App Store Connect Analytics.
- Medición a las 2 y 6 semanas de la publicación de la 5.1.4 y de la ficha de
  Play.
- Cuándo pide valoración la app y con qué límite.
