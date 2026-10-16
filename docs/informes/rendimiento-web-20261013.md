# Rendimiento de la web: línea base y primeras mejoras — 2026-10-13

## Método

Lighthouse 12, móvil, rendimiento, throttling simulado (4G lenta, CPU ×4),
Chrome 155 headless. Mediana de 3 pasadas por página en producción (línea
base) y de 5 pasadas en la comparación local. La comparación local sirve dos
compuestos de `_site` (fuentes de `main` y de la rama) con un servidor estático
con gzip y `Cache-Control: max-age=600`, igual que GitHub Pages; las consultas a
Supabase son reales en ambos. La variación entre pasadas de una misma
configuración llega a 15 puntos de rendimiento: solo se interpretan diferencias
mayores.

Limitaciones: sin datos de campo (CrUX), `jornada.html?slug=` sin el HTML
prerrenderizado de producción, sin páginas generadas (OG) en el compuesto local.

## Línea base en producción

| Página | Rendimiento | FCP | LCP | CLS | Peticiones | Peso |
|---|---:|---:|---:|---:|---:|---:|
| Hoy (`/`) | 63 | 3,4 s | 5,1 s | 0,13 | 92 | 428 KB |
| Jornada | 78 | 2,5 s | 3,0 s | 0,14 | 62 | 327 KB |
| Resultados | 49 | 3,8 s | 6,2 s | 0,31 | 137 | 1058 KB |

Causas medidas en Hoy:

- 58 módulos ES en cascada de 7-8 niveles; la primera consulta a Supabase
  salía a los 1.265 ms (red de escritorio).
- `supabase-js` completo desde jsDelivr: 11 peticiones, 77 KB gzip, con `auth`,
  `realtime` y `storage` sin uso en páginas públicas.
- Cadena de CSS bloqueante `app.css` → `tokens.css` → `fonts.googleapis.com` →
  `fonts.gstatic.com` (Lighthouse: 1,6-1,9 s de recursos que bloquean el render).
- GitHub Pages: `max-age=600` fijo y solo gzip.

## Cambios

1. **Cliente PostgREST ligero.** `js/supabase-client.js` crea un
   `PostgrestClient` (postgrest-js 2.117.2 autoalojado en `js/vendor/`) para las
   páginas públicas. `panel/index.html` y `panel/app.html` llevan
   `<meta name="cc-supabase-client" content="full">` y reciben `supabase-js`
   completo bajo demanda. Las lecturas públicas pasan a usar siempre la clave
   anónima, sin la sesión de administrador que `supabase-js` adjuntaba si había
   una en `localStorage`.
2. **Tipografías autoalojadas.** `css/fonts.css` y `fonts/web/` (Google Sans y
   Roboto, 16 ficheros WOFF2, 316 KB). Quedan fuera las escrituras que no
   aparecen en la web.
3. **Empaquetado.** `tools/site/bundle_assets.mjs` (esbuild) agrupa el JS de
   cada página en una entrada con su URL original más chunks compartidos
   (profundidad 1), minifica los scripts clásicos y aplana y minifica el CSS.

## Resultado (local, mediana de 5)

| Página | Rendimiento | FCP | LCP | CLS | Peticiones | Peso |
|---|---:|---:|---:|---:|---:|---:|
| Hoy | 64 → 74 | 4,1 → 1,7 s | 5,3 → 3,9 s | 0,12 → 0,25 | 92 → 61 | 426 → 248 KB |
| Jornada | 68 → 80 | 3,8 → 2,0 s | 4,5 → 2,9 s | 0,14 → 0,27 | 62 → 38 | 322 → 171 KB |
| Resultados | 62 → 80 | 3,0 → 2,0 s | 3,8 → 2,3 s | 0,30 → 0,32 | 135 → 102 | 1036 → 861 KB |

## CLS

