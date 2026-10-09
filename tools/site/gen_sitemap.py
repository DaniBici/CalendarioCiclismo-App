import argparse, json, os, re, unicodedata
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import quote
from datetime import datetime, timezone, timedelta, date as dt_date
from archived_seasons import race_is_archived
from cx_calendar import cx_race_in_season
from results_routes import sector_suffixes, result_entry_key, result_entry_sort_key, result_segment, without_ambiguous_plain_entries

SUPABASE_URL = "https://bcecwlkynpgovnzhbpah.supabase.co"
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
BASE_URL = "https://calendariociclismo.app"
BASE_URL_EN = os.environ.get("EN_BASE_URL", "https://calendariociclismo.app/en")
MAX_URLS_PER_SITEMAP = 20000

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

def in_filter(values):
    """Filtro PostgREST `in.(...)` con valores entrecomillados y codificados."""
    return quote("in.(" + ",".join(f'"{value}"' for value in sorted(values)) + ")", safe="().,")

def esc(s):
    if not s: return ""
    return str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;").replace("'","&#39;")

def sitemap_entry(loc, lastmod, changefreq, priority, en_url=None, es_url=None):
    hreflang = ""
    if en_url or es_url:
        es_url = es_url or loc
        en_url = en_url or loc
        hreflang = (
            f'    <xhtml:link rel="alternate" hreflang="es" href="{esc(es_url)}"/>\n'
            f'    <xhtml:link rel="alternate" hreflang="en" href="{esc(en_url)}"/>\n'
            f'    <xhtml:link rel="alternate" hreflang="x-default" href="{esc(es_url)}"/>\n'
        )
    return (f"  <url>\n"
            f"    <loc>{esc(loc)}</loc>\n"
            f"{hreflang}"
            f"    <lastmod>{lastmod}</lastmod>\n"
            f"    <changefreq>{changefreq}</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"  </url>")

def add_bilingual(entries, es_url, en_url, lastmod, changefreq, priority):
    entries.append(sitemap_entry(es_url, lastmod, changefreq, priority, en_url=en_url))
    entries.append(sitemap_entry(en_url, lastmod, changefreq, priority, es_url=es_url))

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


RACE_SELECT = ("races?select=id,slug,slugEn,name,nameEn,originalName,year,startDate,endDate,"
               "uciCategory,logoUrl,countryCode,raceFormat&slug=not.is.null&order=startDate.desc")
DAY_SELECT = ("race_days?select=id,slug,slugEn,raceId,stageNumber,startLocation,finishLocation,"
              "dateKey,updatedAt,isRestDay,isCancelledDay,neutralStartTimeUtc,elevationProfile,profileNotViewable,routeGpxUrl"
              "&editorialStatus=eq.published&slug=not.is.null&order=dateKey.desc")
CX_SELECT = ("cx_races?select=id,name,nameEn,slug,slugEn,seasonKey,dateKey,endDateKey,class,countryCode,venue,"
             "logoUrl,isCancelled,createdAt,updatedAt,cx_tournaments(id,slug,updatedAt)&editorialStatus=eq.published&order=dateKey")


def indexable(races, racedays):
    # Las temporadas archivadas se publican con noindex (gen_og_pages.py): sus
    # URLs no se ofrecen en el sitemap.
    races = [r for r in races if not race_is_archived(r)]
    ids = {r["id"] for r in races}
    return races, [rd for rd in racedays if rd.get("raceId") in ids]


def fetch_road(race_ids=None):
    """Catálogo de carretera completo o limitado a unas carreras."""
    race_filter = f"&id={in_filter(race_ids)}" if race_ids is not None else ""
    day_filter = f"&raceId={in_filter(race_ids)}" if race_ids is not None else ""
    all_races = supabase_get(RACE_SELECT + race_filter)
    all_racedays = supabase_get(DAY_SELECT + day_filter)
    races, racedays = indexable(all_races, all_racedays)
    startlist_teams = supabase_get("startlist_teams?select=raceId&order=raceId" + day_filter)
    so_racedays = supabase_get(
        "race_days?select=id,slug,slugEn,raceId,startOrderImportedAt,updatedAt"
        "&editorialStatus=eq.published&slug=not.is.null"
        "&startOrderImportedAt=not.is.null" + day_filter
    )
    res_stages = supabase_get("race_uci_stages?select=raceId,raceDayId,stageNumber,updatedAt&keepForWeb=eq.true"
                              + day_filter)
    return {"all_races": all_races, "all_racedays": all_racedays, "races": races,
            "racedays": racedays, "startlist_teams": startlist_teams,
            "so_racedays": so_racedays, "res_stages": res_stages}


def fetch_cx():
    return [race for race in supabase_get(CX_SELECT) if cx_race_in_season(race)]


def static_entries():
    entries = []
    for path, en_path, freq, prio in [
        ("/","/","daily","1.0"),
        ("/calendario/","/calendar/","daily","0.9"),
        # /buscar.html: fuera del sitemap desde 2026-07-17 y retirado el
        # 2026-09-28 (archive/buscador-web-2026); 404.html lo lleva a la home.
        ("/about/","/about/","monthly","0.4"),
        # /betaandroid.html y /en/beta/ redirigen a /apps/ desde 2026-09-28.
        ("/apps/","/apps/","monthly","0.5"),
        ("/suscripcion/","/subscription/","monthly","0.6"),
        ("/apoyar/","/support/","monthly","0.4"),
    ]:
        add_bilingual(entries, BASE_URL + path, BASE_URL_EN + en_path, today, freq, prio)

    # Página "Abierto" (código abierto + fuentes). ES + gemela EN emparejadas
    # con hreflang.
    add_bilingual(entries, BASE_URL + "/abierto/", f"{BASE_URL_EN}/open/", today, "monthly", "0.5")
    add_bilingual(entries, BASE_URL + "/campeonatos-nacionales-2026.html",
                  f"{BASE_URL_EN}/2026-national-championships/", today, "monthly", "0.5")
    return entries


def road_sections(data):
    """Entradas de carretera por sección, en el orden del sitemap completo.

    Todas dependen solo de su carrera: el grupo canónico incluye el raceId."""
    races, racedays = data["races"], data["racedays"]
    _indexable_race_ids = {r["id"] for r in races}
    race_ids_with_startlist = set(t.get("raceId") for t in data["startlist_teams"] if t.get("raceId"))
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

    sections = {name: [] for name in ("competicion", "inscritos", "jornada", "perfil",
                                      "mapa", "orden", "resultados")}
    entries = sections["competicion"]
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
        es_url = f"{BASE_URL}/competicion/{quote(slug)}/"
        if en_url: add_bilingual(entries, es_url, en_url, lm, "weekly", "0.7")
        else: entries.append(sitemap_entry(es_url, lm, "weekly", "0.7"))

    entries = sections["inscritos"]
    for r in races:
        slug = r.get("slug")
        if not slug or r.get("id") not in race_ids_with_startlist: continue
        slug_en = r.get("slugEn")
        rd_list = racedays_by_race.get(r.get("id"), [])
        rd_lm_candidates = [(rd.get("updatedAt") or "")[:10] or rd.get("dateKey") for rd in rd_list]
        lm = safe_lastmod(*rd_lm_candidates, r.get("startDate"), r.get("endDate"))
        en_url = f"{BASE_URL_EN}/startlist/{quote(slug_en)}/" if slug_en else None
        es_url = f"{BASE_URL}/inscritos/{quote(slug)}/"
        if en_url: add_bilingual(entries, es_url, en_url, lm, "weekly", "0.6")
        else: entries.append(sitemap_entry(es_url, lm, "weekly", "0.6"))

    entries = sections["jornada"]
    for rd in racedays:
        slug = rd.get("slug")
        if not slug: continue
        if canonical_slug_by_slug.get(slug, slug) != slug:
            continue
        lm = safe_lastmod((rd.get("updatedAt") or "")[:10], rd.get("dateKey"))
        slug_en = rd.get("slugEn")
        en_url = f"{BASE_URL_EN}/stage/{quote(slug_en)}/" if slug_en else None
        es_url = f"{BASE_URL}/jornada/{quote(slug)}/"
        if en_url: add_bilingual(entries, es_url, en_url, lm, "daily", "0.8")
        else: entries.append(sitemap_entry(es_url, lm, "daily", "0.8"))

    entries = sections["perfil"]
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
        es_url = f"{BASE_URL}/perfil/{quote(slug)}/"
        slug_en = rd.get("slugEn") or slug
        en_url = f"{BASE_URL_EN}/profile/{quote(slug_en)}/" if slug_en else None
        if en_url: add_bilingual(entries, es_url, en_url, lm, "weekly", "0.5")
        else: entries.append(sitemap_entry(es_url, lm, "weekly", "0.5"))
        perfil_count += 1

    # Mapas del recorrido (opt-in: routeGpxUrl). Espejo del bloque de perfiles.
    entries = sections["mapa"]
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
        slug_en = rd.get("slugEn") or slug
        en_url = f"{BASE_URL_EN}/route-map/{quote(slug_en)}/" if slug_en else None
        es_url = f"{BASE_URL}/mapa/{quote(slug)}/"
        if en_url: add_bilingual(entries, es_url, en_url, lm, "weekly", "0.5")
        else: entries.append(sitemap_entry(es_url, lm, "weekly", "0.5"))
        mapa_count += 1

    entries = sections["orden"]
    so_count = 0
    so_en_count = 0
    for rd in data["so_racedays"]:
        slug = rd.get("slug")
        slug_en = rd.get("slugEn")
        if not slug or rd.get("raceId") not in _indexable_race_ids:
            continue
        lm = safe_lastmod((rd.get("startOrderImportedAt") or rd.get("updatedAt") or "")[:10], rd.get("dateKey", ""))
        es_url = f"{BASE_URL}/orden-salida/{quote(slug)}/"
        so_count += 1
        if slug_en:
            add_bilingual(entries, es_url, f"{BASE_URL_EN}/start-order/{quote(slug_en)}/", lm, "weekly", "0.5")
            so_en_count += 1
        else:
            entries.append(sitemap_entry(es_url, lm, "weekly", "0.5"))

    # ── Resultados (UCI in-house): una URL por (carrera × etapa), exista o no ──
    # clasificación real todavía (adelanta la creación para SEO — toda jornada
    # publicada/no-descanso recibe ya su hueco de resultados.
    entries = sections["resultados"]
    res_count = 0
    res_en_count = 0
    _rmap_res = {r["id"]: r for r in races}
    _res_real_by_race = {}
    _res_updated_by_key = {}
    _res_suffix_by_day = sector_suffixes(racedays)
    for st in (data["res_stages"] or []):
        _rid = st.get("raceId")
        if _rid not in _indexable_race_ids:
            continue
        _race_format = _rmap_res.get(_rid, {}).get("raceFormat")
        _entry = result_entry_key(_race_format, st.get("stageNumber"), st.get("raceDayId"), _res_suffix_by_day)
        _res_real_by_race.setdefault(_rid, set()).add(_entry)
        if st.get("updatedAt"):
            _res_updated_by_key.setdefault((_rid, _entry), []).append(st["updatedAt"])
    for _rid, _entries in list(_res_real_by_race.items()):
        _res_real_by_race[_rid] = without_ambiguous_plain_entries(_entries)
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
        _entry = result_entry_key(rf, sn, rd.get("id"), _res_suffix_by_day)
        _res_days_by_race.setdefault(rid, set()).add(_entry)
        _res_day_by_key[(rid, _entry)] = rd
    _res_by_race = {
        rid: _res_real_by_race.get(rid, set()) | _res_days_by_race.get(rid, set())
        for rid in set(_res_real_by_race) | set(_res_days_by_race)
    }
    for rid in sorted(_res_by_race):
        stage_set = _res_by_race[rid]
        race = _rmap_res.get(rid, {})
        slug = race.get("slug")
        slug_en = race.get("slugEn")
        for entry in sorted(stage_set, key=result_entry_sort_key):
            sn, suffix = entry
            result_day = _res_day_by_key.get((rid, entry), {})
            result_lm = result_lastmod(
                _res_updated_by_key.get((rid, entry), []), result_day, race
            )
            seg = result_segment(sn, suffix)
            seg_en = result_segment(sn, suffix, is_en=True)
            es_url = f"{BASE_URL}/resultados/{quote(slug)}/" + (f"{seg}/" if seg else "") if slug else None
            en_url = f"{BASE_URL_EN}/results/{quote(slug_en)}/" + (f"{seg_en}/" if seg_en else "") if slug_en else None
            if es_url and en_url:
                add_bilingual(entries, es_url, en_url, result_lm, "daily", "0.6")
            elif es_url:
                entries.append(sitemap_entry(es_url, result_lm, "daily", "0.6"))
            elif en_url:
                entries.append(sitemap_entry(en_url, result_lm, "daily", "0.6"))
            res_count += int(bool(es_url))
            res_en_count += int(bool(en_url))
    stats = {"races": len(races), "master_slugs": len(master_slugs), "alias_groups": alias_groups,
             "perfil": perfil_count, "mapa": mapa_count, "so": so_count, "so_en": so_en_count}
    return sections, stats


def cx_entries(cx_races):
    # CX se indexa desde su generación; el flag del menú no afecta a estas URLs.
    # Las carreras nacionales y los torneos solo nacionales no tienen versión
    # EN indexable (cx_calendar.cx_race_has_english).
    from cx_calendar import cx_race_has_english, cx_tournament_has_english
    entries = []
    add_bilingual(entries, f"{BASE_URL}/ciclocross/", f"{BASE_URL_EN}/cyclocross/", today, "daily", "0.8")
    for tournament in {race["cx_tournaments"]["id"]:race["cx_tournaments"] for race in cx_races if race.get("cx_tournaments")}.values():
        es_url = f"{BASE_URL}/ciclocross/torneos/{quote(tournament['slug'])}/"
        en_url = f"{BASE_URL_EN}/cyclocross/series/{quote(tournament['slug'])}/"
        if cx_tournament_has_english(tournament["id"], cx_races):
            add_bilingual(entries, es_url, en_url, safe_lastmod(tournament.get("updatedAt")), "daily", "0.7")
        else:
            entries.append(sitemap_entry(es_url, safe_lastmod(tournament.get("updatedAt")), "daily", "0.7"))
    for race in cx_races:
        if not race.get("slug"):
            continue
        es_url = f"{BASE_URL}/ciclocross/{quote(race['slug'])}/"
        en_url = f"{BASE_URL_EN}/cyclocross/{quote(race.get('slugEn') or race['slug'])}/"
        lastmod = safe_lastmod(race.get("updatedAt"),race.get("createdAt"))
        if not cx_race_has_english(race):
            entries.append(sitemap_entry(es_url, lastmod, "daily", "0.7"))
            for suffix_es in ["inscritos","resultados"]:
                entries.append(sitemap_entry(es_url + suffix_es + "/", lastmod, "daily", "0.6"))
            continue
        add_bilingual(entries, es_url, en_url, lastmod, "daily", "0.7")
        for suffix_es,suffix_en in [("inscritos","startlist"),("resultados","results")]:
            add_bilingual(entries, es_url + suffix_es + "/", en_url + suffix_en + "/", lastmod, "daily", "0.6")
    return entries


def write_sitemap(entries):
    """Escribe el índice y partes de hasta MAX_URLS_PER_SITEMAP URL; retira partes sobrantes."""
    part_names = []
    for offset in range(0, len(entries), MAX_URLS_PER_SITEMAP):
        part_name = f"sitemap-{len(part_names) + 1}.xml"
        part_names.append(part_name)
        xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
               ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
               + "\n".join(entries[offset:offset + MAX_URLS_PER_SITEMAP]) + "\n</urlset>\n")
        with open(part_name, "w", encoding="utf-8") as f:
            f.write(xml)
    for stale in Path(".").glob("sitemap-*.xml"):
        if stale.name not in part_names:
            stale.unlink()
    index_xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                 '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                 + "".join(f"  <sitemap><loc>{BASE_URL}/{name}</loc></sitemap>\n" for name in part_names)
                 + '</sitemapindex>\n')
    with open("sitemap.xml", "w", encoding="utf-8") as f:
        f.write(index_xml)
    return part_names


