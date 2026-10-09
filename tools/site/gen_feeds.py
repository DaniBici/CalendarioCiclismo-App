import json, os, shutil
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlencode
from datetime import datetime, timezone, timedelta, date as dt_date

SUPABASE_URL = "https://bcecwlkynpgovnzhbpah.supabase.co"
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")

# ── Categorías ─────
CATS_PRO = ["WC","CC","1.UWT","2.UWT","1.WWT","2.WWT","1.Pro","2.Pro","CN","1.1","2.1"]
CATS_FEM = CATS_PRO + ["1.2","2.2"]
EUROPE = {"AD","AL","AT","BA","BE","BG","BY","CH","CY","CZ","DE","DK","EE","ES","FI","FR","GB","GR","HR","HU","IE","IS","IT","LI","LT","LU","LV","MC","MD","ME","MK","MT","NL","NO","PL","PT","RO","RS","RU","SE","SI","SK","SM","TR","UA","VA","XK"}
FEED_KEYS = ["todo","pro","wt","wwt","masc","fem"]

TYPE_LABELS = {
    "flat": "Llana",
    "rolling": "Sinuosa",
    "cotas": "Cotas",
    "medium_mountain": "Media montaña",
    "high_mountain": "Alta montaña",
    "cobbles": "Adoquines",
    "sterrato": "Sterrato",
    "itt": "CRI",
    "ttt": "CRE",
    "summit_finish": "Final en alto",
    "uphill_finish": "Final en repecho",
    "chrono_climb": "Cronoescalada",
}

def type_label(t):
    return TYPE_LABELS.get(t, t) if t else ""

def supabase_get(path):
    """Agota la consulta con orden estable; nunca acepta una página truncada."""
    rows = []
    offset = 0
    while True:
        req = Request(f"{SUPABASE_URL}/rest/v1/{path}")
        req.add_header("apikey", ANON_KEY)
        req.add_header("Authorization", f"Bearer {ANON_KEY}")
        req.add_header("Range-Unit", "items")
        req.add_header("Range", f"{offset}-{offset + 999}")
        try:
            with urlopen(req, timeout=60) as res:
                page = json.loads(res.read())
        except HTTPError as error:
            if error.code == 416 and rows:
                return rows
            raise
        if not isinstance(page, list):
            raise ValueError("La consulta de feeds no devolvió filas")
        rows.extend(page)
        if len(page) < 1000:
            return rows
        offset += 1000

# ── Helpers iCal ───────────────────────────────────────────
def normalize_date(date_str):
    # Acepta YYYY-MM-DD y YYYYMMDD; devuelve YYYY-MM-DD.
    s = (date_str or "").strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s

def date_to_ical(date_str):
    return normalize_date(date_str).replace("-", "")

def next_day(date_str):
    y, m, d = [int(x) for x in normalize_date(date_str).split("-")]
    dt = datetime(y, m, d, tzinfo=timezone.utc) + timedelta(days=1)
    return dt.strftime("%Y%m%d")

def ts_to_ical_utc(ts):
    # ISO 8601 con Z o +00:00 → YYYYMMDDTHHMMSSZ
    s = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
    dt = datetime.fromisoformat(s).astimezone(timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")

def escape_text(s):
    if not s:
        return ""
    return (str(s)
            .replace("\\", "\\\\")
            .replace(";", "\\;")
            .replace(",", "\\,")
            .replace("\n", "\\n"))

def fold_line(line):
    # RFC 5545: líneas ≤ 75 octetos; continuaciones con espacio inicial.
    out = []
    current = ""
    for ch in line:
        nxt = current + ch
        if len(nxt.encode("utf-8")) > 75:
            out.append(current)
            current = " " + ch
        else:
            current = nxt
    if current:
        out.append(current)
    return "\r\n".join(out)

def build_vcalendar(vevents, year, key, name=None):
    calname = name or {
        "todo": f"Ciclismo {year}",
        "wt":   f"WorldTour {year}",
        "wwt":  f"WorldTour Fem. {year}",
        "pro":  f"Ciclismo Pro {year}",
        "masc": f"Ciclismo Masc. {year}",
        "fem":  f"Ciclismo Fem. {year}",
    }.get(key, f"Ciclismo {year}")

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Calendario Ciclismo//calendariociclismo.app//ES",
        f"X-WR-CALNAME:{escape_text(calname)}",
        "X-WR-TIMEZONE:Europe/Madrid",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
        "X-PUBLISHED-TTL:PT6H",
    ]
    lines.extend(vevents)
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold_line(l) for l in lines)

