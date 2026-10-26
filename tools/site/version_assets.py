#!/usr/bin/env python3
"""Versiona las URL locales de JS/CSS del sitio compuesto con una query única.

Las fuentes no llevan `?v=`. Tras componer `_site`, este paso añade
`?v=<versión>` a cada referencia local a un `.js`, `.mjs` o `.css`:

- HTML: atributos `src`/`href` y especificadores de módulo en scripts en línea.
- JS: `import … from`, `export … from`, `import '…'`, `import('…')` con literal
  y `new URL('…', …)`.
- CSS: `@import '…'` y `url(…)`.

La versión es única para todo el sitio: SHA-256 de las rutas y del contenido
de todos los JS/CSS publicados, sin sus propias queries de versión. Una versión
por fichero no basta en un grafo de módulos ES: si cambia B y no A, la URL de A
se mantiene, el navegador puede servir A de caché con la URL antigua de B
mientras otro importador pide la nueva, y B se evalúa dos veces con estado
separado. Con una versión global todas las URL cambian a la vez y cada módulo
tiene una sola URL por despliegue. A diferencia del SHA del commit, la versión
no cambia en builds sin cambios de JS/CSS (cron, cambios de HTML o datos).

Con `--preload-map` (salida de `bundle_assets.mjs --preload-map`), cada HTML
reescrito recibe antes de `</head>` un `<link rel="modulepreload">` por módulo
que sus `<script type="module" src>` importan de forma estática. Se versiona
como el resto, así que coincide con la URL que pide el `import`.
"""
import argparse
import hashlib
import json
import os
import posixpath
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from functools import partial
from pathlib import Path

EXTENSIONS = (".html", ".js", ".mjs", ".css")
ASSET_EXTENSIONS = (".js", ".mjs", ".css")
# Código de terceros sin imports locales: entra en la versión, no se reescribe.
UNTOUCHED_SEGMENT = "vendor"

# Ancla literal: extensión seguida de query, fragmento o delimitador de cierre.
# Empezar por un literal permite recorrer decenas de miles de páginas en
# segundos; el contexto (atributo, import o @import) se comprueba hacia atrás.
ANCHOR = re.compile(rb"(?P<ext>\.(?:m?js|css))(?P<query>\?[^'\"\s#<>()`]*)?(?P<fragment>#[^'\"\s<>()`]*)?(?P<end>['\")])")
# Ruta que precede al ancla, hasta el primer delimitador. Se aplica sobre el
# contenido invertido para recorrerla hacia atrás en una sola llamada.
PATH_REVERSED = re.compile(rb"[^'\"()<>`?# \t\r\n\f]*")
SCHEME = re.compile(rb"[A-Za-z][A-Za-z0-9+.-]*:")
_JS = rb"(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\bnew\s+URL\s*\(\s*)\Z"
# Contexto que precede a la comilla (o al paréntesis de url() sin comillas).
PREFIXES = {
    ".html": re.compile(rb"(?:(?i:\b(?:src|href)\s*=\s*)\Z)|" + _JS),
    ".js": re.compile(_JS),
    ".mjs": re.compile(_JS),
    ".css": re.compile(rb"(?i:@import\s+|\burl\(\s*)\Z"),
}
CSS_BARE_URL = re.compile(rb"(?i:\burl)\Z")
# Contexto más frecuente en HTML (atributo tras un espacio): basta con mirar el
# final de la ventana. El resto de contextos pasa por la expresión completa.
QUICK_PREFIXES = {".html": (b" src=", b" href=")}
WINDOW = 48
# Ficheros a partir de los cuales el sitio se reparte entre procesos.
PARALLEL_FILES = 2000

MODULE_SCRIPT = re.compile(rb"<script\b[^>]*\btype\s*=\s*[\"']module[\"'][^>]*>", re.I)
SCRIPT_SRC = re.compile(rb"\bsrc\s*=\s*[\"']([^\"']+)[\"']", re.I)
PRELOAD_LINK = re.compile(rb'<link rel="modulepreload" href="[^"]*">\n?')
HEAD_END = re.compile(rb"</head>", re.I)


def references(content, suffix):
    """Posiciones (inicio de ruta, fin de ruta, match del ancla) de URL locales."""
    prefix, quick = PREFIXES[suffix], QUICK_PREFIXES.get(suffix, ())
    size, reversed_content = len(content), None
    for match in ANCHOR.finditer(content):
        if reversed_content is None:
            reversed_content = content[::-1]
        start = size - PATH_REVERSED.match(reversed_content, size - match.start()).end()
        if start == match.start() or not start:
            continue
        opener, closer = content[start - 1:start], match.group("end")
        path = content[start:match.end("ext")]
        if path.startswith(b"//") or SCHEME.match(path):
            continue
        window_start = max(0, start - 1 - WINDOW)
        if opener in (b"'", b'"'):
            if opener != closer or not (content.endswith(quick, window_start, start - 1)
                                        or prefix.search(content[window_start:start - 1])):
                continue
        elif not (opener == b"(" and closer == b")" and suffix == ".css"
                  and CSS_BARE_URL.search(content[window_start:start - 1])):
            continue
        yield start, match.end("ext"), match


def _query(query, version):
    """Sustituye el parámetro `v` y conserva los demás."""
    params = [part for part in (query or b"?")[1:].split(b"&")
              if part and part != b"v" and not part.startswith(b"v=")]
    if version is not None:
        params.append(b"v=" + version.encode("ascii"))
    return b"?" + b"&".join(params) if params else b""


