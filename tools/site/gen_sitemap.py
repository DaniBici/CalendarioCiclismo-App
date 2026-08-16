import json, os, re, unicodedata
from urllib.request import Request, urlopen
from urllib.parse import quote
from datetime import datetime, timezone, timedelta, date as dt_date

SUPABASE_URL = "https://bcecwlkynpgovnzhbpah.supabase.co"
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
BASE_URL = "https://calendariociclismo.app"

if not ANON_KEY:
    raise SystemExit("Falta SUPABASE_ANON_KEY en secretos del repositorio.")

def supabase_get(path):
    # PostgREST limita cada respuesta a 1000 filas. Paginamos con el header
    # Range hasta agotar resultados (una página corta = fin). Sin esto, las
    # consultas grandes (race_days ya supera las 1000 publicadas) se truncaban
    # y faltaban URLs en el sitemap.
    PAGE = 1000
    all_rows = []
    offset = 0
    while True:
        req = Request(f"{SUPABASE_URL}/rest/v1/{path}")
        req.add_header("apikey", ANON_KEY)
        req.add_header("Authorization", f"Bearer {ANON_KEY}")
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{offset}-{offset + PAGE - 1}")
        with urlopen(req) as res:
            chunk = json.loads(res.read())
        if not isinstance(chunk, list):
            return chunk
        all_rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return all_rows

def esc(s):
    if not s: return ""
    return str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;").replace("'","&#39;")