# ── atom.xml ───────────────────────────────────────────────
# Feed de actividad: últimas 7 días + próximas 60 jornadas publicadas.
def atom_window():
    return today_d - timedelta(days=7), today_d + timedelta(days=60)


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

def road_feed_entries(racedays, race_map, window_start, window_end):
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
            title = f"{race_name} {year} - Descanso"
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
    return feed_items

def cx_feed_entries(races,window_start,window_end,feed_updated):
    from cx_calendar import cx_race_in_season
    items = []
    for race in sorted(races,key=lambda r:r["dateKey"]):
        if not cx_race_in_season(race):
            continue
        d = parse_date(race.get("dateKey") or "")
        end = parse_date(race.get("endDateKey") or "") or d
        if not d or not race.get("slug") or d>window_end or end<window_start:
            continue
        title = f"{race['name']} · {race['seasonKey']}"
        summary = f"Ciclocross el {fecha_larga_es(d)}"
        if end!=d:
            summary += f" – {fecha_larga_es(end)}"
        if race.get("venue"):
            summary += f" ({race['venue']})"
        summary += ". Consulta los horarios por categoría, dorsales, TV, resultados, clasificación general y vídeos de las carreras."
        if race.get("isCancelled"):
            title = "[Cancelada] " + title
            summary = "Cancelada. " + summary
        url = f"{BASE_URL}/ciclocross/{quote(race['slug'])}/"
        def timestamp(value):
            if not value:
                return feed_updated
            return datetime.fromisoformat(value.replace("Z","+00:00")).astimezone(timezone.utc).isoformat().replace("+00:00","Z")
        updated = timestamp(race.get("updatedAt") or race.get("createdAt"))
        published = timestamp(race.get("createdAt"))
        terms = ["Ciclocross",race.get("class"),race.get("countryCode")]
        tags = ''.join(f'    <category term="{esc(term)}" label="{esc(term)}"/>\n' for term in terms if term)
        thumbnail = og_image_url(race.get("logoUrl"),title)
        items.append(f'  <entry>\n    <title>{esc(title)}</title>\n'
                     f'    <link href="{esc(url)}" rel="alternate" type="text/html"/>\n'
                     f'    <id>{esc(url)}</id>\n    <updated>{updated}</updated>\n'
                     f'    <published>{published}</published>\n'
                     f'    <summary type="text">{esc(summary)}</summary>\n{tags}'
                     f'    <media:thumbnail url="{esc(thumbnail)}"/>\n  </entry>')
    return items

