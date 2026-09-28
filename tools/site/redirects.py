#!/usr/bin/env python3
"""Genera en el sitio las páginas de redirección de URLs antiguas.

Cada página conserva una URL retirada y redirige a la vigente con la query y
el hash intactos. Las que traducen parámetros (mes.html, temporada.html y sus
equivalentes EN) reescriben la query al formato de /calendario/.

Uso:
  python3 tools/site/redirects.py --out _site
"""

import argparse
import html
from pathlib import Path

ORIGIN = "https://calendariociclismo.app"

# (ruta de salida, destino, título, idioma)
SIMPLE = [
    ("abierto.html", "/abierto/", "Datos abiertos", "es"),
    ("about.html", "/about/", "Acerca de mí", "es"),
    ("calendario.html", "/calendario/", "Calendario", "es"),
    ("campeonatos-nacionales-2026/index.html", "/campeonatos-nacionales-2026.html",
     "Campeonatos Nacionales 2026", "es"),
]

# (ruta de salida, destino, vista, parámetros conservados, título, idioma)
# Los parámetros se dan como (nombre antiguo, nombre nuevo, patrón opcional).
CALENDAR_VIEWS = [
    ("mes.html", "/calendario/", "mes", [("month", "mes", r"^\d{4}-\d{2}$"), ("cat", "cat", None)],
     "Calendario mensual", "es"),
    ("temporada.html", "/calendario/", "temporada", [("year", "year", None), ("cat", "cat", None)],
     "Calendario de la temporada", "es"),
    ("en/month/index.html", "/en/calendar/", "mes", [("month", "mes", r"^\d{4}-\d{2}$"), ("cat", "cat", None)],
     "Monthly calendar", "en"),
    ("en/season/index.html", "/en/calendar/", "temporada", [("year", "year", None), ("cat", "cat", None)],
     "Season calendar", "en"),
]


def _page(lang, title, canonical, script, fallback):
    title = html.escape(title)
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
  <meta charset="UTF-8">
  <title>{title} — Calendario Ciclismo App</title>
  <link rel="canonical" href="{ORIGIN}{canonical}">
  <script>{script}</script>
  <meta http-equiv="refresh" content="0;url={fallback}">
  <meta name="robots" content="noindex, follow">
</head>
<body>
  <p><a href="{fallback}">{title}</a></p>
</body>
</html>
"""


def simple_page(target, title, lang):
    script = f"location.replace('{target}' + location.search + location.hash);"
    return _page(lang, title, target, script, target)


def calendar_page(target, view, params, title, lang):
    lines = [f"q.set('vista', '{view}');"]
    for old, new, pattern in params:
        if pattern:
            lines.append(f"var {old} = p.get('{old}'); "
                         f"if ({old} && /{pattern}/.test({old})) q.set('{new}', {old});")
        else:
            lines.append(f"if (p.get('{old}')) q.set('{new}', p.get('{old}'));")
    script = ("(function () { var p = new URLSearchParams(location.search); "
              "var q = new URLSearchParams(); " + " ".join(lines) +
              f" location.replace('{target}?' + q.toString()); }})();")
    return _page(lang, title, target, script, f"{target}?vista={view}")


def pages():
    for path, target, title, lang in SIMPLE:
        yield path, simple_page(target, title, lang)
    for path, target, view, params, title, lang in CALENDAR_VIEWS:
        yield path, calendar_page(target, view, params, title, lang)


def write(out_root):
    out_root = Path(out_root)
    written = []
    for path, content in pages():
        dest = out_root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8")
        written.append(path)
    return written


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    written = write(args.out)
    print(f"Redirecciones: {len(written)} páginas")


if __name__ == "__main__":
    main()
