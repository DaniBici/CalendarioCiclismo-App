"""Volcado compartido: semántica PostgREST de las consultas locales y paridad con la API."""
import io
import json
import os
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qsl, quote, urlencode, urlsplit
from urllib.request import Request

import gen_asset_canonicals
import gen_feeds
import gen_sitemap
import site_data
from test_generated import FakePostgrest, catalog, catalog_day, catalog_race, inside, tree

ROOT = Path(__file__).resolve().parents[2]
SUPABASE_URL = "https://bcecwlkynpgovnzhbpah.supabase.co"

ROWS = [
    {"id": "a", "slug": "a-2", "raceId": "r1", "dateKey": "2026-05-02", "stageNumber": 2,
     "isRestDay": False, "year": 2026, "editorialStatus": "published", "url": "https://x/A.PDF",
     "elevationProfile": {"points": [1, 2]}},
    {"id": "B", "slug": "b-0", "raceId": "r1", "dateKey": "2026-05-01", "stageNumber": None,
     "isRestDay": True, "year": 2026, "editorialStatus": "published", "url": None,
     "elevationProfile": None},
    {"id": "c", "slug": "c-1", "raceId": "uci-2027-1", "dateKey": "2026-05-02", "stageNumber": 1,
     "isRestDay": False, "year": 2027, "editorialStatus": "published", "url": "https://x/c.jpg",
     "elevationProfile": None},
    {"id": "d", "slug": None, "raceId": None, "dateKey": None, "stageNumber": None,
     "isRestDay": False, "year": None, "editorialStatus": "published", "url": None,
     "elevationProfile": None},
]
CX = [{"id": "x1", "name": "Cross", "dateKey": "2026-11-01",
       "cx_tournaments": {"id": "t1", "slug": "copa", "name": "Copa", "updatedAt": "2026-10-01T00:00:00+00:00"},
       "cx_race_categories": [{"category": "elite-men", "dateKey": "2026-11-01", "isCancelled": False}],
       "cx_videos": []}]


class EmbeddingPostgrest(FakePostgrest):
    """FakePostgrest con las relaciones embebidas que leen los prerender:
    `assets(*)` de race_days y `race_days!inner(raceId,dateKey)` de assets, con
    su filtro `race_days.raceId`. El resto de embebidos llega ya en las filas."""

    def __call__(self, request, *args, **kwargs):
        url = urlsplit(request.full_url)
        table = url.path.split("/rest/v1/", 1)[1]
        params = parse_qsl(url.query)
        select = dict(params).get("select")
        days = {day["id"]: day for day in self.tables.get("race_days", [])}
        if table == "race_days" and select == "*,assets(*)":
            assets = sorted(self.tables.get("assets", []), key=lambda asset: asset["id"])
            rows = [{**day, "assets": [asset for asset in assets if asset.get("raceDayId") == day["id"]]}
                    for day in self.tables.get("race_days", [])]
        elif table == "assets" and select == "*,race_days!inner(raceId,dateKey)":
            rows = [{**asset, "race_days": {key: days[asset["raceDayId"]][key] for key in ("raceId", "dateKey")}}
                    for asset in self.tables.get("assets", []) if asset.get("raceDayId") in days]
            for key, condition in params:
                if key == "race_days.raceId":
                    rows = [row for row in rows if self.matches(row, condition, row["race_days"]["raceId"])]
        else:
            return super().__call__(request, *args, **kwargs)
        self.calls.append(table + "?" + url.query)
        rest = urlencode([(key, value) for key, value in params if key != "select" and "." not in key])
        return FakePostgrest({table: rows})(Request(f"https://fixture/rest/v1/{table}?{rest}"))


def paged(fake, path, headers):
    """Respuesta de `fake` a `path` según su Range, con el total si se pide
    count=exact, como PostgREST: (estado, cabeceras, cuerpo)."""
    rows = json.loads(fake(Request("https://fixture" + path)).read())
    start, end = (int(value) for value in headers["Range"].split("-"))
    page = rows[start:end + 1]
    response = {}
    if headers.get("Prefer") == "count=exact":
        response["content-range"] = f"{start}-{start + len(page) - 1}/{len(rows)}"
    return 200, response, json.dumps(page).encode()


def inscritos_catalog(today, fillers=0):
    """Carreras con lista dentro y fuera de la ventana de 7 días, sin lista y,
    con `fillers`, carreras de relleno (ids anteriores) que reparten las
    lecturas en dos tramos de 100 carreras."""
    day = lambda offset: (today + timedelta(days=offset)).isoformat()  # noqa: E731
    year = today.year
    races = [catalog_race("r1", "vuelta-x", year, start=day(-2), end=day(3)),
             catalog_race("r2", "clasica-x", year, race_format="one_day", start=day(5), end=day(5)),
             catalog_race("r3", "giro-x", year, start=day(-40), end=day(-30), startlistProvisional=True),
             catalog_race("r4", "sin-lista", year, race_format="one_day", start=day(6), end=day(6))]
    races += [catalog_race(f"a{at:03d}", f"relleno-{at}", year, race_format="one_day", start=day(9), end=day(9))
              for at in range(fillers)]
    days = [catalog_day("d1", "r1", "vuelta-x-etapa-1", day(-2), 1),
            catalog_day("d2", "r1", "vuelta-x-descanso", day(0), None, isRestDay=True),
            catalog_day("d0", "r1", "vuelta-x-etapa-2", day(1), 2),
            catalog_day("d3", "r1", "vuelta-x-borrador", day(2), 3, editorialStatus="draft"),
            catalog_day("d5", "r2", "clasica-x", day(5), None),
            catalog_day("d6", "r3", "giro-x-etapa-1", day(-40), 1)]
    assets = [{"id": "x2", "raceDayId": "d5", "cxRaceId": None, "type": "profile", "url": "https://x/perfil.pdf"},
              {"id": "x1", "raceDayId": "d5", "cxRaceId": None, "type": "technicalGuide", "url": "https://x/guia.pdf"},
              {"id": "x3", "raceDayId": "d1", "cxRaceId": None, "type": "technicalGuide", "url": "https://x/vuelta.pdf"},
              {"id": "x4", "raceDayId": "d6", "cxRaceId": None, "type": "map", "url": "https://x/mapa.pdf"}]

    def team(team_id, name, color):
        return {"id": team_id, "name": name, "nameAliases": None, "category": "WT", "gender": "male",
                "headerBg": "#1f2937", "headerText": "#ffffff", "badgeTorsoCenter": "#ffffff",
                "badgeTorsoSides": "#000000", "badgeInnerCircle": None, "badgeShorts": "#000000",
                "team_seasons": [{"id": f"{team_id}_{year}", "teamId": team_id, "year": year, "name": f"{name} {year}",
                                  "headerBg": color, "headerText": "#ffffff"},
                                 {"id": f"{team_id}_{year - 1}", "teamId": team_id, "year": year - 1,
                                  "name": f"{name} {year - 1}", "headerBg": "#000000"}]}

    def entry(entry_id, race_id, name, order, global_team=None):
        return {"id": entry_id, "raceId": race_id, "teamName": name, "sortOrder": order,
                "teamId": global_team["id"] if global_team else None, "isConfirmed": True,
                "createdAt": "2026-09-01T10:00:00+00:00", "team": global_team}

    def rider(rider_id, team_id, race_id, dorsal, name, global_id=None, country="ES"):
        return {"id": rider_id, "teamId": team_id, "raceId": race_id, "dorsal": dorsal, "firstName": name,
                "lastName": f"Apellido {rider_id}", "createdAt": "2026-09-01T10:00:00+00:00",
                "countryCode": country, "globalRiderId": global_id, "verified": True, "source": "uci",
                "birthDate": "2000-01-01", "currentTeamId": None, "race_gender": "male"}

    uno, dos = team("g1", "Global Uno", "#aa0000"), team("g2", "Global Dos", "#00aa00")
    teams = [entry("t1", "r1", "Equipo Uno", 2, uno), entry("t2", "r1", "Equipo Dos", 1, dos),
             entry("t3", "r1", "Sin equipo", 1), entry("t4", "r2", "Equipo Uno", 1, uno),
             entry("t5", "r3", "Equipo Dos", 1, dos)]
    riders = [rider("p3", "t1", "r1", 3, "Ana", "gr3"), rider("p1", "t1", "r1", 1, "Bea", "gr1"),
              rider("p0", "t1", "r1", 0, "Sin dorsal"), rider("p2", "t2", "r1", 11, "Carla", "gr2", "FR"),
              rider("p4", "t3", "r1", 21, "Dora"), rider("p5", "t4", "r2", 1, "Eva", "gr1"),
              rider("p6", "t5", "r3", 7, "Fe", "gr2"), rider("p7", None, "r1", 99, "Fuera")]
    for at in range(fillers):
        teams.append(entry(f"tf{at:03d}", f"a{at:03d}", "Relleno", 1))
        riders.append(rider(f"pf{at:03d}", f"tf{at:03d}", f"a{at:03d}", 1, "Relleno"))
    stages = [{"id": "u1", "raceId": "r1", "stageNumber": 1, "rowCount": 120, "classKind": "stage", "keepForWeb": True},
              {"id": "u2", "raceId": "r1", "stageNumber": 2, "rowCount": 0, "classKind": "stage"},
              {"id": "u3", "raceId": "r1", "stageNumber": 1, "rowCount": 120, "classKind": "gc"},
              {"id": "u4", "raceId": "r3", "stageNumber": 1, "rowCount": 100, "classKind": "stage"}]
    results = [{"id": 1, "stageRef": "u1", "raceId": "r1", "globalRiderId": "gr3", "irm": "DNF"},
               {"id": 2, "stageRef": "u3", "raceId": "r1", "globalRiderId": "gr1", "irm": "DNF"},
               {"id": 3, "stageRef": "u1", "raceId": "r1", "globalRiderId": None, "irm": "DNS"},
               {"id": 4, "stageRef": "u1", "raceId": "r1", "globalRiderId": "gr2", "irm": None},
               {"id": 5, "stageRef": "u4", "raceId": "r3", "globalRiderId": "gr2", "irm": "DNS"}]
    listed = {}
    for row in teams:
        listed[row["raceId"]] = listed.get(row["raceId"], 0) + 1
    counts = [{"raceId": race_id, "teams": number, "riders": 1} for race_id, number in listed.items()]
    counts.append({"raceId": "r4", "teams": 0, "riders": 3})
    return {"races": races, "race_days": days, "assets": assets, "startlist_teams": teams,
            "startlist_riders_resolved": riders, "race_uci_stages": stages, "race_uci_results": results,
            "rpc/startlist_counts": counts, "broadcasts": [], "cx_races": []}


