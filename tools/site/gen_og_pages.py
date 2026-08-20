import json, os, html, sys, traceback, re, unicodedata
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import quote
from datetime import datetime, timezone

SUPABASE_URL = "https://bcecwlkynpgovnzhbpah.supabase.co"
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
BASE_URL = "https://calendariociclismo.app"
BASE_URL_EN = os.environ.get("EN_BASE_URL", "https://calendariociclismo.app/en")
DEFAULT_OG_IMAGE = "https://assets.calendariociclismo.app/og-default.png"
OG_WORKER_URL = "https://og.calendariociclismo.app"

if not ANON_KEY:
    print("FATAL: SUPABASE_ANON_KEY no está definido", file=sys.stderr)
    sys.exit(1)

def og_image_url(logo_url, title=""):
    """Genera la URL del worker OG que compone logo + fondo."""
    if not logo_url or not logo_url.startswith("http"):
        return DEFAULT_OG_IMAGE
    url = f"{OG_WORKER_URL}/?logo={quote(logo_url, safe='')}"
    if title:
        url += f"&title={quote(title, safe='')}"
    return url

def supabase_get(path):
    # PostgREST limita cada respuesta a 1000 filas. Paginamos con el header
    # Range hasta agotar resultados (una página corta = fin). Sin esto, las
    # consultas grandes (p. ej. race_days, que ya supera las 1000 filas
    # publicadas) se truncaban silenciosamente y las jornadas con dateKey
    # más tardío (posición >1000 en el orden) no generaban su página.
    PAGE = 1000
    all_rows = []
    offset = 0
    while True:
        req = Request(f"{SUPABASE_URL}/rest/v1/{path}")
        req.add_header("apikey", ANON_KEY)
        req.add_header("Authorization", f"Bearer {ANON_KEY}")
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{offset}-{offset + PAGE - 1}")
        try:
            with urlopen(req) as res:
                chunk = json.loads(res.read())
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:1000]
            print(f"ERROR Supabase {e.code} en {path}\n  body: {body}", file=sys.stderr)
            raise
        except Exception as e:
            print(f"ERROR Supabase en {path}: {e}", file=sys.stderr)
            raise
        # Las respuestas escalares (count(), agregados) no son listas: devolver tal cual.
        if not isinstance(chunk, list):
            return chunk
        all_rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return all_rows

def supabase_rpc(fn, payload=None):
    # POST a /rest/v1/rpc/<fn>. Se pagina con Range igual que supabase_get: hoy
    # startlist_counts() devuelve ~410 filas, pero si el catálogo crece más allá
    # de 1000 PostgREST truncaría la respuesta EN SILENCIO (el mismo fallo que
    # documenta supabase_get para race_days).
    PAGE = 1000
    all_rows = []
    offset = 0
    body = json.dumps(payload or {}).encode("utf-8")
    while True:
        req = Request(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", data=body, method="POST")
        req.add_header("apikey", ANON_KEY)
        req.add_header("Authorization", f"Bearer {ANON_KEY}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{offset}-{offset + PAGE - 1}")
        try:
            with urlopen(req) as res:
                chunk = json.loads(res.read())
        except HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:1000]
            print(f"ERROR Supabase {e.code} en rpc/{fn}\n  body: {detail}", file=sys.stderr)
            raise
        except Exception as e:
            print(f"ERROR Supabase en rpc/{fn}: {e}", file=sys.stderr)
            raise
        if not isinstance(chunk, list):
            return chunk
        all_rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return all_rows

def esc(s):
    if s is None: return ""
    return html.escape(str(s), quote=True)

def norm_txt(s):
    s = unicodedata.normalize("NFKD", (s or "")).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s

def canonical_group_key(rd):
    """Agrupa posibles slugs duplicados de una misma jornada para elegir canónico."""
    rid = str(rd.get("raceId") or "")
    sn = str(rd.get("stageNumber") if rd.get("stageNumber") is not None else "")
    dk = str(rd.get("dateKey") or "")
    st = norm_txt(rd.get("startLocation") or "")
    fn = norm_txt(rd.get("finishLocation") or "")
    return "|".join([rid, sn, dk, st, fn])

# ── JSON-LD helpers ─────────────────────────────────────────
def json_ld_script(obj):
    """Serializa un objeto JSON-LD listo para <script>."""
    # separators sin espacios redundantes; ensure_ascii=False para conservar tildes
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))

def breadcrumb_list(items):
    """items: list de (name, url). url=None omite el campo."""
    element = []
    for i, (name, url) in enumerate(items, start=1):
        li = {"@type": "ListItem", "position": i, "name": name}
        if url:
            li["item"] = url
        element.append(li)
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": element,
    }

def sports_event(name, start_date, end_date, url, description,
                 image=None, location_name=None, location_country=None,
                 cancelled=False,
                 date_published=None, date_modified=None,
                 organizer_url=None, same_as=None):
    # Google solo considera elegible un Event con nombre, fecha y ubicación
    # física. No publicamos un SportsEvent parcial: el resto del JSON-LD y del
    # SEO de la página se conserva.
    if not (name and start_date and end_date and location_name and location_country):
        return None
    ev = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        "name": name,
        "url": url,
        "description": description,
        "sport": "Ciclismo en ruta",
        "eventStatus": ("https://schema.org/EventCancelled" if cancelled
                        else "https://schema.org/EventScheduled"),
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "organizer": {
            "@type": "Organization",
            "name": "Calendario Ciclismo",
            "url": organizer_url or BASE_URL,
        },
    }
    if start_date:      ev["startDate"]     = start_date
    if end_date:        ev["endDate"]       = end_date
    if date_published:  ev["datePublished"] = date_published
    if date_modified:   ev["dateModified"]  = date_modified
    if image:           ev["image"]         = image
    ev["location"] = {
        "@type": "Place",
        "name": location_name,
        "address": {
            "@type": "PostalAddress",
            "addressCountry": location_country,
        },
    }
    ev["mainEntityOfPage"] = {
        "@type": "WebPage",
        "@id": url,
    }
    if same_as:
        ev["sameAs"] = same_as
    return ev

def item_list(name, items):
    """items: list de (position, name, url)."""
    return {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": name,
        "numberOfItems": len(items),
        "itemListElement": [
            {"@type": "ListItem", "position": pos, "name": n, "url": u}
            for pos, n, u in items
        ],
    }

# ── Shell compartido (header + footer) ─────────────────────
# Paridad con jornada.html / competicion.html / inscritos.html.
# Uso de rutas absolutas (/js/..., /css/...) porque estas páginas viven
# bajo /jornada/<slug>/ etc.
SITE_HEADER_HTML = (
    # Header común montado en runtime por js/header.js (fuente única).
    # data-back → estas subpáginas muestran el botón "← Volver".
    '<header class="site-header" id="siteHeader" data-back></header>'
    '<script type="module" src="/js/header.js"></script>'
)

SITE_FOOTER_HTML = (
    '<footer class="site-footer">'
    '<p>&copy; 2026 Calendario Ciclismo &mdash; Ideado y editado por '
    '<a href="https://danisanchez.info" target="_blank" rel="noopener">Dani&nbsp;S&aacute;nchez</a> '
    '&mdash; <a href="/privacidad.html">Privacidad</a></p>'
    '</footer>'
)

SITE_FOOTER_HTML_EN = (
    '<footer class="site-footer">'
    '<p>&copy; 2026 Calendario Ciclismo &mdash; Created and edited by '
    '<a href="https://danisanchez.info" target="_blank" rel="noopener">Dani&nbsp;S&aacute;nchez</a> '
    '&mdash; <a href="/en/privacy/">Privacy</a></p>'
    '</footer>'
)

# Contenido SEO presente en el DOM pero oculto visualmente (sr-only).
# Los crawlers lo leen del HTML; el usuario ve el .prerender-loading.
# Al hidratar, la SPA hace content.innerHTML = html y borra ambos.
PRERENDER_STYLE = (
    '<style>'
    '.static-prerender{position:absolute!important;width:1px;height:1px;'
    'padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);'
    'clip-path:inset(50%);white-space:nowrap;border:0}'
    '.static-prerender--visible{position:static!important;width:auto;height:auto;'
    'padding:0;margin:0;overflow:visible;clip:auto;clip-path:none;'
    'white-space:normal;border:0}'
    '.prerender-loading{display:flex;flex-direction:column;align-items:center;'
    'justify-content:center;gap:.9rem;padding:4rem 1.5rem;min-height:50vh}'
    '.prerender-loading__dots{display:flex;gap:.4rem}'
    '.prerender-loading__dots span{width:8px;height:8px;border-radius:50%;'
    'background:var(--accent);opacity:.3;'
    'animation:pr-dot 1.2s ease-in-out infinite}'
    '.prerender-loading__dots span:nth-child(2){animation-delay:.2s}'
    '.prerender-loading__dots span:nth-child(3){animation-delay:.4s}'
    '@keyframes pr-dot{0%,80%,100%{opacity:.3;transform:scale(1)}'
    '40%{opacity:1;transform:scale(1.3)}}'
    '</style>'
)

PRERENDER_LOADING_HTML = (
    '<div class="prerender-loading" aria-hidden="true">'
    '<div class="prerender-loading__dots">'
    '<span></span><span></span><span></span>'
    '</div></div>'
)

# Assets de MapLibre (CSS + JS) para las páginas de /mapa/. El <script>
# es clásico (no módulo) → define window.maplibregl antes de que el
# módulo diferido mapa-pub.js se ejecute. Espejo de mapa.html. Sin esto,
# initRouteMap encuentra `typeof maplibregl === 'undefined'` y sale en
# silencio → mapa en blanco en TODOS los navegadores.
LEAFLET_HEAD = (
    '<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">'
    '<link rel="preconnect" href="https://tiles.openfreemap.org">'
    '<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>'
)

