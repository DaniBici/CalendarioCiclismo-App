#!/usr/bin/env python3
"""Extrae listas de inscritos de una página por coordenadas; no consulta catálogos."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


def extract_source(xml, race_id, year):
    root = ET.fromstring(xml)
    pages = [e for e in root.iter() if e.tag.rsplit('}', 1)[-1] == 'page']
    if len(pages) != 1:
        raise ValueError('Este extractor admite listas de una página; revisar el documento.')
    words = [dict(x=float(w.attrib['xMin']), y=float(w.attrib['yMin']), text=w.text or '')
             for w in pages[0].iter() if w.tag.rsplit('}', 1)[-1] == 'word']
    anchors = sorted({round(w['x'], 1) for w in words if re.fullmatch(r'\d+\.', w['text'])})
    starts = []
    for x in anchors:
        if not starts or x - starts[-1] > 1:
            starts.append(x)
    if not starts:
        raise ValueError('No se encuentran columnas de dorsales.')
    first_bib_y = min(w['y'] for w in words if re.fullmatch(r'\d+\.', w['text']))
    header = ' '.join(w['text'] for w in sorted(words, key=lambda w: (w['y'], w['x']))
                      if w['y'] < first_bib_y)
    count = re.search(r'\b(\d+)\s+starting\b', header)
    edition = re.search(r'\|\s*(20\d{2})\b', header)
    if not count or not edition or int(edition[1]) != year:
        raise ValueError('Falta el recuento fuente o el año no coincide con la edición solicitada.')
    columns = [defaultdict(list) for _ in starts]
    for word in words:
        column = max((i for i, x in enumerate(starts) if word['x'] >= x - .2), default=0)
        columns[column][round(word['y'], 1)].append(word)
    teams = []
    for rows in columns:
        team = rider = mode = None
        for y, row in sorted(rows.items()):
            line = ' '.join(w['text'] for w in sorted(row, key=lambda w: w['x']))
            heading = re.fullmatch(r'(\d+)\s+(.+)', line)
            numbered = re.fullmatch(r'(\d+)\.\s*(.*)', line)
            # Las cabeceras de equipo están debajo del recuento "starting".
            if heading and not re.search(r'\bstarting\b', line) and not re.search(r'\d{2}/\d{2}/\d{4}', line):
                team = dict(index=int(heading[1]), teamName=heading[2], riders=[])
                teams.append(team)
                mode = 'team'
            elif numbered:
                if team is None:
                    raise ValueError('Dorsal sin equipo en su columna.')
                rider = dict(dorsal=int(numbered[1]), name=numbered[2])
                team['riders'].append(rider)
                mode = 'rider'
            elif line.startswith('DS:'):
                mode = None
            elif mode == 'team':
                team['teamName'] += ' ' + line
            elif mode == 'rider':
                rider['name'] += ' ' + line
    teams.sort(key=lambda t: t['index'])
    if [t.pop('index') for t in teams] != list(range(1, len(teams) + 1)):
        raise ValueError('La numeración de equipos no es continua o hay cabeceras no reconocidas.')
    for team in teams:
        if not team['riders']:
            raise ValueError('Equipo sin corredores: ' + team['teamName'])
        for rider in team['riders']:
            parts = rider.pop('name').split()
            split = 0
            while split < len(parts) and parts[split].isupper():
                split += 1
            if not 0 < split < len(parts):
                raise ValueError(f"No se separa el nombre del dorsal {rider['dorsal']}: {parts}")
            rider.update(lastName=' '.join(parts[:split]), firstName=' '.join(parts[split:]))
    bibs = [r['dorsal'] for t in teams for r in t['riders']]
    if len(bibs) != int(count[1]) or len(set(bibs)) != len(bibs) or any(b <= 0 for b in bibs):
        raise ValueError('El recuento extraído no coincide con la fuente o hay dorsales duplicados/inválidos.')
    return dict(raceId=race_id, expectedRiderCount=int(count[1]), teams=teams)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='input', required=True)
    parser.add_argument('--race-id', required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = subprocess.run(['pdftotext', '-bbox-layout', args.input, '-'],
                            check=True, capture_output=True, text=True)
    document = extract_source(result.stdout, args.race_id, args.year)
    Path(args.out).write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n')
    print(f"{len(document['teams'])} equipos, {document['expectedRiderCount']} corredores; edición, recuento y dorsales validados.")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
