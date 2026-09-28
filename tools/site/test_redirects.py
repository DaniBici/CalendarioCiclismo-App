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
                         "en/month/index.html", "en/season/index.html"):
                self.assertIn(path, written)
                page = (Path(tmp) / path).read_text()
                self.assertIn('<meta name="robots" content="noindex, follow">', page)

    def test_simple_redirect_keeps_query_and_hash(self):
        page = redirects.simple_page("/about/", "Acerca de mí", "es")
        self.assertIn("location.replace('/about/' + location.search + location.hash);", page)
        self.assertIn('href="https://calendariociclismo.app/about/"', page)

    def test_calendar_redirect_translates_parameters(self):
        page = dict(redirects.pages())["en/month/index.html"]
        self.assertIn('<html lang="en">', page)
        self.assertIn("q.set('vista', 'mes');", page)
        self.assertIn("q.set('mes', month)", page)
        self.assertIn("location.replace('/en/calendar/?' + q.toString());", page)
        self.assertIn('content="0;url=/en/calendar/?vista=mes"', page)


if __name__ == "__main__":
    unittest.main()
