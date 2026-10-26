#!/usr/bin/env python3
"""Volcado compartido de datos del build de Pages.

Los generadores del job (`gen_og_pages.py`, `gen_sitemap.py`,
`gen_asset_canonicals.py`, `gen_feeds.py` y los prerender de jornadas,
inscritos, resultados, perfiles, mapas y órdenes de salida) leen carreras y
jornadas que se solapan. `fetch()`
lee cada tabla una sola vez por la API pública, en paralelo y con conexiones
persistentes, y la guarda en un directorio del espacio de trabajo
(`.pages-data/`, fuera de `_site` y de la caché). Con `PAGES_DATA` apuntando a
ese directorio, `get()` responde a las mismas consultas PostgREST que los
generadores enviaban a la API: proyección, filtros y orden se aplican en local
sobre las filas leídas.

Cada tabla se lee ordenada por `id` en la base de datos, de modo que el orden
de llegada reproduce `order=id` con la colación de la columna (`en_US`), que
Python no replica. Una consulta que no se pueda resolver con exactitud
(operador, orden por texto o filtro base ausente) devuelve None y el generador
la lee por la API.
"""
import argparse
import gzip
import hashlib
import heapq
import http.client
import itertools
import json
import os
import pickle
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, quote, urlsplit
from zoneinfo import ZoneInfo

import archived_seasons

SUPABASE_URL = "https://bcecwlkynpgovnzhbpah.supabase.co"
PAGE = 1000
WORKERS = 8
ATTEMPTS = 3
MANIFEST = "manifest.json"

CX_SELECT = ("id,name,nameEn,slug,slugEn,seasonKey,dateKey,endDateKey,class,countryCode,venue,"
             "websiteUrl,logoUrl,isCancelled,createdAt,updatedAt,"
             "cx_tournaments(id,name,nameEn,slug,seasonKey,logoUrl,updatedAt),"
             "cx_race_categories(category,dateKey,startTimeUtc,isCancelled,resultsStatus),cx_videos(id,url)")

# Tabla -> (consulta, filtros que el volcado garantiza). Una consulta local
# sobre la tabla debe incluir esos filtros: el volcado no contiene más filas.
TABLES = {
    "races": ("races?select=*", ()),
    "race_days": ("race_days?select=*&editorialStatus=eq.published", ("editorialStatus=eq.published",)),
    "race_uci_stages": ("race_uci_stages?select=raceId,raceDayId,stageNumber,updatedAt,rowCount,keepForWeb"
                        "&keepForWeb=eq.true", ("keepForWeb=eq.true",)),
    "startlist_teams": ("startlist_teams?select=raceId", ()),
    "assets": ("assets?select=*", ()),
    "cx_races": ("cx_races?select=" + CX_SELECT + "&editorialStatus=eq.published", ("editorialStatus=eq.published",)),
    "broadcasts": ("broadcasts?select=*", ()),
}
# Lecturas que solo consumen los prerender, sin consultas locales.
EXTRA = {
    "guides": "assets?select=*,race_days!inner(raceId,dateKey)&type=eq.technicalGuide",
}
RPCS = ("startlist_counts",)

# Lecturas del prerender de inscritos (`prerender-inscritos.mjs`), sin
# consultas locales, solo con PRERENDER_INSCRITOS activo y para su ámbito
# (inscritos_scope): las carreras con lista de `startlist_counts` que terminan
# (o empiezan, sin fecha de fin) desde hace INSCRITOS_WINDOW_DAYS días (UTC), o
# todas con `listas`. Mismas consultas y orden que la lectura por la API del
# prerender, por tramos de IN_CHUNK carreras; las filas de abandono, por tramos
# de etapas sin partir una carrera (inscritos_stage_chunks). Jornadas,
# documentos de la jornada de un día y guías técnicas salen de `race_days`,
# `assets` y `guides`.
INSCRITOS = {
    "inscritos_teams": "startlist_teams?select=*,team:teams(*,team_seasons(*))&{}&order=sortOrder.asc,id.asc",
    "inscritos_riders": "startlist_riders_resolved?select=*&teamId=not.is.null&{}&order=dorsal.asc,id.asc",
    "inscritos_stages": "race_uci_stages?select=id,raceId,stageNumber,rowCount&classKind=eq.stage&{}&order=id.asc",
}
INSCRITOS_RESULTS = ("inscritos_results", "race_uci_results?select=globalRiderId,irm,stageRef"
                     "&globalRiderId=not.is.null&irm=not.is.null&{}&order=id.asc")
INSCRITOS_NAMES = (*INSCRITOS, INSCRITOS_RESULTS[0])
INSCRITOS_WINDOW_DAYS = 7
IN_CHUNK = 100