# ── Página HTML base ───────────────────────────────────────
def og_page(title, description, canonical_url,
            og_image=None, og_image_alt=None,
            body_html="", json_ld_objs=None,
            container_id="jornadaContent", spa_script="/js/jornada.js",
            main_class="",
            prerender_visible=True, show_loading=True,
            date_published=None, date_modified=None,
            head_extra=""):
    img     = og_image if og_image and og_image.startswith("http") else DEFAULT_OG_IMAGE
    img_alt = og_image_alt or title
    # Asignar id estable según @type para que la SPA pueda sobrescribirlos
    # sin duplicar bloques. Fallback: sin id.
    ld_tags = ""
    for obj in (json_ld_objs or []):
        if not isinstance(obj, dict):
            continue
        t = obj.get("@type") if isinstance(obj, dict) else None
        if   t == "SportsEvent":    sid = ' id="jsonld-main"'
        elif t == "BreadcrumbList": sid = ' id="jsonld-breadcrumbs"'
        else:                       sid = ""
        ld_tags += f'\n<script type="application/ld+json"{sid}>{json_ld_script(obj)}</script>'

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<script>!function(){{var t=localStorage.getItem("cc-theme")||(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"),d=document.documentElement;d.classList.toggle("light","light"===t);d.classList.toggle("dark","light"!==t);d.style.backgroundColor="light"===t?"#ffffff":"#111318";d.style.colorScheme="light"===t?"light":"dark"}}()</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#141414" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="apple-itunes-app" content="app-id=6761902611">{f'<meta name="date" content="{esc(date_published)}">' if date_published else ''}{f'<meta name="last-modified" content="{esc(date_modified)}">' if date_modified else ''}
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical_url)}">
<link rel="alternate" hreflang="es" href="{esc(canonical_url)}">
<link rel="alternate" hreflang="x-default" href="{esc(canonical_url)}">
<link rel="alternate" type="application/atom+xml" title="Calendario Ciclismo App — Próximas jornadas" href="{BASE_URL}/atom.xml">
<link rel="alternate" type="text/plain" title="LLMs.txt" href="{BASE_URL}/llms.txt">
<link rel="preconnect" href="https://bcecwlkynpgovnzhbpah.supabase.co">
<link rel="preconnect" href="https://assets.calendariociclismo.app">
<link rel="dns-prefetch" href="https://og.calendariociclismo.app">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_ES">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical_url)}">
<meta property="og:image" content="{esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(img_alt)}">
<meta property="og:site_name" content="Calendario Ciclismo App">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(img)}">
<meta name="twitter:image:alt" content="{esc(img_alt)}">{ld_tags}
<script src="/js/theme.js"></script>
<link rel="stylesheet" href="/css/app.css">
{PRERENDER_STYLE}
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
{head_extra}
</head>
<body>
{SITE_HEADER_HTML}
<main id="{container_id}"{f' class="{main_class}"' if main_class else ''}>
<div class="{'static-prerender static-prerender--visible' if prerender_visible else 'static-prerender'}">
{body_html}
</div>
{PRERENDER_LOADING_HTML if show_loading else ''}
</main>
{SITE_FOOTER_HTML}
<script src="/js/config.js"></script>
<script src="/js/cookie-consent.js"></script>
<script src="/js/analytics.js"></script>
<script type="module" src="{spa_script}"></script>
<script src="/js/apps-modal.js"></script>
<script src="/js/lang-switch.js"></script>
</body>
</html>"""

# ── Body builders (contenido pre-renderizado dentro de .static-prerender) ─
def breadcrumb_html(items):
    """items: list de (name, url). Última entrada sin enlace."""
    parts = []
    for i, (name, url) in enumerate(items):
        sep = ' › ' if i > 0 else ''
        if url and i < len(items) - 1:
            parts.append(f'{sep}<a href="{esc(url)}">{esc(name)}</a>')
        else:
            parts.append(f'{sep}<span>{esc(name)}</span>')
    return f'<nav aria-label="Migas de pan" class="crumbs">{"".join(parts)}</nav>'

def jornada_body(display_title, fecha_larga, description, km,
                 start_loc, finish_loc, same_or_one, crumbs,
                 perfil_url=None):
    parts = [breadcrumb_html(crumbs)]
    parts.append(f'<h1>{esc(display_title)}</h1>')
    if fecha_larga:
        cap = fecha_larga[0].upper() + fecha_larga[1:]
        parts.append(f'<p class="static-date">{esc(cap)}</p>')
    parts.append(f'<p>{esc(description)}</p>')
    if km:
        parts.append(f'<p class="static-meta"><strong>Distancia:</strong> {esc(str(km).replace(".", ","))} km</p>')
    if start_loc:
        route = start_loc if same_or_one else f"{start_loc} → {finish_loc}"
        parts.append(f'<p class="static-meta"><strong>Recorrido:</strong> {esc(route)}</p>')
    if perfil_url:
        parts.append(f'<p class="static-meta"><a href="{esc(perfil_url)}">Ver perfil de elevación</a></p>')
    return ''.join(parts)

def competicion_body(display_title, description, start, end, crumbs, stages=None):
    parts = [breadcrumb_html(crumbs)]
    parts.append(f'<h1>{esc(display_title)}</h1>')
    if start or end:
        if start and end and start != end:
            parts.append(f'<p class="static-date">Del {esc(start)} al {esc(end)}</p>')
        else:
            parts.append(f'<p class="static-date">{esc(start or end)}</p>')
    parts.append(f'<p>{esc(description)}</p>')
    if stages:
        items = []
        for s in stages:
            s_slug = s.get("slug", "")
            sn = s.get("stageNumber")
            label = stage_label(sn) if sn is not None else "Jornada"
            s_start = s.get("startLocation") or ""
            s_finish = s.get("finishLocation") or ""
            route = s_start if (not s_finish or s_start == s_finish) else f"{s_start} › {s_finish}"
            km_s = s.get("distanceKm")
            km_part = f" · {str(km_s).replace('.', ',')} km" if km_s else ""
            text = f"{label}: {route}{km_part}" if route else label
            if s.get("isRestDay"):
                items.append(f'<li class="static-rest">{esc(label)}: Descanso</li>')
            else:
                items.append(f'<li><a href="{BASE_URL}/jornada/{quote(s_slug)}/">{esc(text)}</a></li>')
        parts.append(f'<h2>Etapas</h2><ul class="static-stage-list">{"".join(items)}</ul>')
    return ''.join(parts)

def inscritos_body(display_title, description, crumbs):
    parts = [breadcrumb_html(crumbs)]
    parts.append(f'<h1>{esc(display_title)}</h1>')
    parts.append(f'<p>{esc(description)}</p>')
    return ''.join(parts)

def start_order_body(display_title, description, crumbs):
    parts = [breadcrumb_html(crumbs)]
    parts.append(f'<h1>{esc(display_title)}</h1>')
    parts.append(f'<p>{esc(description)}</p>')
    return ''.join(parts)

# ── Artículos para nombres de carreras ──
FEMENINOS = ["vuelta", "volta", "ronde", "classica", "clásica", "paris-roubaix femmes",
             "liège-bastogne-liège femmes", "strade bianche women", "course", "itzulia"]
def articulo(name):
    nl = (name or "").lower()
    for f in FEMENINOS:
        if nl.startswith(f) or f" {f}" in f" {nl}":
            return "la"
    return "el"

# Espejo de articuloNombre() en js/shared.js (la usan las descriptions de
# perfiles). articulo() de arriba es la heurística legacy de jornadas.
MASCULINOS_NOMBRE = ["tour","giro","gran","grande","campeonato","criterium","critérium",
                     "circuito","circuit","grand","trofeo","trophee","trophée",
                     "memorial","premio","prix","open","paris","parís","eschborn","o","gp"]
def articulo_nombre(name):
    nl = (name or "").strip().lower()
    parts_n = nl.split()
    first = parts_n[0] if parts_n else ""
    if first in MASCULINOS_NOMBRE:
        return "el"
    # «X Tour» (UAE Tour, Renewi Tour, Alpes Isère Tour…): masculino
    # aunque la palabra clave no vaya primera.
    if re.search(r"\btour\b", nl):
        return "el"
    return "la"

# ── Formateo de fechas (paridad con updateSeoCompeticion en js/competicion.js) ──
MESES = ["enero","febrero","marzo","abril","mayo","junio",
         "julio","agosto","septiembre","octubre","noviembre","diciembre"]
MONTHS_EN = ["January","February","March","April","May","June",
             "July","August","September","October","November","December"]

def format_day_month(date_key, include_month):
    """'2026-08-22', True → '22 de agosto'; False → '22'."""
    try:
        y, m, d = [int(x) for x in date_key.split("-")]
        return f"{d} de {MESES[m-1]}" if include_month else str(d)
    except Exception:
        return date_key

def format_full_date(date_key):
    """'2026-08-22' → '22 de agosto de 2026'."""
    try:
        y, m, d = [int(x) for x in date_key.split("-")]
        return f"{d} de {MESES[m-1]} de {y}"
    except Exception:
        return date_key

DIAS_SEMANA = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"]

def format_weekday_date(date_key):
    """'2026-06-20' → 'Sábado 20 de junio' (día capitalizado, sin año).

    Para descripciones donde la fecha ABRE frase (resultados): el día de
    la semana va en mayúscula inicial. Sin año (la carrera ya lo lleva)."""
    try:
        from datetime import date as _dt_date
        y, m, d = [int(x) for x in date_key.split("-")]
        dia = DIAS_SEMANA[_dt_date(y, m, d).weekday()]
        return f"{dia.capitalize()} {d} de {MESES[m-1]}"
    except Exception:
        return date_key

# Nombres de país en español por código ISO-3166-1 alfa-2 (minúscula).
# Cubre todas las nacionalidades en uso en el catálogo de corredores + margen.
PAIS_ES = {
    "ad":"Andorra","ae":"Emiratos Árabes Unidos","af":"Afganistán","al":"Albania",
    "am":"Armenia","ao":"Angola","ar":"Argentina","at":"Austria","au":"Australia",
    "az":"Azerbaiyán","ba":"Bosnia y Herzegovina","be":"Bélgica","bf":"Burkina Faso",
    "bg":"Bulgaria","bh":"Baréin","bj":"Benín","bm":"Bermudas","bo":"Bolivia",
    "br":"Brasil","by":"Bielorrusia","ca":"Canadá","cd":"República Democrática del Congo",
    "ch":"Suiza","cl":"Chile","cn":"China","co":"Colombia","cr":"Costa Rica",
    "cu":"Cuba","cy":"Chipre","cz":"Chequia","de":"Alemania","dk":"Dinamarca",
    "dz":"Argelia","ec":"Ecuador","ee":"Estonia","er":"Eritrea","es":"España",
    "et":"Etiopía","fi":"Finlandia","fr":"Francia","gb":"Reino Unido","ge":"Georgia",
    "gr":"Grecia","gt":"Guatemala","gu":"Guam","hk":"Hong Kong","hn":"Honduras",
    "hr":"Croacia","hu":"Hungría","id":"Indonesia","ie":"Irlanda","il":"Israel",
    "in":"India","ir":"Irán","is":"Islandia","it":"Italia","jp":"Japón",
    "ke":"Kenia","kg":"Kirguistán","kr":"Corea del Sur","kz":"Kazajistán","la":"Laos",
    "lt":"Lituania","lu":"Luxemburgo","lv":"Letonia","ma":"Marruecos","mc":"Mónaco",
    "mn":"Mongolia","mt":"Malta","mu":"Mauricio","mx":"México","my":"Malasia",
    "nl":"Países Bajos","no":"Noruega","nz":"Nueva Zelanda","pa":"Panamá",
    "ph":"Filipinas","pl":"Polonia","pt":"Portugal","py":"Paraguay","ro":"Rumanía",
    "rs":"Serbia","ru":"Rusia","rw":"Ruanda","sa":"Arabia Saudí","se":"Suecia",
    "si":"Eslovenia","sk":"Eslovaquia","sv":"El Salvador","th":"Tailandia",
    "tr":"Turquía","tw":"Taiwán","tz":"Tanzania","ua":"Ucrania","ug":"Uganda",
    "us":"Estados Unidos","uy":"Uruguay","uz":"Uzbekistán","ve":"Venezuela",
    "vn":"Vietnam","xk":"Kosovo","za":"Sudáfrica",
}

def pais_es(code):
    """ISO-2 minúscula → nombre de país en español, o '' si no se conoce."""
    return PAIS_ES.get((code or "").lower(), "")

# Nombres de país en inglés por ISO-2 (espejo EN de PAIS_ES).
COUNTRY_EN = {
    "ad":"Andorra","ae":"United Arab Emirates","af":"Afghanistan","al":"Albania",
    "am":"Armenia","ao":"Angola","ar":"Argentina","at":"Austria","au":"Australia",
    "az":"Azerbaijan","ba":"Bosnia and Herzegovina","be":"Belgium","bf":"Burkina Faso",
    "bg":"Bulgaria","bh":"Bahrain","bj":"Benin","bm":"Bermuda","bo":"Bolivia",
    "br":"Brazil","by":"Belarus","ca":"Canada","cd":"DR Congo",
    "ch":"Switzerland","cl":"Chile","cn":"China","co":"Colombia","cr":"Costa Rica",
    "cu":"Cuba","cy":"Cyprus","cz":"Czechia","de":"Germany","dk":"Denmark",
    "dz":"Algeria","ec":"Ecuador","ee":"Estonia","er":"Eritrea","es":"Spain",
    "et":"Ethiopia","fi":"Finland","fr":"France","gb":"United Kingdom","ge":"Georgia",
    "gr":"Greece","gt":"Guatemala","gu":"Guam","hk":"Hong Kong","hn":"Honduras",
    "hr":"Croatia","hu":"Hungary","id":"Indonesia","ie":"Ireland","il":"Israel",
    "in":"India","ir":"Iran","is":"Iceland","it":"Italy","jp":"Japan",
    "ke":"Kenya","kg":"Kyrgyzstan","kr":"South Korea","kz":"Kazakhstan","la":"Laos",
    "lt":"Lithuania","lu":"Luxembourg","lv":"Latvia","ma":"Morocco","mc":"Monaco",
    "mn":"Mongolia","mt":"Malta","mu":"Mauritius","mx":"Mexico","my":"Malaysia",
    "nl":"Netherlands","no":"Norway","nz":"New Zealand","pa":"Panama",
    "ph":"Philippines","pl":"Poland","pt":"Portugal","py":"Paraguay","ro":"Romania",
    "rs":"Serbia","ru":"Russia","rw":"Rwanda","sa":"Saudi Arabia","se":"Sweden",
    "si":"Slovenia","sk":"Slovakia","sv":"El Salvador","th":"Thailand",
    "tr":"Türkiye","tw":"Taiwan","tz":"Tanzania","ua":"Ukraine","ug":"Uganda",
    "us":"United States","uy":"Uruguay","uz":"Uzbekistan","ve":"Venezuela",
    "vn":"Vietnam","xk":"Kosovo","za":"South Africa",
}

def country_en(code):
    """ISO-2 minúscula → nombre de país en inglés, o '' si no se conoce."""
    return COUNTRY_EN.get((code or "").lower(), "")

WEEKDAYS_EN = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]

def format_weekday_date_en(date_key):
    """'2026-06-20' → 'Saturday 20 June' (weekday capitalised, no year).

    Para descripciones EN donde la fecha cierra frase (resultados)."""
    try:
        from datetime import date as _dt_date
        y, m, d = [int(x) for x in date_key.split("-")]
        wd = WEEKDAYS_EN[_dt_date(y, m, d).weekday()]
        return f"{wd} {d} {MONTHS_EN[m-1]}"
    except Exception:
        return date_key

def format_weekday_full_date_en(date_key):
    """'2026-07-18' → 'Saturday 18 July 2026' (weekday + año, para jornada EN)."""
    try:
        from datetime import date as _dt_date
        y, m, d = [int(x) for x in date_key.split("-")]
        wd = WEEKDAYS_EN[_dt_date(y, m, d).weekday()]
        return f"{wd} {d} {MONTHS_EN[m-1]} {y}"
    except Exception:
        return date_key

def format_full_date_en(date_key):
    """'2026-08-22' → '22 August 2026' (paridad seoLongDate EN en js/shared.js)."""
    try:
        y, m, d = [int(x) for x in date_key.split("-")]
        return f"{d} {MONTHS_EN[m-1]} {y}"
    except Exception:
        return date_key

def ordinal_etapa(n):
    if n == 0: return "prólogo"
    return f"etapa {n}"

def stage_label(n):
    if n is None: return ""
    n = int(n)
    if n == 0: return "Prólogo"
    return f"Etapa {n}"

SITE_HEADER_HTML_EN = (
    # Idéntico al ES; js/header.js detecta el idioma por la ruta /en/.
    '<header class="site-header" id="siteHeader" data-back></header>'
    '<script type="module" src="/js/header.js"></script>'
)

def og_page_en(title, description, canonical_url,
               es_url=None,
               og_image=None, og_image_alt=None,
               body_html="", json_ld_objs=None,
               container_id="jornadaContent", spa_script="/js/jornada.js",
               main_class="",
               prerender_visible=True, show_loading=True,
               date_published=None, date_modified=None,
               head_extra=""):
    img     = og_image if og_image and og_image.startswith("http") else DEFAULT_OG_IMAGE
    img_alt = og_image_alt or title
    ld_tags = ""
    for obj in (json_ld_objs or []):
        if not isinstance(obj, dict):
            continue
        t = obj.get("@type") if isinstance(obj, dict) else None
        if   t == "SportsEvent":    sid = ' id="jsonld-main"'
        elif t == "BreadcrumbList": sid = ' id="jsonld-breadcrumbs"'
        else:                       sid = ""
        ld_tags += f'\n<script type="application/ld+json"{sid}>{json_ld_script(obj)}</script>'

    hreflang_es = f'<link rel="alternate" hreflang="es" href="{esc(es_url)}"/>' if es_url else ''
    hreflang_def = f'<link rel="alternate" hreflang="x-default" href="{esc(es_url)}"/>' if es_url else ''

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<script>!function(){{var t=localStorage.getItem("cc-theme")||(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"),d=document.documentElement;d.classList.toggle("light","light"===t);d.classList.toggle("dark","light"!==t);d.style.backgroundColor="light"===t?"#ffffff":"#111318";d.style.colorScheme="light"===t?"light":"dark"}}()</script>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#141414" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="apple-itunes-app" content="app-id=6761902611">{f'<meta name="date" content="{esc(date_published)}">' if date_published else ''}{f'<meta name="last-modified" content="{esc(date_modified)}">' if date_modified else ''}
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
<link rel="canonical" href="{esc(canonical_url)}">
<link rel="alternate" hreflang="en" href="{esc(canonical_url)}"/>
{hreflang_es}
{hreflang_def}
<link rel="alternate" type="application/atom+xml" title="Calendario Ciclismo" href="{BASE_URL}/atom.xml">
<link rel="preconnect" href="https://bcecwlkynpgovnzhbpah.supabase.co">
<link rel="preconnect" href="https://assets.calendariociclismo.app">
<meta property="og:type" content="website">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{esc(canonical_url)}">
<meta property="og:image" content="{esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{esc(img_alt)}">
<meta property="og:site_name" content="Calendario Ciclismo">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{esc(title)}">
<meta name="twitter:description" content="{esc(description)}">
<meta name="twitter:image" content="{esc(img)}">
<meta name="twitter:image:alt" content="{esc(img_alt)}">{ld_tags}
<script src="/js/theme.js"></script>
<link rel="stylesheet" href="/css/app.css">
{PRERENDER_STYLE}
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
{head_extra}
</head>
<body>
{SITE_HEADER_HTML_EN}
<main id="{container_id}"{f' class="{main_class}"' if main_class else ''}>
<div class="{'static-prerender static-prerender--visible' if prerender_visible else 'static-prerender'}">
{body_html}
</div>
{PRERENDER_LOADING_HTML if show_loading else ''}
</main>
{SITE_FOOTER_HTML_EN}
<script src="/js/config.js"></script>
<script src="/js/cookie-consent.js"></script>
<script src="/js/analytics.js"></script>
<script type="module" src="{spa_script}"></script>
<script src="/js/apps-modal.js"></script>
<script src="/js/lang-switch.js"></script>
</body>
</html>"""

