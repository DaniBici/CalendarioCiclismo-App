#!/usr/bin/env python3
"""
generate-slug-en.py — Genera slugEn para race_days a partir de race.nameEn + stageNumber.

Lógica (sin Claude):
  - Etapa (stageNumber > 0):   {nameEn}-{year}-stage-{N}   ej: tour-de-france-2025-stage-3
  - Prólogo (stageNumber == 0): {nameEn}-{year}-prologue
  - Clásica (stageNumber null): {nameEn}-{year}             ej: milan-san-remo-2025

Solo procesa race_days cuya carrera tenga nameEn y que no tengan slugEn ya asignado.
Verifica unicidad contra los slugEn existentes; en conflicto añade -2, -3…

Uso:
  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... \\
    python3 tools/generate-slug-en.py [opciones]

Opciones:
  --dry-run       Muestra slugs propuestos sin escribir en BD
  --year YYYY     Filtra por año de la carrera
  --race-id UUID  Procesa solo las race_days de esta carrera
  --limit N       Procesa como máximo N registros
  --overwrite     Regenera slugEn incluso si ya existe
"""

import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.error

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY  = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

DRY_RUN   = "--dry-run"  in sys.argv
OVERWRITE = "--overwrite" in sys.argv
YEAR      = None
RACE_ID   = None
LIMIT     = None

for i, arg in enumerate(sys.argv[1:], 1):
    if arg == "--year"    and i < len(sys.argv) - 1: YEAR    = sys.argv[i + 1]
    if arg == "--race-id" and i < len(sys.argv) - 1: RACE_ID = sys.argv[i + 1]
    if arg == "--limit"   and i < len(sys.argv) - 1: LIMIT   = int(sys.argv[i + 1])


# ── Slugificación ─────────────────────────────────────────────────

def slugify(text: str) -> str:
    # Normalizar Unicode: NFD descompone los caracteres acentuados
    text = unicodedata.normalize("NFD", text)
    # Descartar marcas diacríticas (acentos, tildes…)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.lower()
    # Reemplazar apóstrofos y guiones por nada o espacio
    text = re.sub(r"[''`]", "", text)
    # Reemplazar cualquier carácter no alfanumérico por guion
    text = re.sub(r"[^a-z0-9]+", "-", text)
    # Colapsar guiones múltiples y limpiar extremos
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text


def build_slug(name_en: str, year: int, stage_number) -> str:
    base = slugify(name_en)
    if stage_number is None:
        # Clásica de un día
        return f"{base}-{year}"
    elif stage_number == 0:
        return f"{base}-{year}-prologue"
    else:
        return f"{base}-{year}-stage-{stage_number}"


# ── Supabase helpers ──────────────────────────────────────────────

def supabase_get(path: str) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(
        url,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def supabase_patch(record_id: str, payload: dict) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/race_days?id=eq.{record_id}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "apikey":        SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type":  "application/json",
            "Prefer":        "return=minimal",
        },
        method="PATCH",
    )
    try:
        with urllib.request.urlopen(req):
            return True
    except urllib.error.HTTPError as e:
        print(f"  ERROR PATCH race_days/{record_id}: {e.read().decode()[:200]}", file=sys.stderr)
        return False


# ── Main ──────────────────────────────────────────────────────────

def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}generate-slug-en — slugEn para race_days")
    if YEAR:     print(f"  Filtro año: {YEAR}")
    if RACE_ID:  print(f"  Filtro raceId: {RACE_ID}")
    if LIMIT:    print(f"  Límite: {LIMIT}")
    if OVERWRITE: print("  --overwrite: regenera slugEn aunque ya exista")
    print()

    # Fetch race_days con join a races para tener nameEn y year
    filters = [
        "select=id,stageNumber,slugEn,races(id,nameEn,year)",
    ]
    if not OVERWRITE:
        filters.append("slugEn=is.null")
    if RACE_ID:
        filters.append(f"raceId=eq.{RACE_ID}")
    filters.append("order=id.asc")

    rows = supabase_get("race_days?" + "&".join(filters))

    # Filtro de año en cliente
    if YEAR:
        rows = [r for r in rows if r.get("races", {}).get("year") == int(YEAR)]

    # Solo procesar los que tengan nameEn en la carrera
    rows = [r for r in rows if r.get("races", {}).get("nameEn")]

    if LIMIT:
        rows = rows[:LIMIT]

    print(f"{len(rows)} race_days candidatas\n")

    if not rows:
        print("Nada que procesar.")
        return

    # Cargar slugEn existentes para verificar unicidad
    existing_slugs_raw = supabase_get("race_days?select=slugEn&slugEn=not.is.null")
    existing_slugs = {r["slugEn"] for r in existing_slugs_raw if r.get("slugEn")}

    ok = skip = err = 0

    for i, rd in enumerate(rows, 1):
        rid          = rd["id"]
        stage_num    = rd.get("stageNumber")  # None para clásicas
        race         = rd.get("races") or {}
        name_en      = race.get("nameEn", "")
        year         = race.get("year")
        current_slug = rd.get("slugEn")

        if not name_en or not year:
            print(f"[{i}/{len(rows)}] SKIP id={rid[:8]} — sin nameEn o year")
            skip += 1
            continue

        base_slug = build_slug(name_en, year, stage_num)

        # Garantizar unicidad
        candidate = base_slug
        suffix    = 2
        while candidate in existing_slugs and candidate != current_slug:
            candidate = f"{base_slug}-{suffix}"
            suffix += 1

        stage_label = (
            f"Stage {stage_num}" if stage_num and stage_num > 0
            else ("Prologue" if stage_num == 0 else "One-day")
        )
        print(f"[{i}/{len(rows)}] {name_en} {year} · {stage_label}")
        print(f"          slugEn: {candidate}")

        if DRY_RUN:
            ok += 1
            continue

        if supabase_patch(rid, {"slugEn": candidate}):
            existing_slugs.add(candidate)
            if current_slug and current_slug != candidate:
                existing_slugs.discard(current_slug)
            ok += 1
        else:
            err += 1

        time.sleep(0.05)

    print(f"\nResultado: {ok} asignados · {skip} saltados · {err} errores")


if __name__ == "__main__":
    main()
