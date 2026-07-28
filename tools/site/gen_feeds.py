import json, os
from urllib.request import Request, urlopen
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
    req = Request(f"{SUPABASE_URL}/rest/v1/{path}")
    req.add_header("apikey", ANON_KEY)
    req.add_header("Authorization", f"Bearer {ANON_KEY}")
    with urlopen(req) as res:
        return json.loads(res.read())

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

def build_vcalendar(vevents, year, key):
    calname = {
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

# ── Queries ────────────────────────────────────────────────
def fetch_races(year, key):
    params = {
        "year": f"eq.{year}",
        "isCancelled": "eq.false",
        "order": "startDate.asc",
        "select": "id,name,slug,startDate,endDate,uciCategory,gender,countryCode,raceFormat",
    }
    if key == "wt":
        params["uciCategory"] = "in.(1.UWT,2.UWT)"
        params["gender"] = "eq.male"
    elif key == "wwt":
        params["uciCategory"] = "in.(1.WWT,2.WWT)"
        params["gender"] = "eq.female"
    elif key == "masc":
        params["gender"] = "eq.male"
        params["uciCategory"] = f'in.({",".join(CATS_PRO)})'
    elif key == "fem":
        params["gender"] = "eq.female"
        params["uciCategory"] = f'in.({",".join(CATS_FEM)})'
    elif key == "pro":
        params["uciCategory"] = f'in.({",".join(CATS_PRO)})'
    return supabase_get(f"races?{urlencode(params)}")

def fetch_race_days(race_ids):
    if not race_ids:
        return []
    params = {
        "raceId": f'in.({",".join(race_ids)})',
        "editorialStatus": "eq.published",
        "order": "dateKey.asc,stageNumber.asc",
        "select": "id,raceId,dateKey,slug,stageNumber,startLocation,finishLocation,distanceKm,primaryType,secondaryType,neutralStartTimeUtc,estimatedFinishTimeUtc,isRestDay,isCancelledDay",
    }
    return supabase_get(f"race_days?{urlencode(params)}")

# ── Años con datos ─────────────────────────────────────────
years_rows = supabase_get("races?select=year&order=year")
years = sorted({r.get("year") for r in years_rows if r.get("year")})
if not years:
    # Sin datos → al menos generar el año en curso para no dejar 404
    years = [datetime.now(timezone.utc).year]
print(f"Años con datos: {years}")

dtstamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
os.makedirs("feed", exist_ok=True)

total_files = 0
for year in years:
    for key in FEED_KEYS:
        races = fetch_races(year, key)
        if key == "fem":
            races = [r for r in races
                     if r.get("uciCategory") not in ("1.2", "2.2")
                     or (r.get("countryCode") or "").upper() in EUROPE]

        race_ids = [r["id"] for r in races]
        all_days = fetch_race_days(race_ids)

        days_by_race = {}
        for d in all_days:
            days_by_race.setdefault(d["raceId"], []).append(d)

        vevents = []
        for race in races:
            days = days_by_race.get(race["id"], [])
            if race.get("raceFormat") == "stage_race" and days:
                for d in days:
                    ev = build_stage_vevent(race, d, dtstamp)
                    if ev:
                        vevents.extend(ev)
            else:
                day = days[0] if len(days) == 1 else None
                ev = build_race_vevent(race, dtstamp, day)
                if ev:
                    vevents.extend(ev)

        ical = build_vcalendar(vevents, year, key)
        filename = f"{year}.ics" if key == "todo" else f"{year}-{key}.ics"
        path = f"feed/{filename}"
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(ical)
        total_files += 1
        print(f"  {path}: {len(races)} carreras, {sum(1 for l in vevents if l == 'BEGIN:VEVENT')} eventos")

print(f"Total: {total_files} .ics generados en feed/")

# ── Feeds individuales por jornada ─────────────────────────
os.makedirs("feed/event", exist_ok=True)

event_files = 0
for year in years:
    year_params = {
        "year": f"eq.{year}",
        "isCancelled": "eq.false",
        "order": "startDate.asc",
        "select": "id,name,slug,startDate,endDate,uciCategory,gender,countryCode,raceFormat",
    }
    year_races = supabase_get(f"races?{urlencode(year_params)}")
    year_race_ids = [r["id"] for r in year_races]
    if not year_race_ids:
        continue

    day_params = {
        "raceId": f'in.({",".join(year_race_ids)})',
        "editorialStatus": "eq.published",
        "isRestDay": "eq.false",
        "isCancelledDay": "eq.false",
        "order": "dateKey.asc",
        "select": "id,raceId,dateKey,slug,stageNumber,startLocation,finishLocation,distanceKm,primaryType,secondaryType,neutralStartTimeUtc,estimatedFinishTimeUtc,isRestDay,isCancelledDay",
    }
    year_days = supabase_get(f"race_days?{urlencode(day_params)}")

    races_by_id = {r["id"]: r for r in year_races}
    for day in year_days:
        slug = day.get("slug")
        if not slug:
            continue
        race = races_by_id.get(day.get("raceId"))
        if not race:
            continue

        if race.get("raceFormat") == "stage_race":
            ev = build_stage_vevent(race, day, dtstamp)
        else:
            ev = build_race_vevent(race, dtstamp, day)
        if not ev:
            continue

        ev_year = str(race.get('startDate', ''))[:4]
        ev_year_str = f' {ev_year}' if ev_year else ''
        if race.get('raceFormat') == 'stage_race':
            ev_sn = day.get('stageNumber')
            if ev_sn == 0: ev_stage = 'Prólogo'
            elif ev_sn is not None: ev_stage = f'Etapa {ev_sn}'
            else: ev_stage = None
            ev_calname = (f'{race.get("name","")}{ev_year_str} · {ev_stage}'
                         if ev_stage else f'{race.get("name","")}{ev_year_str}')
        else:
            ev_calname = f'{race.get("name","")}{ev_year_str}'
        cal_lines = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Calendario Ciclismo//calendariociclismo.app//ES",
            f"X-WR-CALNAME:{escape_text(ev_calname)}",
            "X-WR-TIMEZONE:Europe/Madrid",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
            "X-PUBLISHED-TTL:PT6H",
        ]
        cal_lines.extend(ev)
        cal_lines.append("END:VCALENDAR")
        ical_content = "\r\n".join(fold_line(l) for l in cal_lines)

        path = f"feed/event/{slug}.ics"
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(ical_content)
        event_files += 1