# ── COMPETICIONES ──
print("Generando páginas OG para competiciones...")
# NB: la tabla races no tiene updatedAt (solo createdAt). El dateModified
# de la JSON-LD SportsEvent cae al fallback `end or start`.
races = supabase_get(
    "races?select=id,slug,slugEn,name,nameEn,originalName,year,startDate,endDate,"
    "logoUrl,raceFormat,countryCode,uciCategory,isCancelled,websiteUrl,"
    "startlistProvisional,gender"
    "&slug=not.is.null&order=startDate.desc"
)

# Conteos de equipos y corredores por carrera (para descripciones de inscritos).
#
# Vía RPC startlist_counts() (migración 131), que agrega en el servidor: ~410
# filas / 26 KB en una petición. NO usar los agregados de PostgREST
# (`select=raceId,count()`): el proyecto los tiene deshabilitados —el default de
# Supabase— y devuelven PGRST123. Eso es lo que hacía este bloque hasta el
# 2026-07-18, y como el fallo se capturaba abajo como aviso, las 802 páginas de
# /inscritos/ salían con la descripción genérica sin que nadie lo notara.
#
# Se conserva el try/except: si la RPC fallara, las páginas siguen generándose
# con la descripción sin números en vez de tumbar el build entero.
sl_team_counts = {}
sl_rider_counts = {}
try:
    for row in supabase_rpc("startlist_counts") or []:
        rid = row.get("raceId")
        if not rid:
            continue
        if row.get("teams") is not None:
            sl_team_counts[rid] = row["teams"]
        if row.get("riders") is not None:
            sl_rider_counts[rid] = row["riders"]
    print(f"  → conteos: {len(sl_team_counts)} carreras con equipos, {len(sl_rider_counts)} con corredores")
except Exception as e:
    print(f"  Aviso: no se pudieron cargar conteos de startlist: {e}", file=sys.stderr)

# Precarga jornadas para generar ItemList en páginas de competición
racedays_all = supabase_get(
    "race_days?select=id,slug,slugEn,raceId,stageNumber,startLocation,finishLocation,"
    "startLocationEn,finishLocationEn,dateKey,isRestDay,isCancelledDay,updatedAt,"
    "countryCode,elevationProfile,profileNotViewable,distanceKm,primaryType,secondaryType,"
    "description,translations"
    "&editorialStatus=eq.published&slug=not.is.null&order=dateKey.asc"
)
stages_by_race = {}
for _rd in racedays_all:
    _rid = _rd.get("raceId")
    if _rid:
        stages_by_race.setdefault(_rid, []).append(_rd)

# SEO ES capturado por raceId para reusarlo en las páginas EN (/en/race).
comp_seo = {}
race_count = 0
for race in races:
    slug = race.get("slug")
    if not slug:
        continue

    name = race.get("name", "")
    orig_name = race.get("originalName", "")
    name_with_orig = f"{name} ({orig_name})" if orig_name else name
    year = race.get("year", "")
    art = articulo(name)
    cancelled = bool(race.get("isCancelled"))

    title = f"{name} {year} — Calendario Ciclismo App"
    display_title = f"{name} {year}" if year else name

    is_one_day_comp = race.get("raceFormat") == "one_day"
    start = race.get("startDate", "")
    end = race.get("endDate", "")
    # Paridad con updateSeoCompeticion en js/competicion.js.
    # Carrera de un día → "se disputa el D de mes" (nunca "del D al D").
    if start and end and start != end:
        multi_month = start[:7] != end[:7]
        fecha_inicio = format_day_month(start, multi_month)
        fecha_fin = format_full_date(end)
        description = f"{art.capitalize()} {name_with_orig} se disputa del {fecha_inicio} al {fecha_fin}. Consulta el recorrido, etapas y cómo ver por TV y online streaming."
    elif start or end:
        description = f"{art.capitalize()} {name_with_orig} se disputa el {format_full_date(start or end)}. Consulta el recorrido y cómo ver por TV y online streaming."
    else:
        description = f"{art.capitalize()} {name_with_orig} {year}. Consulta el recorrido, etapas y cómo ver por TV y online streaming."

    og_image = og_image_url(race.get("logoUrl"), f"{name} {year}")
    # Carrera de un día: /competicion/ y /jornada/ comparten keyword y
    # (casi siempre) slug. Consolidamos la señal SEO hacia la JORNADA
    # (contenido real: recorrido, perfil, horarios, TV) apuntando el
    # canonical de esta página de competición a la jornada única. La
    # página sigue existiendo (no rompe enlaces históricos/indexados;
    # GitHub Pages no hace 301), pero Google indexa la jornada.
    canonical = f"{BASE_URL}/competicion/{quote(slug)}/"
    _oneday_rd_slug = None
    if is_one_day_comp:
        _oneday_rd = next(
            (s for s in stages_by_race.get(race.get("id"), [])
             if not s.get("isRestDay") and s.get("slug")),
            None,
        )
        if _oneday_rd:
            _oneday_rd_slug = _oneday_rd["slug"]
            canonical = f"{BASE_URL}/jornada/{quote(_oneday_rd_slug)}/"

    crumbs = [
        ("Inicio", f"{BASE_URL}/"),
        (f"Temporada {year}" if year else "Temporada",
         f"{BASE_URL}/calendario.html" + (f"?year={year}" if year else "")),
        (display_title, None),
    ]

    representative_stage = next(
        (s for s in stages_by_race.get(race.get("id"), [])
         if not s.get("isRestDay") and s.get("dateKey")
         and (s.get("startLocation") or s.get("finishLocation"))),
        None,
    )
    representative_location = ((representative_stage or {}).get("startLocation")
                               or (representative_stage or {}).get("finishLocation")
                               or None)
    country_iso = (((representative_stage or {}).get("countryCode")
                   or race.get("countryCode") or "").upper() or None)
    race_website_url = race.get("websiteUrl") or None
    race_updated_at = (race.get("updatedAt") or "")[:10] or None
    date_published_comp = start or None
    date_modified_comp = race_updated_at or end or start or None

    # ItemList de etapas para competiciones por etapas
    race_stages = stages_by_race.get(race.get("id"), [])
    il_items = []
    pos = 0
    for _s in race_stages:
        if _s.get("isRestDay"): continue
        pos += 1
        sn = _s.get("stageNumber")
        sl_name = stage_label(sn) if sn is not None else f"Jornada {pos}"
        s_start = _s.get("startLocation") or ""
        s_finish = _s.get("finishLocation") or ""
        route = s_start if (not s_finish or s_start == s_finish) else f"{s_start} – {s_finish}"
        item_name = f"{sl_name}: {route}" if route else sl_name
        il_items.append((pos, item_name, f"{BASE_URL}/jornada/{quote(_s['slug'])}/"))

    competition_event = sports_event(
            name=display_title,
            start_date=start or (representative_stage or {}).get("dateKey") or None,
            end_date=end or start or (representative_stage or {}).get("dateKey") or None,
            url=canonical,
            description=description,
            image=og_image,
            location_name=representative_location,
            location_country=country_iso,
            cancelled=cancelled,
            date_published=date_published_comp,
            date_modified=date_modified_comp,
            organizer_url=race_website_url,
        )
    json_ld_list = [obj for obj in (competition_event, breadcrumb_list(crumbs)) if obj]
    if il_items and len(race_stages) > 1:
        json_ld_list.insert(1, item_list(f"Etapas de {display_title}", il_items))
    if year:
        feed_url = f"{BASE_URL}/feed/{year}.ics"
        json_ld_list.append({
            "@context": "https://schema.org",
            "@type": "SubscribeAction",
            "object": {"@type": "Schedule", "name": f"Calendario {display_title}"},
            "target": {"@type": "EntryPoint", "urlTemplate": feed_url,
                       "actionPlatform": ["https://schema.org/DesktopWebPlatform",
                                          "https://schema.org/MobileWebPlatform"]},
        })

    comp_seo[race.get("id")] = {"title": title, "description": description,
                                "og_image": og_image, "display_title": display_title,
                                "json_ld": json_ld_list}

    body = competicion_body(display_title, description, start, end, crumbs,
                            stages=race_stages if len(race_stages) > 1 else None)

    dir_path = f"competicion/{slug}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page(title, description, canonical, og_image,
                        og_image_alt=display_title,
                        body_html=body, json_ld_objs=json_ld_list,
                        container_id="competicionContent",
                        spa_script="/js/competicion.js",
                        date_published=date_published_comp,
                        date_modified=date_modified_comp))
    race_count += 1

print(f"  → {race_count} competiciones")

# ── JORNADAS ──
print("Generando páginas OG para jornadas...")
# racedays ya precargadas arriba (racedays_all) con todos los campos necesarios
racedays = sorted(racedays_all, key=lambda x: x.get("dateKey",""), reverse=True)

# Política de slug canónico: para jornadas con señal semántica equivalente,
# elegir un slug maestro estable y consolidar canonical hacia ese maestro.
grouped = {}
for rd in racedays:
    slug = rd.get("slug")
    if not slug:
        continue
    grouped.setdefault(canonical_group_key(rd), []).append(slug)

canonical_slug_by_slug = {}
alias_groups = 0
for _k, slugs in grouped.items():
    unique = sorted(set(slugs))
    if not unique:
        continue
    # Preferencia: slug más corto, luego lexicográfico (estable en el tiempo).
    master = sorted(unique, key=lambda s: (len(s), s))[0]
    if len(unique) > 1:
        alias_groups += 1
    for s in unique:
        canonical_slug_by_slug[s] = master
if alias_groups:
    print(f"  → detectados {alias_groups} grupos de alias de slug en jornadas; se consolida canonical al maestro")

_STAGE_TYPE_ES = {
    "mountain": "Montaña", "flat": "Llano", "hilly": "Accidentada",
    "itt": "CRI", "ttt": "CRE", "semi_classic": "Semielásica",
    "one_day_race": "Clásica", "prologue": "Prólogo",
}

# Mapa raceId -> race para enriquecer jornadas
race_map = {r["id"]: r for r in races}

