"""Temporadas 2020-2025: noindex en las páginas de carrera."""
import unittest

from archived_seasons import ROBOTS_INDEX, race_robots
from test_cx_pages import offline_helpers


class ArchivedSeasonsTest(unittest.TestCase):
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
