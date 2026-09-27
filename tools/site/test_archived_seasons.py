"""Temporadas 2020-2025: noindex en las páginas de carrera."""
import unittest

from archived_seasons import ROBOTS_INDEX, ROBOTS_NOINDEX, race_is_archived, race_robots
from test_cx_pages import offline_helpers


class ArchivedSeasonsTest(unittest.TestCase):
    def test_season_range(self):
        for year in (2020, 2025, "2023"):
            self.assertTrue(race_is_archived({"year": year}))
        for race in ({"year": 2019}, {"year": 2026}, {"year": None}, {}, None):
            self.assertFalse(race_is_archived(race))
        self.assertEqual(race_robots({"year": 2024}), ROBOTS_NOINDEX)
        self.assertEqual(race_robots({"year": 2026}), ROBOTS_INDEX)

    def test_page_templates_emit_robots(self):
        builder = offline_helpers("tools/site/gen_og_pages.py")
        for render in (builder["og_page"], builder["og_page_en"]):
            default = render("T", "D", "https://calendariociclismo.app/x/")
            archived = render("T", "D", "https://calendariociclismo.app/x/",
                              robots=race_robots({"year": 2025}))
            self.assertIn(f'<meta name="robots" content="{ROBOTS_INDEX}">', default)
            self.assertIn('<meta name="robots" content="noindex, follow">', archived)
            self.assertNotIn("index, follow, max-image-preview", archived)


if __name__ == "__main__":
    unittest.main()