def write_dump(directory, tables):
    directory.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        (directory / f"{name}.json").write_text(json.dumps(rows), encoding="utf-8")
    (directory / site_data.MANIFEST).write_text("{}", encoding="utf-8")


class SharedDataTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.data = self.root / "data"
        environment = patch.dict(os.environ, {"PAGES_DATA": str(self.data)})
        environment.start()
        self.addCleanup(environment.stop)
        site_data._tables.clear()

    def ids(self, path):
        return [row["id"] for row in site_data.query(path)]

    def test_order_follows_postgres_nulls_and_breaks_ties_by_id(self):
        write_dump(self.data, {"race_days": ROWS})
        base = "race_days?select=id&editorialStatus=eq.published&order="
        # NULL es el mayor valor; los empates conservan el orden por id del volcado.
        self.assertEqual(self.ids(base + "dateKey.desc"), ["d", "a", "c", "B"])
        self.assertEqual(self.ids(base + "dateKey.asc,id"), ["B", "a", "c", "d"])
        self.assertEqual(self.ids(base + "dateKey.asc,stageNumber.asc,id.asc"), ["B", "c", "a", "d"])
        self.assertEqual(self.ids(base + "stageNumber.desc,id.desc"), ["d", "B", "a", "c"])
        self.assertEqual(self.ids("race_days?select=id&editorialStatus=eq.published"), ["a", "B", "c", "d"])

    def test_filters_compare_with_the_column_type(self):
        write_dump(self.data, {"race_days": ROWS})
        base = "race_days?select=id&editorialStatus=eq.published&"
        self.assertEqual(self.ids(base + "isRestDay=eq.false"), ["a", "c", "d"])
        self.assertEqual(self.ids(base + "year=gte.2027"), ["c"])
        self.assertEqual(self.ids(base + "year=eq.2026&stageNumber=not.is.null"), ["a"])
        self.assertEqual(self.ids(base + "raceId=" + quote('in.("r1","uci-2027-1")', safe="().,")), ["a", "B", "c"])
        self.assertEqual(self.ids(base + "raceId=in.(uci-2027-1)"), ["c"])
        self.assertEqual(self.ids(base + "dateKey=gte.2026-05-02&dateKey=lte.2026-05-31"), ["a", "c"])
        self.assertEqual(self.ids(base + "url=ilike.*.pdf"), ["a"])
        self.assertEqual(self.ids(base + "slug=is.null"), ["d"])

    def test_projection_keeps_select_order_and_returns_own_objects(self):
        write_dump(self.data, {"race_days": ROWS, "cx_races": CX})
        path = "race_days?select=stageNumber,id,elevationProfile&editorialStatus=eq.published&slug=eq.a-2"
        first = site_data.query(path)
        self.assertEqual(list(first[0]), ["stageNumber", "id", "elevationProfile"])
        first[0]["elevationProfile"]["points"].append(3)
        self.assertEqual(site_data.query(path)[0]["elevationProfile"], {"points": [1, 2]})
        cx = site_data.query("cx_races?select=id,cx_tournaments(id,slug),cx_race_categories(category)"
                             "&editorialStatus=eq.published&order=dateKey,id")
        self.assertEqual(cx, [{"id": "x1", "cx_tournaments": {"id": "t1", "slug": "copa"},
                               "cx_race_categories": [{"category": "elite-men"}]}])

    def test_queries_the_dump_cannot_answer_go_to_the_api(self):
        write_dump(self.data, {"race_days": ROWS})
        for path in ("race_days?select=id",  # sin el filtro de publicadas: el volcado no tiene el resto
                     "race_days?select=id&editorialStatus=eq.published&order=slug",  # colación en_US
                     "race_days?select=id&editorialStatus=eq.published&raceId=neq.r1",
                     "race_days?select=missing&editorialStatus=eq.published",
                     "race_days?select=id&editorialStatus=eq.published&limit=1",
                     "broadcasts_unknown?select=id"):
            with self.subTest(path=path):
                with self.assertRaises(site_data.Unsupported):
                    site_data.query(path)
                with patch("sys.stderr"):
                    self.assertIsNone(site_data.get(path))
        with patch.dict(os.environ, {"PAGES_DATA": str(self.root / "missing")}):
            self.assertIsNone(site_data.get("race_days?select=id&editorialStatus=eq.published"))

    def test_fetch_requests_known_pages_together_and_checks_totals(self):
        rows = [{"id": f"r{index:04d}"} for index in range(2500)]
        requests = []

        def transport(method, path, headers, body=None):
            requests.append((path.split("?")[0], headers["Range"]))
            start, end = (int(value) for value in headers["Range"].split("-"))
            if path.startswith("/rest/v1/races?"):
                page = rows[start:end + 1]
                return 206, {"content-range": f"{start}-{start + len(page) - 1}/{len(rows)}"}, json.dumps(page).encode()
            return 200, {}, b"[]"

        with patch("builtins.print"):
            manifest = site_data.fetch(self.data, "fixture", transport=transport)
        self.assertEqual(json.loads((self.data / "races.json").read_text()), rows)
        self.assertEqual(manifest["rows"]["races"], 2500)
        self.assertEqual(sorted(r for p, r in requests if p == "/rest/v1/races"),
                         ["0-999", "1000-1999", "2000-2999"])
        self.assertTrue(site_data.available(self.data))

        def short(method, path, headers, body=None):
            status, response_headers, payload = transport(method, path, headers, body)
            if path.startswith("/rest/v1/races?") and headers["Range"] == "1000-1999":
                return status, response_headers, json.dumps(rows[1000:1500]).encode()
            return status, response_headers, payload

        with self.assertRaises(ValueError), patch("builtins.print"):
            site_data.fetch(self.data, "fixture", transport=short)
        self.assertFalse(site_data.available(self.data))

    def test_fetch_reads_the_inscritos_scope_first_and_by_race_chunks(self):
        today = datetime.now(timezone.utc).date()
        fake = EmbeddingPostgrest(inscritos_catalog(today))
        requests = []

        def transport(method, path, headers, body=None):
            requests.append(urlsplit(path).path.split("/rest/v1/", 1)[1])
            return paged(fake, path, headers)

        def read(name):
            return json.loads((self.data / f"{name}.json").read_text())

        with patch("builtins.print"):
            manifest = site_data.fetch(self.data, "fixture", transport=transport, workers=1)
        self.assertNotIn("inscritos", manifest)
        self.assertFalse((self.data / "inscritos_riders.json").exists())
        self.assertEqual(len(requests), len(site_data.dump_queries()))

        requests.clear()
        with patch.dict(os.environ, {"PRERENDER_INSCRITOS": "all"}), patch.object(site_data, "IN_CHUNK", 1), \
                patch("builtins.print"):
            manifest = site_data.fetch(self.data, "fixture", transport=transport, workers=1)
        self.assertEqual(manifest["inscritos"], {"since": (today - timedelta(days=7)).isoformat(), "races": 2})
        # Con un hilo, la cadena de inscritos (una carrera por tramo) va antes que el resto de tablas.
        self.assertEqual(requests[:9], ["races", "rpc/startlist_counts", "startlist_teams", "startlist_teams",
                                        "startlist_riders_resolved", "startlist_riders_resolved",
                                        "race_uci_stages", "race_uci_stages", "race_uci_results"])
        self.assertEqual(len(requests), len(site_data.dump_queries()) + 7)
        # Cada carrera conserva el orden de la API: equipos por sortOrder e id, corredores por dorsal e id.
        self.assertEqual([row["id"] for row in read("inscritos_teams")], ["t2", "t3", "t1", "t4"])
        self.assertEqual(read("inscritos_teams")[0]["team"]["team_seasons"][0]["teamId"], "g2")
        self.assertEqual([row["id"] for row in read("inscritos_riders")], ["p0", "p1", "p3", "p2", "p4", "p5"])
        self.assertEqual([row["id"] for row in read("inscritos_stages")], ["u1", "u2"])
        self.assertEqual(read("inscritos_results"), [{"globalRiderId": "gr3", "irm": "DNF", "stageRef": "u1"}])

        with patch.dict(os.environ, {"PRERENDER_INSCRITOS": "listas"}), patch("builtins.print"):
            manifest = site_data.fetch(self.data, "fixture", transport=transport)
        self.assertEqual(manifest["inscritos"], {"since": None, "races": 3})
        # Un solo tramo: por dorsal e id entre las tres carreras; el prerender agrupa por carrera.
        self.assertEqual([row["id"] for row in read("inscritos_riders")], ["p0", "p1", "p5", "p3", "p6", "p2", "p4"])
        self.assertEqual(len(read("inscritos_results")), 2)

    def test_sql_dump_keeps_the_inscritos_scope(self):
        names = {*site_data.dump_queries(), *site_data.INSCRITOS_NAMES}
        source = self.root / "datos.json"
        source.write_text(json.dumps([{**{name: [] for name in names}, "inscritos_since": None}]))
        site_data.write_from_sql(source, self.data)
        manifest = json.loads((self.data / site_data.MANIFEST).read_text())
        self.assertEqual(manifest["inscritos"], {"since": None})
        self.assertEqual(json.loads((self.data / "inscritos_teams.json").read_text()), [])
        source.write_text(json.dumps([{name: [] for name in names}]))
        with self.assertRaises(ValueError):
            site_data.write_from_sql(source, self.data)


