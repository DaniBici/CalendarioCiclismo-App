#!/usr/bin/env python3
"""
apply-name-en.py — Aplica el CSV de revisión de nameEn a la BD.

Lee tools/race-names-review.csv (generado por review-race-names.py y revisado manualmente).
Para cada fila con nameEn_approved relleno (o nameEn_suggested como fallback),
ejecuta UPDATE races SET nameEn = ... WHERE id = ...

Uso:
  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... python3 tools/apply-name-en.py [--dry-run]
"""

import csv
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

SUPABASE_URL  = os.environ["SUPABASE_URL"]
SERVICE_KEY   = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DRY_RUN       = "--dry-run" in sys.argv

CSV_PATH = Path(__file__).parent / "race-names-review.csv"

def patch_race(race_id: str, name_en: str) -> bool:
    payload = json.dumps({"nameEn": name_en}).encode()
    url = f"{SUPABASE_URL}/rest/v1/races?id=eq.{race_id}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "apikey":        SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal",
        },
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req) as r:
            return True
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code} para {race_id}: {e.read().decode()[:120]}", file=sys.stderr)
        return False

def main():
    if not CSV_PATH.exists():
        print(f"No se encuentra {CSV_PATH}. Ejecuta review-race-names.py primero.")
        sys.exit(1)

    # Detectar encoding
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            with open(CSV_PATH, encoding=enc) as f:
                sample = f.read(2048)
            break
        except UnicodeDecodeError:
            continue

    # Detectar separador
    sep = ";" if ";" in sample.split("\n")[0] else ","

    with open(CSV_PATH, encoding=enc, newline="") as f:
        reader = csv.DictReader(f, delimiter=sep)
        raw_rows = list(reader)

    if not raw_rows:
        print("CSV vacío.")
        sys.exit(1)

    # Numbers exporta con "Column1, Column2..." como cabecera real y
    # desplaza los nombres de columna a la primera fila de datos.
    # Detectarlo: si la primera fila tiene 'id' como valor en alguna columna.
    first = raw_rows[0]
    if "id" in first.values():
        # Usar la primera fila como mapa de columnas
        col_map = {v: k for k, v in first.items()}  # "id" -> "Column1", etc.
        rows = []
        for row in raw_rows[1:]:
            rows.append({real: row[col] for real, col in col_map.items() if col in row})
    else:
        rows = raw_rows

    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Aplicando nameEn a {len(rows)} carreras…")

    ok = 0
    skip = 0
    err = 0

    for row in rows:
        race_id   = row["id"]
        name      = row["name"]
        approved  = row.get("nameEn_approved", "").strip()
        suggested = row.get("nameEn_suggested", "").strip()
        name_en   = approved or suggested

        if not name_en:
            print(f"  SKIP {name} — sin nameEn")
            skip += 1
            continue

        print(f"  {'[DRY] ' if DRY_RUN else ''}{name} → {name_en}")
        if not DRY_RUN:
            if patch_race(race_id, name_en):
                ok += 1
            else:
                err += 1
        else:
            ok += 1

    print(f"\nResultado: {ok} OK · {skip} skip · {err} errores")

if __name__ == "__main__":
    main()