# ── VEVENT builders ────────────────────────────────────────
from urllib.parse import quote as urlquote

def url_encode(s):
    return urlquote(str(s), safe="")

def build_race_vevent(race, dtstamp, day):
    if not race.get("startDate"):
        return None
    end_date = race.get("endDate") or race["startDate"]
    uid = f'{race.get("slug") or race["id"]}@calendariociclismo.app'
    if day and day.get("slug"):
        url = f'https://calendariociclismo.app/jornada.html?slug={url_encode(day["slug"])}'
    else:
        url = f'https://calendariociclismo.app/competicion.html?slug={url_encode(race.get("slug") or race["id"])}'

    year = str(race.get("startDate", ""))[:4]
    year_str = f" {year}" if year else ""
    gender_suffix = " \u2640" if race.get("gender") == "female" else ""
    uci_cat = race.get("uciCategory", "") or ""
    cat_str = f" [{uci_cat}{gender_suffix}]" if uci_cat else ""
    summary = f'{race.get("name","")}{year_str}{cat_str}'

    has_start = bool(day and day.get("neutralStartTimeUtc"))
    has_end = bool(day and day.get("estimatedFinishTimeUtc"))

    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{dtstamp}"]
    if has_start:
        lines.append(f'DTSTART:{ts_to_ical_utc(day["neutralStartTimeUtc"])}')
        if has_end:
            lines.append(f'DTEND:{ts_to_ical_utc(day["estimatedFinishTimeUtc"])}')
    else:
        lines.append(f'DTSTART;VALUE=DATE:{date_to_ical(race["startDate"])}')
        lines.append(f'DTEND;VALUE=DATE:{next_day(end_date)}')

    lines.append(f"SUMMARY:{escape_text(summary)}")

    desc_parts = []
    if day and day.get("startLocation") and day.get("finishLocation"):
        desc_parts.append(f'{day["startLocation"]} → {day["finishLocation"]}')
    elif day and day.get("startLocation"):
        desc_parts.append(day["startLocation"])
    elif race.get("countryCode"):
        desc_parts.append(race["countryCode"].upper())
    if day and day.get("distanceKm"):
        desc_parts.append(f'{day["distanceKm"]} km')
    if day and day.get("primaryType"):
        desc_parts.append(type_label(day["primaryType"]))
    if day and day.get("secondaryType"):
        desc_parts.append(type_label(day["secondaryType"]))

    if desc_parts:
        lines.append(f'DESCRIPTION:{escape_text(" · ".join(desc_parts))}')
    lines.append(f"URL:{url}")
    lines.append("END:VEVENT")
    return lines