class GeneratorParityTest(unittest.TestCase):
    """Con el volcado, los generadores no leen la API y escriben los mismos bytes."""

    NOW = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        site_data._tables.clear()

    def generate(self, directory, urlopen):
        tools = Path(__file__).resolve().parent
        with patch.dict(os.environ, {"SUPABASE_ANON_KEY": "fixture"}), patch(
                "urllib.request.urlopen", urlopen), patch.object(gen_sitemap, "urlopen", urlopen), patch.object(
                gen_feeds, "urlopen", urlopen), patch.object(gen_sitemap, "today", "2026-09-26"), patch.object(
                gen_sitemap, "today_d", date(2026, 9, 26)), patch("builtins.print"):
            with inside(directory / "og"), patch.object(sys, "argv", ["gen_og_pages.py"]):
                runpy.run_path(str(tools / "gen_og_pages.py"), run_name="__main__")
            with inside(directory / "sitemap"):
                gen_sitemap.generate_full()
                gen_asset_canonicals.write_map(gen_asset_canonicals.build_map(*gen_asset_canonicals.fetch())[0])
            with inside(directory / "feeds"):
                gen_feeds.generate_feeds(self.NOW)
        pages = tree(directory)
        # atom.xml lleva la hora de generación.
        pages["sitemap/atom.xml"] = re.sub(rb"<updated>[0-9T:-]+Z</updated>", b"", pages["sitemap/atom.xml"], 1)
        return pages

    def test_generators_read_only_the_dump_and_write_the_same_files(self):
        tables = catalog(True)
        tables["assets"] = [{"id": "s1", "raceDayId": "d1", "cxRaceId": None, "type": "map",
                             "url": "https://assets.calendariociclismo.app/races/vuelta/2026/stage-1/map.pdf"}]
        recorder = FakePostgrest(tables)
        self.generate(self.root / "record", recorder)
        # Columnas que leen los generadores, nulas donde el catálogo no las trae
        # (PostgREST devuelve todas las columnas de la tabla con select=*).
        columns = {}
        for call in recorder.calls:
            table, _, query = call.partition("?")
            for key, value in parse_qsl(query):
                names = ([name for name, nested in site_data.parse_select(value) if nested is None and name != "*"]
                         if key == "select" else [] if key == "order" else [key])
                columns.setdefault(table, set()).update(names)
        for table, rows in tables.items():
            for row in rows:
                for column in sorted(columns.get(table, ())):
                    row.setdefault(column, None)
        api = self.generate(self.root / "api", FakePostgrest(tables))

        def transport(method, path, headers, body=None):
            return 200, {}, FakePostgrest(tables)(Request("https://fixture" + path)).read()

        def forbidden(request, *args, **kwargs):
            raise AssertionError(f"Lectura por la API con volcado: {request.full_url}")

        with patch("builtins.print"):
            site_data.fetch(self.root / "data", "fixture", transport=transport)
        with patch.dict(os.environ, {"PAGES_DATA": str(self.root / "data")}):
            shared = self.generate(self.root / "shared", forbidden)
        self.assertEqual(set(shared), set(api))
        self.assertGreater(len(api), 50)
        for name, content in api.items():
            self.assertEqual(shared[name], content, name)