def write_atom(racedays, races, cx_races):
    window_start, window_end = atom_window()
    feed_updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    feed_items = road_feed_entries(racedays, {r["id"]: r for r in races}, window_start, window_end)
    feed_items.extend(cx_feed_entries(cx_races,window_start,window_end,feed_updated))

    atom = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xml:lang="es">\n'
        f'  <title>Calendario Ciclismo App - Próximas jornadas</title>\n'
        f'  <subtitle>Carreras de carretera y ciclocross: horarios, TV, resultados y clasificaciones.</subtitle>\n'
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


def generate_full():
    data = fetch_road()
    cx_races = fetch_cx()
    sections, stats = road_sections(data)
    entries = static_entries() + sections["competicion"] + sections["inscritos"]
    # Feed de últimos resultados (índice /resultados/ + /en/results/)
    add_bilingual(entries, f"{BASE_URL}/resultados/", f"{BASE_URL_EN}/results/", today, "hourly", "0.8")
    # Mercado de fichajes (/fichajes/ + /en/transfers/)
    add_bilingual(entries, f"{BASE_URL}/fichajes/", f"{BASE_URL_EN}/transfers/", today, "daily", "0.8")
    for name in ("jornada", "perfil", "mapa", "orden", "resultados"):
        entries += sections[name]
    entries += cx_entries(cx_races)
    part_names = write_sitemap(entries)
    print(f"sitemap.xml: {stats['races']} carreras, {stats['master_slugs']} jornadas canónicas, {stats['perfil']} perfiles, {stats['mapa']} mapas, {stats['so']} órdenes de salida ES, {stats['so_en']} EN, {len(entries)} URLs en {len(part_names)} partes (alias grupos: {stats['alias_groups']})")
    write_atom(data["racedays"], data["races"], cx_races)