def build_stage_vevent(race, day, dtstamp):
    if not day.get("dateKey"):
        return None
    if day.get("isRestDay") or day.get("isCancelledDay"):
        return None

    uid = f'{day.get("slug") or day["id"]}@calendariociclismo.app'
    if day.get("slug"):
        url = f'https://calendariociclismo.app/jornada.html?slug={url_encode(day["slug"])}'
    else:
        url = f'https://calendariociclismo.app/competicion.html?slug={url_encode(race.get("slug") or race["id"])}'

    sn = day.get("stageNumber")
    if sn == 0:
        stage_label = "Prólogo"
    elif sn is not None:
        stage_label = f"Etapa {sn}"
    else:
        stage_label = None

    year = str(race.get("startDate", ""))[:4]
    year_str = f" {year}" if year else ""
    gender_suffix = " ♀" if race.get("gender") == "female" else ""
    uci_cat = race.get("uciCategory", "") or ""
    cat_str = f" [{uci_cat}{gender_suffix}]" if uci_cat else ""
    summary = (f'{race.get("name","")}{year_str} · {stage_label}{cat_str}'
               if stage_label else f'{race.get("name","")}{year_str}{cat_str}')

    has_start = bool(day.get("neutralStartTimeUtc"))
    has_end = bool(day.get("estimatedFinishTimeUtc"))

    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{dtstamp}"]
    if has_start:
        lines.append(f'DTSTART:{ts_to_ical_utc(day["neutralStartTimeUtc"])}')
        if has_end:
            lines.append(f'DTEND:{ts_to_ical_utc(day["estimatedFinishTimeUtc"])}')
    else:
        lines.append(f'DTSTART;VALUE=DATE:{date_to_ical(day["dateKey"])}')
        lines.append(f'DTEND;VALUE=DATE:{next_day(day["dateKey"])}')

    lines.append(f"SUMMARY:{escape_text(summary)}")

    desc_parts = []
    if day.get("startLocation") and day.get("finishLocation"):
        desc_parts.append(f'{day["startLocation"]} → {day["finishLocation"]}')
    elif day.get("startLocation"):
        desc_parts.append(day["startLocation"])
    if day.get("distanceKm"):
        desc_parts.append(f'{day["distanceKm"]} km')
    if day.get("primaryType"):
        desc_parts.append(type_label(day["primaryType"]))
    if day.get("secondaryType"):
        desc_parts.append(type_label(day["secondaryType"]))

    if desc_parts:
        lines.append(f'DESCRIPTION:{escape_text(" · ".join(desc_parts))}')
    lines.append(f"URL:{url}")
    lines.append("END:VEVENT")
    return lines

EN_CALNAMES = {
    "todo": "Cycling {year}",
    "wt":   "WorldTour {year}",
    "wwt":  "Women's WorldTour {year}",
    "pro":  "Pro Cycling {year}",
    "masc": "Men's Cycling {year}",
    "fem":  "Women's Cycling {year}",
}

def type_label_en(t):
    return {"flat":"Flat","rolling":"Rolling","cotas":"Hilly","medium_mountain":"Medium mountain",
            "high_mountain":"High mountain","cobbles":"Cobbles","sterrato":"Sterrato",
            "itt":"ITT","ttt":"TTT","summit_finish":"Summit finish",
            "uphill_finish":"Uphill finish","chrono_climb":"Uphill time trial"}.get(t, t)