@unittest.skipUnless(shutil.which("node"), "sin Node")
class InscritosPrerenderParityTest(unittest.TestCase):
    """prerender-inscritos.mjs escribe los mismos bytes con el volcado (sin leer la
    API) que por la API, con las carreras repartidas en dos tramos."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        site_data._tables.clear()
        self.fake = EmbeddingPostgrest(inscritos_catalog(datetime.now(timezone.utc).date(), fillers=105))
        self.requests = []
        fake, requests = self.fake, self.requests

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.answer()

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                self.answer()

            def answer(self):
                requests.append(self.path)
                status, headers, payload = paged(fake, self.path, self.headers)
                self.send_response(status)
                for name, value in {**headers, "Content-Type": "application/json",
                                    "Content-Length": str(len(payload))}.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.api = f"http://127.0.0.1:{server.server_address[1]}"
        # La API pública del prerender, redirigida al PostgREST de la prueba.
        self.preload = self.root / "api.mjs"
        self.preload.write_text("const fetchApi = globalThis.fetch;\n"
                                f"globalThis.fetch = (url, init) => fetchApi(String(url).replace({json.dumps(SUPABASE_URL)}, "
                                "process.env.FAKE_SUPABASE_URL), init);\n", encoding="utf-8")

    def site(self, name):
        site = self.root / name
        for race in self.fake.tables["races"][:4]:
            for directory, slug, container in (("inscritos", race["slug"], "inscritosContent"),
                                               ("en/startlist", race["slugEn"], "startlistContent")):
                page = site / directory / slug / "index.html"
                page.parent.mkdir(parents=True, exist_ok=True)
                page.write_text(f'<html><head><meta name="cc:race-id" content="{race["id"]}"></head><body>'
                                '<header class="site-header" id="siteHeader" data-back></header>'
                                f'<main id="{container}"><div class="static-prerender">bloque</div></main>'
                                '</body></html>', encoding="utf-8")
        return site

    def prerender(self, site, scope, since, data=None):
        environment = {key: value for key, value in os.environ.items() if key != "PAGES_DATA"}
        environment.update({"FAKE_SUPABASE_URL": self.api, "SUPABASE_ANON_KEY": "fixture",
                            **({"PAGES_DATA": str(data)} if data else {})})
        command = ["node", "--import", self.preload.as_uri(), str(ROOT / "tools/site/prerender-inscritos.mjs"),
                   str(site), "--scope", scope, *(["--since", since] if since else [])]
        result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def check(self, scope, slugs):
        def transport(method, path, headers, body=None):
            return paged(self.fake, path, headers)

        with patch.dict(os.environ, {"PRERENDER_INSCRITOS": scope}), patch("builtins.print"):
            since = site_data.fetch(self.root / "data", "fixture", transport=transport)["inscritos"]["since"]
        self.assertIn("datos (volcado compartido)", self.prerender(self.site("shared"), scope, since, self.root / "data"))
        self.assertEqual(self.requests, [])
        self.assertNotIn("volcado compartido", self.prerender(self.site("api"), scope, since))
        self.assertTrue(self.requests)
        shared, api = tree(self.root / "shared"), tree(self.root / "api")
        self.assertEqual(shared, api)
        expected = sorted(f"{directory}/{slug}{suffix}/index.html" for slug in slugs
                          for directory, suffix in (("inscritos", ""), ("en/startlist", "-en")))
        self.assertEqual(sorted(name for name, page in api.items() if b"data-prerendered" in page), expected)
        # Los datos llegan a la página: abandono tachado, equipo global y documentos de la jornada de un día.
        stage_race = api["inscritos/vuelta-x/index.html"].decode()
        self.assertIn("startlist-rider--out", stage_race)
        self.assertIn("Global Dos", stage_race)
        self.assertIn("https://x/perfil.pdf", api["inscritos/clasica-x/index.html"].decode())
        return api

    def test_window_scope(self):
        self.check("all", ["vuelta-x", "clasica-x"])

    def test_all_races_with_list(self):
        self.check("listas", ["vuelta-x", "clasica-x", "giro-x"])



class ResultadosPostgrest(EmbeddingPostgrest):
    """FakePostgrest con lo que leen los resultados: filtro `gt` y equipos de la
    lista con su equipo y la temporada del año embebidos (`team:teams(…,
    team_seasons(…))` con `team.team_seasons.year`)."""

    @staticmethod
    def matches(row, condition, value):
        operator, _, operand = condition.partition(".")
        if operator == "gt":
            return value is not None and value > int(operand)
        return EmbeddingPostgrest.matches(row, condition, value)

    def __call__(self, request, *args, **kwargs):
        url = urlsplit(request.full_url)
        table = url.path.split("/rest/v1/", 1)[1]
        params = parse_qsl(url.query)
        select = dict(params).get("select", "")
        if table != "startlist_teams" or ",team:teams(" not in select:
            return super().__call__(request, *args, **kwargs)
        self.calls.append(table + "?" + url.query)
        year = int(dict(params)["team.team_seasons.year"].partition(".")[2])
        team_columns = site_data.TEAM_COLUMNS.split(",")
        season_columns = site_data.SEASON_COLUMNS.split(",")
        teams = {team["id"]: team for team in self.tables.get("teams", [])}
        seasons = sorted(self.tables.get("team_seasons", []), key=lambda season: season["id"])
        rows = []
        for entry in self.tables["startlist_teams"]:
            team = teams.get(entry.get("teamId"))
            rows.append({"id": entry["id"], "raceId": entry["raceId"], "teamId": entry.get("teamId"),
                         "teamName": entry.get("teamName"),
                         "team": None if team is None else {
                             **{column: team.get(column) for column in team_columns},
                             "team_seasons": [{column: season.get(column) for column in season_columns}
                                              for season in seasons
                                              if season["teamId"] == team["id"] and season["year"] == year]}})
        rest = urlencode([(key, value) for key, value in params if key != "select" and "." not in key])
        return FakePostgrest({table: rows})(Request(f"https://fixture/rest/v1/{table}?{rest}"))


def resultados_catalog(today):
    """Carreras cerradas (por etapas con una cancelada y la general final; de un
    día sin lista, con corredores de las fichas), en la ventana de sondeo,
    provisional y archivada, con más de 20 filas por clasificación."""
    day = lambda offset: (today + timedelta(days=offset)).isoformat()  # noqa: E731
    year = int(day(-10)[:4])
    races = [catalog_race("r1", "vuelta-x", year, start=day(-24), end=day(-20), startlistImportedAt="2026-01-01T10:00:00+00:00",
                          colorHex="#aa0000", websiteUrl="https://vuelta.example"),
             catalog_race("r2", "clasica-x", year, race_format="one_day", start=day(-10), end=day(-10)),
             catalog_race("r3", "giro-x", year, start=day(-3), end=day(-1)),
             catalog_race("r4", "provisional-x", year, race_format="one_day", start=day(-12), end=day(-12)),
             catalog_race("r5", "archivada-x", 2024, race_format="one_day", start="2024-05-01", end="2024-05-01")]
    days = [catalog_day("d1", "r1", "vuelta-x-etapa-1", day(-24), 1, neutralStartTimeUtc=f"{day(-24)}T10:15:00+00:00"),
            catalog_day("d2", "r1", "vuelta-x-etapa-2", day(-23), 2, isCancelledDay=True),
            catalog_day("dr", "r1", "vuelta-x-descanso", day(-22), None, isRestDay=True),
            catalog_day("d3", "r1", "vuelta-x-etapa-3", day(-21), 3, distanceKm=171.5),
            catalog_day("d4", "r2", "clasica-x", day(-10), None),
            catalog_day("d5", "r3", "giro-x-etapa-1", day(-3), 1),
            catalog_day("d6", "r4", "provisional-x", day(-12), None),
            catalog_day("d7", "r5", "archivada-x", "2024-05-01", None)]
    assets = [{"id": "x1", "raceDayId": "d1", "cxRaceId": None, "type": "technicalGuide", "url": "https://x/guia.pdf"},
              {"id": "x2", "raceDayId": "d3", "cxRaceId": None, "type": "profile", "url": "https://x/perfil.pdf"}]

    def stage(stage_id, race_id, day_id, number, kind, rows, **extra):
        return {"id": stage_id, "raceId": race_id, "raceDayId": day_id, "stageNumber": number, "classKind": kind,
                "keepForWeb": True, "rowCount": rows, "publicationStatus": "official", "updating": False,
                "updatingUntil": None, "isTeamEvent": False, "raceType": "RR", "sourcePdfUrl": None,
                "updatedAt": "2026-09-01T10:00:00+00:00", "lastSyncedAt": "2026-09-01T10:00:00+00:00", **extra}

    stages = [stage("u1", "r1", "d1", 1, "stage", 26), stage("u2", "r1", "d1", 1, "gc", 26),
              stage("u3", "r1", "d1", 1, "points", 3), stage("u4", "r1", "d3", 3, "stage", 26),
              stage("u5", "r1", None, None, "gc", 26, isFinalClassification=True),
              stage("u6", "r2", None, None, "gc", 22), stage("u7", "r3", "d5", 1, "stage", 5),
              stage("u8", "r4", None, None, "gc", 5, publicationStatus="provisional"),
              stage("u9", "r5", None, None, "gc", 5), stage("u0", "r1", "d1", 1, "youth", 0, keepForWeb=False)]
    classifications = [{"raceId": "r1", "classKind": kind, "position": position, "labelEs": None, "labelEn": None,
                        "colorHex": color, "colorSource": None, "updatedAt": None}
                       for position, (kind, color) in enumerate((("stage", None), ("gc", "#ffcc00"), ("points", "#00aa00")))]

    def team(team_id, name, sides):
        return {"id": team_id, "name": name, "category": "WT", "nameAliases": None, "badgeTorsoCenter": "#ffffff",
                "badgeTorsoSides": sides, "badgeShorts": "#000000", "badgeInnerCircle": None,
                "historicalCatalogOnly": False, "headerBg": "#1f2937", "headerText": "#ffffff",
                "teamKind": "team", "selectionScope": None, "countryCode": None, "selectionCode": None}

    teams = [team("g1", "Global Uno", "#aa0000"), team("g2", "Global Dos", "#0000aa"),
             {**team("g3", "France", "#0000ff"), "teamKind": "selection", "selectionScope": "national", "countryCode": "FR"}]
    seasons = [{"id": f"{team_id}_{season}", "teamId": team_id, "year": season, "name": f"{name} {season}",
                "category": "WT", "headerBg": "#000000", "headerText": "#ffffff", "badgeTorsoCenter": None,
                "badgeTorsoSides": None, "badgeInnerCircle": None, "badgeShorts": None}
               for team_id, name in (("g1", "Global Uno"), ("g2", "Global Dos")) for season in (year, year - 1)]
    startlist = [{"id": "t1", "raceId": "r1", "teamId": "g1", "teamName": "Equipo Uno", "sortOrder": 1},
                 {"id": "t2", "raceId": "r1", "teamId": None, "teamName": "Equipo sin ficha", "sortOrder": 2},
                 {"id": "t3", "raceId": "r1", "teamId": "g3", "teamName": "France", "sortOrder": 3}]
    riders = [{"id": f"p{dorsal:02d}", "raceId": "r1", "teamId": "t3" if dorsal == 2 else "t1" if dorsal % 2 else "t2", "dorsal": dorsal,
               "firstName": f"Nombre{dorsal}", "lastName": "Apellido", "countryCode": "ES" if dorsal % 3 else "FR",
               "globalRiderId": f"gr{dorsal}"} for dorsal in range(1, 27)]

    def gap(rank):
        return None if rank == 1 else "+0" if rank <= 5 else "+12" if rank <= 10 else "+1:30"

    results = []
    for stage_id in ("u1", "u2", "u4", "u5"):
        for rank in range(1, 27):
            results.append({"id": len(results) + 1, "stageRef": stage_id, "rank": rank if rank < 26 else None, "rankText": None,
                            "bib": str(rank), "riderDisplay": f"APELLIDO Nombre{rank}", "globalRiderId": f"gr{rank}",
                            "teamId": None, "resultValue": None, "timeText": "4:00:00" if rank == 1 else None,
                            "gapText": gap(rank) if rank < 26 else None, "points": None,
                            "uciPoints": 20 if rank <= 3 else None, "irm": "DNF" if rank == 26 else None,
                            "sortOrder": rank})
    for rank, points in ((1, 50), (2, 30), (3, 10)):
        results.append({"id": len(results) + 1, "stageRef": "u3", "rank": rank, "bib": str(rank), "riderDisplay": "X",
                        "globalRiderId": f"gr{rank}", "points": points, "sortOrder": rank})
    for rank in range(1, 23):
        results.append({"id": len(results) + 1, "stageRef": "u6", "rank": rank, "bib": None,
                        "riderDisplay": f"FICHA Corredor{rank}", "globalRiderId": f"m{rank}", "teamId": "g1" if rank == 22 else None,
                        "timeText": "5:00:00" if rank == 1 else None, "gapText": None if rank == 1 else "+5",
                        "sortOrder": rank})
    for stage_id in ("u7", "u8", "u9"):
        for rank in range(1, 6):
            results.append({"id": len(results) + 1, "stageRef": stage_id, "rank": rank, "bib": str(rank),
                            "riderDisplay": "X", "globalRiderId": None, "sortOrder": rank})
    men = [{"id": f"m{rank}", "firstName": f"Corredor{rank}", "lastName": "Ficha", "nationality": "IT",
            "currentTeamId": "g2" if rank % 2 else None, "historicalCatalogOnly": False} for rank in range(1, 23)]
    return {"races": races, "race_days": days, "assets": assets, "race_uci_stages": stages,
            "race_classifications": classifications, "startlist_teams": startlist, "teams": teams,
            "team_seasons": seasons, "startlist_riders_resolved": riders, "race_uci_results": results,
            "riders_men": men, "riders_women": [], "broadcasts": [], "cx_races": [], "rpc/startlist_counts": []}


class ResultadosDataTest(unittest.TestCase):
    """Lecturas de resultados del volcado: ámbito, firma y carreras que leer."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.today = site_data.madrid_today()
        self.fake = ResultadosPostgrest(resultados_catalog(self.today))

    def test_candidates_are_closed_dated_and_not_archived(self):
        tables = self.fake.tables
        self.assertEqual(site_data.resultados_candidates(tables["races"], tables["race_uci_stages"], self.today),
                         ["r1", "r2", "r4"])
        self.assertTrue(site_data.near_today("2026-10-19", "2026-10-21", date(2026, 10, 22)))
        self.assertFalse(site_data.near_today("2026-10-19", "2026-10-20", date(2026, 10, 22)))
        self.assertTrue(site_data.near_today("2026-10-23", None, date(2026, 10, 22)))
        self.assertFalse(site_data.near_today(None, "2026-10-22", date(2026, 10, 22)))

    def test_signature_matches_the_prerender(self):
        race = {"id": "r1", "year": 2026, "startlistImportedAt": None}
        stages = [{"id": "u1", "updatedAt": "2026-09-01T10:00:00+00:00", "rowCount": 26, "publicationStatus": "official",
                   "updating": False}, {"id": "u2", "updatedAt": None, "rowCount": 3, "publicationStatus": None, "updating": None}]
        script = ("import { raceSignature } from " + json.dumps((ROOT / "tools/site/prerender-resultados.mjs").as_uri())
                  + "; console.log(raceSignature(" + json.dumps(race) + ", " + json.dumps(stages) + "));")
        node = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
        self.assertEqual(node.returncode, 0, node.stderr)
        self.assertEqual(node.stdout.strip(), site_data.resultados_signature(race, stages))
        changed = [{**stages[0], "updatedAt": "2026-09-02T10:00:00+00:00"}, stages[1]]
        self.assertNotEqual(site_data.resultados_signature(race, changed), site_data.resultados_signature(race, stages))

    def test_needing_orders_by_priority_and_stops_at_the_maximum(self):
        # Sin datos o con otra firma, de la carrera más reciente a la más
        # antigua (sin fechas, al final; a igualdad, el orden de las
        # candidatas); después, las de rotación vencida, de la lectura más
        # antigua. Igual en prerender-resultados.mjs (racesToRead).
        today = date(2026, 10, 22)
        candidates = ["a", "b", "c", "d", "e", "f", "g", "h"]
        signatures = {race_id: f"s{race_id}" for race_id in candidates}
        races = {"a": {"endDate": "2026-10-20"}, "b": {"startDate": "2026-08-30", "endDate": "2026-09-01"},
                 "c": {"endDate": "2026-10-10"}, "d": {"endDate": "2026-10-19"}, "e": {},
                 "f": {"endDate": "2026-10-18"}, "g": {"startDate": "2026-10-15", "endDate": None},
                 "h": {"startDate": "2026-10-08", "endDate": "2026-10-10"}}
        rotation = site_data.resultados_rotation("d")
        cache = {"races": {"a": {"sig": "sa", "fetched": "2026-10-20"}, "b": {"sig": "otra", "fetched": "2026-10-20"},
                           "d": {"sig": "sd", "fetched": (today - timedelta(days=rotation)).isoformat()},
                           "f": {"sig": "sf", "fetched": (today - timedelta(days=45)).isoformat()}}}
        everything = ["g", "c", "h", "b", "e", "f", "d"]
        self.assertEqual(site_data.resultados_needing(candidates, signatures, cache, today, races), (everything, []))
        self.assertEqual(site_data.resultados_needing(candidates, signatures, cache, today, races, limit=3),
                         (everything[:3], everything[3:]))
        self.assertEqual(site_data.resultados_needing(candidates, signatures, {}, today, races, limit=0),
                         ([], ["a", "d", "f", "g", "c", "h", "b", "e"]))
        self.assertGreaterEqual(rotation, site_data.RESULTADOS_ROTATION_DAYS)
        self.assertLess(rotation, site_data.RESULTADOS_ROTATION_DAYS + 14)

        script = ("import { racesToRead, rotationDays } from "
                  + json.dumps((ROOT / "tools/site/prerender-resultados.mjs").as_uri()) + ";\n"
                  + f"const [candidates, sigs, cache, races] = {json.dumps([candidates, signatures, cache['races'], races])};\n"
                  + "const byId = new Map(Object.entries(races));\n"
                  + "console.log(JSON.stringify([racesToRead(candidates, sigs, cache, '2026-10-22', byId),"
                  + " racesToRead(candidates, sigs, cache, '2026-10-22', byId, 3), racesToRead(candidates, sigs, {}, '2026-10-22', byId, 0),"
                  + " candidates.map(rotationDays)]));")
        node = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=60)
        self.assertEqual(node.returncode, 0, node.stderr)
        self.assertEqual(json.loads(node.stdout), [
            {"read": everything, "pending": []}, {"read": everything[:3], "pending": everything[3:]},
            {"read": [], "pending": ["a", "d", "f", "g", "c", "h", "b", "e"]},
            [site_data.resultados_rotation(race_id) for race_id in candidates]])

    def test_fetch_reads_races_missing_from_the_cache_by_chunks(self):
        requests = []

        def transport(method, path, headers, body=None):
            requests.append(urlsplit(path).path.split("/rest/v1/", 1)[1])
            return paged(self.fake, path, headers)

        data = self.root / "data"
        with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "off"}), patch("builtins.print"):
            manifest = site_data.fetch(data, "fixture", transport=transport)
        self.assertNotIn("resultados", manifest)
        self.assertEqual(len(requests), len(site_data.dump_queries()))

        requests.clear()
        with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "es", "RESULTADOS_CACHE": str(self.root / "sin-cache")}), \
                patch.object(site_data, "IN_CHUNK", 1), patch("builtins.print"):
            manifest = site_data.fetch(data, "fixture", transport=transport)
        state = manifest["resultados"]
        self.assertEqual((state["read"], state["pending"]), (["r2", "r4", "r1"], []))
        self.assertEqual(sorted(state["sigs"]), ["r1", "r2", "r4"])
        # Tramos de una carrera o clasificación: 3 de inscritos, 3 de equipos (un año) y 7 de filas.
        extra = len(requests) - len(site_data.dump_queries()) - len(site_data.RESULTADOS_BASE)
        self.assertEqual(extra, 3 + 3 + 7 + len(site_data.RESULTADOS_CATALOG) + 1)
        read = lambda name: json.loads((data / f"{name}.json").read_text())  # noqa: E731
        self.assertEqual([row["id"] for row in read("resultados_stages")], ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"])
        self.assertEqual(read("resultados_teams")[0]["team"]["team_seasons"], [
            {column: season[column] for column in site_data.SEASON_COLUMNS.split(",")}
            for season in self.fake.tables["team_seasons"] if season["id"] == f"g1_{self.races()['r1']['year']}"])
        self.assertEqual(len(read("resultados_results")), 26 * 4 + 3 + 22 + 5)

        # Con el máximo de lecturas: las dos más recientes; la otra, pendiente.
        requests.clear()
        with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "es", "RESULTADOS_CACHE": str(self.root / "sin-cache")}), \
                patch.object(site_data, "IN_CHUNK", 1), patch.object(site_data, "RESULTADOS_MAX_READS", 2), \
                patch("builtins.print") as printed:
            manifest = site_data.fetch(data, "fixture", transport=transport)
        self.assertEqual((manifest["resultados"]["read"], manifest["resultados"]["pending"]), (["r2", "r4"], ["r1"]))
        self.assertIn("resultados: 3 carreras candidatas, 2 leídas, 1 pendientes de relleno", printed.call_args.args[0])
        extra = len(requests) - len(site_data.dump_queries()) - len(site_data.RESULTADOS_BASE)
        self.assertEqual(extra, 2 + 2 + 2 + len(site_data.RESULTADOS_CATALOG) + 1)
        self.assertEqual((read("resultados_riders"), read("resultados_teams")), ([], []))
        self.assertEqual(len(read("resultados_results")), 22 + 5)

        # Con la caché al día, solo las clasificaciones y su configuración.
        cache = self.root / "cache"
        cache.mkdir()
        (cache / site_data.MANIFEST).write_text(json.dumps({"races": {
            race_id: {"sig": sig, "fetched": self.today.isoformat()} for race_id, sig in state["sigs"].items()}}))
        requests.clear()
        with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "es", "RESULTADOS_CACHE": str(cache)}), patch("builtins.print"):
            manifest = site_data.fetch(data, "fixture", transport=transport)
        self.assertEqual((manifest["resultados"]["read"], manifest["resultados"]["pending"]), ([], []))
        self.assertEqual(len(requests), len(site_data.dump_queries()) + len(site_data.RESULTADOS_BASE))
        self.assertEqual(read("resultados_results"), [])

    def test_sql_dump_marks_reads_like_the_build(self):
        names = {*site_data.dump_queries(), *site_data.INSCRITOS_NAMES}
        tables = self.fake.tables
        source = self.root / "datos.json"
        source.write_text(json.dumps([{**{name: [] for name in names}, "inscritos_since": None, "races": tables["races"]}]))
        extra = self.root / "resultados.json"
        extra.write_text(json.dumps([{**{name: [] for name in site_data.RESULTADOS_NAMES},
                                      "resultados_stages": [stage for stage in tables["race_uci_stages"]
                                                            if stage["keepForWeb"] and stage["rowCount"] > 0]}]))
        cache = self.root / "cache"
        cache.mkdir()
        with patch.dict(os.environ, {"RESULTADOS_CACHE": str(cache)}), patch.object(site_data, "RESULTADOS_MAX_READS", 1):
            site_data.write_from_sql(source, self.root / "sql", resultados=extra)
            state = json.loads((self.root / "sql" / site_data.MANIFEST).read_text())["resultados"]
            self.assertEqual((state["read"], state["pending"]), (["r2"], ["r4", "r1"]))
            (cache / site_data.MANIFEST).write_text(json.dumps({"races": {
                "r2": {"sig": state["sigs"]["r2"], "fetched": self.today.isoformat()}}}))
            site_data.write_from_sql(source, self.root / "sql", resultados=extra)
            state = json.loads((self.root / "sql" / site_data.MANIFEST).read_text())["resultados"]
        self.assertEqual((state["read"], state["pending"]), (["r4"], ["r1"]))

    def races(self):
        return {race["id"]: race for race in self.fake.tables["races"]}


