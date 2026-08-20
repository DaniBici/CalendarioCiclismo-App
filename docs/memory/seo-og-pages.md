# SEO, páginas pre-renderizadas y web estática

## Hosting y limitaciones

**GitHub Pages** (despliega desde `main`, `.nojekyll` activo). Cloudflare solo aporta DNS. `_redirects` no se procesa. Las únicas formas de entregar contenido para una URL: (a) fichero estático en esa ruta, o (b) `404.html` con JS que redirige.

## Arquitectura hidratada

Los `index.html` pre-generados son SPAs standalone (sin redirect). Cargan los mismos scripts que `jornada.html`/`competicion.html`/etc. con rutas absolutas (`/js/...`, `/css/app.css`), y la SPA se activa sobre el contenido pre-renderizado.

**Fallback en `404.html`:** script al inicio del `<head>` detecta rutas limpias en `location.pathname` y redirige al SPA correspondiente antes de pintar nada. Cuando el `index.html` existe, GitHub Pages lo sirve directamente y el 404 no se toca. Rutas cubiertas:

| Patrón | Redirige a |
|---|---|
| `/perfil/{slug}/` | `/perfil.html?id={slug}` |
| `/orden-salida/{slug}/` | `/orden-salida.html?slug={slug}` |
| `/en/start-order/{slug}/` | `/en/start-order/?slug={slug}` |
| `/en/stage/{slug}/` | `/en/stage/?slug={slug}` |
| `/en/race/{slug}/` | `/en/race/?slug={slug}` |
| `/en/startlist/{slug}/` | `/en/startlist/?slug={slug}` |

Esto es clave para contenido recién creado: la página estática la genera `build-site.yml`, así que puede existir una ventana breve tras la primera publicación en la que el `index.html` aún no existe. El fallback hace que la URL limpia funcione al instante (el SPA carga en vivo desde Supabase) en lugar de quedarse en el 404.

**Regeneración solo en la creación inicial:** el panel comprueba la URL canónica al publicar y solo marca `admin_mark_web_pages_dirty()` si recibe un 404. La migración `20260814162106_stop_regenerating_published_race_days.sql` retira los triggers históricos de `start_order_entries` y `startOrderImportedAt`. Una jornada cuya página ya existe no se regenera por cambios de orden de salida, resultados, TV, assets o contenido editorial: la SPA los lee en vivo desde Supabase.

**Defensa en og-pages.yml:** `git add competicion/ jornada/ inscritos/ perfil/` aborta con `bash -eo pipefail` si alguna ruta no existe. Por eso `os.makedirs("perfil", exist_ok=True)` se ejecuta antes del bucle.

## Generador: `og-pages.yml`

Trigger: push a `main`, cron diario 05:00 UTC, `workflow_dispatch`. Python inline.

### Lo que incluye `og_page()` por página

- `<title>`, `<meta description>`, canonical, OG + Twitter cards completas.
- `og:image:alt` / `twitter:image:alt` / `og:locale=es_ES`.
- `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">`.
- `hreflang="es"` + `hreflang="x-default"` auto-referenciales.
- `<link rel="alternate" type="application/atom+xml" href="/atom.xml">`.
- JSON-LD: `SportsEvent` (`startDate`, `endDate`, `location`, `superEvent` para etapas de vuelta, `eventStatus`, `eventAttendanceMode`, `organizer`).
- JSON-LD: `BreadcrumbList` (Inicio › Temporada N › [Competición] › Jornada).
- IDs estables (`jsonld-main`, `jsonld-breadcrumbs`) para que la SPA sobrescriba sin duplicar.
- Body HTML real con `<h1>`, fecha, descripción, distancia, recorrido y breadcrumbs navegables.
- **Contenido SEO oculto visualmente** (`.static-prerender` con `position:absolute; clip:rect(0 0 0 0)`). `.prerender-loading` muestra puntos hasta que la SPA hidrata.
- Theme sincrónico vía `/js/theme.js`.
- Scripts SPA al final del `<body>`.

### Detección de slug desde URL path

`jornada.js`, `competicion.js`, `inscritos.js`, `perfil-pub.js` leen `slug` desde `location.pathname` cuando no hay `?id=`/`?slug=`.

### Rest days y cancelados

Rest days: no se emite `SportsEvent` (sí Breadcrumb). Cancelados: `eventStatus=EventCancelled`.

### Cintillo "Hoy" — SEO evergreen para TODAS las vistas de día (NO regresar)

