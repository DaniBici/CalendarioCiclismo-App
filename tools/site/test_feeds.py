"""Cobertura iCal y paginación sin red ni credenciales."""
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

import gen_feeds as feeds


class FeedsTest(unittest.TestCase):
    def test_pagination_exhausts_rows_including_exact_pages(self):
        ranges = []
        rows = [{"id": index} for index in range(2001)]

        def response(request, **kwargs):
            start, end = map(int, request.get_header("Range").split("-"))
            ranges.append((start, end))
            return io.BytesIO(json.dumps(rows[start:end + 1]).encode())

        with patch.object(feeds, "ANON_KEY", "fixture"), patch.object(feeds, "urlopen", response):
            self.assertEqual(feeds.supabase_get("races?select=id&order=id"), rows)
        self.assertEqual(ranges, [(0, 999), (1000, 1999), (2000, 2999)])

    def test_exact_page_range_end_and_other_http_errors(self):
        rows = [{"id": index} for index in range(1000)]
        with patch.object(feeds, "ANON_KEY", "fixture"), patch.object(feeds, "urlopen", side_effect=[
            io.BytesIO(json.dumps(rows).encode()), HTTPError("fixture", 416, "range", {}, None)
        ]):
            self.assertEqual(feeds.supabase_get("races?select=id&order=id"), rows)
        for status in (400, 416, 500):
            with patch.object(feeds, "ANON_KEY", "fixture"), patch.object(feeds, "urlopen", side_effect=
                HTTPError("fixture", status, "error", {}, None)
            ), self.assertRaises(HTTPError):
                feeds.supabase_get("races?select=id&order=id")

    def test_current_future_only_all_english_days_and_old_files_removed(self):
        now = datetime(2026, 9, 14, tzinfo=timezone.utc)
        race = {"id": "current", "year": 2026, "name": "Carrera", "nameEn": "Race",
                "slug": "carrera", "slugEn": "race", "startDate": "2026-09-14",
                "raceFormat": "stage_race", "gender": "male", "uciCategory": "2.UWT"}
        days = [{"id": str(index), "raceId": "current", "slug": f"etapa-{index}",
                 "slugEn": f"stage-{index}", "dateKey": "2026-09-14",
                 "stageNumber": index} for index in range(1005)]
        days += [{"id": "rest", "raceId": "current", "slug": "rest", "dateKey": "2026-09-15", "isRestDay": True},
                 {"id": "cancel", "raceId": "current", "slug": "cancel", "dateKey": "2026-09-16", "isCancelledDay": True}]
        future = {**race, "id": "future", "year": 2027, "startDate": None}
        cwd = Path.cwd()
        with tempfile.TemporaryDirectory() as temporary:
            try:
                os.chdir(temporary)
                Path("feed/event").mkdir(parents=True)
                Path("feed/2020.ics").write_text("old")
                Path("feed/event/old.ics").write_text("old")
                with patch.object(feeds, "supabase_get", return_value=[{"year": 2020}, {"year": 2026}, {"year": 2027}]) as query, patch.object(
                    feeds, "fetch_year", side_effect=lambda year: ([race], days) if year == 2026 else ([future], [])
                ) as fetch:
                    years, totals = feeds.generate_feeds(now)
                self.assertEqual(years, [2026, 2027])
                self.assertIn("year=gte.2026", query.call_args.args[0])
                self.assertEqual([call.args[0] for call in fetch.call_args_list], [2026, 2027])
                self.assertEqual(totals, {"annual": 24, "events": 2010})
                self.assertFalse(Path("feed/2020.ics").exists())
                self.assertFalse(Path("feed/event/old.ics").exists())
                self.assertTrue(Path("en/feed/event/stage-1004.ics").exists())
                self.assertIn("X-WR-CALNAME:Race 2026 — Stage 1004", Path("en/feed/event/stage-1004.ics").read_text())
                self.assertFalse(Path("feed/event/rest.ics").exists())
                self.assertFalse(Path("en/feed/event/cancel.ics").exists())
                self.assertEqual(Path("en/feed/2026.ics").read_text().count("BEGIN:VEVENT"), 1005)
                self.assertNotIn("BEGIN:VEVENT", Path("en/feed/2027.ics").read_text())
            finally:
                os.chdir(cwd)

    def test_year_boundary_and_unknown_year(self):
        before = datetime.fromisoformat("2026-12-31T23:59:59+00:00")
        after = datetime.fromisoformat("2027-01-01T00:00:00+00:00")
        self.assertTrue(feeds.eligible_calendar_year(2026, before))
        self.assertFalse(feeds.eligible_calendar_year(2026, after))
        self.assertTrue(feeds.eligible_calendar_year(2027, after))
        self.assertFalse(feeds.eligible_calendar_year(None, before))

    def test_filters_preserve_es_en_differences(self):
        rows = [{"id": "cn", "uciCategory": "CN", "gender": "male"},
                {"id": "small", "uciCategory": "1.2", "gender": "female", "countryCode": "CA"},
                {"id": "wt", "uciCategory": "1.UWT", "gender": "female"}]
        self.assertEqual([race["id"] for race in feeds.filter_races(rows, "pro", "es")], ["cn", "wt"])
        self.assertEqual([race["id"] for race in feeds.filter_races(rows, "pro", "en")], ["small", "wt"])
        self.assertEqual(feeds.filter_races(rows, "wt", "es"), [])
        self.assertEqual([race["id"] for race in feeds.filter_races(rows, "wt", "en")], ["wt"])
        self.assertNotIn(rows[1], feeds.filter_races(rows, "fem", "en"))

    def test_year_fetch_batches_ids_and_includes_all_english_fields(self):
        races = [{"id": f"id-{index}"} for index in range(205)]
        calls = []

        def query(path):
            calls.append(path)
            return races if path.startswith("races?") else []

        with patch.object(feeds, "supabase_get", query):
            feeds.fetch_year(2026)
        self.assertEqual(len(calls), 4)
        self.assertTrue(all("slugEn" in call and "startLocationEn" in call for call in calls[1:]))
        self.assertTrue(all("id.asc" in call for call in calls))


if __name__ == "__main__":
    unittest.main()