def sitemap_entry(loc, lastmod, changefreq, priority, en_url=None):
    hreflang = ""
    if en_url:
        hreflang = (
            f'    <xhtml:link rel="alternate" hreflang="es" href="{esc(loc)}"/>\n'
            f'    <xhtml:link rel="alternate" hreflang="en" href="{esc(en_url)}"/>\n'
            f'    <xhtml:link rel="alternate" hreflang="x-default" href="{esc(loc)}"/>\n'
        )
    return (f"  <url>\n"
            f"    <loc>{esc(loc)}</loc>\n"
            f"{hreflang}"
            f"    <lastmod>{lastmod}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"  </url>")

OG_WORKER_URL = "https://og.calendariociclismo.app"
DEFAULT_OG_IMAGE = "https://assets.calendariociclismo.app/og-default.png"

def og_image_url(logo_url, title=""):
    from urllib.parse import quote as _q
    if not logo_url or not logo_url.startswith("http"):
        return DEFAULT_OG_IMAGE
    url = f"{OG_WORKER_URL}/?logo={_q(logo_url, safe='')}"
    if title:
        url += f"&title={_q(title, safe='')}"
    return url

today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
today_d = dt_date.today()

def parse_yyyy_mm_dd(s):
    if not s:
        return None
    try:
        y, m, d = str(s)[:10].split("-")
        return dt_date(int(y), int(m), int(d))
    except Exception:
        return None

def safe_lastmod(*candidates):
    """
    Devuelve la fecha más reciente válida <= hoy.
    Evita futuros artificiales en <lastmod> (señal poco fiable para SEO).
    """
    vals = [d for d in (parse_yyyy_mm_dd(c) for c in candidates) if d]
    vals = [d for d in vals if d <= today_d]
    if not vals:
        return today_d.isoformat()
    return max(vals).isoformat()

def result_lastmod(result_updates, result_day, race):
    """Fecha real más reciente del contenido de una página de resultados."""
    return safe_lastmod(
        *(result_updates or []),
        (result_day or {}).get("updatedAt"),
        (result_day or {}).get("dateKey"),
        (race or {}).get("endDate"),
        (race or {}).get("startDate"),
    )

def norm_txt(s):
    s = unicodedata.normalize("NFKD", (s or "")).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s

def canonical_group_key(rd):
    rid = str(rd.get("raceId") or "")
    sn = str(rd.get("stageNumber") if rd.get("stageNumber") is not None else "")
    dk = str(rd.get("dateKey") or "")
    st = norm_txt(rd.get("startLocation") or "")
    fn = norm_txt(rd.get("finishLocation") or "")
    return "|".join([rid, sn, dk, st, fn])

races = supabase_get("races?select=id,slug,slugEn,name,nameEn,originalName,year,startDate,endDate,uciCategory,logoUrl,countryCode,raceFormat&slug=not.is.null&order=startDate.desc")
racedays = supabase_get(
    "race_days?select=id,slug,slugEn,raceId,stageNumber,startLocation,finishLocation,"
    "dateKey,updatedAt,isRestDay,isCancelledDay,elevationProfile,profileNotViewable,routeGpxUrl"
    "&editorialStatus=eq.published&slug=not.is.null&order=dateKey.desc"
)
BASE_URL_EN = os.environ.get("EN_BASE_URL", "https://calendariociclismo.app/en")
startlist_teams = supabase_get("startlist_teams?select=raceId&order=raceId")
race_ids_with_startlist = set(t.get("raceId") for t in startlist_teams if t.get("raceId"))
racedays_by_race = {}
for rd in racedays:
    rid = rd.get("raceId")
    if rid:
        racedays_by_race.setdefault(rid, []).append(rd)

grouped = {}
for rd in racedays:
    slug = rd.get("slug")
    if not slug:
        continue
    grouped.setdefault(canonical_group_key(rd), []).append(slug)

canonical_slug_by_slug = {}
master_slugs = set()
alias_groups = 0
for _k, slugs in grouped.items():
    unique = sorted(set(slugs))
    if not unique:
        continue
    master = sorted(unique, key=lambda s: (len(s), s))[0]
    if len(unique) > 1:
        alias_groups += 1
    master_slugs.add(master)
    for s in unique:
        canonical_slug_by_slug[s] = master

# ── sitemap.xml ────────────────────────────────────────────
entries = []
for path, freq, prio in [
    ("/","daily","1.0"),
    ("/calendario.html","daily","0.9"),
    # /buscar.html: ARCHIVADO 2026-07-17, fuera del sitemap (la página
    # sigue viva por URL directa, pero no se ofrece ni se indexa).
    ("/about.html","monthly","0.4"),
    ("/betaandroid.html","monthly","0.5"),
    ("/suscripcion/","monthly","0.6"),
]:
    entries.append(sitemap_entry(BASE_URL + path, today, freq, prio))

# Página "Abierto" (código abierto + fuentes). ES + gemela EN emparejadas
# con hreflang.
entries.append(sitemap_entry(BASE_URL + "/abierto.html", today, "monthly", "0.5",
                             en_url=f"{BASE_URL_EN}/open/"))

for r in races:
    slug = r.get("slug")
    if not slug: continue
    # Carrera de un día: /competicion/<slug>/ y /jornada/<slug>/ comparten
    # keyword y (casi siempre) slug → duplicado. La /competicion/ de un día
    # ya declara canonical hacia su jornada (ver og-pages.yml), así que la
    # dejamos FUERA del sitemap; la jornada la cubre el bloque de jornadas.
    if r.get("raceFormat") == "one_day": continue
    slug_en = r.get("slugEn")
    rd_list = racedays_by_race.get(r.get("id"), [])
    rd_lm_candidates = [(rd.get("updatedAt") or "")[:10] or rd.get("dateKey") for rd in rd_list]
    lm = safe_lastmod(*rd_lm_candidates, r.get("startDate"), r.get("endDate"))
    en_url = f"{BASE_URL_EN}/race/{quote(slug_en)}/" if slug_en else None
    entries.append(sitemap_entry(f"{BASE_URL}/competicion/{quote(slug)}/", lm, "weekly", "0.7", en_url=en_url))

for r in races:
    slug = r.get("slug")
    if not slug or r.get("id") not in race_ids_with_startlist: continue
    slug_en = r.get("slugEn")
    rd_list = racedays_by_race.get(r.get("id"), [])
    rd_lm_candidates = [(rd.get("updatedAt") or "")[:10] or rd.get("dateKey") for rd in rd_list]
    lm = safe_lastmod(*rd_lm_candidates, r.get("startDate"), r.get("endDate"))
    en_url = f"{BASE_URL_EN}/startlist/{quote(slug_en)}/" if slug_en else None
    entries.append(sitemap_entry(f"{BASE_URL}/inscritos/{quote(slug)}/", lm, "weekly", "0.6", en_url=en_url))

# Feed de últimos resultados (índice /resultados/ + /en/results/)
entries.append(sitemap_entry(f"{BASE_URL}/resultados/", today, "hourly", "0.8",
                             en_url=f"{BASE_URL_EN}/results/"))

# Mercado de fichajes (/fichajes/ + /en/transfers/)
entries.append(sitemap_entry(f"{BASE_URL}/fichajes/", today, "daily", "0.8",
                             en_url=f"{BASE_URL_EN}/transfers/"))

for rd in racedays:
    slug = rd.get("slug")
    if not slug: continue
    if canonical_slug_by_slug.get(slug, slug) != slug:
        continue
    lm = safe_lastmod((rd.get("updatedAt") or "")[:10], rd.get("dateKey"))
    slug_en = rd.get("slugEn")
    en_url = f"{BASE_URL_EN}/stage/{quote(slug_en)}/" if slug_en else None
    entries.append(sitemap_entry(f"{BASE_URL}/jornada/{quote(slug)}/", lm, "daily", "0.8", en_url=en_url))

perfil_count = 0
for rd in racedays:
    slug = rd.get("slug")
    if not slug:
        continue
    if canonical_slug_by_slug.get(slug, slug) != slug:
        continue
    if rd.get("profileNotViewable"):
        continue
    if not rd.get("elevationProfile"):
        continue
    lm = safe_lastmod((rd.get("updatedAt") or "")[:10], rd.get("dateKey"))
    entries.append(sitemap_entry(f"{BASE_URL}/perfil/{quote(slug)}/", lm, "weekly", "0.5"))
    perfil_count += 1

# Mapas del recorrido (opt-in: routeGpxUrl). Espejo del bloque de perfiles.
mapa_count = 0
for rd in racedays:
    slug = rd.get("slug")
    if not slug:
        continue
    if canonical_slug_by_slug.get(slug, slug) != slug:
        continue
    if not rd.get("routeGpxUrl"):
        continue
    lm = safe_lastmod((rd.get("updatedAt") or "")[:10], rd.get("dateKey"))
    slug_en = rd.get("slugEn")
    en_url = f"{BASE_URL_EN}/route-map/{quote(slug_en)}/" if slug_en else None
    entries.append(sitemap_entry(f"{BASE_URL}/mapa/{quote(slug)}/", lm, "weekly", "0.5", en_url=en_url))
    mapa_count += 1

so_count = 0
so_en_count = 0
so_racedays = supabase_get(
    "race_days?select=id,slug,slugEn,startOrderImportedAt,updatedAt"
    "&editorialStatus=eq.published&slug=not.is.null"
    "&startOrderImportedAt=not.is.null"
)
for rd in so_racedays:
    slug = rd.get("slug")
    slug_en = rd.get("slugEn")
    if not slug:
        continue
    lm = safe_lastmod((rd.get("startOrderImportedAt") or rd.get("updatedAt") or "")[:10], rd.get("dateKey", ""))
    entries.append(sitemap_entry(f"{BASE_URL}/orden-salida/{quote(slug)}/", lm, "weekly", "0.5"))
    so_count += 1
    if slug_en:
        entries.append(sitemap_entry(f"{BASE_URL_EN}/start-order/{quote(slug_en)}/", lm, "weekly", "0.5"))
        so_en_count += 1

# ── Resultados (UCI in-house): una URL por (carrera × etapa), exista o no ──
# clasificación real todavía (adelanta la creación para SEO — toda jornada
# publicada/no-descanso recibe ya su hueco de resultados.
res_count = 0
res_en_count = 0
_rmap_res = {r["id"]: r for r in races}
res_stages = supabase_get("race_uci_stages?select=raceId,stageNumber,updatedAt&keepForWeb=eq.true")
_res_real_by_race = {}
_res_updated_by_key = {}
for st in (res_stages or []):
    _rid = st.get("raceId")
    _sn = st.get("stageNumber")
    _res_real_by_race.setdefault(_rid, set()).add(_sn)
    if st.get("updatedAt"):
        _res_updated_by_key.setdefault((_rid, _sn), []).append(st["updatedAt"])
_res_days_by_race = {}
_res_day_by_key = {}
for rd in racedays:
    rid = rd.get("raceId")
    # El descanso no tiene página de resultados. La CANCELADA sí: desde
    # 2026-07-16 su página muestra el aviso de cancelación + las generales
    # arrastradas de la etapa anterior → es contenido real e indexable
    # (espejo de og-pages.yml).
    if not rid or rd.get("isRestDay"):
        continue
    rf = _rmap_res.get(rid, {}).get("raceFormat")
    sn = None if rf == "one_day" else rd.get("stageNumber")
    if rf != "one_day" and sn is None:
        continue
    _res_days_by_race.setdefault(rid, set()).add(sn)
    _res_day_by_key[(rid, sn)] = rd
_res_by_race = {
    rid: _res_real_by_race.get(rid, set()) | _res_days_by_race.get(rid, set())
    for rid in set(_res_real_by_race) | set(_res_days_by_race)
}
def _res_seg(n, en=False):
    if n == 0: return "prologue" if en else "prologo"
    if n is not None: return f"stage-{n}" if en else f"etapa-{n}"
    return ""
for rid in sorted(_res_by_race):
    stage_set = _res_by_race[rid]
    race = _rmap_res.get(rid, {})
    slug = race.get("slug")
    slug_en = race.get("slugEn")
    for sn in sorted(stage_set, key=lambda x: (x is None, x)):
        result_day = _res_day_by_key.get((rid, sn), {})
        result_lm = result_lastmod(
            _res_updated_by_key.get((rid, sn), []), result_day, race
        )
        if slug:
            seg = _res_seg(sn)
            entries.append(sitemap_entry(f"{BASE_URL}/resultados/{quote(slug)}/" + (f"{seg}/" if seg else ""), result_lm, "daily", "0.6"))
            res_count += 1
        if slug_en:
            seg_en = _res_seg(sn, en=True)
            entries.append(sitemap_entry(f"{BASE_URL_EN}/results/{quote(slug_en)}/" + (f"{seg_en}/" if seg_en else ""), result_lm, "daily", "0.6"))
            res_en_count += 1

xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
       '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
       ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
       + "\n".join(entries) + "\n</urlset>\n")
