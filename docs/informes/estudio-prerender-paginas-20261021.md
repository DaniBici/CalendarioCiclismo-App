# Estudio: contenido generado en el build para el resto de páginas (2026-10-21)

Estudio sin cambios de código ni de producción. Objeto: determinar qué tipos de
página de calendariociclismo.app, además de las jornadas (fase 3,
`docs/plans/fase-3-jornadas-estaticas.md`), deben llevar en el HTML del build
el contenido que hoy pinta el JS con datos de Supabase, y en qué orden.

Este informe conserva el estudio y las mediciones del 2026-10-21. Estado
vigente del presupuesto del job, ahorros aplicados y fases:
`docs/plans/contenido-generado-build.md`.

Condiciones (Dani):

- Sin bloque SEO oculto: el HTML contiene lo que ve el usuario.
- Ningún workflow, job, disparador, cron ni build nuevo, y ningún build lanzado
  desde la base de datos. Todo cabe en el job de build existente, por debajo de
  120 s (GitHub factura cada job redondeando al minuto).
- Resultados: no se pierde ninguna función actual, en especial la
  actualización automática.

## Resumen

- **Presupuesto de build agotado.** El build completo (cron de las 05:00 UTC y
  `workflow_dispatch` sin entradas: 63 en los últimos 30 días) mide 110 s con
  las jornadas ES y llegó a 123 s sin prerender el 2026-10-19. Ningún tipo
  nuevo cabe sin un ahorro previo equivalente, medido en el build completo. Los
  builds por push (54–76 s) tienen margen, pero el prerender se ejecuta en todos.
- **Tamaño.** El sitio publicado mide 200,5 MB (22.766 archivos), el 20 % del
  límite de 1 GB de GitHub Pages. Lo comprometen resultados con el marcado
  actual (~1,08 KB por fila) y ciclocross con todas las secciones en cada URL.
- **Sin JS.** Ninguna página salvo la jornada contiene los datos clave
  (ganador, horarios, televisión, corredores). Portada, calendario, fichajes y
  las tres páginas de cada carrera de ciclocross llevan hoy texto oculto por
  CSS; la portada de resultados, la agenda CX y Campeonatos no llevan nada.
- **Carga en móvil.** El contenido aparece entre 2,0 y 4,0 s en todas las
  páginas pintadas por JS; la jornada generada, a 0,94 s (misma jornada en EN,
  sin generar: 2,03 s). El LCP que registra Chrome en la mayoría es el bloque
  estático, el rótulo de la pantalla de carga o el pie de página (0,7–1,0 s),
  no el contenido.
- **CLS.** Dos causas: el pie de página, que el contenido empuja fuera de la
  pantalla bajo la capa de carga (0,08–0,23 en once tipos de página), y, en
  resultados, la tabla y el panel del perfil (0,28–0,59). La primera se
  corrige sin prerender, reservando alto en `<main>`.
- **Prioridades.** (1) Inscritos, ES y EN. (2) Resultados de carrera y etapa,
  por fases: CLS y marcado de filas primero; después, solo las páginas cerradas
  y fuera de la ventana de actualización. (3) Perfil, mapa y orden de salida
  como extensión de las jornadas. Descartados: portada (Hoy y Ciclocross),
  agenda CX, portada de resultados, calendario y Campeonatos 2026.

## Método

- **Inventario.** `sitemap-1.xml` de producción (13.779 URL) y el artifact del
  build `39648200374` (2026-10-21 17:56 UTC, `PRERENDER_JORNADAS=es`),
  descargado y medido archivo a archivo.
- **Lectura sin JS.** `curl` sobre producción de 32 URL ES y sus 31 gemelas EN
  (dos o tres por tipo, con Giro 2026 etapa 10, Il Lombardia 2026 y Mosselcross
  2026 como casos ricos). Palabras de texto en `<main>` sin `script`, `style` ni
  `svg`, enlaces y `<time>`, distinguiendo el bloque `.static-prerender`
  recortado por CSS del visible.
- **Carga en móvil.** Chrome sin interfaz por CDP con perfil temporal en el
  scratchpad de la sesión (nunca el navegador de Dani), contra producción:
  412×823 a 2,625, agente de Pixel 8, «Slow 4G» (150 ms, 1,6 Mbit/s de bajada,
  750 kbit/s de subida), CPU ×4, caché y almacenamiento del origen borrados
  antes de cada carga, zona `Europe/Madrid`, consentimiento de cookies guardado
  como rechazado (sin aviso). Mediana de 5 cargas por URL.
  - «Contenido visible»: retirada de la capa de carga (`.page-loading`) en el
    siguiente fotograma; sin capa, el LCP.
  - CLS: ventana de sesión máxima (1 s de separación, 5 s de duración) de las
    entradas `layout-shift` sin interacción. Fuentes por
    `LayoutShiftAttribution`; las entradas del ciclista animado de la capa de
    carga (`::after`, < 0,001 cada una) se descartan.
  - Diferencia con el informe del prototipo: allí se sirvió un `_site` local;
    aquí se mide producción (GitHub Pages y Supabase reales), con latencias
    mayores. La jornada generada da 0,94 s aquí y 0,59 s en local.
- **Código.** Lectura de los módulos de cada página con referencias
  `archivo:línea` (cuatro análisis de solo lectura: resultados, ciclocross,
  subpáginas de carrera y páginas globales).
- **Datos.** Volúmenes por `node scripts/db/sql.mjs --read-only`.
- **Build.** Duración de pasos por la API de Actions (builds completos del
  2026-10-18 al 2026-10-21, push `39644013967`, dispatch `39645143540` con
  `2027` y `39648200374` con `es`).

## Estado de partida

### Sitio publicado

Artifact de `39648200374`: 200,5 MB sin comprimir en 22.766 archivos (tar de
228 MB; artifact comprimido de 11,2 MB).