# SEO ES capturado por slug para reusarlo en las páginas EN (/en/stage).
jornada_seo = {}
day_count = 0
for rd in racedays:
    slug = rd.get("slug")
    if not slug:
        continue

    race = race_map.get(rd.get("raceId"), {})
    race_name = race.get("name", "")
    orig_name = race.get("originalName", "")
    race_name_with_orig = f"{race_name} ({orig_name})" if orig_name else race_name
    race_year = race.get("year", "")
    race_slug = race.get("slug", "")
    is_one_day = race.get("raceFormat") == "one_day"
    stage_num = rd.get("stageNumber")
    start_loc = rd.get("startLocation", "") or ""
    finish_loc = rd.get("finishLocation", "") or ""
    same_or_one = not finish_loc or start_loc == finish_loc
    km = rd.get("distanceKm")
    date_key = rd.get("dateKey", "")
    is_rest = bool(rd.get("isRestDay"))
    is_cancelled_day = bool(rd.get("isCancelledDay"))

    fecha_larga = ""
    if date_key:
        try:
            parts = date_key.split("-")
            from datetime import date as dt_date
            d = dt_date(int(parts[0]), int(parts[1]), int(parts[2]))
            dias = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"]
            meses = ["enero","febrero","marzo","abril","mayo","junio",
                     "julio","agosto","septiembre","octubre","noviembre","diciembre"]
            fecha_larga = f"{dias[d.weekday()]} {d.day} de {meses[d.month-1]} de {d.year}"
        except Exception:
            fecha_larga = date_key

    sl = stage_label(stage_num) if stage_num is not None else ""

    stage_type = (rd.get("primaryType") or rd.get("secondaryType") or "").strip()
    stage_type_label = _STAGE_TYPE_ES.get(stage_type, stage_type.replace("_", " ").title()) if stage_type else ""
    km_txt = str(km).replace('.', ',') + " km" if km else ""
    route = start_loc if same_or_one else f"{start_loc} › {finish_loc}"

    # Título: route + km en clásicas (nuevas keywords); solo route en etapas (ya existía)
    if is_one_day:
        tail = " · ".join([x for x in [route if route else "", km_txt] if x])
        title = f"{race_name}{(' ' + str(race_year)) if race_year else ''}" + (f": {tail}" if tail else "") + " — Calendario Ciclismo App"
        display_title = f"{race_name}{(' ' + str(race_year)) if race_year else ''}"
    elif is_rest:
        title = f"{race_name} {race_year}, {sl or 'Descanso'}: Jornada de descanso — Calendario Ciclismo App"
        display_title = f"{race_name} {race_year} · {sl or 'Descanso'}"
    else:
        title = (f"{race_name}, {sl}: {route}" if route else f"{race_name}, {sl}") + (f" · {km_txt}" if km_txt else "") + " — Calendario Ciclismo App"
        display_title = f"{race_name} {race_year} · {sl}" if sl else f"{race_name} {race_year}"
        if route:
            display_title = f"{display_title} — {route}" if sl else display_title

    # Descripción
    ruta_str = (f"con salida y meta en {start_loc}" if same_or_one and start_loc
                else f"con salida en {start_loc} y meta en {finish_loc}" if finish_loc
                else "")
    # Fecha entre paréntesis tras el nombre; conserva minúscula el día de semana.
    fecha_parentesis = f" ({fecha_larga})" if fecha_larga else ""
    fecha_cap = (fecha_larga[0].upper() + fecha_larga[1:]) if fecha_larga else ""
    art = articulo(race_name)
    cuerpo = (f"cubre {str(km).replace('.', ',')} km" + (f" {ruta_str}" if ruta_str else "")
              if km else f"se disputa {ruta_str}" if ruta_str else "se disputa")

    if is_rest:
        description = (f"Jornada de descanso de {art} {race_name_with_orig} {race_year}"
                       f"{' — ' + fecha_cap if fecha_cap else ''}.")
    elif is_one_day:
        art_cap = art[0].upper() + art[1:]
        description = (f"{art_cap} {race_name_with_orig}{fecha_parentesis} {cuerpo}. "
                       f"Consulta recorrido, horarios y cómo ver por TV y online streaming.")
    else:
        ord_str = ordinal_etapa(int(stage_num)) if stage_num is not None else ""
        prefix_art = "El" if ord_str == "prólogo" else "La"
        deArt = "del" if art == "el" else "de la"
        description = (f"{prefix_art} {ord_str} {deArt} {race_name_with_orig}{fecha_parentesis} {cuerpo}. "
                       f"Consulta recorrido, horarios y cómo ver por TV y online streaming.")

    og_title = f"{race_name} {race_year}" if is_one_day else title.replace(" — Calendario Ciclismo App", "")
    og_image = og_image_url(race.get("logoUrl"), og_title)
    canonical_slug = canonical_slug_by_slug.get(slug, slug)
    canonical = f"{BASE_URL}/jornada/{quote(canonical_slug)}/"

    # Breadcrumbs
    crumbs = [("Inicio", f"{BASE_URL}/")]
    if race_year:
        crumbs.append((f"Temporada {race_year}", f"{BASE_URL}/calendario.html?year={race_year}"))
    if race_slug and not is_one_day:
        comp_name = f"{race_name} {race_year}" if race_year else race_name
        crumbs.append((comp_name, f"{BASE_URL}/competicion/{quote(race_slug)}/"))
    # Entrada final (sin URL) — descripción corta
    if is_one_day:
        crumbs.append((display_title, None))
    else:
        final_name = sl if sl else (start_loc or display_title)
        if not same_or_one and finish_loc:
            final_name = f"{sl}: {start_loc} › {finish_loc}" if sl else f"{start_loc} › {finish_loc}"
        elif start_loc and sl:
            final_name = f"{sl}: {start_loc}"
        crumbs.append((final_name, None))

    # JSON-LD
    rd_updated_at = (rd.get("updatedAt") or "")[:10] or None
    rd_country = (rd.get("countryCode") or race.get("countryCode") or "").upper() or None
    json_ld_list = []
    if not is_rest:
        location_name = None
        if same_or_one and start_loc:
            location_name = start_loc
        elif start_loc and finish_loc:
            location_name = f"{start_loc} → {finish_loc}"
        elif start_loc:
            location_name = start_loc
        stage_event = sports_event(
            name=og_title,
            start_date=date_key or None,
            end_date=date_key or None,
            url=canonical,
            description=description,
            image=og_image,
            location_name=location_name,
            location_country=rd_country,
            cancelled=is_cancelled_day or bool(race.get("isCancelled")),
            date_published=date_key or None,
            date_modified=rd_updated_at or date_key or None,
            organizer_url=race.get("websiteUrl") or None,
            same_as=race.get("websiteUrl") or None,
        )
        if stage_event:
            json_ld_list.append(stage_event)
        about = []
        if stage_type_label:
            about.append({"@type": "Thing", "name": f"Tipo de etapa: {stage_type_label}"})
        if route:
            about.append({"@type": "Thing", "name": f"Recorrido: {route}"})
        if km_txt:
            about.append({"@type": "Thing", "name": f"Distancia: {km_txt}"})
        if is_rest:
            about.append({"@type": "Thing", "name": "Jornada de descanso"})
        if about and stage_event:
            stage_event["about"] = about
    json_ld_list.append(breadcrumb_list(crumbs))

    # Body — link a perfil de elevación si existe y es visible
    has_perfil = bool(rd.get("elevationProfile")) and not rd.get("profileNotViewable")
    perfil_url = f"{BASE_URL}/perfil/{quote(slug)}/" if has_perfil and not is_rest else None
    jornada_seo[slug] = {"title": title, "description": description,
                         "og_image": og_image, "og_title": og_title,
                         "json_ld": json_ld_list}

    body = jornada_body(display_title, fecha_larga, description, km,
                        start_loc, finish_loc, same_or_one, crumbs,
                        perfil_url=perfil_url)

    dir_path = f"jornada/{slug}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page(title, description, canonical, og_image,
                        og_image_alt=og_title,
                        body_html=body, json_ld_objs=json_ld_list,
                        container_id="jornadaContent",
                        spa_script="/js/jornada.js",
                        date_published=date_key or None,
                        date_modified=rd_updated_at or date_key or None))
    day_count += 1

print(f"  → {day_count} jornadas")

# ── INSCRITOS ──
# Genera páginas OG para inscritos reutilizando el slug de la carrera.
# Se generan para TODAS las carreras con slug (igual que competiciones).
# inscritos.js ya muestra un mensaje adecuado si aún no hay datos.
print("Generando páginas OG para inscritos...")

# SEO ES capturado por raceId para reusarlo en las páginas EN (/en/startlist).
inscritos_seo = {}
inscritos_count = 0
for race in races:
    slug = race.get("slug")
    if not slug:
        continue

    name = race.get("name", "")
    orig_name = race.get("originalName", "")
    name_with_orig = f"{name} ({orig_name})" if orig_name else name
    year = race.get("year", "")
    art = articulo(name)

    is_female = race.get("gender") == "female"
    provisional = bool(race.get("startlistProvisional"))
    inscritos_label = "Lista provisional" if provisional else "Dorsales"
    provisional_note = " (provisional, sujeta a cambios)" if provisional else ""

    race_id = race.get("id")
    n_teams = sl_team_counts.get(race_id, 0)
    n_riders = sl_rider_counts.get(race_id, 0)
    rider_phrase = "corredoras inscritas" if is_female else "corredores inscritos"
    if n_teams > 0 and n_riders > 0:
        description = f"Lista de {n_teams} equipos y {n_riders} {rider_phrase} en {art} {name_with_orig} {year}{provisional_note}. Dorsales y participantes."
    else:
        description = f"Lista de equipos y {rider_phrase} en {art} {name_with_orig} {year}{provisional_note}. Dorsales y participantes."

    title = f"{inscritos_label} — {name} {year} — Calendario Ciclismo App"
    display_title = f"{inscritos_label} — {name} {year}"

    og_image = og_image_url(race.get("logoUrl"), f"{inscritos_label} — {name} {year}")
    canonical = f"{BASE_URL}/inscritos/{quote(slug)}/"

    crumbs = [
        ("Inicio", f"{BASE_URL}/"),
        (f"Temporada {year}" if year else "Temporada",
         f"{BASE_URL}/calendario.html" + (f"?year={year}" if year else "")),
        (f"{name} {year}" if year else name,
         f"{BASE_URL}/competicion/{quote(slug)}/"),
        (inscritos_label, None),
    ]
    json_ld_list = [breadcrumb_list(crumbs)]
    inscritos_seo[race.get("id")] = {"title": title, "description": description,
                                     "og_image": og_image, "display_title": display_title,
                                     "json_ld": json_ld_list}

    body = inscritos_body(display_title, description, crumbs)

    dir_path = f"inscritos/{slug}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page(title, description, canonical, og_image,
                        og_image_alt=f"{inscritos_label} — {name} {year}",
                        body_html=body, json_ld_objs=json_ld_list,
                        container_id="inscritosContent",
                        spa_script="/js/inscritos.js"))
    inscritos_count += 1

print(f"  → {inscritos_count} inscritos")

# ── ORDEN DE SALIDA ──
print("Generando páginas OG para órdenes de salida...")
os.makedirs("orden-salida", exist_ok=True)
so_rds_raw = supabase_get(
    "race_days?select=id,slug,slugEn,raceId,stageNumber,primaryType,dateKey,"
    "startLocation,finishLocation,startLocationEn,finishLocationEn,"
    "distanceKm,startOrderImportedAt,updatedAt"
    "&editorialStatus=eq.published&slug=not.is.null"
    "&startOrderImportedAt=not.is.null"
)
print(f"  → {len(so_rds_raw)} jornadas con orden de salida")
# SEO ES capturado por slug para reusarlo en las páginas EN (SEO en
# castellano, contenido visible en inglés).
so_seo = {}
so_count = 0
for rd in so_rds_raw:
    slug = rd.get("slug")
    if not slug:
        continue
    race = race_map.get(rd.get("raceId"), {})
    race_name = race.get("name", "")
    year = race.get("year", "")
    stage_num = rd.get("stageNumber")
    if stage_num == 0:
        so_stage_label = "Prólogo"
    elif stage_num is not None:
        so_stage_label = f"Etapa {stage_num}"
    else:
        so_stage_label = ""
    type_map = {"itt": "CRI", "ttt": "CRE"}
    is_ttt = rd.get("primaryType", "") == "ttt"
    type_label = type_map.get(rd.get("primaryType", ""), "Contrarreloj")
    hero_title = f"{race_name} {year}".strip()
    display_title = f"Orden de Salida — {hero_title}"
    if so_stage_label:
        display_title = f"Orden de Salida — {so_stage_label} {type_label} — {hero_title}"
    so_unit = "cada equipo" if is_ttt else "cada corredor"
    # «Horarios y orden de salida de la CRI (1ª etapa) del Tour de Francia
    #  2026: Barcelona > Tarragona (18 km).»
    type_name_map = {"CRI": "CRI", "CRE": "CRE"}
    so_type_name = type_name_map.get(type_label, type_label)  # mantiene mayúsculas
    so_de_art = "del" if articulo_nombre(race_name) == "el" else "de la"
    if stage_num == 0:
        so_stage_par = " (prólogo)"
    elif stage_num is not None:
        so_stage_par = f" ({stage_num}ª etapa)"
    else:
        so_stage_par = ""
    so_start = rd.get("startLocation") or ""
    so_finish = rd.get("finishLocation") or ""
    so_same = (not so_finish) or so_start == so_finish
    so_route = so_start if so_same else f"{so_start} > {so_finish}"
    so_km_val = rd.get("distanceKm")
    so_km = f"{f'{so_km_val:g}'.replace('.', ',')} km" if so_km_val else ""
    if so_route and so_km:
        so_detail = f": {so_route} ({so_km})"
    elif so_route:
        so_detail = f": {so_route}"
    elif so_km:
        so_detail = f" ({so_km})"
    else:
        so_detail = ""
    description = (f"Horarios y orden de salida de la {so_type_name}{so_stage_par} "
                   f"{so_de_art} {hero_title}{so_detail}.")
    title = f"{display_title} — Calendario Ciclismo App"
    og_image = og_image_url(race.get("logoUrl"), display_title)
    canonical = f"{BASE_URL}/orden-salida/{quote(slug)}/"
    race_slug = race.get("slug", "")
    crumbs = [
        ("Inicio", f"{BASE_URL}/"),
        (f"Temporada {year}" if year else "Temporada",
         f"{BASE_URL}/calendario.html" + (f"?year={year}" if year else "")),
    ]
    if race_slug:
        crumbs.append((f"{race_name} {year}" if year else race_name,
                       f"{BASE_URL}/competicion/{quote(race_slug)}/"))
    if so_stage_label:
        crumbs.append((so_stage_label, f"{BASE_URL}/jornada/{quote(slug)}/"))
    crumbs.append(("Orden de Salida", None))
    json_ld_list = [breadcrumb_list(crumbs)]
    so_seo[slug] = {"title": title, "description": description,
                    "og_image": og_image, "display_title": display_title,
                    "crumbs": crumbs}
    body = start_order_body(display_title, description, crumbs)
    rd_updated_at = rd.get("startOrderImportedAt") or rd.get("updatedAt")
    dir_path = f"orden-salida/{slug}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page(title, description, canonical, og_image,
                        og_image_alt=display_title,
                        body_html=body, json_ld_objs=json_ld_list,
                        container_id="startOrderContent",
                        spa_script="/js/orden-salida.js",
                        date_modified=rd_updated_at))
    so_count += 1