with open("sitemap.xml", "w", encoding="utf-8") as f:
    f.write(xml)
print(f"sitemap.xml: {len(races)} carreras, {len(master_slugs)} jornadas canónicas, {perfil_count} perfiles, {mapa_count} mapas, {so_count} órdenes de salida ES, {so_en_count} EN, {len(entries)} URLs (alias grupos: {alias_groups})")

# ── atom.xml ───────────────────────────────────────────────
# Feed de actividad: últimas 7 días + próximas 60 jornadas publicadas.
race_map = {r["id"]: r for r in races}
window_start = today_d - timedelta(days=7)
window_end = today_d + timedelta(days=60)

def parse_date(s):
    try:
        parts = s.split("-")
        return dt_date(int(parts[0]), int(parts[1]), int(parts[2]))
    except Exception:
        return None

def fecha_larga_es(d):
    dias = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"]
    meses = ["enero","febrero","marzo","abril","mayo","junio",
             "julio","agosto","septiembre","octubre","noviembre","diciembre"]
    return f"{dias[d.weekday()]} {d.day} de {meses[d.month-1]} de {d.year}"

def stage_label(n):
    if n is None: return ""
    n = int(n)
    if n == 0: return "Prólogo"
    return f"Etapa {n}"

candidates = []
for rd in racedays:
    slug = rd.get("slug")
    if not slug: continue
    d = parse_date(rd.get("dateKey") or "")
    if not d: continue
    if not (window_start <= d <= window_end): continue
    candidates.append((d, rd))
