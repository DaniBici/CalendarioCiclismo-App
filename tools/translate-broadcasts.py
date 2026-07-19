#!/usr/bin/env python3
"""
translate-broadcasts.py — Traduce en batch el campo note de broadcasts al inglés.

Guarda en translations.en.note (JSONB) con hash SHA-256, status='auto', model.
Respeta status='manual' (no sobreescribe a menos que --force).

Uso:
  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \\
    python3 tools/translate-broadcasts.py [opciones]

Opciones:
  --dry-run   Muestra qué traduciría sin ejecutar cambios
  --force     Re-traduce incluso campos con status='manual'
  --limit N   Procesa como máximo N registros
"""

import hashlib
import json
import os
import sys
import time
import urllib.request
import urllib.error

SUPABASE_URL  = os.environ["SUPABASE_URL"]
SERVICE_KEY   = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANTHROPIC_KEY = os.environ["ANTHROPIC_API_KEY"]

DRY_RUN = "--dry-run" in sys.argv
FORCE   = "--force"   in sys.argv
LIMIT   = None

for i, arg in enumerate(sys.argv[1:], 1):
    if arg == "--limit" and i < len(sys.argv) - 1:
        LIMIT = int(sys.argv[i + 1])

SYSTEM_PROMPT = """You are a professional cycling journalist translator. Translate Spanish cycling TV broadcast notes into English.

PRESERVE UNCHANGED:
- Race names (Giro d'Italia, Tour de France, La Vuelta, etc.)
- Channel names and broadcaster names exactly as written
- Time expressions and timezone codes (CET, CEST, GMT, etc.)
- Country and region codes (ES, LATAM, INT)
- Numbers and times

TRANSLATE AND ADAPT:
- Broadcast and scheduling notes from Spanish to English
- Geo-restriction notes (ej: "Solo para España" → "Spain only")
- Commentary notes (ej: "Con comentarios en español" → "Spanish commentary")
- Platform notes (ej: "En diferido" → "Delayed broadcast", "En directo" → "Live")

STYLE RULES:
- Brief, factual tone as used in TV listings
- Output ONLY the translated text — no quotes, no preamble, no explanation"""


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


def supabase_patch(record_id: str, payload: dict) -> bool:
    url = f"{SUPABASE_URL}/rest/v1/broadcasts?id=eq.{record_id}"
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
        print(f"  ERROR PATCH broadcasts/{record_id}: {e.read().decode()[:200]}", file=sys.stderr)
        return False


def translate_with_claude(text: str, retries: int = 3) -> str:
    payload = json.dumps({
        "model":      "claude-sonnet-4-6",
        "max_tokens": 200,
        "system":     SYSTEM_PROMPT,
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
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
                return data["content"][0]["text"].strip()
        except urllib.error.HTTPError as e:
            status = e.code
            body   = e.read().decode()
            if status == 529 and attempt < retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    Rate limit, esperando {wait}s…", file=sys.stderr)
                time.sleep(wait)
            else:
                raise RuntimeError(f"Anthropic {status}: {body[:200]}")
    return ""


def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}translate-broadcasts — campo note al inglés")
    if LIMIT: print(f"  Límite: {LIMIT}")
    print()

    path = (
        "broadcasts?select=id,note,translations"
        "&note=neq.&note=not.is.null"
        "&order=id.asc"
    )
    rows = supabase_get(path)
    if LIMIT:
        rows = rows[:LIMIT]

    print(f"{len(rows)} broadcasts con note a procesar\n")

    total_t = total_s = total_e = 0

    for i, bc in enumerate(rows, 1):
        bid  = bc["id"]
        note = (bc.get("note") or "").strip()

        print(f"[{i}/{len(rows)}] id={bid[:8]}  note={note[:60]!r}")

        if not note:
            total_s += 1
            continue

        current_translations: dict = bc.get("translations") or {}
        en_translations: dict      = (current_translations.get("en") or {}).copy()
        existing = en_translations.get("note") or {}

        ex_status = existing.get("status", "") if isinstance(existing, dict) else ""
        ex_hash   = existing.get("hash",   "") if isinstance(existing, dict) else ""

        if ex_status == "manual" and not FORCE:
            print(f"    SKIP (manual)")
            total_s += 1
            continue

        current_hash = sha256(note)
        if not FORCE and ex_status == "auto" and ex_hash == current_hash:
            print(f"    SKIP (up-to-date)")
            total_s += 1
            continue

        if DRY_RUN:
            print(f"    WOULD TRANSLATE ({len(note)} chars)")
            total_t += 1
            continue

        try:
            translated = translate_with_claude(note)
        except Exception as exc:
            print(f"    ERROR: {exc}", file=sys.stderr)
            total_e += 1
            continue

        en_translations["note"] = {
            "value":     translated,
            "hash":      current_hash,
            "status":    "auto",
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model":     "claude-sonnet-4-6",
        }
        updated_translations = {**current_translations, "en": en_translations}

        ok = supabase_patch(bid, {"translations": updated_translations})
        if ok:
            print(f"    → {translated[:70]!r}")
            total_t += 1
        else:
            total_e += 1

        time.sleep(0.3)

    print(f"\nResultado: {total_t} traducidos · {total_s} saltados · {total_e} errores")


if __name__ == "__main__":
    main()
