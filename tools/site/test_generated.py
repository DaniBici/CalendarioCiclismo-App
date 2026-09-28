"""Contrato de caché, familias OG y composición de Pages sin red."""
import contextlib
import io
import json
import os
import re
import runpy
import shutil
import sys
import tarfile
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qsl, urlsplit

import build_generated as build
import gen_feeds
import gen_sitemap
from check_seo_output import check_paths

SITEMAP_INDEX = ('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 '<sitemap><loc>https://calendariociclismo.app/sitemap-1.xml</loc></sitemap>'
                 '</sitemapindex>')


def sitemap_fixture(count=100):
    return {"sitemap.xml": SITEMAP_INDEX,
            "sitemap-1.xml": '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                             + ''.join(f'<url><loc>https://calendariociclismo.app/fixture-{index}/</loc></url>'
                                       for index in range(count)) + '</urlset>',
            "atom.xml": "<feed/>"}


class FakePostgrest:
    """PostgREST en memoria: filtros eq/in/gte/lte/not.is.null y order."""

    def __init__(self, tables):
        self.tables = tables
        self.calls = []

    @staticmethod
    def matches(row, condition, value):
        if condition == "not.is.null":
            return value is not None
        operator, _, operand = condition.partition(".")
        if operator == "in":
            return value is not None and str(value) in [item.strip('"') for item in operand[1:-1].split(",")]
        if operator == "eq":
            return (bool(value) == (operand == "true") if operand in ("true", "false")
                    else str(value) == operand)
        if value is None:
            return False
        left, right = (value, int(operand)) if isinstance(value, int) else (str(value), operand)
        return left >= right if operator == "gte" else left <= right

    def __call__(self, request, *args, **kwargs):
        url = urlsplit(request.full_url)
        table = url.path.split("/rest/v1/", 1)[1]
        self.calls.append(table + "?" + url.query)
        rows = list(self.tables.get(table, []))
        for key, condition in parse_qsl(url.query):
            if key == "order":
                for part in reversed(condition.split(",")):
                    field, _, direction = part.partition(".")
                    rows.sort(key=lambda row: str(row.get(field) or ""), reverse=direction == "desc")
            elif key not in ("select", "limit"):
                rows = [row for row in rows if self.matches(row, condition, row.get(key))]
        return io.BytesIO(json.dumps(rows).encode())


def catalog_race(race_id, slug, year=2026, race_format="stage_race", start="2026-09-20", end="2026-09-24", **extra):
    return {"id": race_id, "slug": slug, "slugEn": slug + "-en", "name": slug.title(), "nameEn": slug.title(),
            "year": year, "startDate": start, "endDate": end, "logoUrl": "https://x/logo.png",
            "raceFormat": race_format, "countryCode": "ES", "uciCategory": "2.Pro", "isCancelled": False,
            "gender": "male", **extra}


def catalog_day(day_id, race_id, slug, date_key, number, **extra):
    return {"id": day_id, "raceId": race_id, "slug": slug, "slugEn": slug + "-en", "stageNumber": number,
            "startLocation": "Valencia", "finishLocation": f"Sagunto {number}", "dateKey": date_key,
            "isRestDay": False, "isCancelledDay": False, "updatedAt": "2026-09-01T10:00:00+00:00",
            "editorialStatus": "published", "distanceKm": 150, "primaryType": "flat", **extra}


def catalog(with_new=False):
    """Catálogo con carreras por etapas, de un día, archivadas, futuras y canceladas."""
    races = [catalog_race("r1", "vuelta-2026"),
             catalog_race("r2", "clasica-2026", race_format="one_day", start="2026-09-27", end="2026-09-27"),
             catalog_race("r3", "vuelta-2024", 2024, start="2024-09-20", end="2024-09-24"),
             catalog_race("r4", "giro-2027", 2027, start="2027-05-10", end="2027-05-12", gender="female"),
             catalog_race("r6", "cancelada-2026", race_format="one_day", start="2026-10-05",
                          end="2026-10-05", isCancelled=True)]
    days = [catalog_day("d1", "r1", "vuelta-2026-etapa-1", "2026-09-20", 1, elevationProfile={"p": 1},
                        startOrderImportedAt="2026-09-19T10:00:00+00:00"),
            catalog_day("d2", "r1", "vuelta-2026-etapa-2", "2026-09-21", 2, routeGpxUrl="https://x/a.gpx"),
            catalog_day("d2r", "r1", "vuelta-2026-descanso", "2026-09-22", None, isRestDay=True),
            catalog_day("d3", "r1", "vuelta-2026-etapa-3", "2026-09-23", 3),
            catalog_day("d5", "r2", "clasica-2026", "2026-09-27", None),
            catalog_day("d6", "r3", "vuelta-2024-etapa-1", "2024-09-20", 1),
            catalog_day("d7", "r4", "giro-2027-etapa-1", "2027-05-10", 1),
            catalog_day("d9", "r6", "cancelada-2026", "2026-10-05", None)]
    stages = [{"raceId": "r1", "raceDayId": "d1", "stageNumber": 1, "keepForWeb": True}]
    if with_new:
        races.append(catalog_race("r7", "gp-nuevo-2026", race_format="one_day", start="2026-09-29", end="2026-09-29"))
        days += [catalog_day("d4", "r1", "vuelta-2026-etapa-4", "2026-09-24", 4, elevationProfile={"p": 2}),
                 catalog_day("d10", "r7", "gp-nuevo-2026", "2026-09-29", None)]
        stages.append({"raceId": "r1", "raceDayId": "d4", "stageNumber": 4, "keepForWeb": True})
    return {"races": races, "race_days": days, "race_uci_stages": stages,
            "startlist_teams": [{"raceId": "r1"}, {"raceId": "r2"}], "rpc/startlist_counts": [],
            "cx_races": [{"id": "cx1", "name": "CX", "slug": "cx-uno", "slugEn": "cx-one", "seasonKey": "2026-27",
                          "dateKey": "2026-10-10", "editorialStatus": "published",
                          "createdAt": "2026-09-01T10:00:00+00:00"}]}