Tras el empaquetado el CLS de las páginas medidas no mejoraba y en Hoy y
Jornada subía (Hoy 0,12 → 0,25): al pintar antes, Lighthouse registra los
desplazamientos que antes ocurrían antes del primer pintado. La traza de
Lighthouse (`LayoutShift` con rectángulos) de Hoy en móvil (412 px) desglosa
0,25 así:

| Desplazamiento | Causa | Score |
|---|---|---:|
| Contenido +57 px | `header.js` rellena `<header id="siteHeader">`, vacío en el HTML | 0,055 |
| Contenido +50 px | `#dateBar` se genera por JS | 0,058 |
| Contenido +123 px en 8 pasos | Aviso de cookies insertado en el flujo con `transition: max-height` | ≈0,11 |
| Contenido +48 px | Cintillo (`#giroCountdown`), consulta a `today_highlights` | 0,031 |

Cambios en `css/app.css`:

- `.cookie-banner` pasa a `position: fixed` y entra con `transform`: no empuja
  la página. Durante los 10 s previos al autoaceptar cubre el borde superior.
- `.site-header` y `#dateBar` reservan `min-height: 57px`.

No se reserva el cintillo: su presencia depende de datos (puede no haber
entradas o haberse descartado) y reservarlo dejaría un hueco de 48 px los días
sin cintillo. Un `min-height` de 100 svh en `main > .loading` no tuvo efecto
(0,25 / 0,26 / 0,48) y se descartó.

Medición posterior (local, mediana de 3, móvil):

| Página | Rendimiento | CLS antes | CLS después |
|---|---:|---:|---:|
| Hoy | 74 → 86 | 0,25 | 0,06 |
| Jornada | 80 → 88 | 0,27 | 0,17 |

En Hoy el CLS restante es la agenda (0,04), el pie (0,02) y el cintillo. En
Jornada queda un único desplazamiento de 0,169 del pie de página en el
compuesto local, que sirve `jornada.html` sin el HTML prerrenderizado de
producción; no se ha confirmado que ocurra en las páginas generadas.

## Carga de Hoy: ciclocross bajo demanda y una sola oleada de lecturas

- `js/cintillo.js` deja de importar `cx-data` y `cx/highlight`: el código de
  Ciclocross vive en `js/cintillo-cx.js`, que se carga con `import()` solo si
  la sección `cx` está activa o alguna entrada editorial apunta a una prueba o
  un torneo. Cierre estático de `app.js` (minificado): 160,7 → 141,2 KB sin
  comprimir y 53,9 → 47,4 KB gzip (−6,6 KB). La estimación inicial de ≈50 KB
  gzip incluía el código propio de la página de Ciclocross, que Hoy no carga
  cuando la home es de carretera.
- `loadDay` pedía las jornadas del día y, tras su respuesta, carreras,
  emisiones, assets y resultados propios en una segunda oleada. Ahora una sola
  lectura de `race_days` embebe `race:races(*)`, `race_uci_stages`,
  `broadcasts(*)` y `assets` (claves foráneas existentes, sin migración ni
  funciones nuevas), con el filtro de `race_uci_stages` acotado a las filas
  embebidas. `featured_races_for_dates` sale en la misma oleada que las
  carreras del año. El payload y el resultado son los mismos: la agenda del
  17, 11 y 13 de octubre de 2026 produce el mismo texto y la misma estructura
  de tarjetas en local y en producción.
- La agenda deja de esperar a las carreras del año (`ensureYearRacesCached`):
  solo las necesitan el salto a otro día cuando el día queda vacío y los
  botones de navegación, que las leen al pulsar.

Lecturas de red del día (17-10-2026, 10 repeticiones sin las 2 primeras,
cliente en Python, mismas consultas que el navegador):

| | Mediana | Mín. | Máx. |
|---|---:|---:|---:|
| Dos oleadas (antes) | 400 ms | 319 ms | 1.420 ms |
| Una oleada embebida (después) | 189 ms | 154 ms | 353 ms |

Pendientes: caché local con revalidación de la agenda de Hoy (visitas
repetidas) y precarga de la entrada y los chunks.
