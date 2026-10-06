#!/usr/bin/env python3
"""Comprueba la coherencia de canonical y hreflang del sitio estático.

Para cada página indexable con canonical propio y alternativas hreflang:
- incluye su propia URL entre las alternativas;
- cada alternativa del artifact es indexable y canónica de sí misma;
- cada alternativa devuelve el enlace con el mismo idioma y la misma URL;
- todas las páginas del grupo declaran el mismo x-default.

Las alternativas que no existen en el artifact se ignoran: son URL servidas
por otra vía (SPA o 404.html) o páginas fuera de este árbol.
"""

import argparse
import re
from pathlib import Path

BASE_URL = "https://calendariociclismo.app"
SKIP_DIRS = {"panel", "docs", "archive", "node_modules", "android-app", "ios-app",
             "scripts", "tools", "workers", "supabase", "deploy", "feed"}
LINK = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
META_ROBOTS = re.compile(r'<meta\s+name="robots"\s+content="([^"]*)"', re.IGNORECASE)
ATTR = re.compile(r'(\w[\w-]*)="([^"]*)"')
HEAD_LIMIT = 16384


def page_url(root, path):
    relative = path.relative_to(root).as_posix()
    if relative == "index.html":
        return BASE_URL + "/"
    if relative.endswith("/index.html"):
        return f"{BASE_URL}/{relative[:-len('index.html')]}"
    return f"{BASE_URL}/{relative}"


def normalize(url):
    return url.rstrip("/") if url else url


def read_head(path):
    with path.open("rb") as handle:
        source = handle.read(HEAD_LIMIT).decode("utf-8", "ignore")
    end = source.lower().find("</head>")
    return source if end < 0 else source[:end]


def parse_head(head):
    canonical = None
    alternates = {}
    for tag in LINK.findall(head):
        attrs = {key.lower(): value for key, value in ATTR.findall(tag)}
        rel = attrs.get("rel", "").lower()
        if rel == "canonical" and canonical is None:
            canonical = attrs.get("href")
        elif rel == "alternate" and attrs.get("hreflang"):
            alternates.setdefault(attrs["hreflang"].lower(), attrs.get("href"))
    robots = META_ROBOTS.search(head)
    noindex = bool(robots and "noindex" in robots.group(1).lower())
    return canonical, alternates, noindex


def collect(root):
    pages = {}
    for path in root.rglob("*.html"):
        parts = path.relative_to(root).parts
        if parts[0] in SKIP_DIRS or path.name == "404.html":
            continue
        canonical, alternates, noindex = parse_head(read_head(path))
        pages[normalize(page_url(root, path))] = {
            "path": path.relative_to(root).as_posix(),
            "canonical": normalize(canonical),
            "alternates": {lang: normalize(url) for lang, url in alternates.items()},
            "noindex": noindex,
        }
    return pages


def check_pages(pages):
    failures = []
    for url, page in sorted(pages.items()):
        alternates = page["alternates"]
        if page["noindex"] or page["canonical"] != url or not alternates:
            continue
        languages = [lang for lang in alternates if lang != "x-default"]
        own = [lang for lang in languages if alternates[lang] == url]
        if not own:
            failures.append(f"{page['path']}: ningún hreflang apunta a la propia URL")
            continue
        if "x-default" not in alternates:
            failures.append(f"{page['path']}: falta x-default")
        for lang in languages:
            target_url = alternates[lang]
            if target_url == url or target_url not in pages:
                continue
            target = pages[target_url]
            if target["noindex"]:
                failures.append(f"{page['path']}: hreflang {lang} apunta a una página noindex ({target['path']})")
                continue
            if target["canonical"] != target_url:
                failures.append(f"{page['path']}: hreflang {lang} apunta a una URL no canónica ({target['path']})")
                continue
            back = target["alternates"]
            if not any(back.get(own_lang) == url for own_lang in own):
                failures.append(f"{page['path']}: {target['path']} no devuelve el hreflang")
            if back.get("x-default") != alternates.get("x-default"):
                failures.append(f"{page['path']}: x-default distinto en {target['path']}")
    return failures


def check_site(root):
    pages = collect(root)
    return len(pages), check_pages(pages)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".", type=Path)
    parser.add_argument("--strict", action="store_true", help="Termina con error si hay incoherencias")
    args = parser.parse_args()
    count, failures = check_site(args.root.resolve())
    for failure in failures[:100]:
        print(f"{'ERROR' if args.strict else '::warning::hreflang'}: {failure}")
    if len(failures) > 100:
        print(f"... y {len(failures) - 100} incoherencias más")
    print(f"hreflang: {count} HTML, {len(failures)} incoherencias")
    if failures and args.strict:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
