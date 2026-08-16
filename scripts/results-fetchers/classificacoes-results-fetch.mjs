#!/usr/bin/env node
/**
 * Resultados de Classificações.net → contrato intermedio de uci-results-upsert.
 *
 * El código es el slug de la prueba (p.ej. 86-volta-a-portugal-continente).
 * Descubre los ids de etapa y de clasificación en HTML; no se hardcodean.
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback; };
const has = (name) => argv.includes(name);
const CODE = arg('--code');
const OUT = arg('--out', '.');
const COMPETITION_ID = Number(arg('--competition-id'));
const ONLY_STAGE = arg('--stage') == null ? null : Number(arg('--stage'));
const FIXTURE = arg('--fixture');
const TOTAL_STAGES = arg('--total-stages') == null ? null : Number(arg('--total-stages'));
const BASE = 'https://www.classificacoes.net';
const log = (s) => process.stderr.write(`${s}\n`);

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const suggestCompetitionId = (code) => -(fnv1a(`classificacoes:${code}`) % 200000);
const CLASS_IDX = {
  'stage/stage': 0, 'gc/stage': 1,
  'points/overall': 2, 'kom/overall': 3, 'youth/overall': 4, 'teams/overall': 5,
  'points/stage': 6, 'kom/stage': 7, 'youth/stage': 8, 'teams/stage': 9,
};
const synthEventId = (code, stageNumber, classKind, scope, isFinal = false) => {
  const base = -suggestCompetitionId(code);
  const slot = isFinal ? 9999 : stageNumber;
  return -(base * 10000 + slot * 100 + (CLASS_IDX[`${classKind}/${scope}`] ?? 99));
};

export function stageNumber(text) {
  if (/pr[oó]logo/i.test(text)) return 0;
  const m = text.match(/(\d+)ª\s*Etapa/i);
  return m ? Number(m[1]) : null;
}

const HTML_NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã', auml: 'ä', Auml: 'Ä',
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê', euml: 'ë', Euml: 'Ë',
  iacute: 'í', Iacute: 'Í', igrave: 'ì', Igrave: 'Ì', icirc: 'î', Icirc: 'Î', iuml: 'ï', Iuml: 'Ï',
  ntilde: 'ñ', Ntilde: 'Ñ',
  oacute: 'ó', Oacute: 'Ó', ograve: 'ò', Ograve: 'Ò', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', ouml: 'ö', Ouml: 'Ö',
  uacute: 'ú', Uacute: 'Ú', ugrave: 'ù', Ugrave: 'Ù', ucirc: 'û', Ucirc: 'Û', uuml: 'ü', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', yacute: 'ý', Yacute: 'Ý', yuml: 'ÿ',
};

function decodeEntities(value) {
  return String(value).replace(/&#(?:x([\da-f]+)|(\d+));|&([a-z][a-z\d]+);/gi, (_, hex, decimal, named) => {
    if (hex || decimal) return String.fromCodePoint(parseInt(hex || decimal, hex ? 16 : 10));
    return HTML_NAMED_ENTITIES[named] ?? `&${named};`;
  });
}

export function decodeHtml(s = '') {
  return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stagesFromRaceHtml(html) {
  const stages = [];
  const re = /<tr[^>]*onclick="location\.href='([^']+\/(\d+))'"[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const m of html.matchAll(re)) {
    const text = decodeHtml(m[3]);
    const number = stageNumber(text);
    if (number != null) stages.push({ stageNumber: number, path: m[1], stageId: Number(m[2]), text });
  }
  // El diseño actual muestra las jornadas en un <select>, no en las filas con
  // onclick que usaba la web antigua. Durante la carrera ambas variantes pueden
  // coexistir; se desduplica por identificador de la página de etapa.
  for (const m of String(html).matchAll(/<option[^>]+value=["']([^"']+\/(\d+))["'][^>]*>([\s\S]*?)<\/option>/gi)) {
    const text = decodeHtml(m[3]);
    const number = stageNumber(text);
    if (number != null && !stages.some((stage) => stage.stageId === Number(m[2]))) {
      stages.push({ stageNumber: number, path: m[1], stageId: Number(m[2]), text });
    }
  }
  return stages.sort((a, b) => a.stageNumber - b.stageNumber);
}

export function classificationsFromStageHtml(html) {
  const select = html.match(/<select[^>]+name="stageLinkUpa"[^>]*>([\s\S]*?)<\/select>/i)?.[1] || '';
  return [...select.matchAll(/<option[^>]+value="([^"]+)"[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((m) => ({ path: decodeHtml(m[1]), label: decodeHtml(m[2]) }));
}

// El DataTable no incluye las incidencias que el cronometrador publica al pie
// del libro PDF: un corredor puede figurar clasificado en la etapa y, a la vez,
// quedar fuera de control. Solo usamos el libro "Classificações", no el breve
// "Resumo", que no contiene el cuadro de incidencias completo.
export function stagePdfUrlFromHtml(html) {
  const source = String(html);
  // En la página real el texto vive en un <td> hermano del <a> de descarga.
  for (const m of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const href = m[1].match(/href=["']([^"']*\/download\/[^"']+)["']/i)?.[1];
    const label = decodeHtml(m[1]);
    if (href && /^classifica[cç][oõ]es\b/i.test(label) && !/resumo/i.test(label)) return new URL(href, BASE).href;
  }
  // Mantener este fallback para fixtures y posibles variantes sin tabla.
  for (const m of source.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/^classifica[cç][oõ]es\b/i.test(decodeHtml(m[2])) && !/resumo/i.test(decodeHtml(m[2])) && /^\/download\//.test(m[1])) return new URL(m[1], BASE).href;
  }
  return null;
}

const PDF_SUMMARY_IRMS = [
  [/^DESISTIRAM\b/i, 'DNF'],
  [/^EXPULSOS\b/i, 'DSQ'],
  [/^FORA DE CONTROLO\b/i, 'OTL'],
  [/^N[ÃA]O ALINHARAM\b/i, 'DNS'],
];

export function summaryIrmsFromPdfText(text) {
  const byBib = new Map();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    const entry = PDF_SUMMARY_IRMS.find(([re]) => re.test(line));
    if (!entry) continue;
    const [re, irm] = entry;
    for (const bib of line.replace(re, '').match(/\d+/g) || []) {
      const previous = byBib.get(bib);
      if (previous && previous !== irm) throw new Error(`PDF: dorsal ${bib} con IRM incompatibles (${previous}/${irm})`);
      byBib.set(bib, irm);
    }
  }
  return byBib;
}

export function applyPdfSummaryIrms(rows, irmsByBib) {
  const sourceBibs = new Set(rows.map((row) => row.bib).filter(Boolean));
  const merged = rows.map((row) => {
    const irm = row.bib ? irmsByBib.get(row.bib) : null;
    // El contrato exige que toda IRM vaya sin puesto ni tiempo, incluso cuando
    // la tabla de etapa conserva el orden de llegada (caso Keogh, OTL).
    return !irm ? row : {
      ...row, rank: null, rankText: irm, resultValue: null,
      timeText: null, gapText: null, irm,
    };
  });
  // El DataTable de Classificações.net contiene solo quienes terminaron. Los
  // dorsales del resumen PDF que no estén allí son precisamente abandonos/no
  // salidas que se perderían si nos limitáramos a sobrescribir filas existentes.
  // El upsert los enlaza por dorsal contra la startlist; el display es solo el
  // fallback si esa resolución no existe.
  for (const [bib, irm] of irmsByBib) {
    if (sourceBibs.has(bib)) continue;
    merged.push({
      rank: null, rankText: irm, bib, riderDisplay: 'Sin identificar',
      resultValue: null, timeText: null, gapText: null, points: null, irm,
    });
  }
  return merged.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

export function classify(label) {
  const l = label.toLowerCase();
  if (/classifica[cç][aã]o individual na etapa/.test(l)) return { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' };
  if (/geral individual/.test(l)) return { classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification' };
  if (/geral pontos/.test(l)) return { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification' };
  if (/geral montanha/.test(l)) return { classKind: 'kom', scope: 'overall', eventName: 'Overall Mountain Classification' };
  if (/geral juventude/.test(l)) return { classKind: 'youth', scope: 'overall', eventName: 'Overall Youth Classification' };
  if (/geral equipas/.test(l)) return { classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', isTeamEvent: true };
  return null;
}

const clean = (v) => decodeHtml(String(v ?? '')).replace(/^---$/, '').trim();
const irmOf = (v) => /^(DNF|DNS|DSQ|DQ|OTL)$/i.test(clean(v)) ? clean(v).toUpperCase().replace('DQ', 'DSQ') : null;
const normTime = (v) => {
  const s = clean(v); const m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return m ? `${Number(m[1])}:${m[2]}:${m[3]}` : null;
};
const normGap = (v) => {
  const s = clean(v).replace(/^a\s+/i, '+').replace(/^\+?0+(?=\d)/, '+');
  return /^(?:\+\d+(?::\d{2}){0,2}|m\.t\.)$/i.test(s) ? (s.toLowerCase() === 'm.t.' ? null : s) : null;
};

const provisionalSpec = (label) => {
  const normalized = clean(label).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  if (/^individual na etapa$/.test(normalized)) return { classKind: 'stage', scope: 'stage', eventName: 'Stage Classification' };
  if (/^geral individual$/.test(normalized)) return { classKind: 'gc', scope: 'stage', eventName: 'Stage General Classification' };
  if (/^geral pontos$/.test(normalized)) return { classKind: 'points', scope: 'overall', eventName: 'Overall Points Classification' };
  if (/^geral montanhas$/.test(normalized)) return { classKind: 'kom', scope: 'overall', eventName: 'Overall Mountain Classification' };
  if (/^geral juventude$/.test(normalized)) return { classKind: 'youth', scope: 'overall', eventName: 'Overall Youth Classification' };
  if (/^geral equipas$/.test(normalized)) return { classKind: 'teams', scope: 'overall', eventName: 'Overall Teams Classification', isTeamEvent: true };
  return null;
};

// Parser mínimo de tablas anidadas. La pestaña Resultados no tiene una API: las
// clasificaciones provisionales están embebidas como tablas HTML dentro de una
// celda cuyo encabezado identifica la clasificación.
function resultTablesFromHtml(html) {
  const tables = [];
  const stack = [];
  for (const token of String(html).matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const value = token[0];
    const tag = value.match(/^<\/?\s*([a-z0-9]+)/i)?.[1]?.toLowerCase();
    const closing = /^<\//.test(value);
    if (tag === 'table') {
      if (closing) stack.pop();
      else {
        const parent = stack.at(-1) || null;
        const table = { parentCell: parent?.cell || null, rows: [], row: null, cell: null };
        tables.push(table); stack.push(table);
      }
    } else if (tag === 'tr' && stack.length) {
      if (closing) stack.at(-1).row = null;
      else { const table = stack.at(-1); table.row = []; table.rows.push(table.row); }
    } else if ((tag === 'td' || tag === 'th') && stack.length) {
      const table = stack.at(-1);
      if (closing) table.cell = null;
      else if (table.row) { table.cell = []; table.row.push(table.cell); }
    } else if (!tag && stack.length && stack.at(-1).cell) {
      stack.at(-1).cell.push(value);
    }
  }
  return tables;
}

const tableCells = (table) => table.rows
  .map((row) => row.map((cell) => clean(cell.join(''))))
  .filter((row) => row.length >= 3);

export function provisionalClassificationsFromHtml(html, code, stageNumber) {
  const classifications = [];
  for (const table of resultTablesFromHtml(html)) {
    const spec = provisionalSpec(table.parentCell?.join('') || '');
    if (!spec) continue;
    let previousGap = '+0';
    const isPoints = spec.classKind === 'points' || spec.classKind === 'kom';
    const rows = tableCells(table).map((cells) => {
      const rankText = clean(cells[0]);
      const rank = /^\d+$/.test(rankText) ? Number(rankText) : null;
      const bib = clean(cells[1]) || null;
      const sourceDisplay = clean(cells[2]).replace(/\*+$/, '').trim();
      // El resumen provisional trunca los nombres de equipo, pero conserva su
      // código UCI. El enlazador de resultados usa ese prefijo antes de cotejar
      // aliases, por lo que mantiene el vínculo pese al texto abreviado.
      const teamCode = spec.isTeamEvent ? clean(cells[3]) : null;
      const riderDisplay = spec.isTeamEvent && teamCode ? `${teamCode} - ${sourceDisplay}` : sourceDisplay;
      const value = clean(cells.at(-1));
      if (!rank || !riderDisplay) return null;
      const absolute = !isPoints ? normTime(value) : null;
      const sameTime = /^m\.?t\.?$/i.test(value);
      const explicitGap = !absolute && !isPoints ? normGap(value) : null;
      const gapText = sameTime ? previousGap : explicitGap;
      if (gapText) previousGap = gapText;
      const points = isPoints && /^-?\d+$/.test(value) ? Number(value) : null;
      return {
        rank, rankText: String(rank), bib: spec.isTeamEvent ? null : bib,
        riderDisplay, teamName: spec.isTeamEvent ? riderDisplay : null,
        resultValue: points == null ? (absolute || null) : value,
        timeText: absolute, gapText: absolute ? null : gapText, points, irm: null,
      };
    }).filter(Boolean);
    if (!rows.some((row) => row.rank === 1)) continue;
    classifications.push({
      eventId: synthEventId(code, stageNumber, spec.classKind, spec.scope), ...spec,
      winnerName: rows.find((row) => row.rank === 1)?.riderDisplay || null,
      rowCount: rows.length, rows,
    });
  }
  return classifications;
}

export function rowsFromPayload(payload, { isTeamEvent = false } = {}) {
  const data = Array.isArray(payload?.aaData) ? payload.aaData : Array.isArray(payload?.data) ? payload.data : [];
  return data.map((row) => Array.isArray(row) ? row : Object.values(row)).map((r) => {
    const rankText = clean(r[0]); const bib = clean(r[1]);
    const isCompact = r.length <= 5;
    const display = (isTeamEvent ? clean(r[2]) : clean(isCompact ? r[2] : r[4])).replace(/\*+$/, '').trim();
    const teamName = isTeamEvent ? display : clean(isCompact ? r[3] : r[6]) || null;
    const value = clean(isTeamEvent ? r[3] : (isCompact ? r[4] : r[7]));
    const gap = clean(isTeamEvent ? r[4] : r[8]);
    const irm = irmOf(rankText) || irmOf(value);
    if (irm) return { rank: null, rankText: irm, bib: bib || null, riderDisplay: display || 'Sin identificar', irm };
    const rank = /^\d+$/.test(rankText) ? Number(rankText) : null;
    if (!rank || !display) return null;
    const absolute = normTime(value);
    const points = !isTeamEvent && isCompact && /^-?\d+$/.test(value) ? Number(value) : null;
    const isGap = !absolute && /^a\s+/i.test(value);
    return {
      rank, rankText: String(rank), bib: isTeamEvent ? null : (bib || null), riderDisplay: display,
      teamName,
      // La fuente da tiempo absoluto a todos los clasificados: no mezclar gapText,
      // para que la web derive los m.t. y diferencias de forma consistente.
      resultValue: points == null ? (absolute || (isGap ? null : value || null)) : value,
      timeText: absolute,
      gapText: absolute ? null : normGap(isGap ? value : gap), points, irm: null,
    };
  }).filter(Boolean).sort((a, b) => {
    // Classificações.net puede devolver bloques del DataTable sin ordenar. El
    // upsert conserva este orden como sortOrder, así que normalizamos aquí la
    // posición de carrera antes de que llegue a la web y las apps.
    const aRank = a.rank ?? Number.MAX_SAFE_INTEGER;
    const bRank = b.rank ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'calendariociclismo.app results sync (+https://calendariociclismo.app)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res;
}

async function summaryIrmsFromStagePdf(url) {
  const dir = mkdtempSync(join(tmpdir(), 'classificacoes-pdf-'));
  const pdf = join(dir, 'stage.pdf');
  try {
    writeFileSync(pdf, Buffer.from(await (await get(url)).arrayBuffer()));
    return summaryIrmsFromPdfText(execFileSync('pdftotext', ['-layout', pdf, '-'], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (!CODE) throw new Error('Uso: --code <slug> --competition-id <id> [--out dir]');
  if (has('--suggest-id')) { process.stdout.write(String(suggestCompetitionId(CODE)) + '\n'); return; }
  if (!Number.isInteger(COMPETITION_ID)) throw new Error('Uso: --code <slug> --competition-id <id> [--out dir]');
  const fixture = FIXTURE ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;
  const raceHtml = fixture?.raceHtml || await (await get(`${BASE}/modalidades/ciclismo/${CODE}`)).text();
  const available = stagesFromRaceHtml(raceHtml).filter((s) => ONLY_STAGE == null || s.stageNumber === ONLY_STAGE);
  const stages = [];
  for (const stage of available) {
    const html = fixture?.stageHtml?.[String(stage.stageNumber)] || await (await get(`${BASE}${stage.path}`)).text();
    const pdfText = fixture?.pdfText?.[String(stage.stageNumber)];
    const pdfUrl = !fixture ? stagePdfUrlFromHtml(html) : null;
    const summaryIrms = pdfText != null ? summaryIrmsFromPdfText(pdfText)
      : (pdfUrl ? await summaryIrmsFromStagePdf(pdfUrl) : new Map());
    const classifications = [];
    for (const option of classificationsFromStageHtml(html)) {
      const spec = classify(option.label); if (!spec) continue;
      const id = option.path.match(/\/results\/(\d+)$/)?.[1]; if (!id) continue;
      const payload = fixture?.results?.[id] || await (await get(`${BASE}/ajax/action/results/${id}`)).json();
      const sourceRows = rowsFromPayload(payload, spec);
      const rows = spec.classKind === 'stage' && !spec.isTeamEvent
        ? applyPdfSummaryIrms(sourceRows, summaryIrms) : sourceRows;
      if (!rows.some((r) => r.rank === 1)) continue;
      classifications.push({ eventId: synthEventId(CODE, stage.stageNumber, spec.classKind, spec.scope), ...spec, winnerName: rows.find((r) => r.rank === 1)?.riderDisplay || null, rowCount: rows.length, rows });
    }
    // La pestaña Resultados publica un resumen provisional antes de que el
    // DataTable AJAX habilite la clasificación de etapa. Solo se usa si AJAX no
    // aporta una llegada válida; en el siguiente pase, la fuente completa la
    // reemplaza mediante los mismos eventId sintéticos.
    if (!classifications.some((classification) => classification.classKind === 'stage' && classification.scope === 'stage')) {
      const provisional = provisionalClassificationsFromHtml(html, CODE, stage.stageNumber);
      if (provisional.some((classification) => classification.classKind === 'stage' && classification.scope === 'stage')) {
        classifications.push(...provisional);
        log(`Etapa ${stage.stageNumber}: resumen provisional HTML (${provisional.length} clasificaciones)`);
      }
    }
    if (classifications.length) stages.push({ stageNumber: stage.stageNumber, eventName: stage.text, classifications });
  }
  if (TOTAL_STAGES != null && ONLY_STAGE === TOTAL_STAGES) {
    const last = stages.find((s) => s.stageNumber === TOTAL_STAGES);
    if (last) stages.push({
      stageNumber: null, isFinalClassification: true, eventName: 'Final Classification',
      classifications: last.classifications.filter((c) => c.classKind !== 'stage').map((c) => ({
        ...c, scope: 'stage', eventId: synthEventId(CODE, 9999, c.classKind, 'stage', true),
      })),
    });
  }
  const output = { competitionId: COMPETITION_ID, disciplineId: 10, source: 'classificacoes', classificacoesCode: CODE, stages };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${COMPETITION_ID}.json`), JSON.stringify(output, null, 2));
  if (has('--pretty')) process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((e) => { log(`FATAL: ${e.message}`); process.exit(1); });
}