# Lecturas del prerender de resultados (`prerender-resultados.mjs`), sin
# consultas locales, solo con PRERENDER_RESULTADOS activo. Siempre las
# clasificaciones publicables y su configuración (RESULTADOS_BASE). El resto,
# solo para las carreras candidatas (resultados_candidates) cuyos datos no
# están en la caché del prerender (RESULTADOS_CACHE) con la misma firma
# (resultados_signature) o han cumplido su rotación, por prioridad y hasta
# RESULTADOS_MAX_READS (resultados_needing):
# inscritos, equipos con su temporada, filas de todas sus clasificaciones y,
# si hay alguna carrera que leer, las fichas y los equipos del catálogo para
# las filas sin inscrito. Mismas columnas y orden que js/resultados.js, con la
# carrera o la clasificación añadidas para repartir las filas, por tramos de
# IN_CHUNK carreras o clasificaciones.
RESULTADOS_BASE = {
    "resultados_stages": "race_uci_stages?select=*&keepForWeb=eq.true&rowCount=gt.0&order=id.asc",
    "resultados_classifications": "race_classifications?select=*&order=raceId.asc,classKind.asc",
}
# Columnas de TEAM_COLUMNS y TEAM_SEASON_COLUMNS de js/team-appearance.js.
TEAM_COLUMNS = ("id,name,category,nameAliases,badgeTorsoCenter,badgeTorsoSides,badgeShorts,badgeInnerCircle,"
                "teamKind,selectionScope,countryCode,selectionCode")
SEASON_COLUMNS = ("teamId,name,category,headerBg,headerText,badgeTorsoCenter,badgeTorsoSides,"
                  "badgeInnerCircle,badgeShorts")
RESULTADOS_RIDERS = ("resultados_riders", "startlist_riders_resolved?select=raceId,dorsal,firstName,lastName,"
                     "countryCode,teamId,globalRiderId&{}&order=id.asc")
# Por año de la carrera: el embebido filtra la temporada.
RESULTADOS_TEAMS = ("resultados_teams", f"startlist_teams?select=id,raceId,teamId,teamName,team:teams({TEAM_COLUMNS},"
                    f"team_seasons({SEASON_COLUMNS}))&{{}}&team.team_seasons.year=eq.{{}}&order=id.asc")
RESULTADOS_RESULTS = ("resultados_results", "race_uci_results?select=stageRef,rank,rankText,bib,riderDisplay,"
                      "globalRiderId,teamId,resultValue,timeText,gapText,points,uciPoints,irm,sortOrder"
                      "&{}&order=id.asc")
RESULTADOS_CATALOG = {
    "resultados_riders_men": "riders_men?select=id,firstName,lastName,nationality,currentTeamId&order=id.asc",
    "resultados_riders_women": "riders_women?select=id,firstName,lastName,nationality,currentTeamId&order=id.asc",
    "resultados_team_list": f"teams?select={TEAM_COLUMNS}&order=id.asc",
}
RESULTADOS_SEASONS = ("resultados_team_seasons", f"team_seasons?select=year,{SEASON_COLUMNS}&year=in.({{}})&order=id.asc")
RESULTADOS_NAMES = (*RESULTADOS_BASE, RESULTADOS_RIDERS[0], RESULTADOS_TEAMS[0], RESULTADOS_RESULTS[0],
                    *RESULTADOS_CATALOG, RESULTADOS_SEASONS[0])
# Versión del formato de los datos de la caché: entra en la firma de cada
# carrera, de modo que cambiarla obliga a leerlas todas.
RESULTADOS_CACHE_CONTRACT = 1
# Días con los mismos datos antes de volver a leer una carrera (más 0–13 según
# su id, para repartir las lecturas): cambios de fichas o equipos que no tocan
# sus clasificaciones (listas y catálogo no tienen marca de modificación).
RESULTADOS_ROTATION_DAYS = 28
# Carreras leídas por build como máximo (relleno progresivo): sin la caché del
# prerender, el resto queda pendiente para los builds siguientes y sus páginas,
# como las escribe gen_og_pages.py. RESULTADOS_MAX_READS de
# prerender-resultados.mjs.
RESULTADOS_MAX_READS = 150

# Lecturas del prerender de perfiles, mapas y órdenes de salida
# (`prerender-auxiliares.mjs`), sin consultas locales, solo con
# PRERENDER_AUXILIARES activo y el orden de salida en su ámbito
# (auxiliares_types); perfil y mapa salen de `race_days`, `races`, `assets` y
# `guides`. En cuanto llegan `races` y `race_days`: las filas de
# `start_order_entries_resolved` de las jornadas con orden importado, por
# tramos de IN_CHUNK jornadas, y los equipos de la lista de sus carreras con
# el equipo y la temporada del año de la carrera embebidos (sin año, sin
# temporada), por año y tramos de IN_CHUNK carreras. Mismas consultas y orden
# que js/orden-salida.js (startlistTeamsQuery), con la carrera añadida para
# repartir los equipos.
AUXILIARES_TYPES = ("perfil", "mapa", "orden")
ORDEN_ENTRIES = ("orden_entries", "start_order_entries_resolved?select=*&{}&order=sortOrder.asc,id.asc")
ORDEN_TEAMS = ("orden_teams", f"startlist_teams?select=raceId,teamId,team:teams({TEAM_COLUMNS},"
               f"team_seasons({SEASON_COLUMNS}))&{{}}&team.team_seasons.year=eq.{{}}&order=id.asc")
