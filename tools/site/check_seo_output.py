#!/usr/bin/env python3
"""Valida invariantes SEO del artifact estático antes de publicarlo."""

import argparse
import json
from html.parser import HTMLParser
from pathlib import Path


ALLOWED_EVENT_STATUSES = {
    "https://schema.org/EventScheduled",
    "https://schema.org/EventCancelled",
}
CATALOG_DIRS = ("competicion", "jornada", "en/race", "en/stage")


class JsonLdParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self._capturing = False
        self._chunks = []
        self.blocks = []

    def handle_starttag(self, tag, attrs):
        if tag != "script":
            return
        attr_map = dict(attrs)
        if attr_map.get("type", "").lower() == "application/ld+json":
            self._capturing = True
            self._chunks = []

    def handle_data(self, data):
        if self._capturing:
            self._chunks.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._capturing:
            self.blocks.append("".join(self._chunks).strip())
            self._capturing = False
            self._chunks = []


def iter_objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_objects(child)


def validate_event(event):
    errors = []
    for forbidden in ("superEvent", "isPartOf"):
        if forbidden in event:
            errors.append(f"contiene {forbidden}")
    for required in ("name", "startDate", "endDate"):
        if not event.get(required):
            errors.append(f"falta {required}")
    location = event.get("location")
    if not isinstance(location, dict) or not location.get("name"):
        errors.append("falta location.name")
    else:
        address = location.get("address")
        if not isinstance(address, dict) or not address.get("addressCountry"):
            errors.append("falta location.address.addressCountry")
    if event.get("eventStatus") not in ALLOWED_EVENT_STATUSES:
        errors.append("eventStatus ausente o no admitido")
    return errors


def check_site(root):
    failures = []
    html_count = 0
    event_count = 0
    for relative_dir in CATALOG_DIRS:
        directory = root / relative_dir
        if not directory.is_dir():
            failures.append(f"falta el directorio generado {relative_dir}")
            continue
        for path in directory.rglob("index.html"):
            html_count += 1
            source = path.read_text(encoding="utf-8")
            if "function raceName" in source:
                failures.append(f"{path.relative_to(root)}: contiene código de raceName")
            parser = JsonLdParser()
            parser.feed(source)
            for block_number, block in enumerate(parser.blocks, start=1):
                try:
                    payload = json.loads(block)
                except json.JSONDecodeError as exc:
                    failures.append(
                        f"{path.relative_to(root)}: JSON-LD {block_number} inválido ({exc})"
                    )
                    continue
                for obj in iter_objects(payload):
                    if obj.get("@type") != "SportsEvent":
                        continue
                    event_count += 1
                    for error in validate_event(obj):
                        failures.append(f"{path.relative_to(root)}: SportsEvent {error}")
    return html_count, event_count, failures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".", type=Path)
    parser.add_argument("--min-events", type=int, default=100)
    args = parser.parse_args()
    html_count, event_count, failures = check_site(args.root.resolve())
    if event_count < args.min_events:
        failures.append(
            f"solo se generaron {event_count} SportsEvent (mínimo {args.min_events})"
        )
    if failures:
        for failure in failures[:100]:
            print(f"ERROR: {failure}")
        if len(failures) > 100:
            print(f"ERROR: y {len(failures) - 100} errores más")
        raise SystemExit(1)
    print(f"SEO estructurado correcto: {html_count} HTML, {event_count} SportsEvent válidos")


if __name__ == "__main__":
    main()