| Directorio | Archivos HTML | MB | Media por página |
| --- | ---: | ---: | ---: |
| `jornada` (generadas) | 1.928 | 40,0 | 20,2 KB |
| `en/stage` | 1.927 | 17,1 | 8,7 KB |
| `resultados` | 2.105 | 16,9 | 7,8 KB |
| `en/results` | 2.011 | 15,7 | 7,6 KB |
| `competicion` / `en/race` | 1.672 / 1.575 | 15,0 / 12,9 | 8,8 / 8,0 KB |
| `inscritos` / `en/startlist` | 1.672 / 1.575 | 13,0 / 11,3 | 7,6 / 7,0 KB |
| `perfil` / `en/profile` | 960 / 960 | 7,8 / 7,4 | 7,9 / 7,5 KB |
| `mapa` / `en/route-map` | 275 / 275 | 2,3 / 2,2 | 8,0 / 7,7 KB |
| `orden-salida` / `en/start-order` | 102 / 102 | 0,8 / 0,8 | 7,7 / 7,6 KB |
| `ciclocross` (carrera, inscritos, resultados) | 726 | 7,5 | 9,7–10,8 KB |
| `en/cyclocross` (ídem) | 726 | 6,8 | 8,8–9,5 KB |
| `sitemap-1.xml` | — | 8,2 | — |
| `feed`, `en/feed` (iCal) | — | 6,7 | — |
| `js`, `css`, `fonts`, `flags` | — | 7,0 | — |

Las páginas generadas superan a las del sitemap: `competicion` incluye las
carreras de un día (canonical a la jornada) y las de 2027; `inscritos`, toda
carrera con slug aunque no tenga lista (605 carreras tienen corredores).

### Job de build

| Paso (build completo) | Sin prerender (cron 18–21 oct) | Con `es` (`39648200374`) |
| --- | ---: | ---: |
| Generar OG (una ejecución para las cinco familias) | 27–32 s | 26 s |
| Sitemap, Atom y `asset-canonicals.json` | 14–19 s | 16 s |
| Feeds iCal | 9–13 s | 10 s |
| Prerender de jornadas | — | 6 s (datos 2,70 s, pintado 2,48 s) |
| Comprobar hreflang | 4–6 s | 6 s |
| Versionar JS/CSS | 7–10 s | 11 s |
| Subida del artifact | 3–5 s | 5 s |
| **Job completo** | **88–123 s** | **110 s** |

En 30 días (2026-09-21 a 2026-10-21): 401 ejecuciones, 12,9 al día de media
(251 push correctos, 63 completos entre cron y dispatch, 36 incrementales). Un
build por push que reutiliza la caché mide 54–76 s.

Coste de un prerender en el job, por componentes:

- **Datos.** Lectura en bloque por la API pública: 2,70 s para las siete
  lecturas de jornadas (~1 s por cada ~10.000 filas en paralelo).
- **Pintado.** 1,3 ms por página en CI (jornadas ES).
- **Arrastre por tamaño.** «Versionar» lee y reescribe todos los HTML (7–11 s
  para ~180–200 MB, ~0,05 s/MB), la subida empaqueta todo el sitio (~0,025 s/MB)
  y el empaquetado de JS lee todos los HTML (~0,01 s/MB): ~0,08 s por MB
  añadido. «Comprobar hreflang» solo lee la cabecera (`read_head`), así que no
  depende del tamaño. F2 observó +10 s en esos tres pasos por +22 MB, pero el
  intervalo sin prerender (hreflang 4–6 s, versionado 7–10 s) cubre casi toda
  esa diferencia; se toma 0,08 s/MB como estimación y 0,45 s/MB como cota.

### Contenido estático actual

| Bloque en `<main>` | Páginas |
| --- | --- |
| Recortado por CSS (`clip`) y conservado en el DOM final | Portada ES/EN, calendario, fichajes (`.static-prerender--visible` sin regla en esos HTML: `index.html:55`, `calendario/index.html:15`, `fichajes/index.html:15`) |
| Recortado por CSS (`prerender_visible=False`, `gen_og_pages.py:2949`) | Carrera, inscritos y resultados de ciclocross (726 por idioma) |
| Visible, tapado por la capa de carga y sustituido por el JS | Resultados, competición, inscritos, orden de salida, perfil, mapa, torneo CX |
| Ninguno (solo «Cargando») | Portada de resultados, agenda CX, Campeonatos |

Los bloques recortados de portada, calendario y fichajes permanecen ocultos en
el DOM que indexa Google tras ejecutar el JS (`app.js:279-281` lo mueve fuera
de la lista para conservarlo). Es el patrón que la condición «sin bloque SEO
oculto» excluye para el trabajo nuevo.

## Tabla por tipo

### Inventario y lectura sin JS

Palabras en `<main>` sin JS (muestra ES; EN en paréntesis cuando difiere) y
presencia de los datos clave. «Oculto»: texto recortado por CSS.

| Tipo | Sitemap ES / EN | HTML generados ES / EN | Origen del HTML | Palabras sin JS | Datos clave sin JS |
| --- | ---: | ---: | --- | --- | --- |
| Jornada (referencia, generada) | 1.925 / 1.925 | 1.928 / 1.927 | `gen_og_pages.py` + `prerender-jornadas.mjs` | 320 (EN 31) | Sí: horarios con `<time>`, TV, perfil, puntos clave (solo ES) |
| Competición | 370 / 369 | 1.672 / 1.575 | `gen_og_pages.py` | 116–330 | Lista de etapas con ruta y km; sin fechas por etapa, horas ni TV |
| Inscritos | 614 / 561 | 1.672 / 1.575 | `gen_og_pages.py` | 45–162 | Recuentos («23 equipos y 184 corredores»); sin nombres ni dorsales |
| Orden de salida | 102 / 102 | 102 / 102 | `gen_og_pages.py` | 41–48 | No: sin horas ni corredores |
| Perfil | 932 / 932 | 960 / 960 | `gen_og_pages.py` | 37–45 | Ruta, distancia y número de puertos; sin nombres ni cotas |
| Mapa | 273 / 273 | 275 / 275 | `gen_og_pages.py` | 41–44 | Ruta y distancia |
| Resultados de carrera o etapa | 2.102 / 2.009 | 2.104 / 2.010 | `gen_og_pages.py` | 36–47 | No: sin ganador, tiempos ni clasificación |
| Portada de resultados | 1 / 1 | 1 / 1 | Manual | 2 («Cargando») | No |
| Agenda CX | 1 / 1 | 1 / 1 | Manual (`ciclocross.html`; EN por `build-i18n-html.py`) | 2 | No |
| Carrera CX | 242 / 170 | 242 / 242 | `gen_og_pages.py` | 90–94 oculto | Categorías y fecha; sin horas, TV ni resultados |
| Inscritos CX | 242 / 170 | 242 / 242 | Ídem (mismo cuerpo) | 90 oculto | No |
| Resultados CX | 242 / 170 | 242 / 242 | Ídem (mismo cuerpo) | 84–90 oculto | No |
| Torneo CX | 19 / 11 | 19 / 19 | `gen_og_pages.py` | 81–97 | Pruebas con fecha y enlace; sin general |
| Calendario | 1 / 1 | 1 / 1 | Manual | 138 oculto | No: sin carreras |
| Fichajes | 1 / 1 | 1 / 1 | Manual | 124 oculto | No: sin movimientos |
| Campeonatos Nacionales 2026 | 1 / 1 | 1 / 1 | Manual | 2 | No |
| Portada (Hoy; Ciclocross hasta el 31-12) | 1 / 1 | 1 / 1 | Manual; EN por `build-i18n-html.py` | 283 oculto | No: sin carreras del día |

