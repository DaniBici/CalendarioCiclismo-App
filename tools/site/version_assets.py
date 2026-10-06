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
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

EXTENSIONS = (".html", ".js", ".mjs", ".css")
ASSET_EXTENSIONS = (".js", ".mjs", ".css")
# Código de terceros sin imports locales: entra en la versión, no se reescribe.
UNTOUCHED_SEGMENT = "vendor"

# Ancla literal: extensión seguida de query, fragmento o delimitador de cierre.
# Empezar por un literal permite recorrer decenas de miles de páginas en
# segundos; el contexto (atributo, import o @import) se comprueba hacia atrás.
ANCHOR = re.compile(rb"(?P<ext>\.(?:m?js|css))(?P<query>\?[^'\"\s#<>()`]*)?(?P<fragment>#[^'\"\s<>()`]*)?(?P<end>['\")])")
PATH_STOP = frozenset(b"'\"()<>`?# \t\r\n\f")
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
WINDOW = 48


def references(content, suffix):
    """Posiciones (inicio de ruta, fin de ruta, match del ancla) de URL locales."""
    prefix = PREFIXES[suffix]
    for match in ANCHOR.finditer(content):
        start = match.start()
        while start and content[start - 1] not in PATH_STOP:
            start -= 1
        if start == match.start() or not start:
            continue
        opener, closer = content[start - 1:start], match.group("end")
        path = content[start:match.end("ext")]
        if path.startswith(b"//") or SCHEME.match(path):
            continue
        window = content[max(0, start - 1 - WINDOW):start - 1]
        if opener in (b"'", b'"'):
            if opener != closer or not prefix.search(window):
                continue
        elif not (opener == b"(" and closer == b")" and suffix == ".css" and CSS_BARE_URL.search(window)):
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


def unversioned(content, suffix, version):
    """Rutas locales de `content` sin la versión `version`."""
    expected = b"v=" + version.encode("ascii")
    return [content[start:end].decode("utf-8", "replace")
            for start, end, match in references(content, suffix)
            if expected not in (match.group("query") or b"?")[1:].split(b"&")]


def rewritable(name):
    return Path(name).suffix in PREFIXES and UNTOUCHED_SEGMENT not in name.split("/")


def site_files(site):
    """Rutas relativas (posix) de HTML/JS/CSS de `site`, ordenadas."""
    names = []
    for directory, subdirectories, files in os.walk(site):
        subdirectories.sort()
        base = Path(directory).relative_to(site)
        names.extend((base / name).as_posix() for name in sorted(files)
                     if name.endswith(EXTENSIONS))
    return names


def site_version(site):
    """Versión única del sitio a partir de sus JS/CSS sin queries de versión."""
    site = Path(site)
    result = hashlib.sha256()
    for name in site_files(site):
        suffix = Path(name).suffix
        if suffix not in ASSET_EXTENSIONS:
            continue
        content = (site / name).read_bytes()
        if rewritable(name):
            content = rewrite(content, suffix, None)
        result.update(name.encode("utf-8") + b"\0" + content + b"\0")
    return result.hexdigest()[:12]


def version_files(site, names, version, missing=None):
    """Reescribe `names` dentro de `site`; devuelve cuántos cambiaron.

    Con `missing` (lista) añade las referencias que siguen sin la versión."""
    changed = 0
    for name in names:
        if not rewritable(name):
            continue
        path = Path(site) / name
        original = path.read_bytes()
        updated = rewrite(original, path.suffix, version)
        if updated != original:
            path.write_bytes(updated)
            changed += 1
        if missing is not None:
            missing.extend(f"{name}: {ref}" for ref in unversioned(updated, path.suffix, version))
    return changed


def current_generated_files(cache_root, version):
    """HTML de familias OG cuyo tar ya se versionó con `version`."""
    current = set()
    for manifest in sorted(Path(cache_root).glob("og-*/manifest.json")):
        try:
            metadata = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if metadata.get("asset_version") == version:
            current.update(metadata.get("files", ()))
    return current


def main(argv=None):
    parser = argparse.ArgumentParser(description="Versiona las URL locales de JS/CSS de _site.")
    parser.add_argument("site", type=Path)
    parser.add_argument("--generated-cache", type=Path,
                        help="Directorio .pages-generated: omite el HTML OG ya versionado")
    arguments = parser.parse_args(argv)
    started = time.monotonic()
    site = arguments.site
    version = site_version(site)
    skipped = (current_generated_files(arguments.generated_cache, version)
               if arguments.generated_cache else set())
    pending = [name for name in site_files(site) if name not in skipped]
    missing = []
    changed = version_files(site, pending, version, missing)
    if missing:
        print(f"::error::Referencias locales sin versión: {missing[:10]}")
        return 1
    index = site / "index.html"
    if index.is_file() and b"?v=" + version.encode("ascii") not in index.read_bytes():
        print("::error::index.html no referencia assets versionados")
        return 1
    print(f"Versión de assets: {version}")
    print(f"  Reescritos {changed} de {len(pending)} ficheros; {len(skipped)} HTML OG ya vigentes; "
          f"{time.monotonic() - started:.2f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