**Decisión definitiva (2026-06-03):** las vistas del cintillo "Hoy" (la home `/` y cualquier `/?date=YYYY-MM-DD`) **no compiten en Google con contenido propio por fecha**. `updateSeoDay` (en `js/app.js`) fija `title`/`description`/`og:title`/`og:description` a los valores **evergreen** del HTML estático y canonicaliza **siempre** a la home del idioma. El SEO por fecha se eliminó por completo (antes solo se suprimía en la home canónica; ahora en todos los días).

**Por qué se abandonó el SEO por fecha en estas páginas:**
1. **El valor real está en las páginas de jornada** (`jornada.html`), que conservan su SEO con fecha propio (ver sección siguiente). Las vistas de día del cintillo no aportaban resultados útiles y generaban N URLs casi-duplicadas (`/?date=…`) compitiendo entre sí y con la home.
2. **Googlebot degrada ICU a inglés:** su Chrome headless arrastra ICU sin datos de locale completos, así que `toLocaleDateString('es-ES', …)` caía a inglés ("Monday, 1 June 2026") en el snippet.
3. **El auto-avance contaminaba el snippet:** Googlebot no envía `Referer`, así que `_autoAdvanceReferrerOK` es `true` y el auto-avance (≥2h) se dispara en el render del crawler, moviendo `dateKey` a un día ajeno al de la URL.

**Comportamiento de `updateSeoDay` (todo evergreen, sin gate):**
```js
const isEn = getLang() === 'en';
// title/description = espejo exacto del index.html del idioma (literal hardcodeado)
// canonical y og:url SIEMPRE → home del idioma:
const canonicalUrl = isEn ? origin + '/en/' : origin + '/';
```
- **Bilingüe obligatorio:** `js/app.js` lo comparten la home ES (`/index.html`, `lang="es"`) y la EN (`/en/index.html`, `lang="en"`). `title`/`description` se eligen por `getLang()` y el canonical EN es `/en/`, no `/`. Si se toca esta función, mantener ambas ramas sincronizadas con sus respectivos `index.html`.
- **El titular VISIBLE encima de las race cards NO se toca** (sigue mostrando "Hoy"/"Mañana"/fecha): es UX, no `document.title`. La línea que lo cambia (`title.innerHTML = …` con `formatDateLabel`) es un elemento del DOM distinto de `document.title`.
- El `sitemap.xml` nunca incluyó URLs `/?date=…` (solo `/`, `/en/` y páginas reales), así que no hay señal contradictoria con el canonical.

**Verificación (navegador headless, ejecutando JS como Googlebot):** `/?date=<futuro>` → title evergreen ES + canonical `/`; `/en/?date=<futuro>` → title evergreen EN + canonical `/en/`.

**Historial:** el enfoque anterior era un gate `isCanonicalHome = _urlDate == null || _urlDate === today` que dejaba evergreen solo `/` y `/?date=<hoy>`, pero seguía emitiendo title/description con fecha (y canonical `/?date=…`) para el resto de días (`479483d21f9`, `8727fff7be2`, `adc30628f13`). El cambio de 2026-06-03 lo extiende a **todos** los días: ya no hay gate, todo es evergreen.

### Fechas en SEO de páginas de detalle — sin ICU

Las páginas de detalle (`jornada`, `competición`, `inscritos`) **sí** llevan fecha dinámica por día en `title`/`description`/`og:*`. Como esa cadena la indexa Googlebot y su renderer degrada `toLocaleDateString('es-ES', …)` a inglés, **NO se usa `toLocaleDateString` para esas fechas**: se construyen con formateadores de tablas fijas en `shared.js`:

| Helper (`shared.js`) | Salida ES | Salida EN | Equivale a |
|---|---|---|---|
| `seoLongDateWeekday(dateKey, lang?)` | `lunes, 1 de junio de 2026` | `Monday, 1 June 2026` | `{weekday:'long',day,month:'long',year}` |
| `seoLongDate(dateKey, lang?)` | `1 de junio de 2026` | `1 June 2026` | `{day,month:'long',year}` |
| `seoDayMonth(dateKey, lang?)` | `1 de junio` | `1 June` | `{day,month:'long'}` |

- `lang` por defecto sale de `getLang()` (`'en'`→inglés, resto español). Pasar `'es'` explícito donde la descripción es Spanish-only (competición, inscritos).
- Salida **byte-idéntica** al ICU del sistema (verificado), así que en navegadores normales no cambia nada; solo arregla el render de Googlebot.
- Consumidores: `jornada.js` (`fechaLarga` → `seoLongDateWeekday`), `competicion.js` (`fechaFin` → `seoLongDate`, `formatDayMonth` → `seoDayMonth`), `inscritos.js` (`buildFechaParentesis` → `seoLongDate`/`seoDayMonth`).
- **Solo** para fechas que van al `<head>`. Las fechas visibles en el body (hero `infoParts`, date-bar, chips de tarjeta) siguen con `toLocaleDateString`/`getLocale()` — deben seguir el locale del usuario y no afectan al snippet.
- El generador Python `og-pages.yml` ya formatea con arrays fijos (`MESES`/`meses`/`dias`), así que el HTML estático y el hidratado coinciden en idioma.