### Carga en móvil (producción, mediana de 5)

| Página medida | Contenido visible | LCP (elemento) | CLS | Causa principal del CLS | Peticiones (Supabase) | Palabras con JS |
| --- | ---: | --- | ---: | --- | ---: | ---: |
| `/jornada/giro-de-italia-2026-etapa-10/` (generada) | **0,94 s** | 0,94 s (enlace de cabecera) | 0,003 | — | 38 (12) | 333 |
| `/en/stage/giro-ditalia-2026-stage-10/` (sin generar) | 2,03 s | 0,87 s (`p` estático) | 0,113 | Pie de página | 39 (12) | 330 |
| `/competicion/giro-de-italia-2026/` | 2,53 s | 0,90 s (`p` estático) | 0,029 | Tarjetas de etapa | 32 (4) | 487 |
| `/inscritos/giro-de-italia-2026/` | 2,45 s | 0,78 s (`h1` estático) | 0,004 | — | 68 (14) | 674 |
| `/orden-salida/giro-de-italia-2026-etapa-10/` | 2,19 s | 0,86 s (`h1` estático) | 0,090 | Pie de página | 67 (10) | 1.112 |
| `/perfil/giro-de-italia-2026-etapa-10/` | 2,01 s | 0,82 s (`h1` estático) | 0,003 | — | 31 (8) | 216 |
| `/mapa/tour-de-francia-2026-etapa-10/` | 3,21 s | 0,92 s (`h1` estático) | 0,003 | — | 53 (9), 1,9 MB | 326 |
| `/resultados/giro-de-italia-2026/etapa-10/` | 3,31 s | 0,93 s (`p` estático) | 0,328 | Panel del perfil (`aside.res-context`) | 90 (28) | 1.401 |
| `/resultados/il-lombardia-2026/` | 2,91 s | 0,93 s (`h1` estático) | 0,632 | Tabla, panel del perfil y estado de publicación | 81 (24) | 1.397 |
| `/resultados/` | 4,03 s | 1,03 s (`p` de la capa) | 0,122 | Pie de página | 68 (8) | 717 |
| `/ciclocross/` | 2,96 s | 1,86 s (enlace de tarjeta) | 0,153 | Agenda y barra de filtros | 62 (8) | 211 |
| `/ciclocross/hg-cross-dendermonde-2026/` | 3,14 s | 1,00 s (`p` del pie de página) | 0,172 | Pie de página | 62 (22) | 500 |
| `/ciclocross/hg-cross-dendermonde-2026/inscritos/` | 3,14 s | 0,98 s (`p` del pie de página) | 0,172 | Pie de página | 62 (22) | 450 |
| `/ciclocross/hg-cross-dendermonde-2026/resultados/` | 3,21 s | 0,98 s (`p` del pie de página) | 0,172 | Pie de página | 62 (22) | 500 |
| `/ciclocross/torneos/hg-cross-2026-27/` | 2,02 s | 1,81 s (enlace de tarjeta) | 0,151 | Pie de página | 45 (10) | 160 |
| `/calendario/` | 2,58 s | 0,70 s (`p` de la capa) | 0,356 | Pie de página; barra de filtros (+33 px) | 132 (12), 1,0 MB | 3.280 |
| `/fichajes/` | 2,76 s | 0,80 s (`p` de la capa) | 0,185 | Pie de página | 76 (26) | 537 |
| `/campeonatos-nacionales-2026.html` | 3,86 s | 0,94 s (`p` de la capa) | 0,202 | Pie de página | 124 (4) | 2.032 |
| `/` (Ciclocross) | 3,56 s | 2,39 s (enlace) | 0,211 | Pie de página; agenda y filtros | 64 (8) | 211 |

Observaciones:

- En las páginas con capa de carga, el LCP es el primer pintado del bloque
  estático, del rótulo de la capa o, en las carreras CX (bloque oculto), del
  texto del pie de página (0,7–1,0 s). El contenido real llega 1,1–3,1 s
  después. Generar el contenido acerca «contenido visible» al LCP; el LCP de
  campo mejora poco porque ya se mide sobre el bloque estático.
- El desplazamiento del pie de página ocurre bajo la capa de carga: mientras
  carga, `<main>` es más bajo que la pantalla (en las páginas de
  `gen_og_pages.py`, `.prerender-loading` con `min-height:50vh`) y el pie queda
  dentro de ella; al pintar, sale (rectángulo final 0×0).
  Chrome lo cuenta aunque la capa lo tape. Supera 0,08 en orden de salida,
  jornada EN, portada de resultados, calendario, fichajes, Campeonatos,
  portada, carrera, inscritos y resultados CX y torneo CX (0,08–0,23).