def rewrite(content, suffix, version):
    """Devuelve `content` con las URL locales versionadas; `None` retira la versión."""
    parts, last = [], 0
    for _, path_end, match in references(content, suffix):
        parts += (content[last:path_end], _query(match.group("query"), version),
                  match.group("fragment") or b"")
        last = match.start("end")
    if not parts:
        return content
    parts.append(content[last:])
    return b"".join(parts)


def module_entries(content, name):
    """URL absolutas, sin query ni fragmento, de los `<script type="module" src>`."""
    base = posixpath.join("/", posixpath.dirname(name))
    entries = []
    for tag in MODULE_SCRIPT.finditer(content):
        src = SCRIPT_SRC.search(tag.group(0))
        if not src:
            continue
        path = re.split(rb"[?#]", src.group(1))[0]
        if path.startswith(b"//") or SCHEME.match(path):
            continue
        entries.append(posixpath.normpath(posixpath.join(base, path.decode("utf-8"))))
    return entries


def inject_preloads(content, name, preloads):
    """Sustituye las precargas de módulos del HTML por las de sus entradas."""
    content = PRELOAD_LINK.sub(b"", content)
    entries = module_entries(content, name)
    urls = []
    for entry in entries:
        urls.extend(url for url in preloads.get(entry, ()) if url not in urls and url not in entries)
    head_end = HEAD_END.search(content)
    if not urls or not head_end:
        return content
    links = b"".join(b'<link rel="modulepreload" href="' + url.encode("utf-8") + b'">\n' for url in urls)
    return content[:head_end.start()] + links + content[head_end.start():]


def suffix_of(name):
    """Extensión de una ruta relativa posix, como `Path(name).suffix`."""
    base = name.rpartition("/")[2]
    dot = base.rfind(".")
    return base[dot:] if 0 < dot < len(base) - 1 else ""


def rewritable(name):
    return suffix_of(name) in PREFIXES and UNTOUCHED_SEGMENT not in name.split("/")


def site_files(site):
    """Rutas relativas (posix) de HTML/JS/CSS de `site`, ordenadas."""
    root = os.path.normpath(site)
    names = []
    for directory, subdirectories, files in os.walk(root):
        subdirectories.sort()
        base = "" if directory == root else directory[len(root) + 1:] + "/"
        names.extend(base + name for name in sorted(files) if name.endswith(EXTENSIONS))
    return names


def site_version(site, names=None):
    """Versión única del sitio a partir de sus JS/CSS sin queries de versión.

    `names` (salida de `site_files`) evita recorrer de nuevo el árbol."""
    site = Path(site)
    result = hashlib.sha256()
    for name in site_files(site) if names is None else names:
        suffix = suffix_of(name)
        if suffix not in ASSET_EXTENSIONS:
            continue
        content = (site / name).read_bytes()
        if rewritable(name):
            content = rewrite(content, suffix, None)
        result.update(name.encode("utf-8") + b"\0" + content + b"\0")
    return result.hexdigest()[:12]


def version_files(site, names, version, preloads=None):
    """Reescribe `names` dentro de `site`; devuelve cuántos cambiaron.

    Con `preloads` (mapa entrada → módulos) inyecta las precargas en el HTML.
    La salida no se vuelve a recorrer: toda referencia que `references`
    encuentra recibe la versión (test_rewrite_versions_every_reference)."""
    changed = 0
    for name in names:
        if not rewritable(name):
            continue
        suffix = suffix_of(name)
        path = os.path.join(site, name)
        with open(path, "rb") as handle:
            original = handle.read()
        updated = original
        if preloads is not None and suffix == ".html":
            updated = inject_preloads(updated, name, preloads)
        updated = rewrite(updated, suffix, version)
        if updated != original:
            with open(path, "wb") as handle:
                handle.write(updated)
            changed += 1
    return changed


def version_site_files(site, names, version, preloads=None):
    """`version_files` repartido entre los procesadores: cada fichero se
    reescribe por separado, así que el resultado no depende del reparto."""
    workers = min(os.cpu_count() or 1, len(names) // PARALLEL_FILES)
    if workers < 2:
        return version_files(site, names, version, preloads)
    task = partial(version_files, site, version=version, preloads=preloads)
    with ProcessPoolExecutor(workers) as pool:
        return sum(pool.map(task, [names[at::workers] for at in range(workers)]))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Versiona las URL locales de JS/CSS de _site.")
    parser.add_argument("site", type=Path)
    parser.add_argument("--preload-map", type=Path,
                        help="Mapa de bundle_assets.mjs: precargas de módulos en el HTML reescrito")
    arguments = parser.parse_args(argv)
    started = time.monotonic()
    site = arguments.site
    preloads = None
    if arguments.preload_map:
        try:
            preloads = json.loads(arguments.preload_map.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            print(f"::error::Mapa de precargas ilegible: {error}")
            return 1
    names = site_files(site)
    version = site_version(site, names)
    changed = version_site_files(site, names, version, preloads)
    index = site / "index.html"
    if index.is_file() and b"?v=" + version.encode("ascii") not in index.read_bytes():
        print("::error::index.html no referencia assets versionados")
        return 1
    print(f"Versión de assets: {version}")
    print(f"  Reescritos {changed} de {len(names)} ficheros; {time.monotonic() - started:.2f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