print(f"  → {so_count} órdenes de salida")

# ── ORDEN DE SALIDA (EN) ──
os.makedirs("en/start-order", exist_ok=True)
so_en_count = 0
for rd in so_rds_raw:
    slug_en = rd.get("slugEn")
    if not slug_en:
        continue
    slug_es = rd.get("slug", "")
    race = race_map.get(rd.get("raceId"), {})
    name_en = race.get("nameEn") or race.get("name", "")
    if not name_en:
        continue
    year = race.get("year", "")
    stage_num = rd.get("stageNumber")
    if stage_num == 0:
        stage_label_en = "Prologue"
    elif stage_num is not None:
        stage_label_en = f"Stage {stage_num}"
    else:
        stage_label_en = ""
    type_map_en = {"itt": "ITT", "ttt": "TTT"}
    is_ttt_en = rd.get("primaryType", "") == "ttt"
    type_label_en = type_map_en.get(rd.get("primaryType", ""), "Time trial")
    hero_title_en = f"{name_en} {year}".strip()
    if stage_label_en:
        display_title_en = f"Start order — {stage_label_en} {type_label_en} — {hero_title_en}"
    else:
        display_title_en = f"Start order — {hero_title_en}"
    # «Schedule and start order for the ITT (stage 1) of the Tour de France
    #  2026: Barcelona > Tarragona (18 km).» — ITT/TTT en mayúscula.
    if stage_num == 0:
        so_stage_par_en = " (prologue)"
    elif stage_num is not None:
        so_stage_par_en = f" (stage {stage_num})"
    else:
        so_stage_par_en = ""
    so_start_en = rd.get("startLocationEn") or rd.get("startLocation") or ""
    so_finish_en = rd.get("finishLocationEn") or rd.get("finishLocation") or ""
    so_same_en = (not so_finish_en) or so_start_en == so_finish_en
    so_route_en = so_start_en if so_same_en else f"{so_start_en} > {so_finish_en}"
    so_km_val_en = rd.get("distanceKm")
    so_km_en = f"{f'{so_km_val_en:g}'} km" if so_km_val_en else ""
    if so_route_en and so_km_en:
        so_detail_en = f": {so_route_en} ({so_km_en})"
    elif so_route_en:
        so_detail_en = f": {so_route_en}"
    elif so_km_en:
        so_detail_en = f" ({so_km_en})"
    else:
        so_detail_en = ""
    desc_en = (f"Schedule and start order for the {type_label_en}{so_stage_par_en} "
               f"of the {hero_title_en}{so_detail_en}.")
    title_en = f"{display_title_en} — Calendario Ciclismo"
    og_img_en = og_image_url(race.get("logoUrl"), display_title_en)
    canonical_en = f"{BASE_URL_EN}/start-order/{quote(slug_en)}/"
    canonical_es = f"{BASE_URL}/orden-salida/{quote(slug_es)}/" if slug_es else None
    slug_en_race = race.get("slugEn") or race.get("slug", "")
    crumbs_en = [("Home", f"{BASE_URL_EN}/")]
    if year:
        crumbs_en.append((f"{year} season", f"{BASE_URL_EN}/season/"))
    if slug_en_race:
        crumbs_en.append((f"{name_en} {year}".strip() if year else name_en,
                          f"{BASE_URL_EN}/race/{quote(slug_en_race)}/"))
    if stage_label_en:
        crumbs_en.append((stage_label_en, f"{BASE_URL_EN}/stage/{quote(slug_en)}/"))
    crumbs_en.append(("Start order", None))
    body_en = breadcrumb_html(crumbs_en) + f'<h1>{esc(display_title_en)}</h1><p>{esc(desc_en)}</p>'
    rd_updated_at = rd.get("startOrderImportedAt") or rd.get("updatedAt")
    dir_path = f"en/start-order/{slug_en}"
    os.makedirs(dir_path, exist_ok=True)
    # SEO en CASTELLANO (del dict so_seo); contenido visible en inglés.
    _seo = so_seo.get(slug_es)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page_en(
            _seo["title"] if _seo else title_en,
            _seo["description"] if _seo else desc_en,
            canonical_en,
            es_url=canonical_es,
            og_image=_seo["og_image"] if _seo else og_img_en,
            og_image_alt=_seo["display_title"] if _seo else display_title_en,
            body_html=body_en,
            json_ld_objs=[breadcrumb_list(_seo["crumbs"] if _seo else crumbs_en)],
            container_id="startOrderContent",
            spa_script="/js/orden-salida.js",
            date_modified=rd_updated_at,
        ))
    so_en_count += 1
print(f"  → {so_en_count} start orders EN")

# ── RESULTADOS (UCI in-house) ──
# Una página por (carrera × etapa) con clasificaciones propias
# (race_uci_stages.keepForWeb). El enrutado de js/resultados.js usa el
# slug de la CARRERA + segmento de etapa: /resultados/<slug>/etapa-N/.
# Crear los directorios base aunque no haya filas (git add no debe fallar).
print("Generando páginas OG para resultados...")
os.makedirs("resultados", exist_ok=True)
os.makedirs("en/results", exist_ok=True)
res_stages_raw = supabase_get(
    "race_uci_stages?select=raceId,stageNumber&keepForWeb=eq.true"
)
# Agrupar stageNumbers por carrera (None = clasificación final / un día).
res_real_by_race = {}
for st in (res_stages_raw or []):
    res_real_by_race.setdefault(st.get("raceId"), set()).add(st.get("stageNumber"))

# Adelantar la creación: TODA jornada publicada (no descanso) recibe ya su
# página de resultados, tenga o no clasificación real todavía (decisión
# producto 2026-07-06). Se genera con contenido "aún sin
# disputar" y, en cuanto `race_uci_stages.keepForWeb` aporte datos reales,
# la MISMA URL pasa a servir la clasificación (sin re-crear/mover nada).
res_days_by_race = {}
for _rd in racedays_all:
    _rid = _rd.get("raceId")
    # El descanso no tiene página de resultados. La CANCELADA sí: desde
    # 2026-07-16 su página existe y muestra el aviso de cancelación + las
    # generales arrastradas de la etapa anterior (js/resultados.js), así
    # que es contenido real, no un placeholder de algo que nunca llegará.
    if not _rid or _rd.get("isRestDay"):
        continue
    _rf = race_map.get(_rid, {}).get("raceFormat")
    _sn = None if _rf == "one_day" else _rd.get("stageNumber")
    if _rf != "one_day" and _sn is None:
        continue
    res_days_by_race.setdefault(_rid, set()).add(_sn)
res_by_race = {
    rid: res_real_by_race.get(rid, set()) | res_days_by_race.get(rid, set())
    for rid in set(res_real_by_race) | set(res_days_by_race)
}
print(f"  → {len(res_by_race)} carreras con página de resultados "
      f"({len(res_real_by_race)} con clasificación real)")

# Índice (raceId, stageNumber) → race_day para enriquecer la descripción
# de resultados con ruta, km y fecha de la jornada. `racedays_all` ya está
# en memoria. Para carreras de un día, la jornada única se indexa también
# bajo raceId (la clasificación llega con stageNumber=None).
rd_by_race_stage = {}
rd_oneday_by_race = {}
for _rd in racedays_all:
    _rid = _rd.get("raceId")
    if not _rid:
        continue
    rd_by_race_stage[(_rid, _rd.get("stageNumber"))] = _rd
    _rf = race_map.get(_rid, {}).get("raceFormat")
    if _rf == "one_day" and not _rd.get("isRestDay"):
        rd_oneday_by_race[_rid] = _rd

def _res_seg_es(n):
    if n == 0: return "prologo"
    if n is not None: return f"etapa-{n}"
    return ""
def _res_seg_en(n):
    if n == 0: return "prologue"
    if n is not None: return f"stage-{n}"
    return ""
def _res_stage_label_es(n):
    if n == 0: return "Prólogo"
    if n is not None: return f"Etapa {n}"
    return "Clasificación final"
def _res_stage_label_en(n):
    if n == 0: return "Prologue"
    if n is not None: return f"Stage {n}"
    return "Final classification"

# Ruta «A > B» + «N km» de un race_day (o '' si no hay datos).
def _res_route_km(_rd):
    if not _rd:
        return "", ""
    s = _rd.get("startLocation") or ""
    f_ = _rd.get("finishLocation") or ""
    route = s if (not f_ or s == f_) else f"{s} > {f_}"
    kv = _rd.get("distanceKm")
    km = f"{f'{kv:g}'.replace('.', ',')} km" if kv else ""
    return route, km