- En resultados, el desplazamiento grande (0,59 en Il Lombardia) llega con la
  tabla: `#resTableWrap` pasa de 126 a 467 px de alto y el panel del perfil
  (`aside.res-context`) cambia de posición.

### Datos, pintado y funciones

| Tipo | Datos (navegador) | Pintado separable del DOM | Actualización automática | Funciones a conservar | Huella estable |
| --- | --- | --- | --- | --- | --- |
| Competición | 2 peticiones: carrera con jornadas, emisiones y assets; `race_uci_stages`. Cabe en la lectura de jornadas | No: tarjetas con `createElement` y oyentes (`race-card.js:28-33`, `stage-card.js:80-157`) | `watchCompetitionWaiting` cada 60 s: estado por hora, sin lecturas | Tarjeta enlazable, modales de datos, resultados, TV y Revive, guía, `?challenge=` | No durante la carrera (`todayRaceState`, insignias Live, región) |
| Inscritos | 6–8 peticiones en 4 niveles; ~120 corredores (máx. 184) | Sí: cadena en `inscritos.js:231-335`; extraer `inscritosHtml()` | Ninguna | PDF, tooltip de abandono, aviso de lista provisional | Sí (solo fecha ICU y tachados nuevos entre builds) |
| Orden de salida | 5 peticiones; 47 filas de mediana (máx. 184) | Sí: cadena en `orden-salida.js:197-324` | Ninguna | Filtros Todos/Contrarrelojistas/General, barra fija, perfil interactivo u oficial | ES en Madrid; no en EN (horas convertidas a la zona del visitante) |
| Perfil | 4 peticiones; cabe en la lectura de jornadas | Sí: `stageProfileHtml` (F0) y rejilla duplicada de `jornadaHtml` | Ninguna | Selector de etapa, modo Interactivo/Oficial, punto y tramo, tooltips | ES en Madrid (`formatTimeUser`); hermanas sin `order` |
| Mapa | 4 peticiones + GPX, teselas, DEM; cabe en la lectura de jornadas | Parcial: cabecera, rejilla y puntos clave sí; el mapa (MapLibre) no | Ninguna | Mapa/Satélite, 2D/3D, perfil superpuesto, popups | ES en Madrid |
| Resultados de carrera o etapa | 12–15 peticiones en 4–5 rondas; 140 filas de mediana por página (máx. 584), 97 en la pestaña activa | No: HTML dentro de `init` (1.300 líneas), con `await` y DOM mezclados | Sí, cada 60 s (sección propia) | Pestañas, selector de etapa, filtro por equipo, «m.t.», CRE desplegable, perfil, rutas y `#classKind` | Solo en páginas cerradas y para visitantes en la zona de Madrid |
| Portada de resultados | 15–25 peticiones en ~6 rondas (ventana de 14 días); vista CX hasta el 31-12 | Parcial: `entryRowHtml` pura; `shell` y mampostería con `offsetHeight` | Cada 60 s sin ventana; CX recarga cada 5 min | Pestañas, «Cargar más», ránking | No (depende del día) |
| Agenda CX | Temporada entera (247 pruebas, 958 categorías) + destacadas + cintillo | Parcial: tarjetas como cadena con estado de módulo; barra de fechas y logos por DOM | `refreshTiming` cada 30 s; relectura cada 60 s mientras quede una categoría del día sin resultados | Barra de 7 días, filtros con chincheta, orden, `?date=`, modal TV | No (hoy, hora, región, chincheta) |
| Carrera, inscritos y resultados CX | 11 peticiones; 91 resultados de mediana por carrera (máx. 188); 4 carreras con dorsales; generales de 51–159 filas | Parcial: piezas como cadena; composición suelta (`cx-race.js:183-257`); `cxDocBtn` depende del ancho | Ninguna | Secciones por ruta o `?view=`, categorías por `#`, TV, vídeos, modales | No en fin de semana (hora, región, «Oficial»/«Provisional» por fecha) |
| Torneo CX | 6–11 peticiones (temporada entera dos veces) | Parcial (mismas tarjetas que la agenda) | `refreshTiming` cada 30 s | Calendario/General, categorías, desplazamiento al próximo día | No (hoy, hora, región) |
| Calendario | 5 peticiones (año + 3 meses); el resto por desplazamiento | Parcial: filas como cadena; `render()` con efectos | Ninguna (solo revalidación de la copia local) | Subvista Temporada/Mes, año, país, chincheta, retos, restauración del scroll | No (subvista guardada, chincheta, meses cargados) |
| Fichajes | ~26 peticiones; 774 movimientos de 2027 (536 visibles) | Sí: `feedHtml`/`feedRowHtml`; extraer `marketHomeHtml()` | Ninguna | Pestañas Fichajes/Renovaciones, `?div=`, `?team=` | Sí, salvo `?div`/`?team` y la copia local |
| Campeonatos 2026 | 1 petición (615 pruebas, tope de 1.000 filas) | Sí: `renderGrid`/`eventCell` | Ninguna | Filtros Hoy/Todas/Pro/Masc/Fem, celdas y trofeo | ES en Madrid (evento terminado) |
| Portada | 6–9 peticiones (carretera) o temporada CX | No: tarjetas y barra de fechas por DOM; `app.js:283` vacía la lista al cargar | Cada 60 s (estado y relectura), avance de medianoche, cintillo cada 5 s | Barra de días, filtros, `?date=`, modales, cintillo, conmutador CX/Ruta | No (hora, día, zona, región, chincheta, periodo CX) |

### Tamaño y coste de build (solo ES, como F2)

Tamaño: `<main>` pintado en producción con el marcado actual (Chrome sin
interfaz, sin limitación; incluye lo que monta el JS, como el SVG del perfil o
los controles del mapa) y, entre corchetes, estimado con el marcado aligerado o
sin lo que monta el JS. Coste: lectura de datos + pintado (1,3–4 ms por página)
+ arrastre por tamaño (0,08 s/MB; cota 0,45 s/MB).

