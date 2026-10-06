#!/usr/bin/env python3
"""Genera las capas de calendario y ciclista de los paquetes .icon como contornos rellenos.

El glifo se diseña con trazo 2.3 (redondeado) sobre un lienzo de 100 × 100, igual que
favicon.svg y LaunchLogo. Icon Composer recibe el trazo ya convertido en contorno y unido
en un único path por capa, de modo que el grosor visible no depende de cómo el renderizador
calcula los límites de un trazo.

Uso: python3 ios-app/IconComposer/outline-layers.py   (requiere `pip install skia-pathops`)
"""
import math
from pathlib import Path

import pathops

STROKE = 2.3
SCALE = 1000.0  # el trazador de Skia pierde precisión en un lienzo de 100 unidades
K = 4 * (math.sqrt(2) - 1) / 3  # cuarto de círculo en Bézier cúbica

ROOT = Path(__file__).resolve().parent
TARGETS = {
    'AppIcon.icon/Assets': '#FFFFFF',
    'AppIconFounder.icon/Assets': '#F6A623',
    'AppIconFounder': '#F6A623',
    'AppIconFriend.icon/Assets': '#1A73E8',
    'AppIconFriend': '#1A73E8',
}


def polyline(*pts):
    p = pathops.Path()
    p.moveTo(pts[0][0] * SCALE, pts[0][1] * SCALE)
    for x, y in pts[1:]:
        p.lineTo(x * SCALE, y * SCALE)
    return p


def circle(cx, cy, r):
    cx, cy, r = cx * SCALE, cy * SCALE, r * SCALE
    k = K * r
    p = pathops.Path()
    p.moveTo(cx + r, cy)
    p.cubicTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    p.cubicTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    p.cubicTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    p.cubicTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    p.close()
    return p


def rounded_rect(x, y, w, h, r):
    x, y, w, h, r = x * SCALE, y * SCALE, w * SCALE, h * SCALE, r * SCALE
    k = K * r
    p = pathops.Path()
    p.moveTo(x + r, y)
    p.lineTo(x + w - r, y)
    p.cubicTo(x + w - r + k, y, x + w, y + r - k, x + w, y + r)
    p.lineTo(x + w, y + h - r)
    p.cubicTo(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h)
    p.lineTo(x + r, y + h)
    p.cubicTo(x + r - k, y + h, x, y + h - r + k, x, y + h - r)
    p.lineTo(x, y + r)
    p.cubicTo(x, y + r - k, x + r - k, y, x + r, y)
    p.close()
    return p


LAYERS = {
    '01-calendar': lambda: [
        rounded_rect(15.5, 38, 27, 27, 3),
        polyline((23, 35), (23, 41)),
        polyline((35, 35), (35, 41)),
        polyline((15.5, 47), (42.5, 47)),
    ],
    '02-cyclist': lambda: [
        circle(61.25, 58.25, 5.25),
        circle(80.75, 58.25, 5.25),
        circle(75.5, 39.5, 1.5),
        polyline((71, 58.25), (71, 53), (66.5, 48.5), (72.5, 44), (75.5, 48.5), (78.5, 48.5)),
    ],
}


def outline(shapes):
    builder = pathops.OpBuilder(fix_winding=True, keep_starting_points=False)
    for shape in shapes:
        shape.stroke(STROKE * SCALE, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
        shape.convertConicsToQuads(tolerance=0.5)
        builder.add(shape, pathops.PathOp.UNION)
    return builder.resolve()


def fmt(v):
    s = f'{v / SCALE:.3f}'.rstrip('0').rstrip('.')
    return '0' if s == '-0' else s


def to_svg_path(path):
    cmd = {
        pathops.PathVerb.MOVE: 'M',
        pathops.PathVerb.LINE: 'L',
        pathops.PathVerb.QUAD: 'Q',
        pathops.PathVerb.CUBIC: 'C',
        pathops.PathVerb.CLOSE: 'Z',
    }
    return ''.join(cmd[verb] + ','.join(fmt(c) for pt in pts for c in pt) for verb, pts in path)


def main():
    for folder, color in TARGETS.items():
        for name, shapes in LAYERS.items():
            d = to_svg_path(outline(shapes()))
            svg = (
                '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">'
                f'<path fill="{color}" d="{d}"/></svg>\n'
            )
            (ROOT / folder / f'{name}.svg').write_text(svg)


if __name__ == '__main__':
    main()
