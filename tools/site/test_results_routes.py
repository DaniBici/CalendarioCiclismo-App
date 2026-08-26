import unittest

from results_routes import (
    result_entry_key,
    result_segment,
    result_stage_label,
    sector_suffixes,
    without_ambiguous_plain_entries,
)


class ResultsRoutesTest(unittest.TestCase):
    def setUp(self):
        self.days = [
            {"id": "1b", "raceId": "bct", "dateKey": "2026-08-21", "stageNumber": 1,
             "neutralStartTimeUtc": "2026-08-21T12:00:00Z"},
            {"id": "1a", "raceId": "bct", "dateKey": "2026-08-21", "stageNumber": 1,
             "neutralStartTimeUtc": "2026-08-21T08:00:00Z"},
            {"id": "other", "raceId": "other-race", "dateKey": "2026-08-21", "stageNumber": 1,
             "neutralStartTimeUtc": "2026-08-21T09:00:00Z"},
        ]

    def test_sectors_are_scoped_by_race_and_ordered_by_time(self):
        suffixes = sector_suffixes(self.days)
        self.assertEqual(suffixes, {"1a": "A", "1b": "B"})

    def test_entries_and_routes_keep_both_sectors(self):
        suffixes = sector_suffixes(self.days)
        a = result_entry_key("stage_race", 1, "1a", suffixes)
        b = result_entry_key("stage_race", 1, "1b", suffixes)
        self.assertEqual(a, (1, "A"))
        self.assertEqual(b, (1, "B"))
        self.assertEqual(result_segment(*a), "etapa-1a")
        self.assertEqual(result_segment(*b, is_en=True), "stage-1b")
        self.assertEqual(result_stage_label(*a), "Etapa 1A")

    def test_plain_legacy_key_does_not_duplicate_sector_routes(self):
        entries = without_ambiguous_plain_entries({(1, ""), (1, "A"), (1, "B"), (2, "")})
        self.assertEqual(entries, {(1, "A"), (1, "B"), (2, "")})


if __name__ == "__main__":
    unittest.main()
