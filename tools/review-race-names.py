#!/usr/bin/env python3
"""
review-race-names.py — Genera un CSV con sugerencias de nameEn para revisión manual.

Uso:
  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
    python3 tools/review-race-names.py

Genera: tools/race-names-review.csv
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

SUPABASE_URL  = os.environ["SUPABASE_URL"]
SERVICE_KEY   = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]

RACES_URL = f"{SUPABASE_URL}/rest/v1/races?select=id,name,originalName,nameEn,slugEn&order=name.asc"
OUT       = Path(__file__).parent / "race-names-review.csv"

SYSTEM_PROMPT = """Translate the name of a professional cycling race from Spanish (or another language) into English.

Rules:
- Keep the original name if it is already the official English name or if it is universally known in the original language (e.g. "Giro d'Italia", "Tour de France", "La Vuelta", "Paris-Roubaix", "Strade Bianche", "Tirreno-Adriatico", "Milano-Sanremo").
- For races with a clear English translation, translate naturally (e.g. "Vuelta a Burgos" → "Tour of Burgos", "Clásica de San Sebastián" → "Clásica de San Sebastián" — proper names stay).
- For stage races: "Vuelta a X" → "Tour of X", "Vuelta al País Vasco" → "Itzulia Basque Country" (use official EN name when known).
- For classics: keep the Spanish name if there is no established English version.
- Do NOT add the year.
- Output ONLY the translated name — no explanation, no quotes."""


def supabase_get(url):
    req = urllib.request.Request(
        url,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def translate_name(name: str) -> str:
    payload = json.dumps({
        "model": "claude-sonnet-4-6",
        "max_tokens": 100,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": name}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
            return data["content"][0]["text"].strip()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ERROR Anthropic {e.code} para '{name}': {body[:200]}", file=sys.stderr)
        return ""


def main():
    print("Leyendo carreras desde Supabase…")
    races = supabase_get(RACES_URL)
    print(f"  {len(races)} carreras encontradas")

    rows = []
    for i, race in enumerate(races, 1):
        rid         = race["id"]
        name        = race["name"] or ""
        orig        = race.get("originalName") or ""
        existing_en = race.get("nameEn") or ""
        slug_en     = race.get("slugEn") or ""

        if existing_en:
            suggestion = existing_en
            print(f"  [{i}/{len(races)}] {name} → (ya tiene nameEn: {existing_en})")
        else:
            print(f"  [{i}/{len(races)}] Traduciendo: {name}…", end=" ", flush=True)
            suggestion = translate_name(name)
            print(suggestion or "(vacío)")
            time.sleep(0.2)

        rows.append({
            "id":               rid,
            "name":             name,
            "originalName":     orig,
            "nameEn_suggested": suggestion,
            "nameEn_approved":  existing_en,
            "slugEn":           slug_en,
            "flag":             "",
        })

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "name", "originalName", "nameEn_suggested",
                        "nameEn_approved", "slugEn", "flag"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nCSV generado: {OUT}")
    print("Abre el CSV, revisa 'nameEn_suggested', corrige en 'nameEn_approved' donde necesites,")
    print("y luego ejecuta: python3 tools/apply-name-en.py")


if __name__ == "__main__":
    main()