res_count = 0
res_en_count = 0
for race_id, stage_set in res_by_race.items():
    race = race_map.get(race_id, {})
    slug_es = race.get("slug")
    slug_en = race.get("slugEn")
    year = race.get("year", "")
    name_es = race.get("name", "")
    name_en = race.get("nameEn") or name_es
    race_slug_es = slug_es or ""
    race_slug_en = race.get("slugEn") or slug_es or ""
    hero_es = f"{name_es} {year}".strip()
    hero_en = f"{name_en} {year}".strip()
    is_one_day_res = race.get("raceFormat") == "one_day"
    res_de_art = "del" if articulo_nombre(name_es) == "el" else "de la"
    og_image = og_image_url(race.get("logoUrl"), f"Resultados — {hero_es}")
    for stage_num in sorted(stage_set, key=lambda x: (x is None, x)):
        # race_day correspondiente: por (raceId, stageNumber); para un día,
        # la clasificación llega con stageNumber=None → jornada única.
        res_rd = rd_by_race_stage.get((race_id, stage_num))
        if res_rd is None and is_one_day_res:
            res_rd = rd_oneday_by_race.get(race_id)
        res_route, res_km = _res_route_km(res_rd)
        res_route_km = ", ".join(p for p in (res_route, res_km) if p)
        res_date = format_weekday_date(res_rd.get("dateKey")) if res_rd and res_rd.get("dateKey") else ""
        res_clasifs = "clasificación de etapa, general, puntos, montaña y jóvenes"
        # Clasificación real (keepForWeb) vs. jornada adelantada sin datos
        # todavía — misma URL en ambos casos, solo cambia el texto SEO.
        has_real = stage_num in res_real_by_race.get(race_id, set())
        # Etapa CANCELADA: no habrá clasificación oficial nunca. Su página
        # existe (aviso + generales arrastradas de la etapa anterior), pero
        # NO puede prometer "vuelve tras la etapa".
        res_cancelled = bool(res_rd and res_rd.get("isCancelledDay"))
        # Prólogo/etapa Nª (con y sin artículo) — una sola vez para las 4
        # combinaciones ES/EN × real/placeholder que lo usan más abajo.
        et_ord_bare = "prólogo" if stage_num == 0 else (f"{stage_num}ª etapa" if stage_num is not None else None)
        et_ord_art = "el prólogo" if stage_num == 0 else (f"la {stage_num}ª etapa" if stage_num is not None else None)
        et_art = "del" if stage_num == 0 else "de la"
        et_ord_en = ("the prologue" if stage_num == 0 else f"stage {stage_num}") if stage_num is not None else None
        # ── ES ──
        if slug_es:
            seg = _res_seg_es(stage_num)
            res_stage_label = _res_stage_label_es(stage_num)
            display_title = f"Resultados — {hero_es} · {res_stage_label}"
            title = f"{display_title} — Calendario Ciclismo App"
            if res_cancelled:
                # Cancelada: no habrá clasificación. Se dice lo que pasó.
                _et = et_ord_art if stage_num is not None else "la carrera"
                description = f"{_et.capitalize()} {et_art} {hero_es} se canceló" if stage_num is not None \
                    else f"{hero_es}: carrera cancelada"
                description += f" ({res_route_km})" if res_route_km else ""
                description += "."
                if res_date:
                    description += f" {res_date}."
                description += " No hubo clasificación; la general se mantiene como en la etapa anterior."
            elif not has_real:
                # Jornada ya publicada pero sin clasificación volcada todavía.
                if is_one_day_res:
                    description = f"Resultados aún no disponibles {res_de_art} {hero_es}"
                    description += f" ({res_route_km})" if res_route_km else ""
                    description += "."
                    if res_date:
                        description += f" {res_date}."
                    description += " Vuelve tras la carrera para consultar la clasificación oficial."
                elif stage_num is not None:
                    description = f"Resultados aún no disponibles para {et_ord_art} {et_art} {hero_es}"
                    description += f" ({res_route_km})" if res_route_km else ""
                    description += "."
                    if res_date:
                        description += f" {res_date}."
                    description += " Vuelve tras la etapa para consultar la clasificación oficial."
                else:
                    # No debería alcanzarse: stage_num=None solo llega vía
                    # res_real_by_race (final GC real), nunca se sintetiza
                    # desde race_days.
                    description = f"Clasificación final {res_de_art} {hero_es} aún no disponible."
            elif is_one_day_res:
                # «Resultados oficiales del Tour de Flandes 2026: Brujas >
                #  Oudenaarde, 253 km. Domingo 5 de abril.»
                description = f"Resultados oficiales {res_de_art} {hero_es}"
                description += f": {res_route_km}." if res_route_km else "."
                if res_date:
                    description += f" {res_date}."
            elif stage_num is not None:
                # «Resultados oficiales de la 4ª etapa de la Vuelta a Suiza
                #  2026 (Bad Ragaz > Villars, 153 km): clasificación de
                #  etapa, general, puntos, montaña y jóvenes. Sábado 20 de junio.»
                description = f"Resultados oficiales {et_art} {et_ord_bare} {res_de_art} {hero_es}"
                if res_route_km:
                    description += f" ({res_route_km})"
                description += f": {res_clasifs}."
                if res_date:
                    description += f" {res_date}."
            else:
                # Clasificación final de una vuelta por etapas.
                description = (f"Clasificación final {res_de_art} {hero_es}: "
                               "general, puntos, montaña, jóvenes y equipos.")
            canonical = f"{BASE_URL}/resultados/{quote(slug_es)}/" + (f"{seg}/" if seg else "")
            crumbs = [
                ("Inicio", f"{BASE_URL}/"),
                (f"Temporada {year}" if year else "Temporada",
                 f"{BASE_URL}/calendario.html" + (f"?year={year}" if year else "")),
            ]
            if race_slug_es:
                crumbs.append((hero_es if year else name_es,
                               f"{BASE_URL}/competicion/{quote(race_slug_es)}/"))
            crumbs.append(("Resultados", None))
            body = start_order_body(display_title, description, crumbs)
            dir_path = f"resultados/{slug_es}" + (f"/{seg}" if seg else "")
            os.makedirs(dir_path, exist_ok=True)
            with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
                f.write(og_page(title, description, canonical, og_image,
                                og_image_alt=display_title,
                                body_html=body,
                                json_ld_objs=[breadcrumb_list(crumbs)],
                                container_id="resultsContent",
                                spa_script="/js/resultados.js"))
            res_count += 1
        # ── EN ──
        if slug_en:
            seg_en = _res_seg_en(stage_num)
            stage_label_en = _res_stage_label_en(stage_num)
            display_title_en = f"Results — {hero_en} · {stage_label_en}"
            title_en = f"{display_title_en} — Calendario Ciclismo"
            # Ruta/km/fecha EN del mismo race_day (res_rd).
            if res_rd:
                _se = res_rd.get("startLocationEn") or res_rd.get("startLocation") or ""
                _fe = res_rd.get("finishLocationEn") or res_rd.get("finishLocation") or ""
                _re = _se if (not _fe or _se == _fe) else f"{_se} > {_fe}"
                _kve = res_rd.get("distanceKm")
                _kme = f"{f'{_kve:g}'} km" if _kve else ""
                res_route_km_en = ", ".join(p for p in (_re, _kme) if p)
                res_date_en = format_weekday_date_en(res_rd.get("dateKey")) if res_rd.get("dateKey") else ""
            else:
                res_route_km_en = ""
                res_date_en = ""
            res_clasifs_en = "stage classification, GC, points, KOM and youth"
            if res_cancelled:
                # Cancelada: no habrá clasificación (ver rama ES).
                desc_en = (f"{et_ord_en.capitalize()} of the {hero_en} was cancelled"
                           if stage_num is not None else f"The {hero_en} was cancelled")
                desc_en += f" ({res_route_km_en})" if res_route_km_en else ""
                desc_en += "."
                if res_date_en:
                    desc_en += f" {res_date_en}."
                desc_en += " There was no classification; the GC stands as after the previous stage."
            elif not has_real:
                if is_one_day_res:
                    desc_en = f"Results not yet available for the {hero_en}"
                    desc_en += f" ({res_route_km_en})" if res_route_km_en else ""
                    desc_en += "."
                    if res_date_en:
                        desc_en += f" {res_date_en}."
                    desc_en += " Check back after the race for the official classification."
                elif stage_num is not None:
                    desc_en = f"Results not yet available for {et_ord_en} of the {hero_en}"
                    desc_en += f" ({res_route_km_en})" if res_route_km_en else ""
                    desc_en += "."
                    if res_date_en:
                        desc_en += f" {res_date_en}."
                    desc_en += " Check back after the stage for the official classification."
                else:
                    desc_en = f"Final classification of the {hero_en} not yet available."
            elif is_one_day_res:
                # «Official results for the Tour of Flanders 2026: Bruges >
                #  Oudenaarde, 253 km. Sunday 5 April.»
                desc_en = f"Official results for the {hero_en}"
                desc_en += f": {res_route_km_en}." if res_route_km_en else "."
                if res_date_en:
                    desc_en += f" {res_date_en}."
            elif stage_num is not None:
                desc_en = f"Official results for {et_ord_en} of the {hero_en}"
                if res_route_km_en:
                    desc_en += f" ({res_route_km_en})"
                desc_en += f": {res_clasifs_en}."
                if res_date_en:
                    desc_en += f" {res_date_en}."
            else:
                desc_en = (f"Final classification of the {hero_en}: "
                           "GC, points, KOM, youth and teams.")
            canonical_en = f"{BASE_URL_EN}/results/{quote(slug_en)}/" + (f"{seg_en}/" if seg_en else "")
            canonical_es = (f"{BASE_URL}/resultados/{quote(slug_es)}/" + (f"{_res_seg_es(stage_num)}/" if _res_seg_es(stage_num) else "")) if slug_es else None
            crumbs_en = [("Home", f"{BASE_URL_EN}/")]
            if year:
                crumbs_en.append((f"{year} season", f"{BASE_URL_EN}/season/"))
            if race_slug_en:
                crumbs_en.append((hero_en if year else name_en,
                                  f"{BASE_URL_EN}/race/{quote(race_slug_en)}/"))
            crumbs_en.append(("Results", None))
            body_en = breadcrumb_html(crumbs_en) + f'<h1>{esc(display_title_en)}</h1><p>{esc(desc_en)}</p>'
            dir_path = f"en/results/{slug_en}" + (f"/{seg_en}" if seg_en else "")
            os.makedirs(dir_path, exist_ok=True)
            with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
                # SEO en CASTELLANO (reutiliza title/description/crumbs ES de
                # esta misma iteración, calculados en el bloque `if slug_es`);
                # contenido visible (body_en) en inglés.
                f.write(og_page_en(
                    title, description, canonical_en,
                    es_url=canonical_es,
                    og_image=og_image,
                    og_image_alt=display_title,
                    body_html=body_en,
                    json_ld_objs=[breadcrumb_list(crumbs)],
                    container_id="resultsContent",
                    spa_script="/js/resultados.js"))
            res_en_count += 1
print(f"  → {res_count} resultados ES · {res_en_count} resultados EN")

# ── PERFILES DE ELEVACIÓN ──
print("Generando páginas OG para perfiles de elevación...")
# Crear el directorio aunque no haya filas: el `git add perfil/` posterior
# falla con bash -eo pipefail si la ruta no existe, abortando todo el commit.
os.makedirs("perfil", exist_ok=True)
perfil_rds_raw = supabase_get(
    "race_days?select=id,slug,slugEn,raceId,stageNumber,dateKey,isRestDay,"
    "startLocation,finishLocation,startLocationEn,finishLocationEn,"
    "distanceKm,profileSummits,profileWaypoints,updatedAt"
    "&editorialStatus=eq.published&slug=not.is.null"
    "&elevationProfile=not.is.null"
)
# Filter out not-viewable in Python so the query works even before migration 026
perfil_rds = [rd for rd in perfil_rds_raw if not rd.get("profileNotViewable")]
# SEO ES capturado por slug para reusarlo en las páginas EN (/en/profile).
perfil_seo = {}
perfil_count = 0
for rd in perfil_rds:
    slug = rd.get("slug")
    if not slug:
        continue
    n_summits      = len(rd.get("profileSummits")  or [])
    n_waypoints    = len(rd.get("profileWaypoints") or [])
    n_waypoints_sp = len([w for w in (rd.get("profileWaypoints") or [])
                          if w.get("type") in ("intermediate_sprint","bonus_sprint")])
    # Generamos siempre que haya elevationProfile aunque no existan
    # anotaciones — un prólogo o CRI sin puertos sigue ofreciendo
    # curva, recorrido y horarios.

    race = race_map.get(rd.get("raceId"), {})
    race_name = race.get("name", "")
    race_year = race.get("year", "")
    race_slug = race.get("slug", "")
    is_one_day = race.get("raceFormat") == "one_day"
    stage_num = rd.get("stageNumber")
    start_loc = rd.get("startLocation", "") or ""
    finish_loc = rd.get("finishLocation", "") or ""
    same_or_one = not finish_loc or start_loc == finish_loc
    date_key = rd.get("dateKey", "")
    is_rest = bool(rd.get("isRestDay"))

    sl = stage_label(stage_num) if stage_num is not None else ""
    if is_one_day:
        display_title = f"{race_name}{(' ' + str(race_year)) if race_year else ''}"
    elif sl:
        display_title = f"{race_name} {race_year} · {sl}"
    else:
        display_title = f"{race_name} {race_year}" if race_year else race_name

    title = f"Perfil — {display_title} — Calendario Ciclismo App"
    annot_str = f"{n_summits} puertos" if n_summits else ""
    if n_waypoints_sp:
        annot_str = (annot_str + f", {n_waypoints_sp} sprints") if annot_str else f"{n_waypoints_sp} sprints"

    # «Perfil y recorrido de [la Nª etapa del] X 2026: NNN km con salida
    # en A y meta en B. D de mes de YYYY.» — espejo en js/perfil-pub.js.
    race_title = f"{race_name} {race_year}".strip() if race_year else race_name
    km_val = rd.get("distanceKm")
    km_txt = f"{f'{km_val:g}'.replace('.', ',')} km" if km_val else ""
    if start_loc:
        loc_txt = (f"con inicio y final en {start_loc}" if same_or_one
                   else f"con salida en {start_loc} y meta en {finish_loc}")
    else:
        loc_txt = ""
    sn_desc = None if (is_one_day or is_rest or stage_num is None) else stage_num
    de_art = "del" if articulo_nombre(race_name) == "el" else "de la"
    if sn_desc is None:
        desc_head = f"Perfil y recorrido de {race_title}"
    elif sn_desc == 0:
        desc_head = f"Perfil y recorrido del prólogo {de_art} {race_title}"
    else:
        desc_head = f"Perfil y recorrido de la {sn_desc}ª etapa {de_art} {race_title}"
    desc_tail = " ".join(p for p in (km_txt, loc_txt) if p)
    description = f"{desc_head}: {desc_tail}." if desc_tail else f"{desc_head}."
    if date_key:
        description += f" {format_full_date(date_key)}."

    og_image = og_image_url(race.get("logoUrl"), display_title)
    canonical = f"{BASE_URL}/perfil/{quote(slug)}/"

    crumbs = [("Inicio", f"{BASE_URL}/")]
    if race_year:
        crumbs.append((f"Temporada {race_year}", f"{BASE_URL}/calendario.html?year={race_year}"))
    if race_slug and not is_one_day:
        comp_name = f"{race_name} {race_year}" if race_year else race_name
        crumbs.append((comp_name, f"{BASE_URL}/competicion/{quote(race_slug)}/"))
    jornada_name = display_title if is_one_day else (sl or display_title)
    crumbs.append((jornada_name, f"{BASE_URL}/jornada/{quote(slug)}/"))
    crumbs.append(("Perfil de elevación", None))

    rd_updated_at = (rd.get("updatedAt") or "")[:10] or None

    route_str = start_loc if same_or_one and start_loc else (f"{start_loc} › {finish_loc}" if finish_loc else "")
    km = rd.get("distanceKm")
    parts = []
    if route_str: parts.append(f'<p class="static-meta"><strong>Recorrido:</strong> {esc(route_str)}</p>')
    if km:        parts.append(f'<p class="static-meta"><strong>Distancia:</strong> {esc(str(km).replace(".", ","))} km</p>')
    if annot_str: parts.append(f'<p class="static-meta">{esc(annot_str)}</p>')
    body = breadcrumb_html(crumbs) + f'<h1>{esc(title.replace(" — Calendario Ciclismo App", ""))}</h1>' + ''.join(parts)

    json_ld_list = [breadcrumb_list(crumbs)]
    perfil_seo[slug] = {"title": title, "description": description,
                        "og_image": og_image, "display_title": display_title,
                        "json_ld": json_ld_list}

    dir_path = f"perfil/{slug}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page(title, description, canonical, og_image,
                        og_image_alt=display_title,
                        body_html=body, json_ld_objs=json_ld_list,
                        container_id="perfilEtapaContent",
                        spa_script="/js/perfil-pub.js",
                        main_class="pfe-wrap",
                        date_published=date_key or None,
                        date_modified=rd_updated_at or date_key or None))
    perfil_count += 1

print(f"  → {perfil_count} perfiles")