| Tipo | Páginas ES | KB por página | Δ sitio ES | Datos | Coste estimado |
| --- | ---: | --- | ---: | --- | --- |
| Perfil | 960 | 22–31 [~15–20 sin SVG] | +8–12 MB | Lectura de jornadas | ~2 s (cota ~6 s) |
| Mapa | 275 | 25–36 [~15–25] | +2–5 MB | Lectura de jornadas | ~1 s (cota ~2 s) |
| Orden de salida | 102 | 37 (CRE) – 135 (CRI de 168 filas) [~50 de media] | +4 MB | `start_order_entries` (6.588 filas) + equipos: ~1–2 s | ~2–3 s |
| Inscritos (con lista) | 605 | 91–94 [~55] | +51 MB [+29 MB] | `startlist_riders` (66.406 filas), equipos, temporadas: ~5–8 s | ~10–13 s [~8–11 s] (cota ~30 s) |
| Inscritos (lista y fin ≥ hoy − 7 d) | 20 | 91–94 | +2 MB | Ídem filtrado: ~1 s | ~1–2 s |
| Competición (por etapas) | 370 | 11 (1 etapa) – 205 (Giro) [~12 sin miniperfil] | +15 MB [+1,5 MB] | Lectura de jornadas | ~2 s, más el refactor de tarjetas |
| Resultados, tabla completa | 2.104 | 39–221, mediana ~130 [~98] | +263 MB [+190 MB] | 344.164 filas + corredores, listas y equipos: ~20–30 s | 45–60 s (cota > 130 s) |
| Resultados, 20 primeras filas | 2.104 | ~40 | +68 MB | ~41.000–100.000 filas: ~5–8 s | ~14–18 s (cota ~40 s) |
| Resultados, 20 primeras, solo cerradas, con caché entre builds | ~2.000 | ~40 | +68 MB | Índice de clasificaciones: ~1–2 s | ~8–10 s |
| CX (carrera, inscritos y resultados), todas las secciones | 726 | 227–349 | +196 MB | ~8.000 filas: ~2 s | ~20 s (cota > 90 s) |
| CX, solo la sección de cada URL | 726 | [~50] | +29 MB | Ídem | ~5 s (cota ~16 s) |
| Torneo CX | 19 | 23–25 | +0,3 MB | Temporada CX: ~1 s | ~1 s |
| Fichajes | 1 | 78 | — | Movimientos, corredores, equipos: ~1–2 s | ~2 s |
| Calendario | 1 | 349 (meses cargados) | — | Lectura de jornadas | ~1 s |
| Campeonatos 2026 | 1 | 484 | — | Lectura de jornadas | ~1 s |
| Portada de resultados / agenda CX / portada | 1 c/u | 46 / 27 / 27 | — | 15–25 peticiones; temporada CX | ~2 s c/u |

La tabla de resultados ocupa 181–189 KB con 168–175 filas (~1,08 KB por fila,
medido). La jornada pintada mide 33,5 KB frente a los ~20 KB del HTML generado:
la diferencia es lo que monta el JS (SVG del perfil). EN duplica el tamaño y
añade el pintado y el arrastre; los datos se leen una vez.

### Ahorro necesario

Margen del build completo: ~10 s con las jornadas ES (110 s), negativo en los
peores casos (123 s sin prerender). Cada fase debe ir precedida de un ahorro
medido en el build completo al menos igual a su coste:

| Fase | Coste ES | Ahorro previo |
| --- | ---: | ---: |
| Inscritos, ámbito de 7 días | ~1–2 s | Dentro del margen si el build completo se mantiene ≤ 110 s |
| Perfil, mapa y orden de salida | ~5–7 s | ~5–7 s |
| Inscritos, 605 carreras (ES y EN) | ~11–16 s | ~11–16 s |
| Resultados cerrados, 20 filas, con caché | ~8–10 s | ~8–10 s |
| Las tres prioridades completas | ~25–35 s | ~25–35 s |

Dónde hay segundos (a medir; corresponde a otras sesiones):

- «Comprobar hreflang» y «Versionar JS/CSS» (9–17 s en el build completo):
  objeto de la sesión `aligerar-hreflang-y-vers`. El versionado reescribe
  todos los HTML en cada build; limitarlo a la cabecera o a los archivos que
  cambian reduce también el arrastre por tamaño de cualquier prerender.
- Lecturas repetidas de la base: `gen_og_pages.py` (27–32 s, cinco familias),
  `gen_sitemap.py` (14–19 s, con `asset-canonicals.json`), `gen_feeds.py`
  (9–13 s) y `prerender-jornadas.mjs` (2,7 s) leen por separado, cada uno con
  su `supabase_get`, carreras y jornadas que se solapan. Un volcado común
  leído una vez y compartido dentro del mismo job es la fuente de ahorro más
  grande disponible; los prerender nuevos lo reutilizarían en lugar de añadir
  lecturas.

Estado: los dos ahorros se aplicaron el 2026-10-21 (build completo estimado en
~70 s); cifras y ahorros pendientes en `docs/plans/contenido-generado-build.md`.

## Resultados: actualización automática y compatibilidad

### Cómo funciona hoy

**Página de carrera o etapa** (`js/resultados.js`, función `init`):

- Carga: carrera; en paralelo `race_uci_stages` (`*`), `race_days`,
  `race_classifications`, `startlist_riders_resolved`, `startlist_teams` con
  equipos y temporadas, y guía técnica; después la jornada de contexto (con
  `elevationProfile`) y sus assets; las filas de `race_uci_results` de la
  clasificación activa (`:1043-1047`); y fichas de corredores y equipos.
  12–15 peticiones en 4–5 rondas.
- Sondeo: `setInterval(refreshCurrent, 60000)` más `visibilitychange`; en
  `pagehide` se retiran temporizador y oyentes (`:1518-1520`). Sin realtime.
- Puertas de cada ciclo (`:1460-1464`): pestaña visible, sin otro refresco en
  curso, contenedor conectado y `needsRefresh()`. Esta exige que la fecha local
  del visitante esté entre la víspera y el día siguiente de la carrera
  (`isNearToday`, `results/refresh-window.js:19-25`) **o** que alguna
  clasificación de la etapa activa siga `provisional` o `updating`. Fuera de
  esa ventana y con todo oficial, el intervalo vuelve sin leer nada.