ORDEN_TEAMS_WITHOUT_YEAR = f"startlist_teams?select=raceId,teamId,team:teams({TEAM_COLUMNS})&{{}}&order=id.asc"
ORDEN_NAMES = (ORDEN_ENTRIES[0], ORDEN_TEAMS[0])

# Fechas con la misma forma: la colación en_US las ordena como Python.
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class Unsupported(ValueError):
    """Consulta que el volcado no resuelve con la semántica de PostgREST."""


# ── Lectura por la API ─────────────────────────────────────────────────────
_local = threading.local()


def http_request(method, path, headers, body=None):
    """Petición con conexión persistente por hilo: (estado, cabeceras, cuerpo).

    Si el servidor cerró una conexión ya usada, repite una vez con otra nueva."""
    while True:
        reused = getattr(_local, "connection", None) is not None
        if not reused:
            _local.connection = http.client.HTTPSConnection(urlsplit(SUPABASE_URL).hostname, timeout=60)
        connection = _local.connection
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
        except (OSError, http.client.HTTPException):
            connection.close()
            _local.connection = None
            if reused:
                continue
            raise
        if response.getheader("Content-Encoding") == "gzip":
            payload = gzip.decompress(payload)
        return response.status, {key.lower(): value for key, value in response.getheaders()}, payload


def request_page(key, path, offset, count=False, rpc=False, transport=None):
    """Una página de 1.000 filas: (filas, total o None)."""
    transport = transport or http_request
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept-Encoding": "gzip",
               "Range-Unit": "items", "Range": f"{offset}-{offset + PAGE - 1}"}
    if count:
        headers["Prefer"] = "count=exact"
    body = None
    if rpc:
        headers["Content-Type"] = "application/json"
        body = b"{}"
    for attempt in range(1, ATTEMPTS + 1):
        try:
            status, response_headers, payload = transport(
                "POST" if rpc else "GET", f"/rest/v1/{path}", headers, body)
        except (OSError, http.client.HTTPException):
            if attempt == ATTEMPTS:
                raise
        else:
            if status < 300:
                rows = json.loads(payload)
                if not isinstance(rows, list):
                    raise ValueError(f"Respuesta sin filas en {path}")
                total = response_headers.get("content-range", "").rpartition("/")[2]
                return rows, int(total) if total.isdigit() else None
            if status < 500 or attempt == ATTEMPTS:
                raise ValueError(f"Supabase {status} en {path}: {payload[:300]!r}")
        time.sleep(attempt)


def dump_queries():
    queries = {name: (path + "&order=id.asc", False) for name, (path, _) in TABLES.items()}
    queries.update({name: (path + "&order=id.asc", False) for name, path in EXTRA.items()})
    queries.update({name: (f"rpc/{name}", True) for name in RPCS})
    return queries


def inscritos_scope(value, now=None):
    """Carreras que lee el volcado para el prerender de inscritos.

    Según PRERENDER_INSCRITOS: None (off o valor no admitido: sin lecturas; el
    paso falla por su cuenta), {"since": None} con `listas` (todas las carreras
    con lista) o {"since": "AAAA-MM-DD"} con `es` y `all` (hoy, UTC, menos
    INSCRITOS_WINDOW_DAYS), como scopeSince() del prerender."""
    value = (value or "off").strip()
    if value == "listas":
        return {"since": None}
    if value in ("es", "all"):
        now = now or datetime.now(timezone.utc)
        return {"since": (now - timedelta(days=INSCRITOS_WINDOW_DAYS)).date().isoformat()}
    return None


def inscritos_race_ids(races, counts, since):
    """Carreras con lista (equipos en startlist_counts), en el orden de `races`,
    que terminan (o empiezan, sin fecha de fin) en `since` o después; todas sin
    `since`. Como inWindow() del prerender."""
    listed = {row.get("raceId") for row in counts if (row.get("teams") or 0) > 0}
    return [race["id"] for race in races if race.get("id") in listed
            and (since is None or (race.get("endDate") or race.get("startDate") or "") >= since)]


def in_filter(column, values):
    """Filtro `column=in.(…)` con los valores entre comillas, como inFilter() del prerender."""
    items = ('"' + re.sub(r'(["\\])', r"\\\1", str(value)) + '"' for value in values)
    return f"{column}=in.({quote(','.join(items), safe=',')})"


def chunked(values, size):
    return [values[at:at + size] for at in range(0, len(values), size)]


def inscritos_stage_chunks(stages, size):
    """Etapas con filas (rowCount > 0) en tramos de hasta `size` sin partir una
    carrera: las filas de abandono de cada carrera llegan en una sola consulta,
    ordenadas por id como en el navegador."""
    by_race = {}
    for stage in stages:
        if (stage.get("rowCount") or 0) > 0:
            by_race.setdefault(stage.get("raceId"), []).append(stage["id"])
    chunks = []
    for ids in by_race.values():
        if not chunks or len(chunks[-1]) + len(ids) > size:
            chunks.append([])
        chunks[-1].extend(ids)
    return chunks