### Reglas al modificar

- Cambiar título/descripción o añadir schema → reflejar también en el `updateSeo*` de la SPA correspondiente (y viceversa).
- Añadir directorio nuevo (p.ej. `/etapa/`) → incluirlo en `git add` del workflow + `os.makedirs` preventivo.
- Estilos propios de una SPA (p.ej. `.pfe-*` para perfil) → deben vivir en `app.css`, no en el HTML entry. `og_page()` admite `main_class=`.

## Resultados adelantados — página desde que existe la jornada, no cuando hay datos (2026-07-06)

**Decisión de producto (Dani):** igual que las jornadas se publican con tiempo prudencial antes de la carrera, **toda jornada publicada (no descanso) recibe ya su página `/resultados/`**, tenga o no clasificación real volcada (`race_uci_stages.keepForWeb`). Antes, la página de resultados solo existía una vez había datos reales — cero anticipación, indexación tardía justo cuando más tráfico de búsqueda hay (minutos tras meta).

- **`og-pages.yml`** (bloque "RESULTADOS"): `res_by_race` pasa a ser la UNIÓN de `res_real_by_race` (clasificaciones reales, `keepForWeb=true`, como antes) y `res_days_by_race` (toda jornada de `racedays_all` con `isRestDay=false`; para `raceFormat='one_day'` se indexa con `stageNumber=None`, igual que hace una clasificación real de un día). El flag `has_real = stage_num in res_real_by_race.get(race_id, set())` decide, por página, si se escribe la descripción SEO "oficial" de siempre o una variante "aún no disponible / vuelve tras la etapa" — **misma URL, mismo `<title>`, mismo canonical, mismo `robots: index, follow`** en ambos casos; solo cambia `<meta description>`/cuerpo. Cuando el cron UCI vuelca la clasificación real, el siguiente run de `og-pages.yml` reescribe esa MISMA página con el contenido rico — no hay migración de URL ni duplicado.
- **`sitemap.yml`**: mismo patrón (`_res_real_by_race` ∪ `_res_days_by_race`) — la URL entra en el sitemap desde que la jornada se publica, no cuando hay resultados.
- **`js/resultados.js`**: dos estados vacíos distintos, ambos con el mismo tono ("Aún no hay resultados disponibles..."): (a) la carrera entera sin ninguna clasificación real (`stagesAll.length===0`, ya existía) y (b) **nuevo** — se pide una etapa CONCRETA (segmento de path o `?stage=`) que esta carrera no tiene volcada todavía, aunque OTRAS etapas de la misma carrera sí. Antes este caso caía en silencio a la última etapa CON datos (contenido engañoso: la URL de la etapa 10 mostraba la etapa 9); ahora avisa específicamente de que esa etapa está pendiente y NO reescribe la URL. El fallback "sin etapa pedida → la última con datos" se conserva intacto (navegación interna sin segmento explícito).
- **Gating de navegación interna SIN CAMBIOS**: el trofeo/CTA "Ver resultados" (`race-data-modal.js`, `jornada.js`, `campeonatos.js`, `resultados-feed.js`) sigue leyendo `keepForWeb` tal cual — solo se activa con clasificación real (rank 1 existente). Mientras no haya datos, la navegación interna sigue cayendo al modal FC/PCS de siempre; la página de resultados adelantada solo es alcanzable por buscador/enlace directo.
- **Alcance**: se aplica a TODA jornada publicada con un `raceId` válido, exista o no fuente UCI configurada (`race_uci_links`) para esa carrera. Una carrera que nunca llegue a tener resultados in-house queda con una página "aún no disponible" permanente — barato y sin `noindex`, pero si la escala crece mucho conviene revisar si acotar a carreras con fuente configurada.
- **404.html**: ya cubría `/resultados/` y `/en/results/` (fallback a SPA con querystring) desde antes — sin cambios.

## Sitemap + Atom

`sitemap.yml` genera `sitemap.xml` (URLs limpias `/jornada/{slug}/`, `/competicion/{slug}/`, `/inscritos/{slug}/` solo con startlist) y `atom.xml` (ventana `[hoy-7d, hoy+30d]`, máx. 50 entradas). `scripts/generate-sitemap.sh` es el equivalente local.