def build_vevent_en(race, dtstamp, day=None):
    """VEVENT con SUMMARY en inglés usando nameEn cuando existe."""
    # Las carreras anunciadas sin fecha (p. ej. mientras la UCI confirma una
    # edición) deben seguir en el calendario web, pero no pueden convertirse en
    # un VEVENT: DTSTART es obligatorio y un DTEND vacío invalida todo el feed.
    if not (day and day.get("dateKey")) and not race.get("startDate"):
        return None

    if day and (day.get("isRestDay") or day.get("isCancelledDay")):
        return None

    name_en = race.get("nameEn") or race.get("name", "")
    year = str(race.get("startDate", ""))[:4]
    year_str = f" {year}" if year else ""
    sn = day.get("stageNumber") if day else None
    if race.get("raceFormat") == "stage_race" and day:
        if sn == 0:
            stage_str = " - Prologue"
        elif sn is not None:
            stage_str = f" - Stage {sn}"
        else:
            stage_str = ""
    else:
        stage_str = ""
    summary = f"{name_en}{year_str}{stage_str}"

    end_date = race.get("endDate") or race.get("startDate", "")
    uid = f'{(day.get("slugEn") if day else None) or (day.get("slug") if day else None) or race.get("slugEn") or race.get("slug") or race["id"]}@en.calendariociclismo.app'

    has_start = bool(day and day.get("neutralStartTimeUtc"))
    has_end   = bool(day and day.get("estimatedFinishTimeUtc"))

    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{dtstamp}"]
    if has_start:
        lines.append(f'DTSTART:{ts_to_ical_utc(day["neutralStartTimeUtc"])}')
        if has_end:
            lines.append(f'DTEND:{ts_to_ical_utc(day["estimatedFinishTimeUtc"])}')
    elif day and day.get("dateKey"):
        lines.append(f'DTSTART;VALUE=DATE:{date_to_ical(day["dateKey"])}')
        lines.append(f'DTEND;VALUE=DATE:{next_day(day["dateKey"])}')
    else:
        lines.append(f'DTSTART;VALUE=DATE:{date_to_ical(race.get("startDate",""))}')
        lines.append(f'DTEND;VALUE=DATE:{next_day(end_date)}')

    lines.append(f"SUMMARY:{escape_text(summary)}")

    desc_parts = []
    if day:
        start_loc = day.get("startLocationEn") or day.get("startLocation", "")
        finish_loc = day.get("finishLocationEn") or day.get("finishLocation", "")
        if start_loc and finish_loc and start_loc != finish_loc:
            desc_parts.append(f"{start_loc} → {finish_loc}")
        elif finish_loc:
            desc_parts.append(finish_loc)
        if day.get("distanceKm"):
            desc_parts.append(f'{day["distanceKm"]} km')
        if day.get("primaryType"):
            desc_parts.append(type_label_en(day["primaryType"]))
    if desc_parts:
        lines.append(f'DESCRIPTION:{escape_text(" · ".join(desc_parts))}')

    jornada_url = None
    if day and day.get("slugEn"):
        jornada_url = f'https://calendariociclismo.app/en/stage/{url_encode(day["slugEn"])}/'
    elif day and day.get("slug"):
        jornada_url = f'https://calendariociclismo.app/jornada/{url_encode(day["slug"])}/'
    elif race.get("slugEn"):
        jornada_url = f'https://calendariociclismo.app/en/race/{url_encode(race["slugEn"])}/'
    elif race.get("slug"):
        jornada_url = f'https://calendariociclismo.app/competicion/{url_encode(race["slug"])}/'
    if jornada_url:
        lines.append(f"URL:{jornada_url}")

    lines.append("END:VEVENT")
    return lines


def eligible_calendar_year(year, now=None):
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).year
    return isinstance(year, int) and not isinstance(year, bool) and year >= current


def filter_races(races, key, lang):
    """Conserva los filtros ES/EN existentes, aunque no sean equivalentes."""
    def matches(race):
        category, gender = race.get("uciCategory"), race.get("gender")
        if lang == "en":
            if key == "wt": return category in ("1.UWT", "2.UWT")
            if key == "wwt": return category in ("1.WWT", "2.WWT")
            if key == "pro": return category not in (None, "CN")
            if key == "masc": return gender != "female"
            if key == "fem": return gender == "female"
        else:
            if key == "wt": return category in ("1.UWT", "2.UWT") and gender == "male"
            if key == "wwt": return category in ("1.WWT", "2.WWT") and gender == "female"
            if key == "pro": return category in CATS_PRO
            if key == "masc": return gender == "male" and category in CATS_PRO
            if key == "fem": return gender == "female" and category in CATS_FEM
        return True

    return [race for race in races if matches(race)
            and (key != "fem" or race.get("uciCategory") not in ("1.2", "2.2")
                 or (race.get("countryCode") or "").upper() in EUROPE)]