# ── PÁGINAS DE MAPA DEL RECORRIDO (Leaflet) ────────────────
# Opt-in por jornada: solo las que tienen routeGpxUrl. Gemelas del
# perfil pero con mapa interactivo (spa_script mapa-pub.js).
print("Generando páginas OG para mapas del recorrido...")
os.makedirs("mapa", exist_ok=True)
os.makedirs("en/route-map", exist_ok=True)
mapa_rds = supabase_get(
    "race_days?select=id,slug,slugEn,raceId,stageNumber,dateKey,isRestDay,"
    "startLocation,finishLocation,startLocationEn,finishLocationEn,"
    "distanceKm,profileSummits,profileWaypoints,updatedAt"
    "&editorialStatus=eq.published&slug=not.is.null"
    "&routeGpxUrl=not.is.null"
)
mapa_count = 0
mapa_en_count = 0
for rd in mapa_rds:
    slug = rd.get("slug")
    if not slug:
        continue
    race = race_map.get(rd.get("raceId"), {})
    race_name = race.get("name", "")
    race_year = race.get("year", "")
    race_slug = race.get("slug", "")
    is_one_day = race.get("raceFormat") == "one_day"
    stage_num = rd.get("stageNumber")
    start_loc = rd.get("startLocation", "") or ""
    finish_loc = rd.get("finishLocation", "") or ""
    same_or_one = not finish_loc or start_loc == finish_loc
    date_key = rd.get("dateKey", "")
    is_rest = bool(rd.get("isRestDay"))

    sl = stage_label(stage_num) if stage_num is not None else ""
    if is_one_day:
        display_title = f"{race_name}{(' ' + str(race_year)) if race_year else ''}"
    elif sl:
        display_title = f"{race_name} {race_year} · {sl}"
    else:
        display_title = f"{race_name} {race_year}" if race_year else race_name

    title = f"Mapa del recorrido — {display_title} — Calendario Ciclismo App"

    # «Mapa del recorrido de [la Nª etapa del] X 2026: NNN km con salida
    # en A y meta en B. D de mes de YYYY.» — espejo en js/mapa-pub.js.
    race_title = f"{race_name} {race_year}".strip() if race_year else race_name
    km_val = rd.get("distanceKm")
    km_txt = f"{f'{km_val:g}'.replace('.', ',')} km" if km_val else ""
    if start_loc:
        loc_txt = (f"con inicio y final en {start_loc}" if same_or_one
                   else f"con salida en {start_loc} y meta en {finish_loc}")
    else:
        loc_txt = ""
    sn_desc = None if (is_one_day or is_rest or stage_num is None) else stage_num
    de_art = "del" if articulo_nombre(race_name) == "el" else "de la"
    if sn_desc is None:
        desc_head = f"Mapa del recorrido de {race_title}"
    elif sn_desc == 0:
        desc_head = f"Mapa del recorrido del prólogo {de_art} {race_title}"
    else:
        desc_head = f"Mapa del recorrido de la {sn_desc}ª etapa {de_art} {race_title}"
    desc_tail = " ".join(p for p in (km_txt, loc_txt) if p)
    description = f"{desc_head}: {desc_tail}." if desc_tail else f"{desc_head}."
    if date_key:
        description += f" {format_full_date(date_key)}."

    og_image = og_image_url(race.get("logoUrl"), display_title)
    canonical = f"{BASE_URL}/mapa/{quote(slug)}/"

    crumbs = [("Inicio", f"{BASE_URL}/")]
    if race_year:
        crumbs.append((f"Temporada {race_year}", f"{BASE_URL}/calendario.html?year={race_year}"))
    if race_slug and not is_one_day:
        comp_name = f"{race_name} {race_year}" if race_year else race_name
        crumbs.append((comp_name, f"{BASE_URL}/competicion/{quote(race_slug)}/"))
    jornada_name = display_title if is_one_day else (sl or display_title)
    crumbs.append((jornada_name, f"{BASE_URL}/jornada/{quote(slug)}/"))
    crumbs.append(("Mapa del recorrido", None))

    rd_updated_at = (rd.get("updatedAt") or "")[:10] or None
    route_str = start_loc if same_or_one and start_loc else (f"{start_loc} › {finish_loc}" if finish_loc else "")
    parts = []
    if route_str: parts.append(f'<p class="static-meta"><strong>Recorrido:</strong> {esc(route_str)}</p>')
    if km_txt:    parts.append(f'<p class="static-meta"><strong>Distancia:</strong> {esc(km_txt)}</p>')
    body = breadcrumb_html(crumbs) + f'<h1>{esc(title.replace(" — Calendario Ciclismo App", ""))}</h1>' + ''.join(parts)

    dir_path = f"mapa/{slug}"
    os.makedirs(dir_path, exist_ok=True)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page(title, description, canonical, og_image,
                        og_image_alt=display_title,
                        body_html=body, json_ld_objs=[breadcrumb_list(crumbs)],
                        container_id="mapaEtapaContent",
                        spa_script="/js/mapa-pub.js",
                        main_class="pfe-wrap",
                        head_extra=LEAFLET_HEAD,
                        date_published=date_key or None,
                        date_modified=rd_updated_at or date_key or None))
    mapa_count += 1

    # EN
    slug_en = rd.get("slugEn") or slug
    name_en = race.get("nameEn") or race_name
    if slug_en and name_en:
        year = race_year
        sn = stage_num
        stage_label_en = "Prologue" if sn == 0 else (f"Stage {sn}" if sn is not None else "")
        title_en_base = f"{name_en} {year}".strip() if year else name_en
        display_title_en = (f"{title_en_base} · {stage_label_en}"
                            if stage_label_en and not is_one_day else title_en_base)
        start_loc_en  = rd.get("startLocationEn") or start_loc
        finish_loc_en = rd.get("finishLocationEn") or finish_loc
        circuit_en = not finish_loc_en or start_loc_en == finish_loc_en
        km_txt_en = f"{km_val:g} km" if km_val else ""
        if start_loc_en:
            loc_txt_en = (f"starting and finishing in {start_loc_en}" if circuit_en
                          else f"from {start_loc_en} to {finish_loc_en}")
        else:
            loc_txt_en = ""
        if sn_desc is None:
            desc_head_en = f"Route map of {title_en_base}"
        elif sn_desc == 0:
            desc_head_en = f"Route map of the prologue of {title_en_base}"
        else:
            desc_head_en = f"Route map of stage {sn_desc} of {title_en_base}"
        desc_tail_en = " ".join(p for p in (km_txt_en, loc_txt_en) if p)
        desc_en = f"{desc_head_en}: {desc_tail_en}." if desc_tail_en else f"{desc_head_en}."
        if date_key:
            desc_en += f" {format_full_date_en(date_key)}."
        canonical_en = f"{BASE_URL_EN}/route-map/{quote(slug_en)}/"
        canonical_es = f"{BASE_URL}/mapa/{quote(slug)}/"
        dir_path_en = f"en/route-map/{slug_en}"
        os.makedirs(dir_path_en, exist_ok=True)
        with open(f"{dir_path_en}/index.html", "w", encoding="utf-8") as f:
            # SEO en CASTELLANO (reutiliza title/description/og_image ES de
            # esta misma iteración); la página EN sigue cargando mapa-pub.js.
            f.write(og_page_en(
                title,
                description, canonical_en,
                es_url=canonical_es,
                og_image=og_image,
                og_image_alt=display_title,
                json_ld_objs=[breadcrumb_list(crumbs)],
                container_id="mapaEtapaContent",
                spa_script="/js/mapa-pub.js",
                main_class="pfe-wrap",
                head_extra=LEAFLET_HEAD,
                date_published=date_key or None,
                date_modified=rd_updated_at or date_key or None))
        mapa_en_count += 1

print(f"  → {mapa_count} mapas ES, {mapa_en_count} mapas EN")

# ── PÁGINAS EN ─────────────────────────────────────────────
print("Generando páginas EN...")
os.makedirs("en/race", exist_ok=True)
os.makedirs("en/stage", exist_ok=True)
os.makedirs("en/startlist", exist_ok=True)
os.makedirs("en/profile", exist_ok=True)

en_count = 0

# EN — competiciones
for race in races:
    slug_en = race.get("slugEn")
    name_en = race.get("nameEn") or race.get("name") or ""
    if not slug_en or not name_en:
        continue
    slug_es  = race.get("slug", "")
    year     = race.get("year") or ""
    canonical_en = f"{BASE_URL_EN}/race/{quote(slug_en)}/"
    canonical_es = f"{BASE_URL}/competicion/{quote(slug_es)}/" if slug_es else None
    start = race.get("startDate") or ""
    end   = race.get("endDate") or ""
    title_en = f"{name_en} {year}".strip() if year else name_en
    cancelled_en = bool(race.get("isCancelled"))
    if start and end and start != end:
        desc_en = f"{title_en} takes place from {start} to {end}. Schedule, stages and broadcast guide."
    else:
        desc_en = f"Schedule, results and broadcast guide for {title_en}."
    og_img_en = og_image_url(race.get("logoUrl") or "", title_en)
    country_en = (race.get("countryCode") or "").upper() or None
    race_updated_en = (race.get("updatedAt") or "")[:10] or None

    crumbs_en = [
        ("Home", f"{BASE_URL_EN}/"),
        (f"{year} season" if year else "Season", f"{BASE_URL_EN}/season/"),
        (title_en, None),
    ]

    race_stages_en = stages_by_race.get(race.get("id"), [])
    representative_stage_en = next(
        (s for s in race_stages_en
         if not s.get("isRestDay") and s.get("dateKey")
         and (s.get("startLocationEn") or s.get("startLocation")
              or s.get("finishLocationEn") or s.get("finishLocation"))),
        None,
    )
    representative_location_en = (
        (representative_stage_en or {}).get("startLocationEn")
        or (representative_stage_en or {}).get("startLocation")
        or (representative_stage_en or {}).get("finishLocationEn")
        or (representative_stage_en or {}).get("finishLocation")
        or None
    )
    representative_country_en = (
        ((representative_stage_en or {}).get("countryCode")
         or race.get("countryCode") or "").upper() or None
    )
    il_items_en = []
    pos_en = 0
    for _s in race_stages_en:
        if _s.get("isRestDay"): continue
        pos_en += 1
        sn_s = _s.get("stageNumber")
        slen = "Prologue" if sn_s == 0 else (f"Stage {sn_s}" if sn_s is not None else f"Stage {pos_en}")
        s_start_en = _s.get("startLocationEn") or _s.get("startLocation") or ""
        s_finish_en = _s.get("finishLocationEn") or _s.get("finishLocation") or ""
        route_s = s_start_en if (not s_finish_en or s_start_en == s_finish_en) else f"{s_start_en} – {s_finish_en}"
        item_name_en = f"{slen}: {route_s}" if route_s else slen
        s_slug_en = _s.get("slugEn") or _s.get("slug", "")
        if s_slug_en:
            il_items_en.append((pos_en, item_name_en, f"{BASE_URL_EN}/stage/{quote(s_slug_en)}/"))

    competition_event_en = sports_event(
            name=title_en,
            start_date=start or (representative_stage_en or {}).get("dateKey") or None,
            end_date=end or start or (representative_stage_en or {}).get("dateKey") or None,
            url=canonical_en,
            description=desc_en,
            image=og_img_en,
            location_name=representative_location_en,
            location_country=representative_country_en or country_en,
            cancelled=cancelled_en,
            date_published=start or None,
            date_modified=race_updated_en or end or start or None,
            organizer_url=race.get("websiteUrl") or None,
        )
    json_ld_en = [obj for obj in (competition_event_en, breadcrumb_list(crumbs_en)) if obj]
    if il_items_en and len(race_stages_en) > 1:
        json_ld_en.insert(1, item_list(f"Stages of {title_en}", il_items_en))

    # Body HTML EN
    body_parts_en = [breadcrumb_html(crumbs_en)]
    body_parts_en.append(f'<h1>{esc(title_en)}</h1>')
    if start and end and start != end:
        body_parts_en.append(f'<p class="static-date">{esc(start)} – {esc(end)}</p>')
    elif start or end:
        body_parts_en.append(f'<p class="static-date">{esc(start or end)}</p>')
    body_parts_en.append(f'<p>{esc(desc_en)}</p>')
    if race_stages_en and len(race_stages_en) > 1:
        stage_items_en = []
        for _s in race_stages_en:
            sn_s = _s.get("stageNumber")
            slen = "Prologue" if sn_s == 0 else (f"Stage {sn_s}" if sn_s is not None else "Stage")
            s_start_en = _s.get("startLocationEn") or _s.get("startLocation") or ""
            s_finish_en = _s.get("finishLocationEn") or _s.get("finishLocation") or ""
            route_s = s_start_en if (not s_finish_en or s_start_en == s_finish_en) else f"{s_start_en} › {s_finish_en}"
            km_s = _s.get("distanceKm")
            km_part_s = f" · {km_s} km" if km_s else ""
            text_s = f"{slen}: {route_s}{km_part_s}" if route_s else slen
            s_slug_en = _s.get("slugEn") or _s.get("slug", "")
            if _s.get("isRestDay"):
                stage_items_en.append(f'<li class="static-rest">{esc(slen)}: Rest day</li>')
            elif s_slug_en:
                stage_items_en.append(f'<li><a href="{BASE_URL_EN}/stage/{quote(s_slug_en)}/">{esc(text_s)}</a></li>')
            else:
                stage_items_en.append(f'<li>{esc(text_s)}</li>')
        body_parts_en.append(f'<h2>Stages</h2><ul class="static-stage-list">{"".join(stage_items_en)}</ul>')
    body_en = ''.join(body_parts_en)

    dir_path = f"en/race/{slug_en}"
    os.makedirs(dir_path, exist_ok=True)
    # SEO en CASTELLANO (del dict comp_seo); contenido visible en inglés.
    _seo = comp_seo.get(race.get("id"))
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page_en(
            _seo["title"] if _seo else title_en,
            _seo["description"] if _seo else desc_en,
            canonical_en,
            es_url=canonical_es,
            og_image=_seo["og_image"] if _seo else og_img_en,
            og_image_alt=_seo["display_title"] if _seo else title_en,
            body_html=body_en,
            json_ld_objs=_seo["json_ld"] if _seo else json_ld_en,
            spa_script="/js/competicion.js",
            container_id="competicionContent",
            date_published=start or None,
            date_modified=race_updated_en or end or start or None,
        ))
    en_count += 1

