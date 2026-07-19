#!/usr/bin/env python3
"""Verificación de píxeles de las banderas de iOS contra el set canónico.

Dos puertas (ver README.md de esta carpeta):

  gate1  — cairosvg(SVG de iOS) vs cairosvg(SVG canónico flag-icons).
           Verifica que una normalización NO cambió el dibujo (equivalencia de
           contenido bajo un renderer SVG completo). Debe dar ~0 en todas.
  gate2  — PNG del simulador (CoreSVG real, los vuelca FlagRenderAuditTests
           en /tmp/flag-audit/ios/) vs cairosvg(SVG canónico).
           Verifica que el MOTOR de iOS pinta lo mismo que ven web/Android.

Excepción us/um (markers): cairosvg coloca los markers ~1px abajo-derecha de
donde los colocan los navegadores (verificado contra canvas de Chrome, que
clava la expansión nuestra con 0.003%). Por eso us/um se toleran hasta ~3.5%
contra la referencia cairo; su verificación fina se hace en navegador.

Requisitos:
  brew install cairo
  python3 -m venv /tmp/flag-audit/venv
  /tmp/flag-audit/venv/bin/pip install cairosvg pillow numpy
  curl -sL https://github.com/lipis/flag-icons/archive/refs/tags/v7.2.3.tar.gz | tar xz -C /tmp/flag-audit

Uso:
  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
    /tmp/flag-audit/venv/bin/python scripts/flags/verify-flags-render.py gate1
  ... (volcar el simulador, ver README) ...
  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib \
    /tmp/flag-audit/venv/bin/python scripts/flags/verify-flags-render.py gate2
"""
import os
import sys

import numpy as np
from PIL import Image

import cairosvg

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
IOS_FLAGS = os.path.join(REPO, "ios-app", "CalendarioCiclismo", "Assets.xcassets", "Flags")
CANON = "/tmp/flag-audit/flag-icons-7.2.3/flags/4x3"
SIM_DUMP = "/tmp/flag-audit/ios"
W, H = 480, 360

# us/um: ver docstring (markers, cairo difiere del navegador ~1px)
MARKER_FLAGS = {"us", "um"}
THRESHOLD = 0.15
THRESHOLD_MARKER = 3.5
# residuo conocido de AA/strokes sub-visibles (pf rayos del emblema, kh trazos
# finos de Angkor, es-ct bordes de franja): se listan si superan 0.6%
THRESHOLD_GATE2 = 0.6


def codes():
    return sorted(
        d[: -len(".imageset")]
        for d in os.listdir(IOS_FLAGS)
        if d.endswith(".imageset")
    )


def render(svg_path):
    png = cairosvg.svg2png(url=svg_path, output_width=W, output_height=H)
    import io
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    return np.asarray(Image.alpha_composite(bg, im).convert("RGB"), dtype=np.int16)


def load_png(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    return np.asarray(Image.alpha_composite(bg, im).convert("RGB"), dtype=np.int16)


def pct_bad(a, b):
    return float((np.abs(a - b).max(axis=2) > 48).mean() * 100)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "gate1"
    fails = []
    for c in codes():
        ios_svg = os.path.join(IOS_FLAGS, f"{c}.imageset", f"{c}.svg")
        canon_svg = os.path.join(CANON, f"{c}.svg")
        if not os.path.exists(canon_svg):
            print(f"⚠ {c}: sin canónico en {CANON}")
            continue
        ref = render(canon_svg)
        if mode == "gate1":
            got = render(ios_svg)
            limit = THRESHOLD_MARKER if c in MARKER_FLAGS else THRESHOLD
        else:
            png = os.path.join(SIM_DUMP, f"{c}.png")
            if not os.path.exists(png):
                fails.append((c, -1.0))
                continue
            got = load_png(png)
            limit = THRESHOLD_MARKER if c in MARKER_FLAGS else THRESHOLD_GATE2
        p = pct_bad(got, ref)
        if p > limit:
            fails.append((c, p))
    if fails:
        print(f"{mode}: {len(fails)} banderas fuera de umbral:")
        for c, p in sorted(fails, key=lambda r: -r[1]):
            print(f"  {c}: {p:.3f}%")
        sys.exit(1)
    print(f"{mode}: OK — {len(codes())} banderas dentro de umbral")


if __name__ == "__main__":
    main()
