import unittest

from results_routes import sector_suffixes, without_ambiguous_plain_entries


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

    def test_plain_legacy_key_does_not_duplicate_sector_routes(self):
        entries = without_ambiguous_plain_entries({(1, ""), (1, "A"), (1, "B"), (2, "")})
        self.assertEqual(entries, {(1, "A"), (1, "B"), (2, "")})


if __name__ == "__main__":
    unittest.main()