URL_ENTRY = re.compile(r"  <url>\n.*?\n  </url>", re.S)
URL_LOC = re.compile(r"<loc>(.*?)</loc>")


def race_locations(races, racedays):
    """URL exactas y prefijos que pertenecen a unas carreras y sus jornadas."""
    exact, prefixes = set(), []
    for race in races:
        slug, slug_en = race.get("slug"), race.get("slugEn")
        if slug:
            exact |= {f"{BASE_URL}/competicion/{quote(slug)}/", f"{BASE_URL}/inscritos/{quote(slug)}/"}
            prefixes.append(f"{BASE_URL}/resultados/{quote(slug)}/")
        if slug_en:
            exact |= {f"{BASE_URL_EN}/race/{quote(slug_en)}/", f"{BASE_URL_EN}/startlist/{quote(slug_en)}/"}
            prefixes.append(f"{BASE_URL_EN}/results/{quote(slug_en)}/")
    for rd in racedays:
        slug = rd.get("slug")
        if slug:
            exact |= {f"{BASE_URL}/{path}/{quote(slug)}/" for path in ("jornada", "perfil", "mapa", "orden-salida")}
        for value in {rd.get("slugEn"), slug} - {None, ""}:
            exact |= {f"{BASE_URL_EN}/{path}/{quote(value)}/"
                      for path in ("stage", "profile", "route-map", "start-order")}
    return {esc(url) for url in exact}, tuple(esc(prefix) for prefix in prefixes)