## El sitio inglés vive en `/en/` — `cyclocal.app` es solo un puente de redirección

**Estado actual (revertido):** el sitio EN se sirve en `calendariociclismo.app/en/` (GitHub Pages). No hay dominio inglés dedicado. La marca de la edición EN es **"Calendario Ciclismo"** (igual que las apps, que no traducen `app_name` en `values-en/`), no "CycloCal".

Cómo lo controla el código:
- **`CONFIG.enDomain` / `EN_DOMAIN` vacíos** (`js/config.js`, generados por `inject-web-config.yml` desde `js/config.template.js`). Con el valor vacío: `isEnHost()` siempre `false`, `enBase()` (`js/shared.js`) devuelve `'/en'`, y el auto-redirect de `lang-switch.js` lleva a `/en/`. Para reintroducir un dominio EN dedicado bastaría con volver a poner el dominio en esos tres sitios.
- **Generador de páginas EN estáticas:** `tools/build-i18n-html.py` (canonical/hreflang/og:url con `base_en = ".../en"`, sin script de redirect, marca sin tocar).
- **Generador de páginas EN de detalle:** `og-pages.yml` (`EN_BASE_URL` default `.../en`, URLs `/en/race/…`, marca "Calendario Ciclismo"). ⚠️ Si existe la **repo variable `EN_BASE_URL`** (Settings → Variables) apuntando a un dominio, anula el default — verificar que esté vacía o en `.../en`.

### `cyclocal.app` — Worker de redirección (`workers/cyclocal/src/index.js`)

`cyclocal.app` **ya no sirve contenido**. Worker = puente puro: redirect **301** de cada ruta a su equivalente bajo `/en/` (`/race/<slug>/` → `/en/race/<slug>/`, `/season/` → `/en/season/`, assets raíz `/js/` etc. a la misma ruta del origen). Preserva enlaces externos ya compartidos.

- Deploy: `.github/workflows/deploy-cyclocal-worker.yml` (route `cyclocal.app/*` en el dashboard). El workflow `purge-cyclocal-cache.yml` se eliminó (ya no hay assets que purgar en cyclocal).
- Se retiró la caché de assets resiliente del Worker: al ser solo redirect, ya no proxea respuestas que cachear.

## Modal Apps en la navegación web

- **JS:** `js/apps-modal.js` — IIFE standalone. `<script>` al final del `<body>` en las 10 páginas raíz.
- **CSS:** `.nav-apps-btn`, `.apps-modal__*` en `css/app.css`.
- **HTML:** `<button class="nav-apps-btn" id="navAppsBtn">Apps</button>` antes de "Sobre nosotros" en los 10 HTMLs.
- **Contenido:** iOS → `https://apps.apple.com/app/id6761902611`. Android → card desactivada "Próximamente".
- **Mobile:** al añadir `<button>` en `.site-nav`, añadir estilos desktop + `@media (max-width: 600px)` imitando `.site-nav .theme-toggle`.

## Footer "Principales carreras" — ELIMINADO (2026-06-04)

El bloque "Principales carreras" / "Top races" (9 enlaces a carreras debajo del copyright) **se retiró por completo**: no aportaba SEO, que era su único objetivo. El `<footer class="site-footer">` ahora es solo el copyright + Privacidad.

Lo que se eliminó:
- `js/footer-races.js`, `/footer-races.html`, `/en/footer-races.html` (borrados).
- `og-pages.yml`: funciones `get_ga_top_races`, `calc_race_views`, `pick_grand_tours`, `pick_next_wt`, `pick_top_visited`, `_select_footer_picks`, `build_top_races_nav`/`_en`, `race_url`/`_en`, `parse_iso_date`, constantes `GRAND_TOUR_SLUG_PREFIXES`/`WT_*_CATEGORIES`, el placeholder `{TOP_RACES_NAV}` de `SITE_FOOTER_HTML`/`_EN`, la dependencia pip `google-analytics-data google-auth` y el secret `GOOGLE_ANALYTICS_SERVICE_ACCOUNT_BASE64` (este workflow ya no consume GA4).
- El `<script src="…/js/footer-races.js">` de todas las páginas raíz ES/EN.
- El `<nav class="footer-races">` embebido se eliminó de todas las páginas pre-renderizadas (y `og_page()` ya no lo emite).
- Las reglas CSS `.footer-races*` en `css/app.css`.

Si en el futuro se quisiera reintroducir un bloque de enlaces en el footer, este historial git tiene la implementación completa.