RACE_FIELDS = "id,year,name,nameEn,slug,slugEn,startDate,endDate,uciCategory,gender,countryCode,raceFormat"
DAY_FIELDS = ("id,raceId,dateKey,slug,slugEn,stageNumber,startLocation,finishLocation,startLocationEn,"
              "finishLocationEn,distanceKm,primaryType,secondaryType,neutralStartTimeUtc,estimatedFinishTimeUtc,"
              "isRestDay,isCancelledDay")
DAY_ORDER = "dateKey.asc,stageNumber.asc,id.asc"


def in_list(values):
    return "in.(" + ",".join(f'"{value}"' for value in sorted(values)) + ")"


def fetch_year(year):
    races = supabase_get("races?" + urlencode({
        "year": f"eq.{year}", "isCancelled": "eq.false",
        "order": "startDate.asc,id.asc",
        "select": RACE_FIELDS,
    }))
    days = []
    ids = [race["id"] for race in races]
    for offset in range(0, len(ids), 100):
        days.extend(supabase_get("race_days?" + urlencode({
            "raceId": f'in.({",".join(ids[offset:offset + 100])})',
            "editorialStatus": "eq.published",
            "order": DAY_ORDER,
            "select": DAY_FIELDS,
        })))
    return races, days


def calendar_en(events, name):
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0",
             "PRODID:-//Cycling Calendar//calendariociclismo.app//EN",
             f"X-WR-CALNAME:{escape_text(name)}", "X-WR-TIMEZONE:Europe/Madrid",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
             *events, "END:VCALENDAR"]
    return "\r\n".join(fold_line(line) for line in lines)


def write_feed(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content.encode("utf-8"))


def annual_name(year, key):
    return f"{year}.ics" if key == "todo" else f"{year}-{key}.ics"


def annual_calendar(events, year, key, lang):
    return (build_vcalendar(events, year, key) if lang == "es" else
            calendar_en(events, EN_CALNAMES[key].format(year=year)))


def race_annual_events(race, race_days, lang, stamp):
    """VEVENTs de una carrera en los feeds anuales."""
    events = []
    selected = race_days if race.get("raceFormat") == "stage_race" and race_days else [
        race_days[0] if len(race_days) == 1 else None]
    for day in selected:
        if day and (day.get("isRestDay") or day.get("isCancelledDay")):
            continue
        event = (build_vevent_en(race, stamp, day) if lang == "en" else
                 build_stage_vevent(race, day, stamp) if day and race.get("raceFormat") == "stage_race" else
                 build_race_vevent(race, stamp, day))
        events.extend(event or [])
    return events


def individual_slug(day, lang):
    slug = (day.get("slugEn") or day.get("slug")) if lang == "en" else day.get("slug")
    if slug and (Path(slug).name != slug or slug in (".", "..")):
        raise ValueError("Slug de feed individual no permitido")
    return slug


def write_individual_feeds(race, race_days, lang, base, stamp, year, prune=False):
    """Un feed por jornada; con prune retira los de jornadas sin evento."""
    count = 0
    for day in race_days:
        slug = individual_slug(day, lang)
        if not slug:
            continue
        path = Path(f"{base}/event/{slug}.ics")
        event = None
        if not (day.get("isRestDay") or day.get("isCancelledDay")):
            event = (build_vevent_en(race, stamp, day) if lang == "en" else
                     build_stage_vevent(race, day, stamp) if race.get("raceFormat") == "stage_race" else
                     build_race_vevent(race, stamp, day))
        if not event:
            if prune and path.is_file():
                path.unlink()
            continue
        if lang == "en":
            name = f'{race.get("nameEn") or race.get("name", "")} {year}'
            stage = day.get("stageNumber")
            if race.get("raceFormat") == "stage_race":
                name += " - Prologue" if stage == 0 else f" - Stage {stage}" if stage is not None else ""
            content = calendar_en(event, name)
        else:
            stage = day.get("stageNumber")
            label = "Prólogo" if stage == 0 else f"Etapa {stage}" if stage is not None else None
            name = f'{race.get("name", "")} {year}'
            if race.get("raceFormat") == "stage_race" and label:
                name += f" · {label}"
            content = build_vcalendar(event, year, "todo", name)
        write_feed(path, content)
        count += 1
    return count