class ResultadosPrerenderParityTest(unittest.TestCase):
    """prerender-resultados.mjs escribe los mismos bytes con el volcado (sin leer
    la API), por la API y, sin volcado, desde su caché."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        site_data._tables.clear()
        self.fake = ResultadosPostgrest(resultados_catalog(site_data.madrid_today()))
        self.requests = []
        fake, requests = self.fake, self.requests

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                status, headers, payload = paged(fake, self.path, self.headers)
                self.send_response(status)
                for name, value in {**headers, "Content-Type": "application/json",
                                    "Content-Length": str(len(payload))}.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.api = f"http://127.0.0.1:{server.server_address[1]}"
        self.preload = self.root / "api.mjs"
        self.preload.write_text("const fetchApi = globalThis.fetch;\n"
                                f"globalThis.fetch = (url, init) => fetchApi(String(url).replace({json.dumps(SUPABASE_URL)}, "
                                "process.env.FAKE_SUPABASE_URL), init);\n", encoding="utf-8")

    PAGES = ["vuelta-x", "vuelta-x/etapa-1", "vuelta-x/etapa-2", "vuelta-x/etapa-3", "clasica-x", "giro-x/etapa-1",
             "provisional-x", "archivada-x"]

    def site(self, name):
        site = self.root / name
        races = {race["slug"]: race["id"] for race in self.fake.tables["races"]}
        for path in self.PAGES:
            page = site / "resultados" / path / "index.html"
            page.parent.mkdir(parents=True, exist_ok=True)
            page.write_text(f'<html><head><meta name="cc:race-id" content="{races[path.split("/")[0]]}"></head><body>'
                            '<header class="site-header" id="siteHeader" data-back></header>'
                            '<main id="resultsContent"><div class="static-prerender">bloque</div></main>'
                            '</body></html>', encoding="utf-8")
        return site

    def prerender(self, site, data=None, cache=None, *options):
        environment = {key: value for key, value in os.environ.items() if key not in ("PAGES_DATA", "RESULTADOS_CACHE")}
        environment.update({"FAKE_SUPABASE_URL": self.api, "SUPABASE_ANON_KEY": "fixture", "TZ": "Europe/Madrid",
                            **({"PAGES_DATA": str(data)} if data else {}),
                            **({"RESULTADOS_CACHE": str(cache)} if cache else {})})
        command = ["node", "--import", self.preload.as_uri(), str(ROOT / "tools/site/prerender-resultados.mjs"),
                   str(site), "--scope", "es", *options]
        result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_shared_api_and_cache_write_the_same_pages(self):
        def transport(method, path, headers, body=None):
            return paged(self.fake, path, headers)

        cache = self.root / "cache"
        with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "es", "RESULTADOS_CACHE": str(cache)}), patch("builtins.print"):
            site_data.fetch(self.root / "data", "fixture", transport=transport)
        output = self.prerender(self.site("shared"), self.root / "data", cache)
        self.assertIn("datos (volcado compartido)", output)
        self.assertIn("5 pintadas, 0 desde la caché", output)
        self.assertEqual(self.requests, [])
        self.assertIn("datos (API)", self.prerender(self.site("api")))
        self.assertTrue(self.requests)
        self.requests.clear()
        self.assertIn("datos (caché, sin volcado)", self.prerender(self.site("solo-cache"), cache=cache))
        self.assertIn("0 pintadas, 5 desde la caché", self.prerender(self.site("warm"), self.root / "data", cache))
        self.assertEqual(self.requests, [])
        shared = tree(self.root / "shared")
        for name in ("api", "solo-cache", "warm"):
            self.assertEqual(tree(self.root / name), shared, name)
        expected = sorted(f"resultados/{path}/index.html" for path in self.PAGES[:5])
        self.assertEqual(sorted(name for name, page in shared.items() if b"data-prerendered" in page), expected)
        # Datos en la página: 20 filas de 26 con m.t., la etapa cancelada con la
        # general arrastrada y el equipo de la ficha en la carrera sin lista.
        stage = shared["resultados/vuelta-x/etapa-1/index.html"].decode()
        self.assertIn('data-rows="20"', stage)
        self.assertEqual(stage.count('<tr class="so-row"'), 20)
        self.assertIn("m.t.", stage)
        # Selección nacional con el país en castellano (js/services/national-team-name.js).
        self.assertIn(">Francia<", stage)
        self.assertIn("res-cancelled-note", shared["resultados/vuelta-x/etapa-2/index.html"].decode())
        self.assertIn("Global Dos", shared["resultados/clasica-x/index.html"].decode())

    def test_maximum_of_reads_leaves_pages_pending_and_fills_them_in_later_builds(self):
        def transport(method, path, headers, body=None):
            return paged(self.fake, path, headers)

        def build(name, cache):
            data = self.root / f"{name}-datos"
            with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "es", "RESULTADOS_CACHE": str(cache)}), \
                    patch.object(site_data, "RESULTADOS_MAX_READS", 1), patch("builtins.print"):
                state = site_data.fetch(data, "fixture", transport=transport)["resultados"]
            return (state["read"], state["pending"]), self.prerender(self.site(name), data, cache, "--max-reads", "1")

        with patch.dict(os.environ, {"PRERENDER_RESULTADOS": "es", "RESULTADOS_CACHE": str(self.root / "sin-cache")}), \
                patch("builtins.print"):
            site_data.fetch(self.root / "completo-datos", "fixture", transport=transport)
        self.prerender(self.site("completo"), self.root / "completo-datos")
        cache = self.root / "cache"
        # Sin caché: la carrera más reciente; las cuatro páginas de la otra
        # carrera del ámbito, como las escribió gen_og_pages.py.
        reads, output = build("primero", cache)
        self.assertEqual(reads, (["r2"], ["r4", "r1"]))
        self.assertIn("1/1 (100.0 %), 0 con vuelta atrás, pendientes de relleno: 4;", output)
        self.assertIn("1 carreras pendientes de relleno", output)
        first = tree(self.root / "primero")
        self.assertEqual(sorted(name for name, page in first.items() if b"data-prerendered" in page),
                         ["resultados/clasica-x/index.html"])
        source = tree(self.site("origen"))
        self.assertEqual({name: first[name] for name in source if "vuelta-x" in name},
                         {name: page for name, page in source.items() if "vuelta-x" in name})
        self.assertEqual(self.requests, [])
        # Por la API sin volcado ni caché, el mismo máximo y la misma prioridad;
        # sin volcado, la caché del primero.
        self.assertIn("pendientes de relleno: 4;", self.prerender(self.site("api"), None, None, "--max-reads", "1"))
        self.assertTrue(self.requests)
        self.requests.clear()
        self.prerender(self.site("solo-cache"), None, cache)
        for name in ("api", "solo-cache"):
            self.assertEqual(tree(self.root / name), first, name)
        # Builds siguientes: la provisional (fuera del ámbito por sus páginas) y
        # después la que faltaba; el resultado, el del build sin máximo.
        reads, output = build("segundo", cache)
        self.assertEqual(reads, (["r4"], ["r1"]))
        self.assertIn("0 pintadas, 1 desde la caché", output)
        self.assertIn("pendientes de relleno: 4;", output)
        reads, output = build("tercero", cache)
        self.assertEqual(reads, (["r1"], []))
        self.assertIn("4 pintadas, 1 desde la caché", output)
        self.assertIn("pendientes de relleno: 0;", output)
        self.assertEqual(self.requests, [])
        self.assertEqual(tree(self.root / "tercero"), tree(self.root / "completo"))



class AuxiliaresPostgrest(EmbeddingPostgrest):
    """FakePostgrest con lo que lee el orden de salida: equipos de la lista con
    su equipo embebido (`team:teams(…)`) y, con `team.team_seasons.year`, la
    temporada de ese año."""

    def __call__(self, request, *args, **kwargs):
        url = urlsplit(request.full_url)
        table = url.path.split("/rest/v1/", 1)[1]
        params = parse_qsl(url.query)
        select = dict(params).get("select", "")
        if table != "startlist_teams" or ",team:teams(" not in select:
            return super().__call__(request, *args, **kwargs)
        self.calls.append(table + "?" + url.query)
        year = dict(params).get("team.team_seasons.year")
        teams = {team["id"]: team for team in self.tables.get("teams", [])}
        seasons = sorted(self.tables.get("team_seasons", []), key=lambda season: season["id"])

        def embedded(team):
            row = {column: team.get(column) for column in site_data.TEAM_COLUMNS.split(",")}
            if year is not None:
                row["team_seasons"] = [{column: season.get(column) for column in site_data.SEASON_COLUMNS.split(",")}
                                       for season in seasons
                                       if season["teamId"] == team["id"] and season["year"] == int(year.partition(".")[2])]
            return row

        rows = [{"id": entry["id"], "raceId": entry["raceId"], "teamId": entry.get("teamId"),
                 "team": embedded(teams[entry["teamId"]]) if entry.get("teamId") in teams else None}
                for entry in self.tables["startlist_teams"]]
        rest = urlencode([(key, value) for key, value in params if key != "select" and "." not in key])
        projected = json.loads(FakePostgrest({table: rows})(Request(f"https://fixture/rest/v1/{table}?{rest}")).read())
        return io.BytesIO(json.dumps([{key: row[key] for key in ("raceId", "teamId", "team")} for row in projected]).encode())


def auxiliares_catalog():
    """Jornadas con perfil, mapa y orden de salida (CRI con equipo global y
    temporada, CRE de una carrera sin año), una con el perfil no visible y otra
    con orden importado sin filas."""
    profile = {"points": [{"km": 0, "alt": 100}, {"km": 10, "alt": 600}, {"km": 20, "alt": 150}],
               "distance": 20, "maxElevation": 600, "minElevation": 100, "elevationGain": 512}
    summits = [{"km": 10, "name": "Alto", "startKm": 4, "altitude": 600, "category": "1",
                "timeUtc": "2026-09-20T11:30:00.000Z"}]
    races = [catalog_race("r1", "vuelta-x", colorHex="#aa0000", websiteUrl="https://vuelta.example",
                          startlistImportedAt="2026-09-01T10:00:00+00:00"),
             catalog_race("r2", "clasica-x", None, race_format="one_day", start="2026-09-27", end="2026-09-27")]
    days = [catalog_day("d1", "r1", "vuelta-x-etapa-1", "2026-09-20", 1, primaryType="itt", distanceKm=12.5,
                        neutralStartTimeUtc="2026-09-20T11:00:00+00:00", estimatedFinishTimeUtc="2026-09-20T15:00:00+00:00",
                        elevationProfile=profile, profileSummits=summits, routeGpxUrl="https://x/1.gpx",
                        startOrderImportedAt="2026-09-19T10:00:00+00:00", timezone="Europe/Madrid",
                        startOrderTtDorsals=[2]),
            catalog_day("d2", "r1", "vuelta-x-etapa-2", "2026-09-21", 2, elevationProfile=profile, profileNotViewable=True),
            catalog_day("d3", "r1", "vuelta-x-etapa-3", "2026-09-22", 3, elevationProfile=profile,
                        startOrderImportedAt="2026-09-21T10:00:00+00:00"),
            catalog_day("d5", "r2", "clasica-x", "2026-09-27", None, primaryType="ttt", routeGpxUrl="https://x/5.gpx",
                        startOrderImportedAt="2026-09-26T10:00:00+00:00", timezone="America/Toronto")]
    assets = [{"id": "x1", "raceDayId": "d1", "cxRaceId": None, "type": "technicalGuide", "url": "https://x/guia.pdf"},
              {"id": "x2", "raceDayId": "d1", "cxRaceId": None, "type": "profile", "url": "https://x/perfil.pdf"}]
    teams = [{"id": "g1", "name": "Global Uno", "category": "WT", "nameAliases": "Equipo Uno", "badgeTorsoCenter": "#ffffff",
              "badgeTorsoSides": "#aa0000", "badgeShorts": "#000000", "badgeInnerCircle": None, "teamKind": "team",
              "selectionScope": None, "countryCode": None, "selectionCode": None}]
    seasons = [{"id": "g1_2026", "teamId": "g1", "year": 2026, "name": "Global Uno 2026", "category": "WT",
                "headerBg": "#000000", "headerText": "#ffffff", "badgeTorsoCenter": None, "badgeTorsoSides": "#00aa00",
                "badgeInnerCircle": None, "badgeShorts": None}]
    startlist = [{"id": "t1", "raceId": "r1", "teamId": "g1", "teamName": "Equipo Uno"},
                 {"id": "t2", "raceId": "r2", "teamId": "g1", "teamName": "Equipo Uno"},
                 {"id": "t3", "raceId": "r1", "teamId": None, "teamName": "Sin ficha"}]
    entries = [{"id": f"e{at}", "raceDayId": "d1", "sortOrder": order, "dorsal": at, "startTime": f"13:0{at}:00",
                "riderId": None, "riderName": f"Corredor {at}", "teamName": "Equipo Uno" if at % 2 else "Sin ficha",
                "countryCode": "ES", "createdAt": "2026-09-19T10:00:00+00:00"}
               for at, order in ((1, 1), (2, 2), (3, 2), (4, 3))]
    entries += [{"id": "f1", "raceDayId": "d5", "sortOrder": 1, "dorsal": None, "startTime": "09:30:00", "riderId": None,
                 "riderName": None, "teamName": "Equipo Uno", "countryCode": None, "createdAt": "2026-09-26T10:00:00+00:00"}]
    return {"races": races, "race_days": days, "assets": assets, "teams": teams, "team_seasons": seasons,
            "startlist_teams": startlist, "start_order_entries_resolved": entries, "broadcasts": [], "cx_races": [],
            "race_uci_stages": [], "rpc/startlist_counts": []}


class AuxiliaresDataTest(unittest.TestCase):
    """Lecturas del orden de salida en el volcado: solo con el tipo en el ámbito."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.fake = AuxiliaresPostgrest(auxiliares_catalog())

    def test_types_follow_the_prerender(self):
        self.assertIsNone(site_data.auxiliares_types(None))
        self.assertIsNone(site_data.auxiliares_types("off"))
        self.assertIsNone(site_data.auxiliares_types("perfil,inscritos"))
        self.assertEqual(site_data.auxiliares_types(" es "), {"perfil", "mapa", "orden"})
        self.assertEqual(site_data.auxiliares_types("mapa, perfil"), {"perfil", "mapa"})

    def test_fetch_reads_start_orders_only_with_their_type(self):
        requests = []

        def transport(method, path, headers, body=None):
            requests.append(path)
            return paged(self.fake, path, headers)

        data = self.root / "data"
        for value in ("off", "perfil,mapa"):
            requests.clear()
            with patch.dict(os.environ, {"PRERENDER_AUXILIARES": value}), patch("builtins.print"):
                manifest = site_data.fetch(data, "fixture", transport=transport)
            self.assertEqual(len(requests), len(site_data.dump_queries()), value)
            self.assertFalse(manifest.get("auxiliares", {}).get("orden"), value)
        requests.clear()
        with patch.dict(os.environ, {"PRERENDER_AUXILIARES": "es"}), patch.object(site_data, "IN_CHUNK", 1), \
                patch("builtins.print"):
            manifest = site_data.fetch(data, "fixture", transport=transport)
        self.assertEqual(manifest["auxiliares"], {"types": ["mapa", "orden", "perfil"], "orden": {"days": 3, "races": 2}})
        # Tramos de una jornada (3) y de una carrera, por año: 2026 con temporada y la de sin año.
        extra = [path for path in requests if "start_order_entries_resolved" in path or "startlist_teams?select=raceId,teamId" in path]
        self.assertEqual(len(extra), 3 + 2)
        self.assertTrue(any("team.team_seasons.year=eq.2026" in path for path in extra))
        read = lambda name: json.loads((data / f"{name}.json").read_text())  # noqa: E731
        # Por sortOrder e id dentro de cada jornada.
        self.assertEqual([row["id"] for row in read("orden_entries")], ["e1", "e2", "e3", "e4", "f1"])
        teams = read("orden_teams")
        self.assertEqual([(row["raceId"], "team_seasons" in (row["team"] or {})) for row in teams],
                         [("r1", True), ("r1", False), ("r2", False)])
        self.assertEqual(teams[0]["team"]["team_seasons"][0]["badgeTorsoSides"], "#00aa00")

    def test_sql_dump_adds_the_start_order_reads(self):
        names = {*site_data.dump_queries(), *site_data.INSCRITOS_NAMES}
        source = self.root / "datos.json"
        source.write_text(json.dumps([{**{name: [] for name in names}, "inscritos_since": None,
                                       "race_days": [{"id": "d1", "raceId": "r1", "startOrderImportedAt": "t"}],
                                       "races": [{"id": "r1", "year": 2026}]}]))
        extra = self.root / "auxiliares.json"
        extra.write_text(json.dumps([{"orden_entries": [{"id": "e1"}], "orden_teams": []}]))
        data = self.root / "sql"
        site_data.write_from_sql(source, data, auxiliares=extra)
        manifest = json.loads((data / site_data.MANIFEST).read_text())
        self.assertEqual(manifest["auxiliares"]["orden"], {"days": 1, "races": 1})
        self.assertEqual(json.loads((data / "orden_entries.json").read_text()), [{"id": "e1"}])