- Sondeo ligero (`:1467-1473`): `race_uci_stages` (`id, updatedAt, rowCount,
  publicationStatus, updating, updatingUntil, officialAt, lastSyncedAt`) y la
  jornada de contexto (`id, updatedAt, metricsUpdatedAt, distanceKm`),
  comparados por `JSON.stringify` con `lastProbe`, que se inicializa con los
  datos de la carga (`:1459`).
- Si cambian (`:1474-1513`): relee clasificaciones, `race_classifications` y
  jornada; rehace la clasificación activa (incluidas la fusión de la final y las
  etapas canceladas); conserva la pestaña por `classKind`; repinta el carril de
  pestañas y los botones de etapa solo si cambian; vuelve a pedir las filas y
  llama a `renderClassification(fresh, { refresh: true })` sin «Cargando».
  `updateResultsHtml` (`results/dom.js:5-10`) no toca el DOM si el HTML es
  idéntico; si cambia, sustituye la tabla, reconstruye el filtro de equipo
  conservando la selección y reaplica «m.t.» (los desplegables de CRE se
  cierran). Actualiza el aviso «Oficial»/«Provisional» con «Última
  actualización» en hora local y remonta perfil y datos de jornada si cambian.
- Error: «Sin conexión · Datos conservados» con «Reintentar» (`:1515`).
- Página adelantada sin clasificación: `pollPending` cada 60 s, solo si
  `isNearToday` al cargar; `location.reload()` cuando aparece la etapa
  (`:430-439`).

**Portada de resultados** (`js/resultados-feed.js`):

- Carretera: `setInterval(refreshFeed, 60000)` más `visibilitychange`, sin
  ventana de fechas; sale si la pestaña está oculta, la vista no es «Últimos» o
  hay carga en curso (`:809`). Marca de agua: `race_uci_stages.updatedAt` más
  reciente, una fila (`:432-438`); si cambia, relee toda la ventana (14 días más
  lo añadido con «Cargar más») y, si el JSON difiere, repinta todo con
  `innerHTML` y devuelve el foco por `href` (`:778-783`).
- Ciclocross (vista por defecto hasta el 31-12-2026): marca de agua
  `latestCxImport` y recarga completa cada 5 min (`cx/results-feed.js:22-26`).

### Compatibilidad con HTML generado

El esquema de las jornadas es compatible con el sondeo si el JS conserva todo su
recorrido actual y solo el primer pintado pasa a ser condicional:

1. El build escribe `#resultsContent` con la página y la tabla de la pestaña
   por defecto, `data-prerendered="<huella>"` en el contenedor y en la tabla.
2. `init` hace las mismas lecturas que hoy (no ahorra red). Al pintar compara
   su HTML con la huella: si coincide, conserva el DOM y monta encima lo
   interactivo (filtro de equipo, «m.t.», carril de pestañas, perfil); si no,
   repinta como hoy. En ambos casos retira `data-prerendered`.
3. `lastProbe` sale de los datos que lee el navegador, no del HTML: el sondeo,
   la ventana `needsRefresh`, la conservación de pestaña y filtro y la
   comparación de `updateResultsHtml` no cambian.
4. `pollPending` y la recarga de páginas adelantadas no cambian; esas páginas
   no se generan con tabla.

Requisitos para que la huella coincida y no se pierda nada:

- Fuera del bloque con huella, o con zona fija y etiqueta como
  `timeZoneLabel` en las jornadas: hora de salida neutralizada
  (`formatTimeUser`), «Última actualización» (`toLocaleString` sin zona,
  `:1010`) e icono de actualización (`classificationIsUpdating` usa
  `Date.now`).
- «m.t.», el `<select>` del filtro y el estado inicial del perfil escritos en
  el HTML: hoy solo existen en el DOM (`applyTeamFilter`, `:800-827`;
  `slot.innerHTML`, `:1415`). Sin ellos el HTML generado repite `+gap` en todo
  un grupo hasta que corre el JS.
- Corregir lo que el prototipo de captura (`prototipo-jornadas`) rompe: no
  retira `data-prerendered` cuando la huella no coincide y desde entonces
  suprime «Cargando» en todos los cambios de pestaña; y `#gc` (enlaces de
  general final del feed) elige otra pestaña que la generada.
- Sin segmento de etapa la página elige «la última etapa con datos»: el HTML
  generado debe usar la misma regla con los mismos datos.
- `currentTeamId` del año en curso entra en el equipo mostrado: un fichaje
  entre builds cambia la huella (repintado, sin pérdida).

Consecuencia sobre el beneficio: el HTML se genera en cada build (cada push y a
las 05:00 UTC). Una etapa que termina por la tarde no tiene tabla en el HTML
hasta el build siguiente, así que en las horas de más tráfico de esa página el
navegador repinta igual que hoy. El beneficio recae en las páginas cerradas (la
cola larga: 5.589 de 5.615 clasificaciones son oficiales), que son también las
que no sondean. Generar solo las páginas con todas sus clasificaciones
oficiales y fuera de la ventana `isNearToday` en el momento del build evita
cualquier interacción con la actualización automática: esas páginas ya no
sondean hoy.

### Marcado de las filas

Una fila individual ocupa ~1.026 B: bandera `<img>` con 146 B de estilo en
línea (`shared.js:282-286`), dos copias de `teamStripes` de 155 B
(`team-appearance.js:88-94`), el nombre de equipo tres veces (`data-team`,
`.res-rider-team` para móvil y `.res-td--team` para escritorio,
`resultados.js:1379-1388`) y ~64 B de sangrado. Con el estilo de la bandera en
CSS, las franjas en un solo `<span>` con variables y sin sangrado, ~700 B
(−31 %), sin cambio visible. Unificar las copias del equipo exige reordenar el
CSS de móvil y escritorio.

Existe además un fallo previo, sin relación con el build: sin barra de
pestañas (una sola clasificación de equipos, `isTeamEvent`),
`content.querySelector('#resTabs')` es nulo, `:1429` lanza una excepción y la
página muestra «No se han podido cargar» (`:1527-1530`).

## Resto de tipos