print(f"Total: {event_files} per-event .ics generados en feed/event/")

# ── Feeds EN ────────────────────────────────────────────────
os.makedirs("en/feed/event", exist_ok=True)

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

def fetch_races_en(year, key):
    """Igual que fetch_races pero incluye nameEn y slugEn."""
    params = {
        "year": f"eq.{year}",
        "isCancelled": "eq.false",
        "order": "startDate.asc",
        "select": "id,name,nameEn,slug,slugEn,startDate,endDate,uciCategory,gender,countryCode,raceFormat",
    }
    races_en = supabase_get(f"races?{urlencode(params)}")
    if key == "wt":
        races_en = [r for r in races_en if r.get("uciCategory") in ("1.UWT","2.UWT")]
    elif key == "wwt":
        races_en = [r for r in races_en if r.get("uciCategory") in ("1.WWT","2.WWT")]
    elif key == "pro":
        races_en = [r for r in races_en if r.get("uciCategory") not in (None,"CN")]
    elif key == "masc":
        races_en = [r for r in races_en if r.get("gender") != "female"]
    elif key == "fem":
        races_en = [r for r in races_en if r.get("gender") == "female"]
    return races_en

def build_vevent_en(race, dtstamp, day=None):
    """VEVENT con SUMMARY en inglés usando nameEn cuando existe."""
    # Las carreras anunciadas sin fecha (p. ej. mientras la UCI confirma una
    # edición) deben seguir en el calendario web, pero no pueden convertirse en
    # un VEVENT: DTSTART es obligatorio y un DTEND vacío invalida todo el feed.
    if not (day and day.get("dateKey")) and not race.get("startDate"):
        return None

    name_en = race.get("nameEn") or race.get("name", "")
    year = str(race.get("startDate", ""))[:4]
    year_str = f" {year}" if year else ""
    sn = day.get("stageNumber") if day else None
    if race.get("raceFormat") == "stage_race" and day:
        if sn == 0:
            stage_str = " — Prologue"
        elif sn is not None:
            stage_str = f" — Stage {sn}"
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

en_total = 0
for year in years:
    for key in FEED_KEYS:
        races_en = fetch_races_en(year, key)
        if key == "fem":
            races_en = [r for r in races_en if r.get("uciCategory") not in ("1.2","2.2")
                        or (r.get("countryCode") or "").upper() in EUROPE]
        race_ids_en = [r["id"] for r in races_en]
        all_days_en = fetch_race_days(race_ids_en) if race_ids_en else []
        # añadir slugEn y locationEn a los days
        day_slugs_needed = [d["id"] for d in all_days_en]
        days_en_extra = {}
        if day_slugs_needed:
            chunk = day_slugs_needed[:500]
            extra = supabase_get(f"race_days?id=in.({','.join(chunk)})&select=id,slugEn,startLocationEn,finishLocationEn")
            for e in extra:
                days_en_extra[e["id"]] = e
        for d in all_days_en:
            extra = days_en_extra.get(d["id"], {})
            d["slugEn"]          = extra.get("slugEn")
            d["startLocationEn"] = extra.get("startLocationEn")
            d["finishLocationEn"]= extra.get("finishLocationEn")

        days_by_race_en = {}
        for d in all_days_en:
            days_by_race_en.setdefault(d["raceId"], []).append(d)

        vevents_en = []
        for race in races_en:
            days = days_by_race_en.get(race["id"], [])
            if race.get("raceFormat") == "stage_race" and days:
                for d in days:
                    ev = build_vevent_en(race, dtstamp, d)
                    if ev:
                        vevents_en.extend(ev)
            else:
                day = days[0] if len(days) == 1 else None
                ev = build_vevent_en(race, dtstamp, day)
                if ev:
                    vevents_en.extend(ev)

        calname_en = EN_CALNAMES.get(key, "Cycling {year}").replace("{year}", str(year))
        cal_lines_en = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Cycling Calendar//calendariociclismo.app//EN",
            f"X-WR-CALNAME:{escape_text(calname_en)}",
            "X-WR-TIMEZONE:Europe/Madrid",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
            "X-PUBLISHED-TTL:PT6H",
        ]
        cal_lines_en.extend(vevents_en)
        cal_lines_en.append("END:VCALENDAR")
        ical_en = "\r\n".join(fold_line(l) for l in cal_lines_en)
        filename_en = f"{year}.ics" if key == "todo" else f"{year}-{key}.ics"
        path_en = f"en/feed/{filename_en}"
        with open(path_en, "w", encoding="utf-8", newline="") as f:
            f.write(ical_en)
        en_total += 1

