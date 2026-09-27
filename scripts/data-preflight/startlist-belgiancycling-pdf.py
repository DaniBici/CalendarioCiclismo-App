#!/usr/bin/env python3
"""Extrae la lista de inscritos "DEELNEMERSLIJST - LISTE DES PARTANTS" de Belgian Cycling.

El formato no es el de una página: cinco columnas de equipos por página. Cada bloque lleva el
nombre del equipo, una línea `PL/DS` con el director y las filas de corredores
precedidas por su dorsal. Las columnas fluyen de forma independiente, así que
los bloques no comparten coordenada Y; se separan por la X de las etiquetas
`PL/DS`. La última columna puede recortar nombres largos contra el margen de la
página; `--patch` permite corregir esos casos antes de emitir el documento.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

TAG = lambda element: element.tag.rsplit('}', 1)[-1]

FOOTER_TOKENS = {'Last', 'Update:', ';', 'Results', 'at', ':', 'www.results.belgiancycling.be'}


def is_footer(text):
    return text in FOOTER_TOKENS or bool(re.fullmatch(r'\d{1,2}:\d{2}', text)) or bool(re.fullmatch(r'\d{2}/\d{2}/\d{4}', text))


def word_list(xml):
    root = ET.fromstring(xml)
    words = []
    for element in root.iter():
        if TAG(element) != 'word':
            continue
        words.append({
            'x': float(element.attrib['xMin']),
            'y': float(element.attrib['yMin']),
            'text': element.text or '',
        })
    return words


def column_anchors(words):
    anchors = sorted({w['x'] for w in words if w['text'] == 'PL/DS'})
    columns = []
    for x in anchors:
        if not columns or x - columns[-1] > 1:
            columns.append(x)
    if len(columns) != 5:
        raise ValueError(f'Se esperaban 5 columnas de equipos; se encontraron {len(columns)}.')
    return columns


def line_groups(words):
    rows = defaultdict(list)
    for word in words:
        rows[round(word['y'] / 3) * 3].append(word)
    lines = []
    for key in sorted(rows):
        ordered = sorted(rows[key], key=lambda w: w['x'])
        lines.append({
            'y': key,
            'text': ' '.join(w['text'] for w in ordered).strip(),
        })
    return lines


def split_name(name):
    parts = name.split()
    split = 0
    while split < len(parts) and parts[split].isupper():
        split += 1
    if not 0 < split < len(parts):
        raise ValueError(f'No se separa el nombre: {name!r}')
    return ' '.join(parts[:split]), ' '.join(parts[split:])


def parse_column(lines, patch):
    teams = []
    team = None
    rider = None
    for index, line in enumerate(lines):
        text = line['text']
        next_text = lines[index + 1]['text'] if index + 1 < len(lines) else ''
        first = text.split(' ', 1)[0]
        if first == 'PL/DS':
            continue
        if next_text.startswith('PL/DS'):
            team = {'teamName': text, 'riders': []}
            teams.append(team)
            rider = None
            continue
        if re.fullmatch(r'\d+', text):
            rider = None
            continue
        numbered = re.fullmatch(r'(\d+)\s+(.+)', text)
        if numbered and team is not None:
            dorsal = int(numbered[1])
            rider = {'dorsal': dorsal, 'name': numbered[2].strip()}
            team['riders'].append(rider)
            continue
        if rider is not None:
            rider['name'] += ' ' + text
    for team in teams:
        for rider in team['riders']:
            fix = patch.get(str(rider['dorsal']))
            if fix:
                rider['name'] = fix
            last_name, first_name = split_name(rider['name'])
            rider.pop('name')
            rider.update(firstName=first_name, lastName=last_name)
    return teams


def extract_source(xml, race_id, year, patch):
    words = word_list(xml)
    text = '\n'.join(w['text'] for w in words)
    if not re.search(r'DEELNEMERSLIJST\s*-\s*LISTE\s+DES\s+PARTANTS', text, re.IGNORECASE):
        raise ValueError('El PDF no es una lista de inscritos de Belgian Cycling.')
    date = re.search(r'\b(\d{2})/(\d{2})/(20\d{2})\b', text)
    if not date:
        raise ValueError('El PDF no contiene fecha.')
    if int(date[3]) != year:
        raise ValueError(f'El PDF es de {date[3]}, no de {year}.')
    count = re.search(r'\b(\d+)\s+Deeln\./Part\.', text)
    if not count:
        raise ValueError('El PDF no declara el recuento de participantes.')

    words = [w for w in words if not is_footer(w['text'])]
    anchors = column_anchors(words)
    # La etiqueta PL/DS de cada columna abre el bloque siguiente; todo lo que
    # queda a su izquierda pertenece a la columna anterior.
    boundaries = anchors[1:]
    top = min(w['y'] for w in words if w['text'] == 'PL/DS') - 12
    columns = [[] for _ in anchors]
    for word in words:
        if word['y'] < top:
            continue
        column = 0
        while column < len(boundaries) and word['x'] >= boundaries[column]:
            column += 1
        columns[column].append(word)

    teams = []
    for column in columns:
        teams.extend(parse_column(line_groups(column), patch))

    bibs = [rider['dorsal'] for team in teams for rider in team['riders']]
    expected = int(count[1])
    if len(bibs) != expected:
        raise ValueError(f'Se extrajeron {len(bibs)} corredores, pero el PDF declara {expected}.')
    if len(set(bibs)) != len(bibs) or any(bib <= 0 for bib in bibs):
        raise ValueError('Hay dorsales duplicados o no positivos.')
    if not teams:
        raise ValueError('No se extrajo ningún equipo.')
    return dict(raceId=race_id, expectedRiderCount=expected, teams=teams)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--in', dest='input', required=True)
    parser.add_argument('--race-id', required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--patch', default=None, help='JSON {"dorsal": "Nombre completo"} para nombres recortados por la fuente.')
    args = parser.parse_args()
    patch = json.loads(Path(args.patch).read_text()) if args.patch else {}
    result = subprocess.run(['pdftotext', '-bbox-layout', args.input, '-'],
                            check=True, capture_output=True, text=True)
    document = extract_source(result.stdout, args.race_id, args.year, patch)
    Path(args.out).write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n')
    print(f"{len(document['teams'])} equipos, {document['expectedRiderCount']} corredores; edición, recuento y dorsales validados.")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