- **Inscritos.** Página más determinista: no depende de hora, zona, región ni
  día; el pintado ya es una cadena. Sin actualización automática. La huella
  coincidiría también en EN (sin horas ni emisiones), a diferencia de jornadas.
  El HTML actual solo da recuentos: sin JS no hay ningún nombre ni dorsal. Fila
  de corredor 462 B (bandera 200 B), cabecera de equipo 337 B.
- **Orden de salida.** Cadena ya separada. Horas convertidas a la zona del
  visitante cuando `rd.timezone` difiere: coincide en ES para Madrid, no en EN.
  Fila de CRI 711 B. Solo 5 de 103 jornadas con orden son recientes o futuras.
- **Perfil y mapa.** Reutilizan `stageProfileHtml` (F0) y la rejilla de
  `jornadaHtml` (hoy duplicada con ICU y sin `<time>`). El gráfico del perfil y
  el mapa siguen en JS; el HTML aporta puertos con longitud y pendiente, horas
  de paso y alto reservado. CLS ya bajo (0,003); el contenido visible pasaría de
  ~2,0 s (perfil) y ~3,2 s (mapa, sin el lienzo) a ~1 s (estimación por
  analogía con la jornada generada). La consulta de etapas
  hermanas del perfil no lleva `order` (`perfil-pub.js:76-78`): debe pedirse por
  `id`, como en jornadas, antes de generar.
- **Competición.** Datos ya leídos por el prerender de jornadas, pero las
  tarjetas se construyen con DOM y oyentes, cada tarjeta depende de la hora
  (`todayRaceState`, Live, «Esperando resultados») y de la región, y el
  miniperfil ocupa 10,5 KB por tarjeta (dos trazados): una vuelta de 21 etapas
  ronda 220–240 KB. CLS ya bajo (0,029). El bloque estático actual ya da la
  lista de etapas a los lectores sin JS.
- **Ciclocross.** Carrera, inscritos y resultados comparten módulo, 11
  peticiones y el mismo HTML con todas las secciones; la URL solo alterna
  `hidden`. Generarlas exige una variante por URL con la sección activa visible.
  Sin actualización automática en `cx-race.js`. Dependencias de hora (Revive,
  directo), fecha («Oficial»/«Provisional»), región, zona en los `title` y
  ancho (`cxDocBtn`, como los documentos antes de F0). Hoy llevan bloque oculto:
  si no se generan, la alternativa coherente con la condición de Dani es hacer
  visible ese bloque o retirarlo.
- **Agenda CX y portada.** Dependen de «hoy», la hora, la región y la
  chincheta; se repintan cada 30–60 s en días de carrera; la portada cambia de
  estructura (Hoy o Ciclocross) según la fecha del visitante, y `app.js:283`
  vacía la lista al cargar. Un HTML de las 05:00 UTC muestra las carreras
  europeas en estado previo y, entre las 00:00 de Madrid y el build siguiente,
  el día anterior. Si la huella no coincide, el contenido visible se sustituye:
  peor que la capa actual.
- **Portada de resultados.** Ventana de 14 días relativa al día, vista CX por
  defecto hasta el 31-12 y sondeo continuo: la huella casi nunca coincide.
- **Calendario.** Subvista (Temporada/Mes) por URL o `localStorage`, chincheta
  de categoría, meses cargados según el desplazamiento y temporada activa por
  fecha local. Temporada completa con «Todas»: 0,5–0,8 MB. Los chips estáticos
  marcan «Pro» y el JS arranca en «Todas».
- **Fichajes.** Determinista salvo `?div`/`?team` y la copia local
  (`fichajes:2027`), una sola página, 60–80 KB, sin actualización automática.
  Candidata barata.
- **Campeonatos 2026.** Evento terminado; solo zona y región. 150–500 KB y
  consulta sin paginación cerca del tope de 1.000 filas. Sin tráfico hasta la
  edición 2027, que tendrá otra página.

## Límite de 1 GB

Tamaño actual: 200,5 MB. Cada temporada añade un volumen similar (las páginas de
temporadas archivadas siguen publicadas con `noindex`).

| Escenario (ES y EN salvo indicación) | Tamaño del sitio |
| --- | ---: |
| Hoy | 200,5 MB |
| Prioridades 1–3: inscritos de 605 carreras ES y EN aligerados, resultados con 20 filas ES, perfil, mapa y orden de salida ES | ~345–390 MB |
| Prioridades 1–3 con resultados completos (marcado actual) en ES y EN en lugar de 20 filas | ~790–835 MB |
| Además, CX con todas las secciones en cada URL, ES y EN | > 1 GB |

El sitio crece por temporada aunque no se genere nada: las páginas de
temporadas archivadas siguen publicadas. Con las prioridades 1–3 el
crecimiento por temporada pasa de ~200 MB a ~350 MB. Condiciones:

- Generar contenido solo en temporadas no archivadas; las archivadas
  (`noindex`, `archived_seasons.py`) conservan el bloque ligero.
- Validación en el build del total del sitio y del tamaño por página y tipo,
  como propone el plan de fase 3 para resultados.

## Riesgos

| Riesgo | Tipos | Mitigación |
| --- | --- | --- |
| Superar 120 s en el build completo (+1 min facturado por build; 63 al mes) | Todos | Ahorro previo medido en el build completo; ámbito por fecha; caché de páginas generadas cuando los datos no cambian |
| Divergencia Node/navegador: se pierde el beneficio sin error visible | Todos | Paridad local con Chrome sin interfaz por tipo, como `check-prerender-parity.mjs` |
| Huella rota por hora, zona, región, «hoy», ancho o `localStorage` | Resultados, competición, CX, portadas, calendario | Regla de marcado de F0; generar solo lo que no depende del momento |
| Contenido visible sustituido al cargar (peor que la capa) | Portada, agenda CX, portada de resultados | No generar |
| Pérdida de funciones en resultados (sondeo, filtro, «m.t.», pestañas) | Resultados | Recorrido completo de `init` intacto; primer pintado condicional; paridad y prueba de sondeo en una etapa en curso |
| Tamaño por página por encima de 64 KB (validación actual) | Resultados, inscritos, orden, CX, calendario, Campeonatos | Marcado aligerado; límite por tipo en la validación |
| Datos de hasta ~24 h para lectores sin JS | Todos | Aceptado en F2 (decisión 2); la cola larga no cambia |
| Fechas ICU degradadas en el render de Google | Competición, inscritos, perfil, mapa, CX, globales | Tablas fijas (decisión 3 de F2) antes de generar |
| Cabecera conservada sin huella con `CX_HOME` desfasado el 2027-01-01 | Todas las generadas | Build completo del 2027-01-01 (cron); ya afecta a jornadas |
| Texto oculto existente | Portada, calendario, fichajes, CX | Hacerlo visible o retirarlo, al margen del prerender |