def auxiliares_types(value):
    """Tipos de página del prerender de perfiles, mapas y órdenes de salida
    según PRERENDER_AUXILIARES: los tres con `es`, los de una lista separada por
    comas (`perfil`, `mapa`, `orden`) o None (off o valor no admitido: sin
    lecturas; el paso falla por su cuenta). Como parseScope() del prerender."""
    value = (value or "off").strip()
    if value == "es":
        return set(AUXILIARES_TYPES)
    types = {item.strip() for item in value.split(",") if item.strip()}
    return types if types and types <= set(AUXILIARES_TYPES) else None


def orden_scope(days, races):
    """Jornadas con orden de salida importado, en el orden de `days`, y sus
    carreras por año ({año: [carrera]}, en orden de aparición)."""
    years = {race.get("id"): race.get("year") for race in races}
    day_ids, by_year, seen = [], {}, set()
    for day in days:
        if not day.get("startOrderImportedAt"):
            continue
        day_ids.append(day["id"])
        race_id = day.get("raceId")
        if race_id and race_id not in seen:
            seen.add(race_id)
            by_year.setdefault(years.get(race_id), []).append(race_id)
    return day_ids, by_year


def resultados_active(value):
    """Si PRERENDER_RESULTADOS pide lecturas: `es` (off o valor no admitido:
    no; el paso falla por su cuenta)."""
    return (value or "off").strip() == "es"


def madrid_today(now=None):
    now = now or datetime.now(timezone.utc)
    return now.astimezone(ZoneInfo("Europe/Madrid")).date()


def _day(value):
    match = ISO_DATE.match(value or "")
    return date.fromisoformat(match.group(0)) if match else None


def near_today(start, end, today):
    """isNearToday() de js/services/refresh-window.js: hoy entre la víspera del
    inicio y el día siguiente al final."""
    first = _day(start)
    if first is None:
        return False
    last = _day(end or start) or first
    return first - timedelta(days=1) <= today <= last + timedelta(days=1)


def resultados_candidates(races, stages, today):
    """Carreras cuyas páginas puede generar el prerender, en el orden de
    `races`: con clasificaciones publicables, con temporada (no archivada) y
    fuera de la ventana de sondeo (isNearToday, día de Madrid). El prerender
    exige además que las clasificaciones de cada página sean oficiales."""
    with_stages = {stage.get("raceId") for stage in stages}
    return [race["id"] for race in races if race.get("id") in with_stages
            and race.get("year") is not None and not archived_seasons.race_is_archived(race)
            and not near_today(race.get("startDate"), race.get("endDate"), today)]


def resultados_signature(race, stages):
    """Firma de los datos de una carrera: cambia si se publica, corrige o
    actualiza alguna clasificación (updatedAt), si se importa su lista o con la
    versión del formato de la caché."""
    lines = [f"{RESULTADOS_CACHE_CONTRACT}|{race.get('id')}|{race.get('year')}|{race.get('startlistImportedAt')}"]
    lines += [f"{stage.get('id')}|{stage.get('updatedAt')}|{stage.get('rowCount')}|{stage.get('publicationStatus')}"
              f"|{stage.get('updating')}" for stage in stages]
    return hashlib.sha1("\n".join(lines).encode()).hexdigest()[:16]


def resultados_cache(directory):
    """Manifiesto de la caché del prerender de resultados (vacío si no hay)."""
    file = Path(directory) / MANIFEST if directory else None
    if not file or not file.is_file():
        return {}
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def resultados_rotation(race_id):
    return RESULTADOS_ROTATION_DAYS + int(hashlib.sha1(str(race_id).encode()).hexdigest()[:4], 16) % 14


def resultados_needing(candidates, signatures, cache, today, race_by_id, limit=None):
    """Candidatas que hay que leer en este build y las que quedan pendientes de
    relleno, por prioridad y con el corte en `limit` (RESULTADOS_MAX_READS):
    primero las que no tienen datos en la caché o han cambiado de firma, de la
    carrera más reciente a la más antigua (fin o, sin él, inicio; sin fechas,
    al final); después, las leídas hace al menos su rotación, de la lectura más
    antigua a la más reciente. A igualdad, el orden de `candidates`."""
    limit = RESULTADOS_MAX_READS if limit is None else limit
    cached = cache.get("races") or {}
    missing, rotated = [], []
    for race_id in candidates:
        entry = cached.get(race_id) or {}
        fetched = _day(entry.get("fetched"))
        if entry.get("sig") != signatures[race_id] or fetched is None:
            missing.append(race_id)
        elif (today - fetched).days >= resultados_rotation(race_id):
            rotated.append((fetched, race_id))

    def recency(race_id):
        race = race_by_id[race_id]
        day = _day(race.get("endDate") or race.get("startDate"))
        return (day is None, -day.toordinal() if day else 0)

    ordered = sorted(missing, key=recency) + [race_id for _, race_id in sorted(rotated, key=lambda item: item[0])]
    return ordered[:limit], ordered[limit:]