# Orden cronológico ascendente
candidates.sort(key=lambda x: x[0])
# Limitar a 50
candidates = candidates[:50]

feed_updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
feed_items = []
for d, rd in candidates:
    rd_slug = rd.get("slug")
    race = race_map.get(rd.get("raceId"), {})
    race_name = race.get("name", "")
    year = race.get("year", "")
    sn = rd.get("stageNumber")
    sl = stage_label(sn) if sn is not None else ""
    start_loc = rd.get("startLocation") or ""
    finish_loc = rd.get("finishLocation") or ""
    same_or_one = (not finish_loc) or start_loc == finish_loc
    is_rest = bool(rd.get("isRestDay"))
    is_cancelled = bool(rd.get("isCancelledDay"))
    route = start_loc if same_or_one else f"{start_loc} › {finish_loc}"

    if is_rest:
        title = f"{race_name} {year} — Descanso"
        summary = f"Jornada de descanso el {fecha_larga_es(d)}."
    elif sl:
        title = f"{race_name} {year} · {sl}" + (f": {route}" if route else "")
        summary = f"{sl} de {race_name} {year} el {fecha_larga_es(d)}" + (f" ({route})." if route else ".")
    else:
        title = f"{race_name} {year}"
        summary = f"{race_name} {year} el {fecha_larga_es(d)}" + (f" ({route})." if route else ".")
    if is_cancelled:
        title = f"[Cancelada] {title}"
        summary = "Cancelada. " + summary

    url = f"{BASE_URL}/jornada/{quote(rd_slug)}/"
    updated_src = rd.get("updatedAt") or (d.strftime("%Y-%m-%d") + "T00:00:00+00:00")
    # Normalizar a Z si es necesario
    if updated_src.endswith("+00:00"):
        updated = updated_src.replace("+00:00", "Z")
    elif "T" in updated_src and not updated_src.endswith("Z"):
        updated = updated_src.split(".")[0] + "Z"
    else:
        updated = updated_src
    published = d.strftime("%Y-%m-%d") + "T00:00:00Z"

    uci_cat = race.get("uciCategory") or ""
    country = race.get("countryCode") or ""
    logo_url = race.get("logoUrl") or ""
    thumb_url = og_image_url(logo_url, f"{race_name} {year}") if logo_url else DEFAULT_OG_IMAGE
    category_terms = [t for t in [uci_cat, country] if t]

    cat_tags = "".join(
        f'    <category term="{esc(t)}" label="{esc(t)}"/>\n'
        for t in category_terms
    )
    entry_parts = [
        f"  <entry>\n",
        f"    <title>{esc(title)}</title>\n",
        f"    <link href=\"{esc(url)}\" rel=\"alternate\" type=\"text/html\"/>\n",
        f"    <id>{esc(url)}</id>\n",
        f"    <updated>{updated}</updated>\n",
        f"    <published>{published}</published>\n",
        f"    <summary type=\"text\">{esc(summary)}</summary>\n",
        cat_tags,
        f'    <media:thumbnail xmlns:media="http://search.yahoo.com/mrss/" url="{esc(thumb_url)}"/>\n',
        f"  </entry>",
    ]
    feed_items.append("".join(entry_parts))

atom = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="es">\n'
    f'  <title>Calendario Ciclismo App — Próximas jornadas</title>\n'
    f'  <subtitle>Carreras de ciclismo en ruta: recorrido, horarios, TV y streaming.</subtitle>\n'
    f'  <link href="{BASE_URL}/atom.xml" rel="self" type="application/atom+xml"/>\n'
    f'  <link href="{BASE_URL}/" rel="alternate" type="text/html"/>\n'
    f'  <id>{BASE_URL}/atom.xml</id>\n'
    f'  <updated>{feed_updated}</updated>\n'
    f'  <author><name>Calendario Ciclismo</name><uri>{BASE_URL}/</uri></author>\n'
    + "\n".join(feed_items) + "\n"
    '</feed>\n'
)
with open("atom.xml", "w", encoding="utf-8") as f:
    f.write(atom)
print(f"atom.xml: {len(feed_items)} entradas en ventana [-7d, +60d]")