## Propuesta priorizada

### 0. Previo, sin build: reservar alto en `<main>`

Un alto mínimo de `<main>` igual al de la ventana (menos cabecera), mantenido
también tras el pintado para que el pie no suba en páginas cortas, deja el pie
de página fuera de la pantalla durante la carga y elimina 0,08–0,23 de CLS en
once tipos de página sin tocar el build. En resultados, reservar el alto de la
tabla y la posición del panel del perfil desde el primer pintado corrige la
mayor parte de 0,33–0,63. Coste de CI: cero. Verificar con la misma medición
CDP antes y después.

### 1. Inscritos (ES y EN)

- Por qué: dato de alta intención de búsqueda (los títulos ya se orientaron a
  «dorsales y corredores inscritos»), sin JS hoy no hay ningún corredor,
  página determinista (huella estable también en EN), pintado ya en cadena, sin
  actualización automática y con pocas funciones (PDF, tooltip, aviso).
- Cómo: `inscritosHtml()` extraída de `inscritos.js`; bandera por clase;
  fechas con tablas fijas; validación por tipo con límite propio.
- Ámbito por coste: empezar por las carreras con lista y fin en los últimos 7
  días o futuras (20 hoy; ~1–2 s) y ampliar a las 605 cuando haya ahorro
  (~8–11 s en ES con el marcado aligerado; EN añade ~3–5 s).
- Contenido visible estimado: de 2,45 s a ~1 s; CLS ya bajo.

Estado: implantado con el ámbito de 7 días y activado
(`PRERENDER_INSCRITOS=all`) el 2026-10-21; ampliación a todas las carreras
con lista (`listas`) activada el 2026-10-22. Detalle en
`docs/CHANGELOG-tecnico.md` y estado en `docs/plans/contenido-generado-build.md`.

### 2. Resultados de carrera y etapa (ES), por fases

1. CLS sin build (punto 0) y marcado de filas aligerado (−31 %).
2. Renderizador sin DOM `resultadosHtml()` desde `init` (modelo, tabla, CRE,
   aviso de publicación con zona fija), con «m.t.» y `<select>` en el HTML y
   paridad local.
3. Generar solo páginas cerradas: todas las clasificaciones oficiales y fecha
   fuera de `isNearToday` en el momento del build. No sondean, así que la
   actualización automática no se ve afectada; las páginas en curso siguen como
   hoy.
4. Tabla de la pestaña activa con las 20 primeras filas y el resto añadido por
   el JS bajo el pliegue (20 filas superan el alto de la pantalla del móvil):
   ~40 KB por página, +68 MB y ~14–18 s por build. Exige que
   `renderClassification` compare la huella de esas 20 filas y añada las
   demás sin sustituirlas. La tabla completa con el marcado actual añade
   +263 MB y 45–60 s: inviable.
5. Caché de páginas generadas entre builds, invalidada por `updatedAt` de
   `race_uci_stages`, para que el build completo solo pinte lo que cambió
   (~8–10 s por build, casi todo arrastre por tamaño). Es una caché del job
   existente, no un job ni un disparador nuevos.

Beneficio medido en el prototipo: clasificación visible de ~3,0 a ~1,0 s y CLS
de 0,43–0,73 a ≤ 0,03; sin JS, de ~40 palabras sin nombres a la clasificación
con ganador y tiempos.

### 3. Perfil, mapa y orden de salida (ES)

Extensión directa de las jornadas: `stageProfileHtml` y la rejilla ya existen
(F0), los datos de perfil y mapa ya los lee el prerender de jornadas y el orden
de salida ya se pinta como cadena. Coste conjunto ~5–7 s (perfil ~2 s, mapa
~1 s, orden de salida ~2–3 s). Antes: rejilla única con `jornadaHtml`,
`<time>`, decimales fijos y hermanas ordenadas por `id`. Generalizar
`prerender-jornadas.mjs`, que hoy fija el contenedor (`jornadaContent`), la
meta (`cc:race-day-id`) y el límite de 64 KB. Aporte: puertos, horas de paso y
horas de salida legibles sin JS; el CLS de perfil y mapa ya es bajo y el de
orden de salida (0,090) se corrige con el punto 0.

### Después, según tráfico

- **Fichajes**: una página, determinista, ~2 s de build; requiere quitar el
  texto oculto actual.
- **Carrera CX** (temporada de octubre a febrero): datos pequeños, pero
  refactor de la composición, variante por URL y huella inestable en fin de
  semana. Mientras tanto, retirar o hacer visible el bloque oculto.
- **Competición**: tarjetas a cadena y miniperfil fuera del HTML; CLS ya bajo y
  bloque estático con la lista de etapas.
- **Torneo CX**: depende del mismo refactor de tarjetas que la agenda.

### No generar

- Portada (Hoy y Ciclocross), agenda CX y portada de resultados: dependen del
  momento y del visitante, se repintan solas y la huella casi nunca coincidiría;
  el contenido visible se sustituiría al cargar.
- Calendario: tamaño (0,5–0,8 MB), dos subvistas y estado guardado por el
  visitante.
- Campeonatos 2026: evento terminado; revisar con la página de 2027.
- Páginas EN con horas o emisiones (perfil, orden de salida, resultados): por la
  decisión 1 de F2 repintan siempre en EN; solo aportan a lectores sin JS.

## Pendiente

Decisiones, mediciones y seguimiento pendientes:
`docs/plans/contenido-generado-build.md`.