# EN — jornadas
_STAGE_TYPE_EN = {
    "mountain": "Mountain", "flat": "Flat", "hilly": "Hilly",
    "itt": "ITT", "ttt": "TTT", "semi_classic": "Semi-classic",
    "one_day_race": "Classic", "prologue": "Prologue",
}
for rd in racedays:
    slug_en = rd.get("slugEn")
    if not slug_en:
        continue
    race   = race_map.get(rd.get("raceId") or "", {})
    name_en = race.get("nameEn") or race.get("name") or ""
    if not name_en:
        continue
    slug_es = rd.get("slug", "")
    slug_en_race = race.get("slugEn") or race.get("slug") or ""
    is_one_day_en = race.get("raceFormat") == "one_day"
    is_rest_en    = bool(rd.get("isRestDay"))
    is_cancelled_en = bool(rd.get("isCancelledDay")) or bool(race.get("isCancelled"))
    year_en = race.get("year") or ""
    canonical_en = f"{BASE_URL_EN}/stage/{quote(slug_en)}/"
    canonical_es = f"{BASE_URL}/jornada/{quote(slug_es)}/" if slug_es else None
    tr_en   = (rd.get("translations") or {}).get("en", {})
    desc_en_val = tr_en.get("description", {}).get("value") if isinstance(tr_en.get("description"), dict) else None
    sn = rd.get("stageNumber")
    stage_label_en = "Prologue" if sn == 0 else (f"Stage {sn}" if sn else "")
    date_key_en = rd.get("dateKey", "")
    start_en = rd.get("startLocationEn") or rd.get("startLocation") or ""
    finish_en = rd.get("finishLocationEn") or rd.get("finishLocation") or ""
    same_en = not finish_en or start_en == finish_en
    km_en = rd.get("distanceKm")
    km_txt_en = str(km_en) + " km" if km_en else ""
    route_en = start_en if same_en else f"{start_en} › {finish_en}"

    # Build title
    base_title_en = f"{name_en} {year_en}".strip() if year_en else name_en
    if is_rest_en:
        title_en = f"{base_title_en}, {stage_label_en or 'Rest day'}: Rest day"
    elif is_one_day_en:
        tail_en = " · ".join([x for x in [route_en if route_en else "", km_txt_en] if x])
        title_en = f"{base_title_en}" + (f": {tail_en}" if tail_en else "")
    else:
        title_en = f"{name_en} — {stage_label_en}".rstrip("— ").strip() if stage_label_en else name_en
        if start_en and finish_en and start_en != finish_en:
            title_en += f" · {start_en} › {finish_en}"
        elif finish_en:
            title_en += f" · {finish_en}"

    # Build description
    if is_rest_en:
        desc_en = f"Rest day of {name_en} {year_en}.".strip()
    elif is_one_day_en:
        route_part = f", from {start_en} to {finish_en}" if start_en and finish_en and start_en != finish_en else (f", finishing in {finish_en}" if finish_en else "")
        km_part = f", {km_txt_en}" if km_txt_en else ""
        desc_en = desc_en_val or f"{name_en} {year_en}{route_part}{km_part}. Schedule, broadcast info and route details.".strip()
    else:
        route_part = f" from {start_en} to {finish_en}" if start_en and finish_en and start_en != finish_en else ""
        km_part = f" ({km_txt_en})" if km_txt_en else ""
        desc_en = desc_en_val or f"{stage_label_en or 'Stage'} of {name_en}{route_part}{km_part}. Schedule, broadcast info and route details."

    # Fecha al final con día de la semana en mayúscula (paridad con ES).
    # Solo en descripciones auto-generadas (no si hay override de traducción)
    # ni en jornadas de descanso (que ya nombran la fecha si procede).
    if not is_rest_en and not desc_en_val and date_key_en:
        _wd_en = format_weekday_full_date_en(date_key_en)
        if _wd_en:
            desc_en += f" {_wd_en}."

    og_img_en = og_image_url(race.get("logoUrl") or "", name_en)

    # Breadcrumbs EN
    crumbs_en = [("Home", f"{BASE_URL_EN}/")]
    if year_en:
        crumbs_en.append((f"{year_en} season", f"{BASE_URL_EN}/season/"))
    if slug_en_race and not is_one_day_en:
        comp_name_en = f"{name_en} {year_en}".strip() if year_en else name_en
        crumbs_en.append((comp_name_en, f"{BASE_URL_EN}/race/{quote(slug_en_race)}/"))
    if is_one_day_en:
        crumbs_en.append((title_en.split(":")[0].strip(), None))
    else:
        crumbs_en.append((stage_label_en or title_en, None))

    # JSON-LD EN
    json_ld_list_en = []
    if not is_rest_en:
        location_name_en = None
        if same_en and start_en:
            location_name_en = start_en
        elif start_en and finish_en:
            location_name_en = f"{start_en} → {finish_en}"
        elif start_en:
            location_name_en = start_en
        rd_country_en = (rd.get("countryCode") or race.get("countryCode") or "").upper() or None
        og_title_en = f"{name_en} {year_en}".strip() if is_one_day_en and year_en else title_en
        stage_event_en = sports_event(
            name=og_title_en,
            start_date=date_key_en or None,
            end_date=date_key_en or None,
            url=canonical_en,
            description=desc_en,
            image=og_img_en,
            location_name=location_name_en,
            location_country=rd_country_en,
            cancelled=is_cancelled_en,
        )
        if stage_event_en:
            json_ld_list_en.append(stage_event_en)
    json_ld_list_en.append(breadcrumb_list(crumbs_en))

    # Body HTML EN (pre-render with H1 and breadcrumbs)
    has_perfil_en = bool(rd.get("elevationProfile")) and not rd.get("profileNotViewable")
    slug_en_for_perfil = rd.get("slugEn") or slug_es
    perfil_url_en = f"{BASE_URL_EN}/profile/{quote(slug_en_for_perfil)}/" if has_perfil_en and not is_rest_en and slug_en_for_perfil else None
    parts_en = []
    if route_en: parts_en.append(f'<p class="static-meta"><strong>Route:</strong> {esc(route_en)}</p>')
    if km_txt_en: parts_en.append(f'<p class="static-meta"><strong>Distance:</strong> {esc(km_txt_en)}</p>')
    if date_key_en: parts_en.append(f'<p class="static-meta"><strong>Date:</strong> {esc(date_key_en)}</p>')
    if perfil_url_en: parts_en.append(f'<p class="static-meta"><a href="{esc(perfil_url_en)}">View elevation profile</a></p>')
    h1_en = f"{name_en} {year_en}".strip() if year_en else name_en
    body_en = breadcrumb_html(crumbs_en) + f'<h1>{esc(h1_en)}</h1>' + ''.join(parts_en)

    rd_updated_en = (rd.get("updatedAt") or "")[:10] or None
    dir_path = f"en/stage/{slug_en}"
    os.makedirs(dir_path, exist_ok=True)
    # SEO en CASTELLANO (del dict jornada_seo); contenido visible en inglés.
    _seo = jornada_seo.get(slug_es)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page_en(
            _seo["title"] if _seo else title_en,
            _seo["description"] if _seo else desc_en,
            canonical_en,
            es_url=canonical_es,
            og_image=_seo["og_image"] if _seo else og_img_en,
            og_image_alt=_seo["og_title"] if _seo else title_en,
            body_html=body_en,
            json_ld_objs=_seo["json_ld"] if _seo else json_ld_list_en,
            spa_script="/js/jornada.js",
            container_id="jornadaContent",
            date_published=date_key_en or None,
            date_modified=rd_updated_en or date_key_en or None,
        ))
    en_count += 1

# EN — inscritos
for race in races:
    slug_en = race.get("slugEn")
    name_en = race.get("nameEn") or race.get("name") or ""
    if not slug_en or not name_en:
        continue
    slug_es = race.get("slug", "")
    year = race.get("year") or ""
    canonical_en = f"{BASE_URL_EN}/startlist/{quote(slug_en)}/"
    canonical_es = f"{BASE_URL}/inscritos/{quote(slug_es)}/" if slug_es else None
    title_en = f"{name_en} {year} — Startlist".strip()
    desc_en  = f"Full startlist for {name_en} {year}.".strip()
    og_img_sl = og_image_url(race.get("logoUrl") or "", name_en)
    crumbs_sl = [
        ("Home", f"{BASE_URL_EN}/"),
        (f"{year} season" if year else "Season", f"{BASE_URL_EN}/season/"),
        (f"{name_en} {year}".strip(), f"{BASE_URL_EN}/race/{quote(slug_en)}/"),
        ("Startlist", None),
    ]
    body_sl = breadcrumb_html(crumbs_sl) + f'<h1>{esc(title_en)}</h1><p>{esc(desc_en)}</p>'
    dir_path = f"en/startlist/{slug_en}"
    os.makedirs(dir_path, exist_ok=True)
    # SEO en CASTELLANO (del dict inscritos_seo); contenido visible en inglés.
    # ⚠️ NO "arreglar" esto traduciendo el title/description: es DELIBERADO y por
    # SEO (decisión de Dani, reconfirmada el 2026-07-18). El desc_en de arriba
    # queda solo como respaldo para carreras sin entrada en inscritos_seo.
    _seo = inscritos_seo.get(race.get("id"))
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page_en(
            _seo["title"] if _seo else title_en,
            _seo["description"] if _seo else desc_en,
            canonical_en,
            es_url=canonical_es,
            og_image=_seo["og_image"] if _seo else og_img_sl,
            og_image_alt=_seo["display_title"] if _seo else title_en,
            body_html=body_sl,
            json_ld_objs=_seo["json_ld"] if _seo else [breadcrumb_list(crumbs_sl)],
            spa_script="/js/inscritos.js",
            container_id="startlistContent",
        ))
    en_count += 1

# EN — perfiles de elevación
en_perfil_count = 0
for rd in perfil_rds:
    slug_es  = rd.get("slug")
    slug_en  = rd.get("slugEn") or slug_es
    if not slug_en:
        continue
    race = race_map.get(rd.get("raceId"), {})
    name_en = race.get("nameEn") or race.get("name") or ""
    if not name_en:
        continue
    year     = race.get("year") or ""
    slug_en_race = race.get("slugEn") or race.get("slug") or ""
    is_one_day = race.get("raceFormat") == "one_day"
    sn = rd.get("stageNumber")
    stage_label_en = "Prologue" if sn == 0 else (f"Stage {sn}" if sn is not None else "")
    title_en = f"{name_en} {year}".strip() if year else name_en
    if stage_label_en and not is_one_day:
        display_title_en = f"{title_en} · {stage_label_en}"
    else:
        display_title_en = title_en

    # «Profile and route of [stage N of] X 2026: NNN km from A to B.
    # D Month YYYY.» — espejo en js/perfil-pub.js.
    start_loc_en  = rd.get("startLocationEn") or rd.get("startLocation") or ""
    finish_loc_en = rd.get("finishLocationEn") or rd.get("finishLocation") or ""
    circuit_en = not finish_loc_en or start_loc_en == finish_loc_en
    km_val = rd.get("distanceKm")
    km_txt_en = f"{km_val:g} km" if km_val else ""
    if start_loc_en:
        loc_txt_en = (f"starting and finishing in {start_loc_en}" if circuit_en
                      else f"from {start_loc_en} to {finish_loc_en}")
    else:
        loc_txt_en = ""
    sn_desc = None if (is_one_day or rd.get("isRestDay") or sn is None) else sn
    if sn_desc is None:
        desc_head_en = f"Profile and route of {title_en}"
    elif sn_desc == 0:
        desc_head_en = f"Profile and route of the prologue of {title_en}"
    else:
        desc_head_en = f"Profile and route of stage {sn_desc} of {title_en}"
    desc_tail_en = " ".join(p for p in (km_txt_en, loc_txt_en) if p)
    desc_en = f"{desc_head_en}: {desc_tail_en}." if desc_tail_en else f"{desc_head_en}."
    date_key_en = rd.get("dateKey") or ""
    if date_key_en:
        desc_en += f" {format_full_date_en(date_key_en)}."

    canonical_en = f"{BASE_URL_EN}/profile/{quote(slug_en)}/"
    canonical_es = f"{BASE_URL}/perfil/{quote(slug_es)}/" if slug_es else None

    dir_path = f"en/profile/{slug_en}"
    os.makedirs(dir_path, exist_ok=True)
    # SEO en CASTELLANO (del dict perfil_seo); contenido visible en inglés.
    _seo = perfil_seo.get(slug_es)
    with open(f"{dir_path}/index.html", "w", encoding="utf-8") as f:
        f.write(og_page_en(
            _seo["title"] if _seo else f"Profile — {display_title_en} — Calendario Ciclismo",
            _seo["description"] if _seo else desc_en,
            canonical_en,
            es_url=canonical_es,
            og_image=_seo["og_image"] if _seo else og_image_url(race.get("logoUrl") or "", name_en),
            og_image_alt=_seo["display_title"] if _seo else display_title_en,
            json_ld_objs=_seo["json_ld"] if _seo else None,
            container_id="perfilEtapaContent",
            spa_script="/js/perfil-pub.js",
            main_class="pfe-wrap",
        ))
    en_perfil_count += 1

en_count += en_perfil_count + so_en_count
print(f"  → {en_count} páginas EN ({en_perfil_count} profiles, {so_en_count} start orders)")
print(f"Total: {race_count + day_count + inscritos_count + so_count + perfil_count + so_en_count} páginas OG generadas")