NEW_STAGES = {"vuelta-2026-etapa-4", "gp-nuevo-2026"}
URL_ENTRY = re.compile(r"  <url>\n.*?\n  </url>", re.S)
VEVENT = re.compile(r"BEGIN:VEVENT.*?END:VEVENT", re.S)


@contextlib.contextmanager
def inside(directory):
    original = Path.cwd()
    Path(directory).mkdir(parents=True, exist_ok=True)
    os.chdir(directory)
    try:
        yield
    finally:
        os.chdir(original)


def tree(directory):
    return {path.relative_to(directory).as_posix(): path.read_bytes()
            for path in Path(directory).rglob("*") if path.is_file()}


class GeneratedTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.cache = self.root / ".pages-generated"
        self.state_path = self.root / ".pages-build-state.json"
        self.now = build.utc_now()
        self.state = {"force": False, "requested": None, "day": self.now.strftime("%Y-%m-%d"),
                      "blocks": {name: {"prefix": name + "-fixture-", "regenerated": False} for name in build.BLOCKS}}
        for name, value in (("ROOT", self.root), ("CACHE_ROOT", self.cache), ("STATE_PATH", self.state_path)):
            mocked = patch.object(build, name, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.state_path.write_text(json.dumps(self.state))
        (self.root / "_site").mkdir()

    def block(self, name, files, verified=True):
        directory = self.cache / name
        payload = directory / "output"
        for relative, content in files.items():
            path = payload / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        inventory = build.inventory(payload)
        archive = directory / "output.tar"
        sha = build.archive_output(payload, inventory, archive)
        shutil.rmtree(payload)
        metadata = {"prefix": self.state["blocks"][name]["prefix"],
                    "started": (self.now - timedelta(seconds=1)).isoformat(),
                    "files": inventory, "archive_sha256": sha, "verified": verified}
        (directory / "manifest.json").write_text(json.dumps(metadata))
        return archive, metadata

    def test_rejects_missing_incompatible_incomplete_and_corrupt_archives(self):
        archive, metadata = self.block("sitemap", sitemap_fixture())
        self.assertTrue(build.reusable("sitemap", archive, metadata, self.state))
        for changed in ({}, {**metadata, "prefix": "old"}, {**metadata, "verified": False},
                        {**metadata, "started": (self.now - timedelta(days=1)).isoformat()}):
            self.assertFalse(build.reusable("sitemap", archive, changed, self.state))
        archive.write_bytes(archive.read_bytes() + b"corrupt")
        self.assertFalse(build.reusable("sitemap", archive, metadata, self.state))
        archive.unlink()
        self.assertFalse(build.reusable("sitemap", archive, metadata, self.state))
        _, incomplete = self.block("og-races", {"competicion/a/index.html": "html"})
        self.assertFalse(build.reusable("og-races", self.cache / "og-races/output.tar", incomplete, self.state))

    def test_cancelled_full_request_invalidates_older_block(self):
        archive, metadata = self.block("sitemap", sitemap_fixture())
        requested = self.now.isoformat()

        def response(request, **kwargs):
            event = "workflow_dispatch" if "workflow_dispatch" in request.full_url else "schedule"
            return io.BytesIO(json.dumps({"workflow_runs": [{"event": event, "head_branch": "main",
                "created_at": requested, "conclusion": "cancelled"}]}).encode())

        with patch.object(build, "urlopen", response):
            self.state["requested"], _ = build.latest_requests("fixture/repo", "fixture")
        self.assertFalse(build.reusable("sitemap", archive, metadata, self.state))
        metadata["started"] = requested
        self.assertTrue(build.reusable("sitemap", archive, metadata, self.state))

    def test_incremental_dispatch_does_not_invalidate_other_caches(self):
        full_request = (self.now - timedelta(hours=2)).isoformat()
        incremental_request = (self.now - timedelta(hours=1)).isoformat()

        def response(request, **kwargs):
            event = "workflow_dispatch" if "workflow_dispatch" in request.full_url else "schedule"
            return io.BytesIO(json.dumps({"workflow_runs": [
                {"event": event, "head_branch": "main", "created_at": incremental_request,
                 "display_title": "stage-incremental"},
                {"event": event, "head_branch": "main", "created_at": full_request,
                 "display_title": "Construir y desplegar el sitio"},
            ]}).encode())

        with patch.object(build, "urlopen", response):
            self.assertEqual(build.latest_requests("fixture/repo", "fixture"), (full_request, None))

    def test_stage_request_counts_only_earlier_incrementals(self):
        times = {number: (self.now - timedelta(hours=10 - number)).isoformat() for number in (1, 2, 3, 4)}

        def response(request, **kwargs):
            event = "workflow_dispatch" if "workflow_dispatch" in request.full_url else "schedule"
            runs = [] if event == "schedule" else [
                {"event": event, "head_branch": "main", "created_at": times[number], "run_number": number,
                 "display_title": "stage-incremental" if number != 1 else "Construir y desplegar el sitio",
                 "conclusion": "cancelled" if number == 2 else None}
                for number in (1, 2, 3, 4)]
            return io.BytesIO(json.dumps({"workflow_runs": runs}).encode())

        with patch.object(build, "urlopen", response):
            # El propio run (3) y los posteriores (4) no cuentan; el cancelado (2) sí.
            self.assertEqual(build.latest_requests("fixture/repo", "fixture", 3), (times[1], times[2]))

    def test_blocks_older_than_previous_incremental_are_not_reusable(self):
        archive, metadata = self.block("sitemap", sitemap_fixture())
        _, results = self.block("og-results", {"resultados/a/index.html": "html",
                                                "en/results/a/index.html": "html"})
        self.state["stage_requested"] = self.now.isoformat()
        self.assertFalse(build.reusable("sitemap", archive, metadata, self.state))
        self.assertTrue(build.reusable("og-results", self.cache / "og-results/output.tar", results, self.state))
        metadata["extended"] = (self.now + timedelta(microseconds=1)).isoformat()
        self.assertTrue(build.reusable("sitemap", archive, metadata, self.state))
        self.state["requested"] = self.now.isoformat()
        self.assertFalse(build.reusable("sitemap", archive, metadata, self.state))

    def test_wait_for_turn_queues_behind_earlier_active_runs(self):
        own = {"id": 30, "head_branch": "main", "status": "in_progress",
               "created_at": "2026-09-26T10:00:05Z", "run_started_at": "2026-09-26T10:00:05Z"}
        earlier = {"id": 20, "head_branch": "main", "status": "queued",
                   "created_at": "2026-09-26T10:00:00Z", "run_started_at": "2026-09-26T10:00:00Z"}
        ignored = [
            {**earlier, "id": 10, "status": "completed"},
            {**earlier, "id": 11, "head_branch": "feature"},
            {**earlier, "id": 40, "created_at": "2026-09-26T10:00:09Z", "run_started_at": "2026-09-26T10:00:09Z"},
            {**earlier, "id": 5, "created_at": "2026-09-26T09:00:00Z", "run_started_at": "2026-09-26T10:00:10Z"},
        ]
        polls = [[own, earlier, *ignored], [own, {**earlier, "status": "completed"}, *ignored]]

        def response(request, **kwargs):
            if request.full_url.endswith("/actions/runs/30"):
                return io.BytesIO(json.dumps(own).encode())
            return io.BytesIO(json.dumps({"workflow_runs": polls.pop(0)}).encode())

        sleeps = []
        with patch.dict(os.environ, {"GITHUB_REPOSITORY": "fixture/repo", "GITHUB_TOKEN": "fixture",
                                     "GITHUB_RUN_ID": "30"}), patch.object(build, "urlopen", response):
            build.wait_for_turn(sleep=sleeps.append, clock=lambda: 0)
        self.assertEqual(sleeps, [build.TURN_POLL_SECONDS])
        self.assertEqual(polls, [])

    def test_incremental_stage_extends_verified_archive_without_losing_pages(self):
        self.state["stage_slugs"] = ["new-stage"]
        self.state_path.write_text(json.dumps(self.state))
        files = {f"{directory}/old-{index}/index.html": "old"
                 for directory in build.OG_FAMILIES["og-stages"] for index in range(100)}
        archive, metadata = self.block("og-stages", files)
        actual_run = build.subprocess.run

        def run(command, cwd=None, check=None):
            if command[0] == "tar":
                return actual_run(command, cwd=cwd, check=check)
            self.assertEqual(command[-4:], ["--family", "stages", "--stage-slugs", "new-stage"])
            for name in ("jornada/new-stage/index.html", "en/stage/new-stage/index.html"):
                path = Path(cwd) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("new")

        with patch.object(build.subprocess, "run", side_effect=run):
            updated = build.extend_og_family("og-stages", archive, metadata, self.state)
        self.assertEqual(len(updated["files"]), 202)
        self.assertEqual((self.cache / "og-stages/output/jornada/old-0/index.html").read_text(), "old")
        self.assertEqual((self.cache / "og-stages/output/jornada/new-stage/index.html").read_text(), "new")
        self.assertEqual(build.digest(archive), updated["archive_sha256"])
        self.assertFalse(updated["verified"])
        self.assertEqual(updated["started"], metadata["started"])
        self.assertGreaterEqual(updated["extended"], metadata["started"])
        # Reintento del mismo slug: sustituye la página sin fallar ni perder otras.
        shutil.rmtree(self.cache / "og-stages/output")
        with patch.object(build.subprocess, "run", side_effect=run):
            retried = build.extend_og_family("og-stages", archive, updated, self.state)
        self.assertEqual(retried["files"].keys(), updated["files"].keys())

    def test_stage_dispatch_extends_stage_and_sitemap_caches(self):
        self.state["stage_slugs"] = ["new-stage"]
        self.state_path.write_text(json.dumps(self.state))
        self.block("og-stages", {f"{directory}/old-{index}/index.html": "old"
                                 for directory in build.OG_FAMILIES["og-stages"]
                                 for index in range(100)})
        self.block("sitemap", sitemap_fixture())
        actual_run = build.subprocess.run

        def run(command, cwd=None, check=None):
            if command[0] == "tar":
                return actual_run(command, cwd=cwd, check=check)
            if "gen_og_pages.py" in command[1]:
                for name in ("jornada/new-stage/index.html", "en/stage/new-stage/index.html"):
                    path = Path(cwd) / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("new")
            elif "gen_sitemap.py" in command[1]:
                self.assertEqual(command[-2:], ["--stage-slugs", "new-stage"])
                self.assertTrue((Path(cwd) / "sitemap-1.xml").is_file())
                for name, content in sitemap_fixture(101).items():
                    (Path(cwd) / name).write_text(content)
            else:
                self.fail(f"Generador inesperado: {command}")

        with patch.object(build.subprocess, "run", side_effect=run):
            build.run_block("og-stages")
            build.run_block("sitemap")
        self.assertEqual((self.root / "_site/jornada/new-stage/index.html").read_text(), "new")
        self.assertEqual((self.root / "_site/jornada/old-0/index.html").read_text(), "old")
        self.assertTrue(build.read_state()["blocks"]["og-stages"]["regenerated"])
        self.assertTrue(build.read_state()["blocks"]["sitemap"]["regenerated"])
        sitemap = build.read_manifest("sitemap")
        self.assertEqual(sitemap["started"], (self.now - timedelta(seconds=1)).isoformat())
        self.assertIn("extended", sitemap)

    def test_generator_emits_only_selected_stage_and_related_race(self):
        races = [{"id": f"race-{key}", "slug": f"race-{key}",
                  "slugEn": f"race-{key}-en", "name": f"Race {key}",
                  "nameEn": f"Race {key}", "year": 2026,
                  "startDate": "2026-09-24", "endDate": "2026-09-25",
                  "raceFormat": "stage_race", "countryCode": "ES"}
                 for key in ("new", "old")]
        days = [{"id": f"day-{key}", "slug": f"{key}-stage",
                 "slugEn": f"{key}-stage-en", "raceId": f"race-{key}",
                 "stageNumber": 1, "dateKey": "2026-09-24",
                 "startLocation": "Valencia", "finishLocation": "Sagunto",
                 "countryCode": "ES", "distanceKm": 120}
                for key in ("new", "old")]

        def urlopen(request):
            url = request.full_url
            rows = (races if "/rest/v1/races?" in url else
                    days if "/rest/v1/race_days?" in url else [])
            return io.BytesIO(json.dumps(rows).encode())

        generator = Path(__file__).resolve().parent / "gen_og_pages.py"
        original_cwd = Path.cwd()
        for family, expected in (("races", "competicion/race-new/index.html"),
                                 ("stages", "jornada/new-stage/index.html"),
                                 ("extras", "inscritos/race-new/index.html")):
            output = self.root / family
            output.mkdir()
            try:
                os.chdir(output)
                with patch.dict(os.environ, {"SUPABASE_ANON_KEY": "fixture"}), patch(
                        "urllib.request.urlopen", side_effect=urlopen), patch.object(
                        sys, "argv", ["gen_og_pages.py", "--family", family,
                                      "--stage-slugs", "new-stage"]):
                    runpy.run_path(str(generator), run_name="__main__")
            finally:
                os.chdir(original_cwd)
            pages = {path.relative_to(output).as_posix() for path in output.rglob("index.html")}
            self.assertIn(expected, pages)
            self.assertFalse(any("old-stage" in name or "race-old" in name for name in pages))

    def test_family_paths_and_source_indexes_are_exclusive(self):
        for name in (*build.SOURCE_INDEXES, "js/config.js", "../competicion/a/index.html"):
            for block in build.OG_FAMILIES:
                self.assertFalse(build.allowed_file(block, name))
        for block, directories in build.OG_FAMILIES.items():
            for directory in directories:
                self.assertTrue(build.allowed_file(block, f"{directory}/fixture/index.html"))
                for other in build.OG_FAMILIES:
                    if other != block:
                        self.assertFalse(build.allowed_file(other, f"{directory}/fixture/index.html"))

    def test_hash_isolates_family_and_ignores_assets(self):
        source = Path(__file__).resolve().parent
        target = self.root / "tools/site"
        target.mkdir(parents=True)
        for name in {item for files in build.BLOCKS.values() for item in files} | {"gen_og_pages.py"}:
            shutil.copyfile(source / name, target / name)
        original = {name: build.cache_prefix(name, self.now, self.root) for name in build.BLOCKS}
        for relative in ("js/app.js", "css/app.css", "index.html", "i18n/en.json"):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("changed source")
        self.assertEqual(original, {name: build.cache_prefix(name, self.now, self.root) for name in build.BLOCKS})
        generator = target / "gen_og_pages.py"
        generator.write_text(generator.read_text().replace(
            'print("Generando páginas OG para resultados...")',
            'print("Generando páginas OG para resultados de ciclismo...")'))
        changed = {name for name in build.BLOCKS if original[name] != build.cache_prefix(name, self.now, self.root)}
        self.assertEqual(changed, {"og-results"})
        generator.write_text(generator.read_text().replace('DEFAULT_OG_IMAGE = ', 'DEFAULT_OG_IMAGE  = '))
        changed = {name for name in build.BLOCKS if original[name] != build.cache_prefix(name, self.now, self.root)}
        self.assertEqual(changed, set(build.OG_FAMILIES))
        with (target / "cx_calendar.py").open("a") as stream:
            stream.write("\n# changed\n")
        before = {name: build.cache_prefix(name, self.now, self.root) for name in build.BLOCKS}
        self.assertNotEqual(original["og-cx"], before["og-cx"])
        self.assertNotEqual(original["sitemap"], before["sitemap"])
        self.assertNotEqual(original["og-results"], build.cache_prefix("og-results", self.now + timedelta(days=1), self.root))

    def assets(self, js="one", css="two"):
        for relative, content in (("js/app.js", js), ("css/app.css", css)):
            path = self.root / "_site" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

    def test_versioning_legacy_cache_rewrites_site_only(self):
        self.assets()
        html = '<script src="/js/app.js?v=old"></script><link href="/css/app.css">'
        archive, metadata = self.block("og-results", {"resultados/a/index.html": html,
                                                        "en/results/a/index.html": html})
        build.extract_archive(archive, metadata["files"])
        table = build.version_published_assets(self.root / "_site", metadata["files"])
        published = (self.root / "_site/resultados/a/index.html").read_text()
        self.assertIn("/js/app.js?v=" + build.digest(self.root / "_site/js/app.js")[:12], published)
        self.assertIn("/css/app.css?v=" + build.digest(self.root / "_site/css/app.css")[:12], published)
        self.assertNotIn("v=old", published)
        self.assertEqual(set(table), {"js/app.js", "css/app.css"})
        self.assertEqual(self.cache.joinpath("og-results/output.tar").read_bytes(), archive.read_bytes())

    def test_cached_version_table_skips_rewrite_until_an_asset_changes(self):
        self.assets()
        html = '<script src="/js/app.js"></script><link href="/css/app.css">'

        def generate(command, cwd=None, check=None):
            for name in ("resultados/a/index.html", "en/results/a/index.html"):
                path = Path(cwd) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(html)

        with patch.object(build.subprocess, "run", side_effect=generate):
            build.run_block("og-results")
        metadata = build.read_manifest("og-results")
        self.assertEqual(set(metadata["assets"]), {"js/app.js", "css/app.css"})
        # El tar guarda el HTML ya versionado.
        with tarfile.open(self.cache / "og-results/output.tar") as stream:
            cached = stream.extractfile("resultados/a/index.html").read().decode()
        self.assertIn("/js/app.js?v=" + metadata["assets"]["js/app.js"], cached)
        metadata["verified"] = True
        (self.cache / "og-results/manifest.json").write_text(json.dumps(metadata))
        shutil.rmtree(self.root / "_site/resultados")
        with patch.object(build, "version_published_assets", wraps=build.version_published_assets) as versioning:
            build.run_block("og-results")
            versioning.assert_not_called()
        self.assertEqual((self.root / "_site/resultados/a/index.html").read_text(), cached)
        self.assets(js="changed")
        shutil.rmtree(self.root / "_site/resultados")
        with patch.object(build, "version_published_assets", wraps=build.version_published_assets) as versioning:
            build.run_block("og-results")
            versioning.assert_called_once()
        published = (self.root / "_site/resultados/a/index.html").read_text()
        self.assertIn("/js/app.js?v=" + build.digest(self.root / "_site/js/app.js")[:12], published)

    def test_extension_versions_and_validates_only_new_pages(self):
        self.assets()
        validator = self.root / "tools/site/check_seo_output.py"
        validator.parent.mkdir(parents=True)
        validator.write_text("validator")
        event = {"@type": "SportsEvent", "name": "Race", "startDate": "2026-09-24",
                 "endDate": "2026-09-24", "location": {"name": "City", "address": {"addressCountry": "ES"}},
                 "eventStatus": "https://schema.org/EventScheduled"}
        html = ('<script src="/js/app.js"></script><script type="application/ld+json">'
                + json.dumps(event) + '</script>')
        versions = {}
        table = {"js/app.js": build.asset_version("js/app.js", versions)}
        versioned = html.replace("/js/app.js", "/js/app.js?v=" + table["js/app.js"])
        archive, metadata = self.block("og-stages", {f"{directory}/old-{index}/index.html": versioned
                                                     for directory in build.OG_FAMILIES["og-stages"]
                                                     for index in range(100)})
        metadata.update(assets=table, seo={"validator": build.digest(validator), "html": 200, "events": 200})
        (self.cache / "og-stages/manifest.json").write_text(json.dumps(metadata))
        self.state["stage_slugs"] = ["new-stage"]
        self.state_path.write_text(json.dumps(self.state))

        def generate(command, cwd=None, check=None):
            if command[0] == "tar":
                return actual_run(command, cwd=cwd, check=check)
            for name in ("jornada/new-stage/index.html", "en/stage/new-stage/index.html"):
                path = Path(cwd) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(html)

        actual_run = build.subprocess.run
        with patch.object(build.subprocess, "run", side_effect=generate), patch.object(
                build, "version_published_assets", wraps=build.version_published_assets) as versioning:
            build.run_block("og-stages")
        self.assertEqual([sorted(call.args[1]) for call in versioning.call_args_list],
                         [["en/stage/new-stage/index.html", "jornada/new-stage/index.html"]])
        updated = build.read_manifest("og-stages")
        self.assertEqual(len(updated["files"]), 202)
        self.assertEqual(updated["files"]["jornada/old-0/index.html"], metadata["files"]["jornada/old-0/index.html"])
        self.assertEqual(build.digest(archive), updated["archive_sha256"])
        with tarfile.open(archive) as stream:
            self.assertEqual(len(stream.getmembers()), 202)
        self.assertIn("?v=" + table["js/app.js"], (self.root / "_site/jornada/new-stage/index.html").read_text())
        with patch.object(build, "check_paths", wraps=build.check_paths) as seo:
            self.assertEqual(build.validate_catalog_seo("og-stages", updated, build.digest(validator)),
                             (202, 202))
        checked = [path.relative_to(self.root / "_site").as_posix()
                   for call in seo.call_args_list for path in call.args[1]]
        self.assertEqual(sorted(checked), ["en/stage/new-stage/index.html", "jornada/new-stage/index.html"])
        # Con otro validador se revisa la familia completa.
        updated["seo"]["validator"] = "old"
        self.assertEqual(build.validate_catalog_seo("og-stages", updated, build.digest(validator)),
                         (202, 202))

    def test_stage_families_share_one_filtered_generation(self):
        self.state["stage_slugs"] = ["new-stage"]
        self.state_path.write_text(json.dumps(self.state))
        for block in build.STAGE_OG_BLOCKS:
            count = 100 if block in ("og-races", "og-stages") else 1
            directories = build.OG_FAMILIES[block] if block != "og-extras" else ("inscritos", "en/startlist",
                                                                                  "perfil", "en/profile")
            self.block(block, {f"{directory}/old-{index}/index.html": "old"
                               for directory in directories for index in range(count)})
        actual_run = build.subprocess.run
        generated = {"og-races": "competicion/race/index.html", "og-stages": "jornada/new-stage/index.html",
                     "og-extras": "perfil/new-stage/index.html"}
        commands = []

        def generate(command, cwd=None, check=None):
            if command[0] == "tar":
                return actual_run(command, cwd=cwd, check=check)
            commands.append(command[2:])
            for name in generated.values():
                path = Path(cwd) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("new")

        with patch.object(build.subprocess, "run", side_effect=generate):
            for block in build.STAGE_OG_BLOCKS:
                build.run_block(block)
        self.assertEqual(commands, [["--family", "races,stages,extras", "--stage-slugs", "new-stage"]])
        for block, name in generated.items():
            self.assertIn(name, build.read_manifest(block)["files"])
            self.assertTrue((self.root / "_site" / name).is_file())
        self.assertFalse(build.STAGE_DELTA_ROOT.joinpath("og-extras").exists())

    def run_generator_script(self, script, directory, tables, argv=()):
        fake = FakePostgrest(tables)
        with inside(directory), patch.dict(os.environ, {"SUPABASE_ANON_KEY": "fixture"}), patch(
                "urllib.request.urlopen", fake), patch.object(sys, "argv", [script, *argv]):
            runpy.run_path(str(Path(__file__).resolve().parent / script), run_name="__main__")
        return fake

    def test_incremental_og_reads_only_selected_races(self):
        full = self.run_generator_script("gen_og_pages.py", self.root / "full", catalog(True))
        fake = self.run_generator_script("gen_og_pages.py", self.root / "delta", catalog(True),
                                         ["--family", "races,stages,extras",
                                          "--stage-slugs", ",".join(sorted(NEW_STAGES))])
        delta, complete = tree(self.root / "delta"), tree(self.root / "full")
        self.assertIn("jornada/vuelta-2026-etapa-4/index.html", delta)
        self.assertIn("competicion/gp-nuevo-2026/index.html", delta)
        self.assertIn("perfil/vuelta-2026-etapa-4/index.html", delta)
        self.assertFalse(any("clasica" in name or "etapa-1" in name for name in delta))
        self.assertTrue(all(complete[name] == content for name, content in delta.items()))
        for call in fake.calls:
            if call.startswith(("races?", "race_days?")):
                self.assertTrue("raceId=in." in call or "id=in." in call or "slug=in." in call, call)
        self.assertFalse(any(call.startswith(("race_uci_stages?", "cx_races?")) for call in fake.calls))
        self.assertTrue(any(call.startswith("race_uci_stages?") for call in full.calls))

    def test_incremental_feeds_match_full_generation(self):
        now = datetime(2026, 9, 26, 12, tzinfo=timezone.utc)
        directories = {name: self.root / name for name in ("before", "after")}
        for name, tables in (("before", catalog()), ("after", catalog(True))):
            with inside(directories[name]), patch.object(gen_feeds, "urlopen", FakePostgrest(tables)):
                gen_feeds.generate_feeds(now)
        fake = FakePostgrest(catalog(True))
        with inside(directories["before"]), patch.object(gen_feeds, "urlopen", fake):
            gen_feeds.update_feeds(NEW_STAGES, now)
        self.assertEqual(len(fake.calls), 3)
        updated, complete = tree(directories["before"]), tree(directories["after"])
        self.assertEqual(set(updated), set(complete))
        for name, content in complete.items():
            self.assertEqual(sorted(VEVENT.findall(updated[name].decode())),
                             sorted(VEVENT.findall(content.decode())), name)
        self.assertIn("en/feed/event/gp-nuevo-2026-en.ics", updated)

    def test_incremental_sitemap_matches_full_generation_and_repartitions(self):
        directories = {name: self.root / name for name in ("before", "after")}
        with patch.object(gen_sitemap, "today", "2026-09-26"), patch.object(
                gen_sitemap, "today_d", date(2026, 9, 26)), patch.object(gen_sitemap, "MAX_URLS_PER_SITEMAP", 20):
            for name, tables in (("before", catalog()), ("after", catalog(True))):
                with inside(directories[name]), patch.object(gen_sitemap, "urlopen", FakePostgrest(tables)):
                    gen_sitemap.generate_full()
            fake = FakePostgrest(catalog(True))
            with inside(directories["before"]), patch.object(gen_sitemap, "urlopen", fake):
                gen_sitemap.update_for_stages(NEW_STAGES)
        updated, complete = tree(directories["before"]), tree(directories["after"])
        self.assertEqual(set(updated), set(complete))
        parts = [name for name in updated if name.startswith("sitemap-")]
        self.assertGreater(len(parts), 1)
        for name in parts:
            self.assertLessEqual(len(URL_ENTRY.findall(updated[name].decode())), 20)
        self.assertEqual(sorted(entry for name in parts for entry in URL_ENTRY.findall(updated[name].decode())),
                         sorted(entry for name in parts for entry in URL_ENTRY.findall(complete[name].decode())))
        feed_date = re.compile(rb"  <updated>[0-9T:-]+Z</updated>\n  <author>")
        self.assertEqual(feed_date.sub(b"", updated["atom.xml"], 1), feed_date.sub(b"", complete["atom.xml"], 1))
        self.assertFalse(any("select=id,slug" in call and "in." not in call and "dateKey=gte" not in call
                             for call in fake.calls if call.startswith(("races?", "race_days?"))))
        index = updated["sitemap.xml"].decode()
        self.assertEqual(re.findall(r"app/(sitemap-\d+\.xml)", index),
                         [f"sitemap-{number}.xml" for number in range(1, len(parts) + 1)])

    def test_seo_reads_only_json_ld_scripts(self):
        event = {"@type": "SportsEvent", "name": "Race", "startDate": "2026-09-24",
                 "endDate": "2026-09-24", "location": {"name": "City",
                 "address": {"addressCountry": "ES"}},
                 "eventStatus": "https://schema.org/EventScheduled"}
        page = self.root / "_site" / "fixture.html"
        page.write_text('<script src="/js/app.js"></script>'
                        '<script data-test="x" TYPE=\'application/ld+json\'>'
                        + json.dumps(event) + '</script>'
                        '<script type="application/ld+json">{broken}</script>')
        count, events, errors = check_paths(self.root / "_site", [page])
        self.assertEqual((count, events), (1, 1))
        self.assertEqual(len(errors), 1)
        self.assertIn("JSON-LD 2 inválido", errors[0])

    def test_full_composition_reuses_verified_archives_and_preserves_indexes(self):
        validator = self.root / "tools/site/check_seo_output.py"
        validator.parent.mkdir(parents=True)
        validator.write_text("validator")
        event = {"@type": "SportsEvent", "name": "Race", "startDate": "2026-09-24",
                 "endDate": "2026-09-24", "location": {"name": "City",
                 "address": {"addressCountry": "ES"}},
                 "eventStatus": "https://schema.org/EventScheduled"}
        html = '<script type="application/ld+json">' + json.dumps(event) + '</script>'
        for block, dirs in build.OG_FAMILIES.items():
            count = 100 if block in ("og-races", "og-stages") else 1
            self.block(block, {f"{directory}/fixture-{index}/index.html": html
                               for directory in dirs for index in range(count)})
        self.block("sitemap", sitemap_fixture())
        year = self.now.year
        self.block("feeds", {f"{base}/{year}{key}.ics": "BEGIN:VCALENDAR\r\nEND:VCALENDAR"
                             for base in ("feed", "en/feed")
                             for key in ("", "-pro", "-wt", "-wwt", "-masc", "-fem")})
        for name in build.SOURCE_INDEXES:
            path = self.root / "_site" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("<h1>fresh index</h1>")
        with patch.object(build.subprocess, "run", wraps=build.subprocess.run) as runner:
            for block in build.BLOCKS:
                build.run_block(block)
            build.verify()
            self.assertEqual(runner.call_count, len(build.BLOCKS))
        self.assertEqual((self.root / "_site/ciclocross/index.html").read_text(), "<h1>fresh index</h1>")
        with patch.object(build, "check_paths", wraps=build.check_paths) as seo:
            build.verify()
            self.assertEqual(seo.call_count, 1)  # solo índices fuente
        validator.write_text("new validator")
        with patch.object(build, "check_paths", wraps=build.check_paths) as seo:
            build.verify()
            self.assertEqual(seo.call_count, 4)

    def test_cold_build_generates_all_families_once(self):
        self.state["force"] = True
        self.state_path.write_text(json.dumps(self.state))

        def generate(command, cwd=None, check=None):
            self.assertEqual(command[-1], str(build.ROOT / "tools/site/gen_og_pages.py"))
            staging = Path(cwd)
            for block, directories in build.OG_FAMILIES.items():
                count = 100 if block in ("og-races", "og-stages") else 1
                for directory in directories:
                    for index in range(count):
                        path = staging / directory / f"fixture-{index}" / "index.html"
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text("<html></html>")

        with patch.object(build.subprocess, "run", side_effect=generate) as runner:
            build.generate_all_og(self.state)
        runner.assert_called_once()
        self.assertFalse((self.cache / "_og-full").exists())
        for block in build.OG_FAMILIES:
            metadata = build.read_manifest(block)
            self.assertTrue(build.complete_files(block, metadata["files"], self.state["day"]))
            self.assertEqual(build.digest(self.cache / block / "output.tar"), metadata["archive_sha256"])
            self.assertTrue(build.read_state()["blocks"][block]["prefilled"])
        build.run_block("og-races")
        self.assertTrue((self.root / "_site/competicion/fixture-0/index.html").is_file())
        self.assertFalse((self.cache / "og-races/output").exists())

    def test_move_generated_payload_preserves_source_index(self):
        source_index = self.root / "_site/resultados/index.html"
        source_index.parent.mkdir(parents=True)
        source_index.write_text("manual index")
        payload = self.cache / "og-results/output"
        page = payload / "resultados/race/etapa-1/index.html"
        page.parent.mkdir(parents=True)
        page.write_text("generated page")
        build.move_generated_payload(payload)
        self.assertEqual(source_index.read_text(), "manual index")
        self.assertEqual((self.root / "_site/resultados/race/etapa-1/index.html").read_text(),
                         "generated page")

    def test_manual_schedule_and_failed_github_lookup_force_full_build(self):
        for event in ("workflow_dispatch", "schedule", "push"):
            with patch.dict(os.environ, {"GITHUB_EVENT_NAME": event, "GITHUB_REF": "refs/heads/main",
                "GITHUB_REPOSITORY": "fixture/repo", "GITHUB_TOKEN": "fixture"}), patch.object(
                build, "cache_prefix", side_effect=lambda block, now: block + "-fixture-"
            ), patch.object(build, "latest_requests", side_effect=OSError("unavailable")) as lookup:
                build.prepare()
                self.assertTrue(build.read_state()["force"])
                self.assertEqual(lookup.call_count, 1 if event == "push" else 0)

    def test_stage_dispatch_selects_incremental_mode(self):
        previous = (self.now - timedelta(minutes=5)).isoformat()
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch",
                                  "GITHUB_REF": "refs/heads/main", "GITHUB_RUN_NUMBER": "7",
                                  "GITHUB_REPOSITORY": "fixture/repo", "GITHUB_TOKEN": "fixture",
                                  "STAGE_SLUGS": "new-one,new-two"}), patch.object(
                build, "cache_prefix", side_effect=lambda block, now: block + "-fixture-"), patch.object(
                build, "latest_requests", return_value=(previous, previous)) as lookup:
            build.prepare()
        lookup.assert_called_once_with("fixture/repo", "fixture", 7)
        state = build.read_state()
        self.assertFalse(state["force"])
        self.assertIsNone(state["requested"])
        self.assertEqual(state["stage_requested"], previous)
        self.assertEqual(state["stage_slugs"], ["new-one", "new-two"])
        with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch",
                                  "STAGE_SLUGS": "new-one"}), patch.object(
                build, "cache_prefix", side_effect=lambda block, now: block + "-fixture-"), patch.object(
                build, "latest_requests", side_effect=OSError("unavailable")):
            build.prepare()
        # Sin consulta posible se regeneran los bloques de jornadas, no todo.
        self.assertFalse(build.read_state()["force"])
        self.assertIsNotNone(build.read_state()["stage_requested"])
        for invalid in ("new-one,../bad", ",,", "new-one,"):
            with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch",
                                      "STAGE_SLUGS": invalid}):
                with self.assertRaisesRegex(ValueError, "STAGE_SLUGS"):
                    build.prepare()

    def test_workflow_restores_families_and_prunes_test_sources(self):
        source = (Path(__file__).resolve().parents[2] / ".github/workflows/build-site.yml").read_text()
        self.assertEqual(source.count("if: steps.generated.outputs.force != 'true'"), len(build.BLOCKS))
        for block in build.OG_FAMILIES:
            self.assertIn(f"run og-{block[3:]}", source)
            self.assertEqual(source.count(f".pages-generated/{block}/output.tar"), 2)
            self.assertEqual(source.count(f".pages-generated/{block}/manifest.json"), 2)
        self.assertIn("- '!js/**/__tests__/**'", source)
        self.assertIn("rsync -a --relative", source)
        self.assertIn("--exclude '__tests__'", source)
        site = source.split("SITE=(", 1)[1].split(")", 1)[0].split()
        for internal in (".pages-generated", "AGENTS.md", "CLAUDE.md", ".codex", "deploy", "docs"):
            self.assertNotIn(internal, site)
        self.assertIn("actions: read", source)
        self.assertIn("format('pages-stage-{0}', github.run_id)", source)
        self.assertLess(source.index("build_generated.py wait"), source.index("build_generated.py prepare"))
        self.assertNotIn("working-directory: _site", source)

    def test_github_output_normalizes_family_keys(self):
        destination = self.root / "outputs"
        with patch.dict(os.environ, {"GITHUB_OUTPUT": str(destination)}):
            build.output("og-races_prefix", "cache-prefix")
            build.output("save_og-cx", True)
        self.assertEqual(destination.read_text(),
                         "og_races_prefix=cache-prefix\nsave_og_cx=true\n")


if __name__ == "__main__":
    unittest.main()
