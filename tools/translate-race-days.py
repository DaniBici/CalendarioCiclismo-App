#!/usr/bin/env python3
"""
translate-race-days.py — Traduce en batch los campos editoriales de race_days al inglés.

Campos: description, bonuses, notes, startLocation, finishLocation.
Guarda en translations.en (JSONB) con hash SHA-256, status='auto', model.
Para startLocation/finishLocation también escribe las columnas directas
startLocationEn/finishLocationEn.

Respeta status='manual' (no sobreescribe a menos que --force).
Salta campos cuyo hash coincide con el JSONB existente (contenido sin cambios).

Uso:
  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \\
    python3 tools/translate-race-days.py [opciones]

Opciones:
  --dry-run     Muestra qué traduciría sin ejecutar cambios
  --force       Re-traduce incluso campos con status='manual'
  --year YYYY   Filtra por año de la carrera (ej: --year 2025)
  --id UUID     Traduce solo esta race_day
  --limit N     Procesa como máximo N registros (útil para pruebas)
"""

import hashlib
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

DRY_RUN = "--dry-run" in sys.argv
FORCE   = "--force" in sys.argv

YEAR  = None
LIMIT = None
ONLY_ID = None

for i, arg in enumerate(sys.argv[1:], 1):
    if arg == "--year"  and i < len(sys.argv) - 1: YEAR    = sys.argv[i + 1]
    if arg == "--limit" and i < len(sys.argv) - 1: LIMIT   = int(sys.argv[i + 1])
    if arg == "--id"    and i < len(sys.argv) - 1: ONLY_ID = sys.argv[i + 1]

# ── System prompt (idéntico al de la edge function) ───────────────
SYSTEM_PROMPT = """You are a professional cycling journalist translator. Translate Spanish cycling editorial content into English.

PRESERVE UNCHANGED (do not translate):
- Race names: Giro d'Italia, Tour de France, La Vuelta, Paris-Roubaix, Strade Bianche, Liège-Bastogne-Liège, Itzulia, Il Lombardia, Tirreno-Adriatico, Milano-Sanremo, Amstel Gold Race, La Flèche Wallonne, Eschborn-Frankfurt, Tour de Romandie, Critérium du Dauphiné, Volta a Catalunya, etc.
- Jersey names: Maglia Rosa, Maglia Ciclamino, Maglia Azzurra, Maillot Jaune, Maillot Vert, Maillot Pois, Maillot Rojo, Maillot de la Montaña
- Local place names in their original language: Bologna, Liège, Roubaix, Firenze, Roma, etc.
- UCI team names exactly as registered
- Technical terms used in English cycling media: ITT (individual time trial), TTT (team time trial), GC (general classification), KOM (King of the Mountains), DNF, DNS, DSQ
- Surface terms: pavé, sterrato (used as-is in English cycling press)
- Numbers, distances, and units

TRANSLATE AND ADAPT:
- etapa N → stage N
- prólogo → prologue
- contrarreloj / CRI → time trial
- contrarreloj por equipos / CRE → team time trial
- puerto de N categoría → category N climb
- final en alto → summit finish
- final en repecho → uphill finish
- cronoescalada → uphill time trial
- fuga / escapada → breakaway
- pelotón → peloton
- bonificaciones → bonus seconds
- día de descanso → rest day
- llegada → finish / arrival
- salida → start / departure
- jornada → stage / day
- kilómetro → kilometre (British spelling)
- metros → metres (British spelling)

STYLE RULES:
- Neutral, journalistic tone matching English cycling press (Cyclingnews, VeloNews, CyclingWeekly style)
- Preserve all Markdown formatting from the original (**, *, _, #, line breaks)
- Do not add information not present in the original
- Do not add explanations or commentary
- Output ONLY the translated text — no quotes, no preamble, no explanation"""

LOCATION_PROMPT = """Translate this Spanish city/place name to its standard English form used in international cycling media.
Keep the original name if it is already the internationally used form (e.g. Bologna, Liège, Roubaix).
Output ONLY the name — no explanation, no quotes."""

# Tokens máximos por campo
MAX_TOKENS = {
    "description":   2048,
    "bonuses":        512,
    "notes":          512,
    "startLocation":   50,
    "finishLocation":  50,
}


# ── Helpers ───────────────────────────────────────────────────────

def sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def supabase_get(path: str) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(
        url,
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def supabase_patch(table: str, record_id: str, payload: dict) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{record_id}"
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
        print(f"  ERROR PATCH {table}/{record_id}: {e.read().decode()[:200]}", file=sys.stderr)
        return False


def translate_with_claude(text: str, field: str, retries: int = 3) -> str:
    is_location = field in ("startLocation", "finishLocation")
    system      = LOCATION_PROMPT if is_location else SYSTEM_PROMPT
    max_tokens  = MAX_TOKENS.get(field, 512)

    payload = json.dumps({
        "model":      "claude-sonnet-4-6",
        "max_tokens": max_tokens,
        "system":     system,
        "messages":   [{"role": "user", "content": text}],
    }).encode()

    for attempt in range(retries):
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
            with urllib.request.urlopen(req, timeout=45) as r:
                data = json.loads(r.read())
                return data["content"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            status = e.code
            body   = e.read().decode()
            if status in (529, 529) and attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Rate limit ({status}), esperando {wait}s…", file=sys.stderr)
                time.sleep(wait)
            else:
                raise RuntimeError(f"Anthropic {status}: {body[:200]}")
    return ""


# ── Fetch race_days ───────────────────────────────────────────────

def fetch_race_days() -> list:
    filters = [
        "select=id,description,bonuses,notes,startLocation,finishLocation,"
        "startLocationEn,finishLocationEn,translations,races(year,nameEn)"
    ]
    if ONLY_ID:
        filters.append(f"id=eq.{ONLY_ID}")
    elif YEAR:
        filters.append(f"races.year=eq.{YEAR}")

    # Traer solo filas con al menos un campo de texto no vacío
    filters.append(
        "or=(description.neq.,bonuses.neq.,notes.neq.,"
        "startLocation.neq.,finishLocation.neq.)"
    )
    filters.append("order=id.asc")

    path = "race_days?" + "&".join(filters)
    rows = supabase_get(path)

    # Filtro de año aplicado en cliente si viene de la relación
    if YEAR and not ONLY_ID:
        rows = [r for r in rows if r.get("races", {}).get("year") == int(YEAR)]

    if LIMIT:
        rows = rows[:LIMIT]
    return rows


# ── Process one race_day ──────────────────────────────────────────

FIELDS = ["description", "bonuses", "notes", "startLocation", "finishLocation"]


def process_race_day(rd: dict) -> tuple[int, int, int]:
    rid   = rd["id"]
    label = f"{rd.get('startLocation','?')} → {rd.get('finishLocation','?')} (id={rid[:8]})"

    current_translations: dict = rd.get("translations") or {}
    en_translations: dict      = (current_translations.get("en") or {}).copy()

    translated_count = 0
    skipped_count    = 0
    error_count      = 0

    patch_direct = {}  # columnas directas a actualizar (startLocationEn, finishLocationEn)

    for field in FIELDS:
        source = (rd.get(field) or "").strip()
        if not source:
            skipped_count += 1
            continue

        existing = en_translations.get(field) or {}
        if isinstance(existing, dict):
            ex_status = existing.get("status", "")
            ex_hash   = existing.get("hash", "")
        else:
            ex_status = ""
            ex_hash   = ""

        if ex_status == "manual" and not FORCE:
            skipped_count += 1
            if DRY_RUN:
                print(f"    SKIP  {field} (manual)")
            continue

        current_hash = sha256(source)
        if not FORCE and ex_status == "auto" and ex_hash == current_hash:
            skipped_count += 1
            if DRY_RUN:
                print(f"    SKIP  {field} (up-to-date)")
            continue

        if DRY_RUN:
            print(f"    WOULD TRANSLATE  {field} ({len(source)} chars)")
            translated_count += 1
            continue

        try:
            translated = translate_with_claude(source, field)
        except Exception as exc:
            print(f"    ERROR {field}: {exc}", file=sys.stderr)
            error_count += 1
            continue

        en_translations[field] = {
            "value":     translated,
            "hash":      current_hash,
            "status":    "auto",
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model":     "claude-sonnet-4-6",
        }
        translated_count += 1

        if field == "startLocation":
            patch_direct["startLocationEn"] = translated
        elif field == "finishLocation":
            patch_direct["finishLocationEn"] = translated

    if not DRY_RUN and translated_count > 0:
        updated_translations = {**current_translations, "en": en_translations}
        payload = {"translations": updated_translations, **patch_direct}
        ok = supabase_patch("race_days", rid, payload)
        if not ok:
            error_count += translated_count
            translated_count = 0

    return translated_count, skipped_count, error_count


# ── Main ──────────────────────────────────────────────────────────

def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}translate-race-days — campos editoriales al inglés")
    if YEAR:    print(f"  Filtro año: {YEAR}")
    if ONLY_ID: print(f"  Solo ID: {ONLY_ID}")
    if LIMIT:   print(f"  Límite: {LIMIT}")
    if FORCE:   print("  --force: re-traduce incluso campos manuales")
    print()

    rows = fetch_race_days()
    print(f"{len(rows)} race_days con contenido a procesar\n")

    total_t = total_s = total_e = 0

    for i, rd in enumerate(rows, 1):
        label = (
            f"[{i}/{len(rows)}] "
            f"{rd.get('startLocation','?')} → {rd.get('finishLocation','?')} "
            f"(id={rd['id'][:8]})"
        )
        print(label)
        t, s, e = process_race_day(rd)
        total_t += t
        total_s += s
        total_e += e
        if not DRY_RUN:
            time.sleep(0.3)

    print(f"\nResultado: {total_t} traducidos · {total_s} saltados · {total_e} errores")


if __name__ == "__main__":
    main()
