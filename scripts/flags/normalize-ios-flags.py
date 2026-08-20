#!/usr/bin/env python3
"""Normaliza los SVG de banderas del asset catalog de iOS para CoreSVG.

CoreSVG (el motor SVG del asset catalog, el que usa `preserves-vector-representation`)
NO es un renderer SVG completo. Bugs cazados en la auditoría 2026-06-10 (ver
scripts/flags/README.md):

  A. clip-path en espacio de usuario + transform EN EL MISMO elemento
     (patrón legacy de flag-icons: el rect del clip × transform == viewBox).
     CoreSVG resuelve mal la combinación: el lienzo/clip sale a escala
     equivocada (Tanzania a 1/3, Aruba a 1/2, bandas blancas en bordes…).
     Fix: transformar el rect del clip a espacio raíz y anidar el transform
     en un <g> interior. Semánticamente idéntico; la geometría del arte no
     se toca (verbatim, igual que el aplanado de <use> de la build 1059).

  B. <marker>/marker-mid no soportado (us/um: las 50 estrellas no se pintan).
     Fix: expandir cada estampa del marker en un <path transform="translate()">
     real con la geometría verbatim de la estrella.

  C. Paint servers colgantes — fill/stroke="url(#id)" sin definición en el
     archivo (sh-ac: el build de flag-icons upstream perdió los gradientes
     del escudo). Web/Android (spec) tratan paint inválido como none;
     CoreSVG lo pinta. Fix: fill/stroke="none" explícito = lo que ve la web.

  D. Trazos con escala anisótropa (es-ct: franjas como stroke-width 60 bajo
     scale(.79012 .88889)): CoreSVG desplaza los bordes ~1px. Fix: convertir
     las líneas trazadas en rects equivalentes en espacio raíz.

Idempotente: re-ejecutar sobre archivos ya normalizados no cambia nada.
Tras CUALQUIER ejecución hay que pasar la verificación de píxeles
(scripts/flags/README.md): cairosvg(fijado) vs cairosvg(canónico) ≈ 0 y
re-volcado del simulador (FlagRenderAuditTests) vs canónico.

Uso:  python3 scripts/flags/normalize-ios-flags.py [--dry-run]
"""
import os
import re
import sys

FLAGS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..",
    "ios-app", "CalendarioCiclismo", "Assets.xcassets", "Flags",
)

DRY = "--dry-run" in sys.argv


def fmt(n: float) -> str:
    """Número compacto estilo flag-icons (sin ceros colgantes)."""
    s = f"{n:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


# ── parsers mínimos (bail ruidoso ante cualquier forma no prevista) ──────────

def parse_transform(t: str):
    """Devuelve la afín (a,b,c,d,e,f) de una lista de transforms. Solo
    matrix/translate/scale sin rotación/skew (b=c=0); si no, ValueError."""
    a, b, c, d, e, f = 1.0, 0.0, 0.0, 1.0, 0.0, 0.0
    pos = 0
    t = t.strip()
    for m in re.finditer(r"(matrix|translate|scale)\(([^)]*)\)\s*", t):
        if m.start() != pos:
            raise ValueError(f"transform no contiguo: {t!r}")
        pos = m.end()
        kind = m.group(1)
        nums = [float(x) for x in re.split(r"[\s,]+", m.group(2).strip())]
        if kind == "matrix":
            if len(nums) != 6:
                raise ValueError(f"matrix con {len(nums)} números")
            m2 = nums
        elif kind == "translate":
            tx = nums[0]
            ty = nums[1] if len(nums) > 1 else 0.0
            m2 = [1, 0, 0, 1, tx, ty]
        else:  # scale
            sx = nums[0]
            sy = nums[1] if len(nums) > 1 else sx
            m2 = [sx, 0, 0, sy, 0, 0]
        # componer: actual ∘ nuevo
        a, b, c, d, e, f = (
            a * m2[0] + c * m2[1],
            b * m2[0] + d * m2[1],
            a * m2[2] + c * m2[3],
            b * m2[2] + d * m2[3],
            a * m2[4] + c * m2[5] + e,
            b * m2[4] + d * m2[5] + f,
        )
    if pos != len(t):
        raise ValueError(f"transform con restos: {t!r}")
    if abs(b) > 1e-9 or abs(c) > 1e-9:
        raise ValueError(f"transform con rotación/skew: {t!r}")
    if a <= 0 or d <= 0:
        raise ValueError(f"transform con escala negativa: {t!r}")
    return a, d, e, f


def _cluster(values, tol=0.6):
    """Agrupa valores casi iguales (ruido fp + redondeos sueltos de flag-icons)."""
    out = []
    for v in sorted(values):
        if out and abs(v - out[-1][-1]) <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]


