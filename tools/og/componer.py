#!/usr/bin/env python3
"""Compone la imagen Open Graph única de calendariociclismo.app (1200 × 630).

Entrada: el gráfico sin texto (perfil de etapa con el punto, fondo #10141c),
generado con ImageGen. Salida: JPG con el logotipo horizontal oficial
(`logo-combinado.png`, iconos y nombre en una línea) y la URL en Google Sans.

El gráfico se sube `--subir` px: la base del perfil queda por encima de la franja
inferior que X cubre con el titular de la tarjeta. El hueco inferior se rellena
con filas del fondo vacío de la parte superior del propio gráfico.

Uso:
  python3 tools/og/componer.py ARTE.png SALIDA.jpg [--subir 90] [--logo-y 66]

Requiere Pillow y Google Sans (`GoogleSans-Regular.ttf`) en `~/Library/Fonts`,
`/Library/Fonts` o en la carpeta de `CC_FONTS_DIR`.
"""
import argparse
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
LOGO = ROOT / ".agents/skills/cc-graficos-sociales/assets/logo-combinado.png"
ANCHO, ALTO = 1200, 630
MARGEN_X = 56          # coincide con el inicio de la línea del perfil
ANCHO_LOGO = 720
URL = "calendariociclismo.app"
COLOR_URL = (183, 193, 206)   # --text-muted del tema oscuro (#b7c1ce)
TAM_URL = 36
SEPARACION_URL = 26


def buscar_fuente(nombre):
    carpetas = [os.environ.get("CC_FONTS_DIR"), Path.home() / "Library/Fonts", Path("/Library/Fonts")]
    for carpeta in carpetas:
        if carpeta and (Path(carpeta) / nombre).is_file():
            return str(Path(carpeta) / nombre)
    sys.exit(f"No se encuentra {nombre}; indicar la carpeta en CC_FONTS_DIR.")


def subir_gráfico(arte, n):
    """Desplaza el gráfico n px hacia arriba y rellena el fondo inferior."""
    if n <= 0:
        return arte
    salida = Image.new("RGB", arte.size)
    salida.paste(arte.crop((0, n, arte.width, arte.height)), (0, 0))
    salida.paste(arte.crop((0, 0, arte.width, n)), (0, arte.height - n))
    return salida


def componer(arte_ruta, salida_ruta, subir, logo_y):
    arte = Image.open(arte_ruta).convert("RGB")
    if arte.size != (ANCHO, ALTO):
        arte = arte.resize((ANCHO, ALTO), Image.LANCZOS)
    im = subir_gráfico(arte, subir).convert("RGBA")

    logo = Image.open(LOGO).convert("RGBA")
    alto_logo = round(logo.height * ANCHO_LOGO / logo.width)
    logo = logo.resize((ANCHO_LOGO, alto_logo), Image.LANCZOS)
    im.alpha_composite(logo, (MARGEN_X, logo_y))

    fuente = ImageFont.truetype(buscar_fuente("GoogleSans-Regular.ttf"), TAM_URL)
    ImageDraw.Draw(im).text((MARGEN_X, logo_y + alto_logo + SEPARACION_URL), URL, font=fuente, fill=COLOR_URL)

    im.convert("RGB").save(salida_ruta, quality=92, optimize=True, progressive=True, subsampling=0)
    print(f"{salida_ruta}: {Path(salida_ruta).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("arte")
    p.add_argument("salida")
    p.add_argument("--subir", type=int, default=90, help="px que sube el gráfico (90)")
    p.add_argument("--logo-y", type=int, default=66, help="posición vertical del logotipo (66)")
    a = p.parse_args()
    componer(a.arte, a.salida, a.subir, a.logo_y)
