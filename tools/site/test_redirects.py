"""Comprueba las páginas de redirección de URLs antiguas."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import redirects


class RedirectsTest(unittest.TestCase):
    def test_writes_every_legacy_url(self):
        with TemporaryDirectory() as tmp:
            written = redirects.write(tmp)
            for path in ("abierto.html", "about.html", "calendario.html", "mes.html",
                         "temporada.html", "campeonatos-nacionales-2026/index.html",
                         "betaandroid.html", "en/beta/index.html",
                         "en/month/index.html", "en/season/index.html"):
                self.assertIn(path, written)
                page = (Path(tmp) / path).read_text()
                self.assertIn('<meta name="robots" content="noindex, follow">', page)

    def test_calendar_views_use_page_language_params(self):
        es = redirects.calendar_page("/calendario/", ("vista", "mes"),
                                     [("month", "mes", r"^\d{4}-\d{2}$")], "Calendario mensual", "es")
        self.assertIn("q.set('vista', 'mes');", es)
        self.assertIn('content="0;url=/calendario/?vista=mes"', es)
        en = redirects.calendar_page("/en/calendar/", ("view", "month"),
                                     [("month", "month", r"^\d{4}-\d{2}$")], "Monthly calendar", "en")
        self.assertIn("q.set('view', 'month');", en)
        self.assertIn("q.set('month', month)", en)
        self.assertIn('content="0;url=/en/calendar/?view=month"', en)
        self.assertNotIn("vista", en)


if __name__ == "__main__":
    unittest.main()
