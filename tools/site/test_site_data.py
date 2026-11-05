"""Volcado compartido: semántica PostgREST de las consultas locales y paridad con la API."""
import json
import os
import re
import runpy
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qsl, quote
from urllib.request import Request

import gen_asset_canonicals
import gen_feeds
import gen_sitemap
import site_data
from test_generated import FakePostgrest, catalog, inside, tree

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


if __name__ == "__main__":
    unittest.main()