print(f"Total EN: {en_total} .ics generados en en/feed/")

# ── Feeds EN por jornada suelta ────────────────────────────
en_event_files = 0
for year in years:
    year_params_ev = {
        "year": f"eq.{year}",
        "isCancelled": "eq.false",
        "order": "startDate.asc",
        "select": "id,name,nameEn,slug,slugEn,startDate,endDate,uciCategory,gender,countryCode,raceFormat",
    }
    year_races_ev = supabase_get(f"races?{urlencode(year_params_ev)}")
    year_race_ids_ev = [r["id"] for r in year_races_ev]
    if not year_race_ids_ev:
        continue

    day_params_ev = {
        "raceId": f'in.({",".join(year_race_ids_ev)})',
        "editorialStatus": "eq.published",
        "isRestDay": "eq.false",
        "isCancelledDay": "eq.false",
        "order": "dateKey.asc",
        "select": "id,raceId,dateKey,slug,stageNumber,startLocation,finishLocation,distanceKm,primaryType,secondaryType,neutralStartTimeUtc,estimatedFinishTimeUtc,isRestDay,isCancelledDay",
    }
    year_days_ev = supabase_get(f"race_days?{urlencode(day_params_ev)}")

    day_ids_ev = [d["id"] for d in year_days_ev]
    days_en_extra_ev = {}
    if day_ids_ev:
        chunk = day_ids_ev[:500]
        extra_rows = supabase_get(f"race_days?id=in.({','.join(chunk)})&select=id,slugEn,startLocationEn,finishLocationEn")
        for e in extra_rows:
            days_en_extra_ev[e["id"]] = e
    for d in year_days_ev:
        extra = days_en_extra_ev.get(d["id"], {})
        d["slugEn"]           = extra.get("slugEn")
        d["startLocationEn"]  = extra.get("startLocationEn")
        d["finishLocationEn"] = extra.get("finishLocationEn")

    races_by_id_ev = {r["id"]: r for r in year_races_ev}
    for day in year_days_ev:
        slug = day.get("slugEn") or day.get("slug")
        if not slug:
            continue
        race = races_by_id_ev.get(day.get("raceId"))
        if not race:
            continue

        ev = build_vevent_en(race, dtstamp, day)
        if not ev:
            continue

        name_en = race.get("nameEn") or race.get("name", "")
        ev_year = str(race.get("startDate", ""))[:4]
        ev_year_str = f" {ev_year}" if ev_year else ""
        if race.get("raceFormat") == "stage_race":
            ev_sn = day.get("stageNumber")
            if ev_sn == 0:
                ev_stage = " — Prologue"
            elif ev_sn is not None:
                ev_stage = f" — Stage {ev_sn}"
            else:
                ev_stage = ""
            ev_calname_en = f"{name_en}{ev_year_str}{ev_stage}"
        else:
            ev_calname_en = f"{name_en}{ev_year_str}"

        cal_lines_ev = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Cycling Calendar//calendariociclismo.app//EN",
            f"X-WR-CALNAME:{escape_text(ev_calname_en)}",
            "X-WR-TIMEZONE:Europe/Madrid",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
            "X-PUBLISHED-TTL:PT6H",
        ]
        cal_lines_ev.extend(ev)
        cal_lines_ev.append("END:VCALENDAR")
        ical_content_ev = "\r\n".join(fold_line(l) for l in cal_lines_ev)

        path_ev = f"en/feed/event/{slug}.ics"
        with open(path_ev, "w", encoding="utf-8", newline="") as f:
            f.write(ical_content_ev)
        en_event_files += 1

print(f"Total EN events: {en_event_files} per-event .ics generados en en/feed/event/")