def fetch(directory, key, transport=None, workers=WORKERS):
    """Lee todas las tablas del volcado y escribe un JSON por tabla y el manifiesto.

    Con PRERENDER_INSCRITOS activo añade las lecturas de INSCRITOS: dependen de
    `races` y `startlist_counts`, y las filas de abandono, de las etapas. Con
    PRERENDER_RESULTADOS activo, las de resultados: dependen de `races`, de las
    clasificaciones y de la caché del prerender (RESULTADOS_CACHE), hasta
    RESULTADOS_MAX_READS carreras; el manifiesto guarda las pendientes. Con el
    orden de salida en PRERENDER_AUXILIARES, sus filas y equipos: dependen de
    `races` y `race_days`. Esas cadenas van por delante en la cola para no
    alargar el final de la lectura."""
    started = time.monotonic()
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / MANIFEST).unlink(missing_ok=True)
    scope = inscritos_scope(os.environ.get("PRERENDER_INSCRITOS"))
    resultados = {} if resultados_active(os.environ.get("PRERENDER_RESULTADOS")) else None
    auxiliares = auxiliares_types(os.environ.get("PRERENDER_AUXILIARES"))
    orden = {} if auxiliares and "orden" in auxiliares else None
    chain = {"races", "startlist_counts", *INSCRITOS_NAMES} if scope else set()
    if resultados is not None:
        chain |= {"races", *RESULTADOS_NAMES}
    if orden is not None:
        chain |= {"races", "race_days", *ORDEN_NAMES}
    # Lectura -> lista de consultas (tramos), cada una con sus páginas por offset.
    parts = {}
    pages = {}
    totals = {}
    backlog = []
    order = itertools.count()
    pending = {}
    requests = 0
    progress = {"wave": 0, "resultados": 0, "orden": 0}

    def submit(part, offset, count=False):
        heapq.heappush(backlog, (part[0] not in chain, next(order), part, offset, count))

    def add(name, paths, rpc=False):
        parts[name] = [(path, rpc) for path in paths]
        for index in range(len(paths)):
            pages[(name, index)] = {}
            submit((name, index), 0, count=not rpc)

    def complete(name):
        for index in range(len(parts.get(name, ()))):
            chunks = pages[(name, index)]
            if (name, index) in totals:
                if len(chunks) < max(1, -(-totals[(name, index)] // PAGE)):
                    return False
            elif not chunks or len(chunks[max(chunks)]) == PAGE:
                return False
        return name in parts

    def rows_of(name):
        return [row for index in range(len(parts[name]))
                for offset in sorted(pages[(name, index)]) for row in pages[(name, index)][offset]]

    def advance_resultados():
        if resultados is None or progress["resultados"] or not (complete("races") and complete("resultados_stages")):
            return
        races, stages = rows_of("races"), rows_of("resultados_stages")
        today = madrid_today()
        candidates = resultados_candidates(races, stages, today)
        by_race = {}
        for stage in stages:
            by_race.setdefault(stage.get("raceId"), []).append(stage)
        race_by_id = {race["id"]: race for race in races}
        signatures = {race_id: resultados_signature(race_by_id[race_id], by_race[race_id]) for race_id in candidates}
        needing, pending = resultados_needing(candidates, signatures, resultados_cache(os.environ.get("RESULTADOS_CACHE")),
                                              today, race_by_id)
        name, path = RESULTADOS_RIDERS
        add(name, [path.format(in_filter("raceId", chunk)) for chunk in chunked(needing, IN_CHUNK)])
        by_year = {}
        for race_id in needing:
            by_year.setdefault(race_by_id[race_id].get("year"), []).append(race_id)
        name, path = RESULTADOS_TEAMS
        add(name, [path.format(in_filter("raceId", chunk), year)
                   for year, ids in sorted(by_year.items()) for chunk in chunked(ids, IN_CHUNK)])
        name, path = RESULTADOS_RESULTS
        stage_ids = [stage["id"] for race_id in needing for stage in by_race[race_id]]
        add(name, [path.format(in_filter("stageRef", chunk)) for chunk in chunked(stage_ids, IN_CHUNK)])
        for name, path in RESULTADOS_CATALOG.items():
            add(name, [path] if needing else [])
        name, path = RESULTADOS_SEASONS
        add(name, [path.format(",".join(str(year) for year in sorted(by_year)))] if needing else [])
        resultados.update({"madrid": today.isoformat(), "contract": RESULTADOS_CACHE_CONTRACT,
                           "sigs": signatures, "read": needing, "pending": pending})
        progress["resultados"] = 1

    def advance_orden():
        if orden is None or progress["orden"] or not (complete("races") and complete("race_days")):
            return
        day_ids, by_year = orden_scope(rows_of("race_days"), rows_of("races"))
        name, path = ORDEN_ENTRIES
        add(name, [path.format(in_filter("raceDayId", chunk)) for chunk in chunked(day_ids, IN_CHUNK)])
        name, path = ORDEN_TEAMS
        add(name, [path.format(in_filter("raceId", chunk), year) if year is not None
                   else ORDEN_TEAMS_WITHOUT_YEAR.format(in_filter("raceId", chunk))
                   for year, ids in sorted(by_year.items(), key=lambda item: (item[0] is None, item[0] or 0))
                   for chunk in chunked(ids, IN_CHUNK)])
        orden.update({"days": len(day_ids), "races": sum(len(ids) for ids in by_year.values())})
        progress["orden"] = 1

    def advance():
        advance_resultados()
        advance_orden()
        if not scope:
            return
        if progress["wave"] == 0 and complete("races") and complete("startlist_counts"):
            ids = inscritos_race_ids(rows_of("races"), rows_of("startlist_counts"), scope["since"])
            scope["races"] = len(ids)
            for name, path in INSCRITOS.items():
                add(name, [path.format(in_filter("raceId", chunk)) for chunk in chunked(ids, IN_CHUNK)])
            progress["wave"] = 1
        if progress["wave"] == 1 and complete("inscritos_stages"):
            name, path = INSCRITOS_RESULTS
            add(name, [path.format(in_filter("stageRef", chunk))
                       for chunk in inscritos_stage_chunks(rows_of("inscritos_stages"), IN_CHUNK)])
            progress["wave"] = 2

    with ThreadPoolExecutor(workers) as pool:
        def fill():
            while backlog and len(pending) < workers:
                _, _, part, offset, count = heapq.heappop(backlog)
                path, rpc = parts[part[0]][part[1]]
                pending[pool.submit(request_page, key, path, offset, count, rpc, transport)] = (part, offset)

        for name, (path, rpc) in dump_queries().items():
            add(name, [path], rpc)
        if resultados is not None:
            for name, path in RESULTADOS_BASE.items():
                add(name, [path])
        fill()
        while pending:
            future = next(as_completed(pending))
            part, offset = pending.pop(future)
            rows, total = future.result()
            requests += 1
            pages[part][offset] = rows
            if offset == 0 and total is not None:
                # Con el total conocido, el resto de páginas se piden a la vez.
                totals[part] = total
                for following in range(PAGE, total, PAGE):
                    submit(part, following)
            elif part not in totals and len(rows) == PAGE:
                # Sin total (RPC), página a página hasta una corta.
                submit(part, offset + PAGE)
            advance()
            fill()
    counts = {}
    for name in parts:
        for index in range(len(parts[name])):
            chunks = pages[(name, index)]
            total = totals.get((name, index))
            received = sum(len(rows) for rows in chunks.values())
            if total is not None and received != total:
                raise ValueError(f"Volcado incompleto de {name}: {received} de {total} filas")
            if any(len(chunks[offset]) != PAGE for offset in sorted(chunks)[:-1]):
                raise ValueError(f"Página corta intermedia en {name}")
        rows = rows_of(name)
        (directory / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        counts[name] = len(rows)
    seconds = time.monotonic() - started
    manifest = {"created": datetime.now(timezone.utc).isoformat(), "rows": counts,
                "requests": requests, "seconds": round(seconds, 2)}
    if scope:
        manifest["inscritos"] = scope
    if resultados is not None:
        manifest["resultados"] = resultados
    if auxiliares:
        manifest["auxiliares"] = {"types": sorted(auxiliares), "orden": orden}
    (directory / MANIFEST).write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    inscritos = (f"; inscritos: {scope['races']} carreras "
                 + (f"desde {scope['since']}" if scope["since"] else "con lista")) if scope else ""
    if resultados is not None:
        inscritos += (f"; resultados: {len(resultados['sigs'])} carreras candidatas, {len(resultados['read'])} leídas, "
                      f"{len(resultados['pending'])} pendientes de relleno")
    if orden is not None:
        inscritos += f"; orden de salida: {orden['days']} jornadas, {orden['races']} carreras"
    print(f"Datos compartidos: {len(parts)} lecturas, {requests} peticiones, "
          f"{sum(counts.values())} filas, {seconds:.2f} s{inscritos}")
    return manifest


def available(directory):
    return directory is not None and (Path(directory) / MANIFEST).is_file()


# ── Consultas locales ──────────────────────────────────────────────────────
_tables = {}


def directory():
    value = os.environ.get("PAGES_DATA")
    return Path(value) if value and available(value) else None


def enabled():
    return directory() is not None


def table_rows(name):
    base = directory()
    cache_key = (str(base), name)
    if cache_key not in _tables:
        _tables[cache_key] = json.loads((base / f"{name}.json").read_text(encoding="utf-8"))
    return _tables[cache_key]


def split_top(text):
    """Divide por comas fuera de paréntesis."""
    parts, depth, current = [], 0, ""
    for char in text:
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
            continue
        depth += char == "("
        depth -= char == ")"
        if depth < 0:
            raise Unsupported(f"select mal formado: {text}")
        current += char
    if depth:
        raise Unsupported(f"select mal formado: {text}")
    parts.append(current)
    return parts


def parse_select(text):
    items = []
    for part in split_top(text):
        name, paren, rest = part.partition("(")
        if not name or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*|\*", name):
            raise Unsupported(f"columna no admitida en select: {part}")
        if paren:
            if not rest.endswith(")") or name == "*":
                raise Unsupported(f"select mal formado: {part}")
            items.append((name, parse_select(rest[:-1])))
        else:
            items.append((name, None))
    if any(name == "*" for name, _ in items) and len(items) > 1:
        raise Unsupported("select con * y otras columnas")
    return items


def fresh(value):
    """Copia de los valores JSON anidados: cada consulta devuelve objetos propios.

    pickle copia estos valores (dict, list y escalares JSON) unas siete veces
    más rápido que copy.deepcopy."""
    return pickle.loads(pickle.dumps(value, pickle.HIGHEST_PROTOCOL)) if isinstance(value, (dict, list)) else value


def project(row, items):
    if items[0][0] == "*":
        return {key: fresh(value) for key, value in row.items()}
    result = {}
    for name, nested in items:
        if name not in row:
            raise Unsupported(f"columna fuera del volcado: {name}")
        value = row[name]
        if nested is None or value is None:
            result[name] = fresh(value)
        elif isinstance(value, list):
            result[name] = [project(item, nested) for item in value]
        elif isinstance(value, dict):
            result[name] = project(value, nested)
        else:
            raise Unsupported(f"relación sin filas embebidas: {name}")
    return result


def in_values(operand):
    if not (operand.startswith("(") and operand.endswith(")")):
        raise Unsupported(f"lista in mal formada: {operand}")
    values, current, quoted = [], "", False
    for char in operand[1:-1]:
        if char == '"':
            quoted = not quoted
        elif char == "," and not quoted:
            values.append(current)
            current = ""
        else:
            current += char
    values.append(current)
    return values


def typed(value, operand):
    """Operando con el tipo del valor de la fila."""
    if isinstance(value, bool):
        if operand not in ("true", "false"):
            raise Unsupported(f"booleano no admitido: {operand}")
        return operand == "true"
    try:
        if isinstance(value, int):
            return int(operand)
        if isinstance(value, float):
            return float(operand)
    except ValueError:
        raise Unsupported(f"operando no numérico: {operand}") from None
    if isinstance(value, str):
        return operand
    raise Unsupported(f"comparación con valor {type(value).__name__}")


def ordered_text(*values):
    # La colación en_US ordena el texto de otra forma que Python; las fechas
    # AAAA-MM-DD no.
    if not all(ISO_DATE.fullmatch(value) for value in values):
        raise Unsupported(f"comparación de texto que no es fecha: {values!r}")


COMPARISONS = {"gt": lambda a, b: a > b, "gte": lambda a, b: a >= b,
               "lt": lambda a, b: a < b, "lte": lambda a, b: a <= b}


def compile_filter(condition):
    """Predicado sobre el valor de una columna con la semántica de PostgREST."""
    operator, _, operand = condition.partition(".")
    if condition == "not.is.null":
        return lambda value: value is not None
    if condition == "is.null":
        return lambda value: value is None
    if operator == "eq":
        return lambda value: value is not None and value == typed(value, operand)
    if operator == "in":
        items = in_values(operand)
        raw = set(items)

        def member(value):
            if value is None:
                return False
            if isinstance(value, str):
                return value in raw
            return value in [typed(value, item) for item in items]
        return member
    if operator in COMPARISONS:
        compare = COMPARISONS[operator]

        def ordered(value):
            if value is None:
                return False
            target = typed(value, operand)
            if isinstance(value, str):
                ordered_text(value, target)
            return compare(value, target)
        return ordered
    if operator == "ilike":
        pattern = re.compile("".join(".*" if char in "*%" else "." if char == "_" else re.escape(char)
                                     for char in operand), re.IGNORECASE | re.DOTALL)

        def like(value):
            if value is None:
                return False
            if not isinstance(value, str):
                raise Unsupported(f"ilike sobre valor {type(value).__name__}")
            return pattern.fullmatch(value) is not None
        return like
    raise Unsupported(f"filtro no admitido: {condition}")


def sort_key(column):
    def key(entry):
        position, row = entry
        if column == "id":
            return (0, position)
        value = row.get(column)
        if value is None:
            # PostgreSQL trata NULL como mayor: último en asc y primero en desc.
            return (1,)
        if isinstance(value, (dict, list)):
            raise Unsupported(f"orden por columna JSON: {column}")
        if isinstance(value, str):
            ordered_text(value)
        return (0, value)
    return key


def parse_order(text):
    keys = []
    for part in text.split(","):
        column, _, direction = part.partition(".")
        if direction not in ("", "asc", "desc") or not column:
            raise Unsupported(f"orden no admitido: {part}")
        keys.append((column, direction == "desc"))
    return keys


def query(path):
    """Filas de una consulta PostgREST resuelta sobre el volcado."""
    table, _, query_string = path.partition("?")
    if table not in TABLES:
        raise Unsupported(f"tabla fuera del volcado: {table}")
    required = set(TABLES[table][1])
    select, order, filters = [("*", None)], [], []
    for key, value in parse_qsl(query_string, keep_blank_values=True, strict_parsing=True):
        if key == "select":
            select = parse_select(value)
        elif key == "order":
            order = parse_order(value)
        elif key in ("limit", "offset", "or", "and", "not") or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise Unsupported(f"parámetro no admitido: {key}")
        elif f"{key}={value}" in required:
            required.discard(f"{key}={value}")
        else:
            filters.append((key, value))
    if required:
        raise Unsupported(f"faltan filtros del volcado: {sorted(required)}")
    rows = list(enumerate(table_rows(table)))
    for column, condition in filters:
        if rows and column not in rows[0][1]:
            raise Unsupported(f"filtro sobre columna fuera del volcado: {column}")
        predicate = compile_filter(condition)
        rows = [entry for entry in rows if predicate(entry[1].get(column))]
    # Ordenaciones estables de la última clave a la primera sobre el orden por
    # id del volcado: equivale a ORDER BY <claves>, id.
    for column, descending in reversed(order):
        rows.sort(key=sort_key(column), reverse=descending)
    return [project(row, select) for _, row in rows]


def get(path):
    """Filas de `path` desde el volcado, o None si la consulta va por la API."""
    if not enabled():
        return None
    try:
        return query(path)
    except Unsupported as error:
        print(f"Volcado: {error}; lectura por la API de {path.partition('?')[0]}", file=sys.stderr)
        return None


def rpc(name):
    if not enabled() or name not in RPCS:
        return None
    return [{key: fresh(value) for key, value in row.items()} for row in table_rows(name)]


def write_from_sql(source, target, resultados=None, auxiliares=None):
    """Escribe el volcado desde la salida de `sql.mjs --file tools/site/site-data.sql`.

    Las lecturas de inscritos corresponden a las carreras con lista desde
    `inscritos_since` (todas si es null), como el volcado de `listas` o de la
    ventana de `es` y `all`. `resultados`: salida de
    tools/site/prerender-resultados.sql; añade sus lecturas (las filas de todas
    las candidatas) y, como el volcado del build, marca leídas las que no cubre
    la caché de RESULTADOS_CACHE (sin caché, todas), por prioridad y hasta
    RESULTADOS_MAX_READS, y pendientes las demás. `auxiliares`:
    salida de tools/site/prerender-auxiliares.sql; añade las lecturas del orden
    de salida, como un volcado con PRERENDER_AUXILIARES=es."""
    def first_row(file):
        parsed = json.loads(Path(file).read_text(encoding="utf-8"))
        return parsed[0] if isinstance(parsed, list) else parsed

    row = first_row(source)
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    names = {*dump_queries(), *INSCRITOS_NAMES}
    if set(row) != names | {"inscritos_since"}:
        raise ValueError("Columnas del volcado SQL distintas de las lecturas: "
                         f"{sorted(set(row) ^ (names | {'inscritos_since'}))}")
    tables = {name: row[name] for name in names}
    if resultados:
        extra = first_row(resultados)
        missing = set(RESULTADOS_NAMES) - set(extra)
        if missing:
            raise ValueError(f"Faltan lecturas de resultados en {resultados}: {sorted(missing)}")
        tables.update({name: extra[name] for name in RESULTADOS_NAMES})
    if auxiliares:
        extra = first_row(auxiliares)
        missing = set(ORDEN_NAMES) - set(extra)
        if missing:
            raise ValueError(f"Faltan lecturas del orden de salida en {auxiliares}: {sorted(missing)}")
        tables.update({name: extra[name] for name in ORDEN_NAMES})
    for name in sorted(tables):
        (target / f"{name}.json").write_text(json.dumps(tables[name], ensure_ascii=False), encoding="utf-8")
    manifest = {"created": datetime.now(timezone.utc).isoformat(), "source": "sql",
                "rows": {name: len(rows) for name, rows in sorted(tables.items())},
                "inscritos": {"since": row["inscritos_since"]}}
    if resultados:
        today = madrid_today()
        stages = tables["resultados_stages"]
        candidates = resultados_candidates(tables["races"], stages, today)
        by_race = {}
        for stage in stages:
            by_race.setdefault(stage.get("raceId"), []).append(stage)
        race_by_id = {race["id"]: race for race in tables["races"]}
        signatures = {race_id: resultados_signature(race_by_id[race_id], by_race[race_id]) for race_id in candidates}
        read, pending = resultados_needing(candidates, signatures, resultados_cache(os.environ.get("RESULTADOS_CACHE")),
                                           today, race_by_id)
        manifest["resultados"] = {"madrid": today.isoformat(), "contract": RESULTADOS_CACHE_CONTRACT, "read": read,
                                  "pending": pending, "sigs": signatures}
    if auxiliares:
        day_ids, by_year = orden_scope(tables["race_days"], tables["races"])
        manifest["auxiliares"] = {"types": sorted(AUXILIARES_TYPES), "orden": {
            "days": len(day_ids), "races": sum(len(ids) for ids in by_year.values())}}
    (target / MANIFEST).write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Lee el volcado compartido por la API o desde SQL local.")
    parser.add_argument("directory")
    parser.add_argument("--from-sql", help="Salida de sql.mjs con tools/site/site-data.sql")
    parser.add_argument("--resultados", help="Salida de sql.mjs con tools/site/prerender-resultados.sql (con --from-sql)")
    parser.add_argument("--auxiliares", help="Salida de sql.mjs con tools/site/prerender-auxiliares.sql (con --from-sql)")
    arguments = parser.parse_args()
    if arguments.from_sql:
        write_from_sql(arguments.from_sql, arguments.directory, arguments.resultados, arguments.auxiliares)
        return
    key = os.environ.get("SUPABASE_ANON_KEY")
    if not key:
        raise SystemExit("Falta SUPABASE_ANON_KEY")
    fetch(arguments.directory, key)


if __name__ == "__main__":
    main()