def parse_rect_path(d: str):
    """Rect de un path M/m + h/H/v/V + z. Devuelve (x, y, w, h) o ValueError."""
    tokens = re.findall(r"([MmhHvVzZ])([^MmhHvVzZ]*)", d.strip())
    if not tokens or tokens[0][0] not in "Mm":
        raise ValueError(f"clip path no empieza por M: {d!r}")
    nums0 = [float(x) for x in re.findall(r"-?\d*\.?\d+", tokens[0][1])]
    if len(nums0) != 2:
        raise ValueError(f"M con {len(nums0)} números: {d!r}")
    x0, y0 = nums0
    x, y = x0, y0
    xs, ys = [x], [y]
    for cmd, raw in tokens[1:]:
        if cmd in "zZ":
            continue
        v = float(raw.strip())
        if cmd == "h":
            x += v
        elif cmd == "H":
            x = v
        elif cmd == "v":
            y += v
        elif cmd == "V":
            y = v
        xs.append(x)
        ys.append(y)
    cx, cy = _cluster(xs), _cluster(ys)
    if len(cx) != 2 or len(cy) != 2:
        raise ValueError(f"clip path no es un rect: {d!r}")
    return cx[0], cy[0], cx[1] - cx[0], cy[1] - cy[0]


def transform_path_d(d: str, a: float, sd: float, e: float, f: float) -> str:
    """Aplica la afín (escala a/sd + traslación e/f, sin rotación) a un path
    arbitrario, comando a comando. Para clips no rectangulares."""
    out = []
    first = True
    for m in re.finditer(r"([MmLlHhVvZzCcSsQqTt])([^MmLlHhVvZzCcSsQqTtAa]*)|([Aa])", d.strip()):
        if m.group(3):
            raise ValueError("clip con arcos: no soportado")
        cmd, raw = m.group(1), m.group(2)
        nums = [float(v) for v in re.findall(r"-?\d*\.?\d+(?:e-?\d+)?", raw)]
        rel = cmd.islower()
        # un `m` como PRIMER comando es absoluto por spec (su primer par);
        # los pares implícitos siguientes son linetos relativos
        first_pair_abs = first and cmd == "m"
        first = False
        if cmd in "Zz":
            out.append("z")
            continue
        if cmd in "Hh":
            scaled = [n * a for n in nums]
            if not rel:
                scaled = [n * a + e for n in nums]
            out.append(("h" if rel else "H") + " ".join(fmt(n) for n in scaled))
            continue
        if cmd in "Vv":
            scaled = [n * sd for n in nums]
            if not rel:
                scaled = [n * sd + f for n in nums]
            out.append(("v" if rel else "V") + " ".join(fmt(n) for n in scaled))
            continue
        if len(nums) % 2 != 0:
            raise ValueError(f"comando {cmd} con número impar de coordenadas")
        pts = []
        for i in range(0, len(nums), 2):
            absolute = (not rel) or (first_pair_abs and i == 0)
            px = nums[i] * a + (e if absolute else 0)
            py = nums[i + 1] * sd + (f if absolute else 0)
            pts.append(f"{fmt(px)} {fmt(py)}")
        out.append(cmd + " ".join(pts))
    return "".join(out)


def find_matching_close(s: str, open_end: int) -> int:
    """Índice del `</g>` que cierra el <g> cuyo tag abre justo antes de open_end."""
    depth = 1
    for m in re.finditer(r"<g\b[^>]*>|</g>", s[open_end:]):
        if m.group(0).startswith("</"):
            depth -= 1
            if depth == 0:
                return open_end + m.start()
        elif not m.group(0).endswith("/>"):
            depth += 1
    raise ValueError("no se encontró el </g> de cierre")


# ── A: clip-path + transform en el mismo <g> ─────────────────────────────────

