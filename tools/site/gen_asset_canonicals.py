#!/usr/bin/env python3
"""Mapa de PDFs de assets a la página web equivalente: `asset-canonicals.json`.

`scripts/assets-canonical/sync-map.mjs` lo descarga en el VPS y nginx añade a cada PDF la cabecera
`Link: <página>; rel="canonical"`. Correspondencia tipo → página:

| Tipo              | Página                                                         |
| ----------------- | -------------------------------------------------------------- |
| `map`             | `/mapa/{slug}/` si la jornada tiene `routeGpxUrl`; si no, `/jornada/{slug}/` |
| `profile`, `ports`| `/perfil/{slug}/` si hay `elevationProfile` visible; si no, `/jornada/{slug}/` |
| `roadbook`        | `/jornada/{slug}/`                                             |
| `technicalGuide`  | `/competicion/{slug}/` (carrera por etapas) o `/jornada/{slug}/` (un día) |
| `technicalGuide` CX | `/ciclocross/{slug}/` de la temporada vigente                |

Solo URL de `assets.calendariociclismo.app` que terminan en `.pdf`. Se omiten
las jornadas no publicadas y las de temporadas archivadas (`noindex`). Los
mapas de ciclocross son imágenes y quedan fuera. Una ruta con dos destinos
distintos se descarta.
"""
import json
import sys
from urllib.parse import quote, unquote, urlsplit

import gen_sitemap
from archived_seasons import race_is_archived

ASSET_HOST = "assets.calendariociclismo.app"
OUTPUT_NAME = "asset-canonicals.json"
ROAD_TYPES = ("roadbook", "profile", "map", "ports", "technicalGuide")
DAY_SELECT = ("race_days?select=id,slug,raceId,stageNumber,startLocation,finishLocation,dateKey,"
              "routeGpxUrl,profileNotViewable&editorialStatus=eq.published&slug=not.is.null"
              "&order=dateKey.desc,id")
PROFILE_IDS = ("race_days?select=id&editorialStatus=eq.published&slug=not.is.null"
               "&elevationProfile=not.is.null&order=id")
ASSET_SELECT = ("assets?select=id,raceDayId,cxRaceId,type,url"
                f"&type={gen_sitemap.in_filter(ROAD_TYPES)}"
                "&url=ilike.*.pdf&order=id")


def asset_path(url):
    """Ruta normalizada de un PDF alojado en el dominio de assets; None si no aplica.

    Cada segmento se decodifica y se vuelve a codificar como `encodeURIComponent`,
    de modo que la clave coincide con la ruta que lee `sync-map.mjs`."""
    try:
        parts = urlsplit(url or "")
    except ValueError:
        return None
    if parts.scheme != "https" or parts.hostname != ASSET_HOST or not parts.path.lower().endswith(".pdf"):
        return None
    return "/".join(quote(unquote(segment), safe="!*'()") for segment in parts.path.split("/"))


def page_url(section, slug):
    return f"{gen_sitemap.BASE_URL}/{section}/{quote(slug)}/"


def build_map(assets, races, racedays, profile_day_ids, cx_races):
    """Devuelve `({ruta: canónica}, estadísticas)` a partir de filas ya leídas."""
    races, racedays = gen_sitemap.indexable(races, racedays)
    race_by_id = {race["id"]: race for race in races}
    day_by_id = {day["id"]: day for day in racedays}
    masters, _, _ = gen_sitemap.alias_masters(racedays)
    cx_by_id = {race["id"]: race for race in cx_races if race.get("slug")}
    profile_day_ids = set(profile_day_ids)
    found, conflicts = {}, set()
    stats = {"assets": 0, "omitidos": 0, "conflictos": 0}

    def target(asset):
        if asset.get("cxRaceId"):
            cx_race = cx_by_id.get(asset["cxRaceId"])
            if asset.get("type") != "technicalGuide" or not cx_race:
                return None
            return page_url("ciclocross", cx_race["slug"])
        day = day_by_id.get(asset.get("raceDayId"))
        race = race_by_id.get((day or {}).get("raceId"))
        if not day or not race:
            return None
        slug = masters.get(day["slug"], day["slug"])
        kind = asset.get("type")
        if kind == "map" and day.get("routeGpxUrl"):
            return page_url("mapa", slug)
        if kind in ("profile", "ports") and day["id"] in profile_day_ids and not day.get("profileNotViewable"):
            return page_url("perfil", slug)
        if kind == "technicalGuide" and race.get("raceFormat") != "one_day" and race.get("slug"):
            return page_url("competicion", race["slug"])
        if kind in ROAD_TYPES:
            return page_url("jornada", slug)
        return None

    for asset in assets:
        path = asset_path(asset.get("url"))
        if not path:
            continue
        stats["assets"] += 1
        destination = target(asset)
        if not destination:
            stats["omitidos"] += 1
        elif found.setdefault(path, destination) != destination:
            conflicts.add(path)
    for path in conflicts:
        del found[path]
    stats["conflictos"] = len(conflicts)
    return dict(sorted(found.items())), stats


def fetch():
    races = gen_sitemap.supabase_get(gen_sitemap.RACE_SELECT)
    racedays = gen_sitemap.supabase_get(DAY_SELECT)
    profile_ids = [row["id"] for row in gen_sitemap.supabase_get(PROFILE_IDS)]
    assets = gen_sitemap.supabase_get(ASSET_SELECT)
    return assets, races, racedays, profile_ids, gen_sitemap.fetch_cx()


def write_map(mapping, name=OUTPUT_NAME):
    with open(name, "w", encoding="utf-8") as stream:
        stream.write(json.dumps(mapping, sort_keys=True, separators=(",", ":")) + "\n")


def main():
    if not gen_sitemap.ANON_KEY:
        raise SystemExit("Falta SUPABASE_ANON_KEY en secretos del repositorio.")
    mapping, stats = build_map(*fetch())
    write_map(mapping)
    print(f"{OUTPUT_NAME}: {len(mapping)} rutas ({stats['assets']} PDF de assets, "
          f"{stats['omitidos']} sin página, {stats['conflictos']} con destinos distintos)")


if __name__ == "__main__":
    sys.exit(main())
