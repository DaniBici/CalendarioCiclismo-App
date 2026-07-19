#!/usr/bin/env python3
"""
generate-race-slug-en.py — Genera slugEn para la tabla races a partir de nameEn.

Lógica: slugify(nameEn) sin año ni stage (el slug identifica la carrera como entidad).

  tour-de-france
  milan-san-remo
  amstel-gold-race-women
  dwars-door-vlaanderen

Solo procesa races con nameEn y sin slugEn (salvo --overwrite).
Verifica unicidad; en conflicto añade -2, -3…

Uso:
  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... \\
    python3 tools/generate-race-slug-en.py [--dry-run] [--overwrite] [--limit N]
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
LIMIT     = None

for i, arg in enumerate(sys.argv[1:], 1):
    if arg == "--limit" and i < len(sys.argv) - 1:
        LIMIT = int(sys.argv[i + 1])


# ── Slugificación ─────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.lower()
    text = re.sub(r"[''`]", "", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text


# ── Supabase helpers ──────────────────────────────────────────────

def supabase_get(path: str) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(
        url,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def supabase_patch(race_id: str, payload: dict) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/races?id=eq.{race_id}"
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
        print(f"  ERROR PATCH races/{race_id}: {e.read().decode()[:200]}", file=sys.stderr)
        return False


# ── Main ──────────────────────────────────────────────────────────

def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}generate-race-slug-en — slugEn para races")
    if LIMIT:    print(f"  Límite: {LIMIT}")
    if OVERWRITE: print("  --overwrite: regenera slugEn aunque ya exista")
    print()

    filters = ["select=id,name,nameEn,slugEn,year", "nameEn=not.is.null", "order=name.asc"]
    if not OVERWRITE:
        filters.append("slugEn=is.null")

    rows = supabase_get("races?" + "&".join(filters))

    if LIMIT:
        rows = rows[:LIMIT]

    print(f"{len(rows)} carreras candidatas\n")

    if not rows:
        print("Nada que procesar.")
        return

    existing_slugs_raw = supabase_get("races?select=slugEn&slugEn=not.is.null")
    existing_slugs = {r["slugEn"] for r in existing_slugs_raw if r.get("slugEn")}

    ok = skip = err = 0

    for i, race in enumerate(rows, 1):
        race_id      = race["id"]
        name         = race.get("name", "")
        name_en      = race.get("nameEn", "")
        year         = race.get("year")
        current_slug = race.get("slugEn")

        if not name_en or not year:
            print(f"[{i}/{len(rows)}] SKIP {name} — sin nameEn o year")
            skip += 1
            continue

        base_slug = f"{slugify(name_en)}-{year}"
        candidate = base_slug
        suffix    = 2
        while candidate in existing_slugs and candidate != current_slug:
            candidate = f"{base_slug}-{suffix}"
            suffix += 1

        print(f"[{i}/{len(rows)}] {name_en}")
        print(f"          slugEn: {candidate}")

        if DRY_RUN:
            ok += 1
            continue

        if supabase_patch(race_id, {"slugEn": candidate}):
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
