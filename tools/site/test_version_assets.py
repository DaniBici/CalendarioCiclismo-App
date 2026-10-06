"""Versionado de JS/CSS en _site."""
import contextlib
import io
import re
import tempfile
import unittest
from pathlib import Path

import version_assets as va


class RewriteTest(unittest.TestCase):
    def html(self, text, version="abc"):
        return va.rewrite(text.encode(), ".html", version).decode()

    def js(self, text, version="abc"):
        return va.rewrite(text.encode(), ".js", version).decode()

    def css(self, text, version="abc"):
        return va.rewrite(text.encode(), ".css", version).decode()

    def test_html_attributes(self):
        source = ('<link rel="stylesheet" href="/css/app.css?v=20260928hoy">'
                  "<script type=module src='js/app.js'></script>"
                  '<script src="/js/a.js?lang=en&v=old#x"></script>'
                  '<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>'
                  '<script src="//cdn.example/x.js"></script>'
                  '<link rel="icon" href="/favicon.svg"><a href="/js/">js</a>')
        self.assertEqual(self.html(source), (
            '<link rel="stylesheet" href="/css/app.css?v=abc">'
            "<script type=module src='js/app.js?v=abc'></script>"
            '<script src="/js/a.js?lang=en&v=abc#x"></script>'
            '<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>'
            '<script src="//cdn.example/x.js"></script>'
            '<link rel="icon" href="/favicon.svg"><a href="/js/">js</a>'))

    def test_html_inline_module(self):
        source = '<script type="module">import { a } from "/js/a.js";</script>'
        self.assertEqual(self.html(source), '<script type="module">import { a } from "/js/a.js?v=abc";</script>')

    def test_js_specifiers(self):
        source = """import { a,
  b } from './shared.js?v=20260924sitefix';
import './side.js';
import"./tight.mjs";
export * from "../services/races.js";
export { c } from '/js/c.js';
const m = await import('./calendario-mes.js?v=old');
const w = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const lazy = import(`./${name}.js`);
const yt = 'https://www.youtube.com/watch?v=abcdefghijk';
fetch('/i18n/en.json?v=1');
const cdn = import('https://cdn.jsdelivr.net/npm/x@1/x.mjs');
"""
        self.assertEqual(self.js(source), """import { a,
  b } from './shared.js?v=abc';
import './side.js?v=abc';
import"./tight.mjs?v=abc";
export * from "../services/races.js?v=abc";
export { c } from '/js/c.js?v=abc';
const m = await import('./calendario-mes.js?v=abc');
const w = new URL('../vendor/pdfjs/pdf.worker.min.mjs?v=abc', import.meta.url).href;
const lazy = import(`./${name}.js`);
const yt = 'https://www.youtube.com/watch?v=abcdefghijk';
fetch('/i18n/en.json?v=1');
const cdn = import('https://cdn.jsdelivr.net/npm/x@1/x.mjs');
""")

    def test_css_imports(self):
        source = ("@import url('tokens.css?v=20260928tokens');\n@import \"base.css\";\n"
                  "@font-face { src: url(/fonts/a.woff2) format('woff2'); }\n"
                  ".x { background: url(\"../img/a.png\"); }\n@import url(https://fonts.example/a.css);\n")
        self.assertEqual(self.css(source), (
            "@import url('tokens.css?v=abc');\n@import \"base.css?v=abc\";\n"
            "@font-face { src: url(/fonts/a.woff2) format('woff2'); }\n"
            ".x { background: url(\"../img/a.png\"); }\n@import url(https://fonts.example/a.css);\n"))

    def test_strip_and_idempotence(self):
        source = "import a from './a.js?v=old';\nimport b from './b.js';\n"
        stripped = self.js(source, None)
        self.assertEqual(stripped, "import a from './a.js';\nimport b from './b.js';\n")
        once = self.js(source)
        self.assertEqual(self.js(once), once)
        self.assertEqual(self.js(once, None), stripped)


class SiteTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name) / "_site"
        files = {
            "index.html": '<link href="/css/app.css?v=manual"><script type="module" src="/js/app.js"></script>',
            "en/index.html": '<script type="module" src="/js/app.js?v=otra"></script>',
            "jornada/a/index.html": '<script type="module" src="/js/jornada.js"></script>',
            "css/app.css": "@import url('tokens.css?v=x');",
            "css/tokens.css": ":root{}",
            "js/app.js": "import { t } from './i18n.js?v=uno';\nimport './cx/view.js';",
            "js/jornada.js": "import { t } from './i18n.js';",
            "js/cx/view.js": "import { t } from '../i18n.js?v=dos';",
            "js/i18n.js": "export const t = 1;",
            "js/vendor/lib.mjs": "import x from './other.js';",
        }
        for name, content in files.items():
            path = self.site / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

    def run_main(self, *extra):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            code = va.main([str(self.site), *extra])
        return code, output.getvalue()

    def i18n_urls(self):
        found = set()
        for name in ("js/app.js", "js/jornada.js", "js/cx/view.js"):
            found.update(re.findall(r"i18n\.js(\?v=[0-9a-f]+)", (self.site / name).read_text()))
        return found

    def test_single_version_for_every_importer(self):
        version = va.site_version(self.site)
        code, output = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn(version, output)
        self.assertEqual(self.i18n_urls(), {"?v=" + version})
        self.assertEqual((self.site / "css/app.css").read_text(), f"@import url('tokens.css?v={version}');")
        for name in ("index.html", "en/index.html", "jornada/a/index.html"):
            self.assertIn(f".js?v={version}", (self.site / name).read_text())
        # Vendor no se reescribe; la versión no depende de las queries ya aplicadas.
        self.assertEqual((self.site / "js/vendor/lib.mjs").read_text(), "import x from './other.js';")
        self.assertEqual(va.site_version(self.site), version)
        self.assertEqual(self.run_main()[0], 0)

    def test_version_follows_asset_content_only(self):
        version = va.site_version(self.site)
        (self.site / "index.html").write_text('<script type="module" src="/js/app.js"></script><p>nuevo</p>')
        self.assertEqual(va.site_version(self.site), version)
        (self.site / "js/vendor/lib.mjs").write_text("export default 2;")
        self.assertNotEqual(va.site_version(self.site), version)


if __name__ == "__main__":
    unittest.main()