def write_year(year, races, days, stamp, totals, now):
    races = [race for race in races if race.get("year") == year
             and eligible_calendar_year(race.get("year"), now)
             and not race.get("isCancelled")]
    by_race = {}
    for day in days:
        by_race.setdefault(day.get("raceId"), []).append(day)

    for lang, base in (("es", "feed"), ("en", "en/feed")):
        for key in FEED_KEYS:
            events = []
            for race in filter_races(races, key, lang):
                events.extend(race_annual_events(race, by_race.get(race["id"], []), lang, stamp))
            name = annual_name(year, key)
            write_feed(f"{base}/{name}", annual_calendar(events, year, key, lang))
            totals["annual"] += 1
            print(f"  {base}/{name}: {events.count('BEGIN:VEVENT')} eventos")

        for race in races:
            totals["events"] += write_individual_feeds(
                race, by_race.get(race["id"], []), lang, base, stamp, year)


def generate_feeds(now=None):
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    # El filtro precede a cualquier consulta de jornadas históricas.
    year_rows = supabase_get("races?" + urlencode({
        "select": "id,year", "year": f"gte.{now.year}", "order": "year.asc,id.asc",
    }))
    years = sorted({row["year"] for row in year_rows
                    if eligible_calendar_year(row.get("year"), now)})
    years = sorted(set(years) | {now.year})
    print(f"Años iCal elegibles: {years}")
    # Destinos generados exclusivos. No se mezclan con fuentes ni slugs viejos.
    for destination in ("feed", "en/feed"):
        directory = Path(destination)
        if directory.is_symlink():
            raise ValueError(f"Destino iCal no permitido: {directory}")
        if directory.exists():
            shutil.rmtree(directory)
        (directory / "event").mkdir(parents=True)

    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    totals = {"annual": 0, "events": 0}
    for year in years:
        races, days = fetch_year(year)
        write_year(year, races, days, stamp, totals, now)
    print(f"Total iCal: {totals['annual']} anuales y {totals['events']} individuales")
    return years, totals


# ── Modo incremental: sustituye en los feeds cacheados las carreras de unas
# jornadas, sin consultar el resto del catálogo.
def split_calendar(content):
    lines = content.split("\r\n")
    if not lines or lines[0] != "BEGIN:VCALENDAR" or lines[-1] != "END:VCALENDAR":
        raise ValueError("Feed iCal cacheado inválido")
    first = lines.index("BEGIN:VEVENT") if "BEGIN:VEVENT" in lines else len(lines) - 1
    blocks, current = [], None
    for line in lines[first:-1]:
        if line == "BEGIN:VEVENT":
            current = []
        if current is None:
            raise ValueError("Feed iCal cacheado inválido")
        current.append(line)
        if line == "END:VEVENT":
            blocks.append(current)
            current = None
    if current is not None:
        raise ValueError("Feed iCal cacheado inválido")
    return lines[:first], blocks


def block_uid(block):
    logical = []
    for line in block:
        if line.startswith(" ") and logical:
            logical[-1] += line[1:]
        else:
            logical.append(line)
    return next((line[4:] for line in logical if line.startswith("UID:")), None)


def race_uids(race, race_days):
    """UIDs que una carrera y sus jornadas pueden haber emitido en ES y EN."""
    es = {race.get("slug"), race.get("id")} | {day.get(field) for day in race_days for field in ("slug", "id")}
    en = ({race.get("slugEn"), race.get("slug"), race.get("id")}
          | {day.get(field) for day in race_days for field in ("slugEn", "slug")})
    return ({f"{value}@calendariociclismo.app" for value in es if value}
            | {f"{value}@en.calendariociclismo.app" for value in en if value})