def cached_entries():
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    from xml.etree import ElementTree
    index = ElementTree.parse("sitemap.xml").getroot()
    entries = []
    for node in index.findall(ns + "sitemap"):
        name = node.findtext(ns + "loc").rsplit("/", 1)[-1]
        entries += URL_ENTRY.findall(Path(name).read_text(encoding="utf-8"))
    return entries


def update_for_stages(stage_slugs):
    """Sustituye en el sitemap cacheado las URL de las carreras de unas jornadas."""
    refs = supabase_get("race_days?select=slug,raceId&editorialStatus=eq.published"
                        f"&slug={in_filter(stage_slugs)}")
    refs = [row for row in refs if row.get("slug") in stage_slugs]
    missing = set(stage_slugs) - {row["slug"] for row in refs}
    race_ids = {row.get("raceId") for row in refs}
    if missing or None in race_ids:
        raise ValueError(f"Jornadas no publicadas o sin carrera: {sorted(missing)}")
    data = fetch_road(race_ids)
    sections, stats = road_sections(data)
    new_entries = [entry for name in ("competicion", "inscritos", "jornada", "perfil",
                                      "mapa", "orden", "resultados") for entry in sections[name]]
    new_locations = {URL_LOC.search(entry).group(1) for entry in new_entries}
    exact, prefixes = race_locations(data["all_races"], data["all_racedays"])
    exact |= new_locations
    cached = cached_entries()
    kept = [entry for entry in cached
            if (loc := URL_LOC.search(entry).group(1)) not in exact and not loc.startswith(prefixes)]
    entries = kept + new_entries
    part_names = write_sitemap(entries)
    print(f"sitemap.xml incremental: {len(race_ids)} carreras, {len(cached) - len(kept)} URL retiradas, "
          f"{len(new_entries)} URL de sus carreras, {len(entries)} URLs en {len(part_names)} partes")
    # Atom solo depende de la ventana [-7d, +60d]: se consulta únicamente esa.
    window_start, window_end = atom_window()
    window_days = supabase_get(DAY_SELECT + f"&dateKey=gte.{window_start.isoformat()}"
                               f"&dateKey=lte.{window_end.isoformat()}")
    window_race_ids = {rd.get("raceId") for rd in window_days if rd.get("raceId")}
    window_races = (supabase_get(RACE_SELECT + f"&id={in_filter(window_race_ids)}")
                    if window_race_ids else [])
    window_races, window_days = indexable(window_races, window_days)
    write_atom(window_days, window_races, fetch_cx())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-slugs", help="Actualiza el sitemap cacheado con estas jornadas")
    arguments = parser.parse_args()
    if not ANON_KEY:
        raise SystemExit("Falta SUPABASE_ANON_KEY en secretos del repositorio.")
    if arguments.stage_slugs:
        update_for_stages(set(arguments.stage_slugs.split(",")))
    else:
        generate_full()