def fix_clip_transform(code: str, s: str):
    changed = False
    while True:
        m = re.search(
            r'<g\b(?=[^>]*clip-path="url\(#([^)"]+)\)")(?=[^>]*transform="([^"]+)")[^>]*>',
            s,
        )
        if not m:
            break
        clip_id, transform = m.group(1), m.group(2)
        a, d, e, f = parse_transform(transform)

        cp = re.search(
            r'(<clipPath id="' + re.escape(clip_id) + r'">\s*<path [^>]*d=")([^"]+)("[^>]*/>\s*</clipPath>)',
            s,
        )
        if not cp:
            # variante <rect> (zw): transformar sus atributos in situ
            cr = re.search(
                r'<clipPath id="' + re.escape(clip_id) + r'">\s*<rect ([^>]*)/>\s*</clipPath>',
                s,
            )
            if not cr:
                raise ValueError(f"{code}: clipPath #{clip_id} no encontrado o con forma no prevista")
            attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', cr.group(1)))
            x = float(attrs.get("x", "0"))
            y = float(attrs.get("y", "0"))
            w, h = float(attrs["width"]), float(attrs["height"])
            attrs["x"], attrs["y"] = fmt(a * x + e), fmt(d * y + f)
            attrs["width"], attrs["height"] = fmt(a * w), fmt(d * h)
            new_rect = "<rect " + " ".join(f'{k}="{v}"' for k, v in attrs.items()) + "/>"
            s = (
                s[: cr.start()]
                + f'<clipPath id="{clip_id}">{new_rect}</clipPath>'
                + s[cr.end():]
            )
            m = re.search(
                r'<g\b(?=[^>]*clip-path="url\(#' + re.escape(clip_id) + r'\)")(?=[^>]*transform="([^"]+)")[^>]*>',
                s,
            )
            open_tag = m.group(0)
            stripped = open_tag.replace(f' transform="{m.group(1)}"', "", 1)
            close_at = find_matching_close(s, m.end())
            s = (
                s[: m.start()]
                + stripped
                + f'<g transform="{m.group(1)}">'
                + s[m.end(): close_at]
                + "</g>"
                + s[close_at:]
            )
            changed = True
            continue
        try:
            x, y, w, h = parse_rect_path(cp.group(2))
            nx, ny, nw, nh = a * x + e, d * y + f, a * w, d * h
            new_d = f"M{fmt(nx)} {fmt(ny)}h{fmt(nw)}v{fmt(nh)}H{fmt(nx)}z"
        except ValueError:
            # clip no rectangular (triángulos, siluetas): transformar el path entero
            new_d = transform_path_d(cp.group(2), a, d, e, f)
        s = s[: cp.start()] + cp.group(1) + new_d + cp.group(3) + s[cp.end():]

        # re-localizar el <g> tras el reemplazo anterior
        m = re.search(
            r'<g\b(?=[^>]*clip-path="url\(#' + re.escape(clip_id) + r'\)")(?=[^>]*transform="([^"]+)")[^>]*>',
            s,
        )
        open_tag = m.group(0)
        stripped = open_tag.replace(f' transform="{m.group(1)}"', "", 1)
        if stripped == open_tag:
            raise ValueError(f"{code}: no pude quitar transform del tag {open_tag!r}")
        close_at = find_matching_close(s, m.end())
        s = (
            s[: m.start()]
            + stripped
            + f'<g transform="{m.group(1)}">'
            + s[m.end(): close_at]
            + "</g>"
            + s[close_at:]
        )
        changed = True
    return s, changed


# ── B: expandir <marker>/marker-mid (us, um) ─────────────────────────────────

def fix_markers(code: str, s: str):
    mk = re.search(r'\n?\s*<marker id="([^"]+)"[^>]*>\s*<path ([^>]*)/>\s*</marker>', s)
    if not mk:
        if "marker-mid" in s:
            raise ValueError(f"{code}: marker-mid sin <marker> reconocible")
        return s, False
    marker_id, star_attrs = mk.group(1), mk.group(2)

    carrier = re.search(
        r'\n?\s*<path [^>]*marker-mid="url\(#' + re.escape(marker_id) + r'\)"[^>]*d="([^"]+)"[^>]*/>',
        s,
    )
    if not carrier:
        raise ValueError(f"{code}: no encontré el path portador del marker")
    d = carrier.group(1)

    # vértices del portador: m inicial relativo + parejas lineto implícitas,
    # h relativo, L absoluto, z final
    tokens = re.findall(r"([mhLz])([^mhLz]*)", d)
    if not tokens or tokens[0][0] != "m":
        raise ValueError(f"{code}: portador no empieza por m: {d[:40]!r}")
    verts = []
    x = y = 0.0
    first = True
    for cmd, raw in tokens:
        nums = [float(v) for v in re.findall(r"-?\d*\.?\d+", raw)]
        if cmd == "m":
            x, y = nums[0], nums[1]
            verts.append((x, y))
            for i in range(2, len(nums), 2):
                x += nums[i]
                y += nums[i + 1]
                verts.append((x, y))
        elif cmd == "h":
            for v in nums:
                x += v
                verts.append((x, y))
        elif cmd == "L":
            for i in range(0, len(nums), 2):
                x, y = nums[i], nums[i + 1]
                verts.append((x, y))
        elif cmd == "z":
            pass
        first = False
    # marker-mid: todos los vértices menos el moveto inicial (el cierre z
    # devuelve al inicial, que recibiría marker-end — no pintado)
    stamps = verts[1:]
    if len(stamps) != 50:
        raise ValueError(f"{code}: esperaba 50 estrellas, hay {len(stamps)}")

    star = "".join(
        f'<path transform="translate({fmt(px)} {fmt(py)})" {star_attrs.strip()}/>'
        for px, py in stamps
    )
    block = "<g>" + star + "</g>"
    s = s[: mk.start()] + s[mk.end():]
    carrier = re.search(
        r'\n?(\s*)<path [^>]*marker-mid="url\(#' + re.escape(marker_id) + r'\)"[^>]*/>',
        s,
    )
    s = s[: carrier.start()] + "\n" + carrier.group(1) + block + s[carrier.end():]
    return s, True