class AuxiliaresPrerenderParityTest(unittest.TestCase):
    """prerender-auxiliares.mjs escribe los mismos bytes con el volcado (sin leer
    la API) que por la API, y con el volcado sin las lecturas del orden de
    salida (solo esas, por la API)."""

    PAGES = (("perfil", "perfilEtapaContent", ("d1", "d2", "d3")), ("mapa", "mapaEtapaContent", ("d1", "d5")),
             ("orden-salida", "startOrderContent", ("d1", "d3", "d5")))

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        site_data._tables.clear()
        self.fake = AuxiliaresPostgrest(auxiliares_catalog())
        self.requests = []
        fake, requests = self.fake, self.requests

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                status, headers, payload = paged(fake, self.path, self.headers)
                self.send_response(status)
                for name, value in {**headers, "Content-Type": "application/json",
                                    "Content-Length": str(len(payload))}.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.api = f"http://127.0.0.1:{server.server_address[1]}"
        self.preload = self.root / "api.mjs"
        self.preload.write_text("const fetchApi = globalThis.fetch;\n"
                                f"globalThis.fetch = (url, init) => fetchApi(String(url).replace({json.dumps(SUPABASE_URL)}, "
                                "process.env.FAKE_SUPABASE_URL), init);\n", encoding="utf-8")

    def site(self, name):
        site = self.root / name
        slugs = {day["id"]: day["slug"] for day in self.fake.tables["race_days"]}
        for directory, container, days in self.PAGES:
            for day_id in days:
                page = site / directory / slugs[day_id] / "index.html"
                page.parent.mkdir(parents=True, exist_ok=True)
                page.write_text(f'<html><head><meta name="cc:race-day-id" content="{day_id}"></head><body>'
                                '<header class="site-header" id="siteHeader" data-back></header>'
                                f'<main id="{container}" class="pfe-wrap"><div class="static-prerender">bloque</div></main>'
                                '</body></html>', encoding="utf-8")
        return site

    def prerender(self, site, data=None):
        environment = {key: value for key, value in os.environ.items() if key != "PAGES_DATA"}
        environment.update({"FAKE_SUPABASE_URL": self.api, "SUPABASE_ANON_KEY": "fixture",
                            **({"PAGES_DATA": str(data)} if data else {})})
        command = ["node", "--import", self.preload.as_uri(), str(ROOT / "tools/site/prerender-auxiliares.mjs"),
                   str(site), "--scope", "es"]
        result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def test_shared_and_api_write_the_same_pages(self):
        def transport(method, path, headers, body=None):
            return paged(self.fake, path, headers)

        for value, name in (("es", "data"), ("perfil,mapa", "data-sin-orden")):
            with patch.dict(os.environ, {"PRERENDER_AUXILIARES": value}), patch("builtins.print"):
                site_data.fetch(self.root / name, "fixture", transport=transport)
        self.assertIn("datos (volcado compartido)", self.prerender(self.site("shared"), self.root / "data"))
        self.assertEqual(self.requests, [])
        self.assertIn("datos (volcado compartido; orden de salida por la API)",
                      self.prerender(self.site("partial"), self.root / "data-sin-orden"))
        self.assertTrue(self.requests)
        self.assertTrue(all("start_order_entries_resolved" in path or "startlist_teams" in path for path in self.requests))
        self.requests.clear()
        self.assertIn("datos (API)", self.prerender(self.site("api")))
        self.assertTrue(self.requests)
        shared = tree(self.root / "shared")
        for name in ("partial", "api"):
            self.assertEqual(tree(self.root / name), shared, name)
        self.assertEqual(sum(b"data-prerendered" in page for page in shared.values()), 8)
        # Datos en la página: puerto con su hora de paso, aviso del perfil no
        # visible, temporada del equipo global, CRE convertida a la hora de
        # Madrid y aviso de la jornada sin filas.
        perfil = shared["perfil/vuelta-x-etapa-1/index.html"].decode()
        self.assertIn("Alto", perfil)
        self.assertIn('<time datetime="2026-09-20T11:00:00+00:00">13:00</time>', perfil)
        self.assertIn("Perfil no disponible", shared["perfil/vuelta-x-etapa-2/index.html"].decode())
        orden = shared["orden-salida/vuelta-x-etapa-1/index.html"].decode()
        self.assertEqual(orden.count('<tr class="so-row"'), 4)
        self.assertIn("--a:#00aa00", orden)
        self.assertIn('data-is-tt="1"', orden)
        self.assertIn("so-tz-note", shared["orden-salida/clasica-x/index.html"].decode())
        self.assertIn("startlist-empty", shared["orden-salida/vuelta-x-etapa-3/index.html"].decode())

if __name__ == "__main__":
    unittest.main()