def splice_calendar(content, uids, events):
    """Retira los VEVENT con esos UID e inserta los nuevos en su lugar."""
    header, blocks = split_calendar(content)
    kept, position = [], None
    for block in blocks:
        if block_uid(block) in uids:
            position = len(kept) if position is None else position
            continue
        kept.append(block)
    position = len(kept) if position is None else position
    lines = (header + [line for block in kept[:position] for line in block]
             + [fold_line(line) for line in events]
             + [line for block in kept[position:] for line in block] + ["END:VCALENDAR"])
    return "\r\n".join(lines), len(blocks) - len(kept)


def update_feeds(stage_slugs, now=None):
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    refs = supabase_get("race_days?" + urlencode({
        "select": "slug,raceId", "editorialStatus": "eq.published", "slug": in_list(stage_slugs),
        "order": "slug.asc"}))
    refs = [row for row in refs if row.get("slug") in stage_slugs]
    missing = set(stage_slugs) - {row["slug"] for row in refs}
    race_ids = {row.get("raceId") for row in refs}
    if missing or None in race_ids:
        raise ValueError(f"Jornadas no publicadas o sin carrera: {sorted(missing)}")
    races = supabase_get("races?" + urlencode({
        "id": in_list(race_ids), "order": "startDate.asc,id.asc",
        "select": RACE_FIELDS + ",isCancelled"}))
    days = supabase_get("race_days?" + urlencode({
        "raceId": in_list(race_ids), "editorialStatus": "eq.published",
        "order": DAY_ORDER, "select": DAY_FIELDS}))
    by_race = {}
    for day in days:
        by_race.setdefault(day.get("raceId"), []).append(day)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    totals = {"annual": 0, "events": 0}
    for year in sorted({race.get("year") for race in races
                        if eligible_calendar_year(race.get("year"), now)}):
        year_races = [race for race in races if race.get("year") == year]
        if not all(Path(f"{base}/{annual_name(year, key)}").is_file()
                   for base in ("feed", "en/feed") for key in FEED_KEYS):
            # Año nuevo sin feeds cacheados: se genera completo.
            print(f"  {year}: sin feeds anuales en caché; generación completa del año")
            year_rows, year_days = fetch_year(year)
            write_year(year, year_rows, year_days, stamp, totals, now)
            continue
        active = [race for race in year_races if not race.get("isCancelled")]
        uids = set().union(*(race_uids(race, by_race.get(race["id"], [])) for race in year_races))
        for lang, base in (("es", "feed"), ("en", "en/feed")):
            for key in FEED_KEYS:
                events = []
                for race in filter_races(active, key, lang):
                    events.extend(race_annual_events(race, by_race.get(race["id"], []), lang, stamp))
                path = Path(f"{base}/{annual_name(year, key)}")
                content, removed = splice_calendar(path.read_bytes().decode("utf-8"), uids, events)
                write_feed(path, content)
                totals["annual"] += 1
                print(f"  {path}: {removed} eventos sustituidos por {events.count('BEGIN:VEVENT')}")
            for race in year_races:
                race_days = by_race.get(race["id"], [])
                if race.get("isCancelled"):
                    for day in race_days:
                        slug = individual_slug(day, lang)
                        if slug and Path(f"{base}/event/{slug}.ics").is_file():
                            Path(f"{base}/event/{slug}.ics").unlink()
                    continue
                totals["events"] += write_individual_feeds(
                    race, race_days, lang, base, stamp, year, prune=True)
    print(f"Total iCal incremental: {len(race_ids)} carreras, {totals['annual']} anuales "
          f"y {totals['events']} individuales reescritos")
    return totals


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-slugs", help="Actualiza los feeds cacheados con estas jornadas")
    arguments = parser.parse_args()
    if not ANON_KEY:
        raise SystemExit("Falta SUPABASE_ANON_KEY en secretos del repositorio.")
    if arguments.stage_slugs:
        update_feeds(set(arguments.stage_slugs.split(",")))
    else:
        generate_feeds()