# ── C: paints colgantes → none ───────────────────────────────────────────────

def fix_dangling_paints(code: str, s: str):
    ids = set(re.findall(r'id="([^"]+)"', s))
    changed = False

    def sub(m):
        nonlocal changed
        if m.group(2) in ids:
            return m.group(0)
        changed = True
        return f'{m.group(1)}="none"'

    s = re.sub(r'(fill|stroke)="url\(#([^)"]+)\)"', sub, s)
    return s, changed


# ── D: franjas trazadas con escala anisótropa → rects (es-ct) ────────────────

def fix_anisotropic_stroke_stripes(code: str, s: str):
    m = re.search(
        r'<path stroke="([^"]+)" stroke-width="([\d.]+)" d="([^"]+)" transform="scale\(([\d.]+) ([\d.]+)\)"/>',
        s,
    )
    if not m:
        return s, False
    color, width, d, sx, sy = m.group(1), float(m.group(2)), m.group(3), float(m.group(4)), float(m.group(5))
    # SOLO franjas horizontales puras (es-ct): M/m de 2 números + h/H. Cualquier
    # otra cosa (diagonales tipo gb-sct, que CoreSVG sí renderiza bien) → no tocar.
    tokens = re.findall(r"([MmhH])([^MmhH]*)", d.strip())
    if "".join(c + r for c, r in tokens) != d.strip():
        return s, False
    lines = []
    x = y = 0.0
    for cmd, raw in tokens:
        nums = [float(v) for v in re.findall(r"-?\d*\.?\d+", raw)]
        if cmd in "Mm":
            if len(nums) != 2:
                return s, False  # linetos implícitos → no son franjas
            x, y = (nums[0], nums[1]) if cmd == "M" else (x + nums[0], y + nums[1])
        elif cmd == "h":
            if len(nums) != 1:
                return s, False
            x2 = x + nums[0]
            lines.append((min(x, x2), y, abs(nums[0])))
            x = x2
        elif cmd == "H":
            if len(nums) != 1:
                return s, False
            x2 = nums[0]
            lines.append((min(x, x2), y, abs(x2 - x)))
            x = x2
    if not lines:
        return s, False
    rects = []
    for lx, ly, lw in lines:
        rx, rw = lx * sx, lw * sx
        ry, rh = (ly - width / 2) * sy, width * sy
        rects.append(f"M{fmt(rx)} {fmt(ry)}h{fmt(rw)}v{fmt(rh)}H{fmt(rx)}z")
    repl = f'<path fill="{color}" d="{"".join(rects)}"/>'
    s = s[: m.start()] + repl + s[m.end():]
    return s, True


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    flags_dir = os.path.abspath(FLAGS_DIR)
    touched, errors = [], []
    for entry in sorted(os.listdir(flags_dir)):
        if not entry.endswith(".imageset"):
            continue
        code = entry[: -len(".imageset")]
        path = os.path.join(flags_dir, entry, f"{code}.svg")
        if not os.path.exists(path):
            continue
        original = open(path).read()
        s = original
        applied = []
        try:
            for name, fn in (
                ("clip+transform", fix_clip_transform),
                ("marker", fix_markers),
                ("dangling-paint", fix_dangling_paints),
                ("aniso-stroke", fix_anisotropic_stroke_stripes),
            ):
                s, ch = fn(code, s)
                if ch:
                    applied.append(name)
        except ValueError as exc:
            errors.append(f"{code}: {exc}")
            continue
        if applied:
            touched.append((code, applied))
            if not DRY:
                open(path, "w").write(s)
    for code, applied in touched:
        print(f"{code}: {', '.join(applied)}")
    print(f"\n{'DRY-RUN — ' if DRY else ''}{len(touched)} banderas normalizadas")
    if errors:
        print("\nERRORES (sin tocar):")
        for e in errors:
            print(" -", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
