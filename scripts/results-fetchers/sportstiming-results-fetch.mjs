#!/usr/bin/env node
/**
 * sportstiming-results-fetch.mjs — FETCHER de resultados desde SPORTSTIMING.DK
 * (www.sportstiming.dk), el cronometrador de carreras danesas — entre ellas la
 * Copenhagen Sprint (UCI WorldTour / Women's WorldTour). Publica la clasificación
 * de meta poco después de cruzar la línea, antes que UCI DataRide.
 *
 * EMITE EXACTAMENTE EL MISMO JSON que uci-results-fetch.mjs → el upsert
 * (uci-results-upsert.mjs), los locks del panel (087), el resolve por dorsal
 * (082) y la web/apps funcionan sin cambios. Quién usa qué fetcher lo decide
 * race_uci_links.source ('uci'|'tissot'|'pdf'|'matsport'|'sportstiming') vía
 * uci-results-cron.mjs — PERO esta carrera se vuelca EN LOCAL (sin GitHub
 * Actions): este fetcher + uci-results-upsert.mjs --apply, a mano o en bucle.
 *
 * FUENTE (sin API JSON; scraping HTML estable por query param):
 *   GET /event/{eventId}/results?cat={catLabel}
 *   - {catLabel} selecciona la carrera dentro del evento ("Elite Women (13. June)"
 *     / "Elite Men (14. June)"): un evento sportstiming agrupa varias carreras.
 *   - La clasificación de meta se renderiza server-side, UNA <table> por corredor
 *     (sin paginación: todas las filas en una carga). NO se usan las vistas
 *     ?viewType=leader|points (líder en ruta / puntos) ni los "crossings" (pasos
 *     por meta del circuito final): SOLO la clasificación final por defecto.
 *
 * CONTRATO DE FILA (verificado contra la edición 2025, /event/16511):
 *   Plac. | Tid (tiempo) | Efter#1 (gap +M:SS) | "Nombre (DORSAL)\nEQUIPO"
 *         | Land (país IOC-3) | Klub/Firma (equipo) | [crossings, ignorados]
 *   - El número entre paréntesis tras el nombre ES EL DORSAL (Wiebes (1),
 *     Meeus (31); cuadra con fuente externa) → resolución POR DORSAL (082) contra la
 *     startlist curada. El display es solo fallback.
 *   - Ganador con tiempo ABSOLUTO ("3:32:30"); resto con gap "+0:00"/"+8:10".
 *   - Abandonos: placement "DNF" (también DNS/DSQ/OTL posibles) + tiempo "-".
 *
 * NORMALIZACIÓN:
 *   tiempo absoluto "3:32:30" → tal cual (formato BD) · gap "+0:00"→"+0",
 *   "+0:12" tal cual · status placement → IRM UCI: DNF→DNF · DNS→DNS · DSQ→DSQ ·
 *   OTL→OTL (desconocidos en crudo, mayúsculas).
 *
 * IDs SINTÉTICOS: sportstiming no existe en DataRide → eventId/uciRaceId/
 *   competitionId NEGATIVOS y deterministas (mismo esquema que Tissot/Matsport/
 *   PDF, salt propio "sportstiming:"). fnv1a("sportstiming:"+code)%200000 base.
 *
 * Uso (desde la raíz del repo; fetch nativo, sin deps):
 *   node scripts/results-fetchers/sportstiming-results-fetch.mjs \
 *     --event 18776 --cat "Elite Women (13. June)" --competition-id -123456
 *
 * Args:
 *   --event           id numérico del evento sportstiming (p. ej. 18776).
 *   --cat             etiqueta EXACTA de la carrera dentro del evento
 *                     ("Elite Women (13. June)"). Imprescindible: un evento tiene
 *                     varias carreras (masc/fem) bajo el mismo --event.
 *   --code            (opcional) código del puente para los IDs sintéticos;
 *                     default = "{event}|{cat}". Debe ser ESTABLE por carrera.
 *   --competition-id  competitionId del puente race_uci_links (sintético NEGATIVO;
 *                     obligatorio: el JSON lo lleva para que el upsert NO recablee
 *                     el puente y nombra el archivo de salida <id>.json). Lo
 *                     imprime este script con --suggest-id.
 *   --date            (opcional) dateKey YYYY-MM-DD de la jornada (default: se
 *                     intenta deducir del catLabel; si no, null).
 *   --out             carpeta de salida (default _results_run/sportstiming-<code> JUNTO A ESTE
 *                     script, no relativo al cwd). La ruta que imprime al terminar es la
 *                     real: leer esa, no reconstruirla a mano.
 *   --pretty          además vuelca el JSON a stdout.
 *   --suggest-id      imprime el competitionId sintético sugerido y sale.
 */
'use strict';

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const EVENT = getArg('event');
const CAT = getArg('cat');
// Inyección manual de corredores que el cronómetro NO capta (p. ej. sin
// transponder por cambio de bici): "--inject rank|dorsal|Nombre|Equipo[|gap]"
// (repetible). Se inserta en ese rank desplazando +1 a los >= rank; se
// AUTODESACTIVA si ese dorsal ya aparece en el feed (para no duplicar cuando
// el cronómetro lo añade a mano). gap por defecto "+0:00" (mismo grupo de meta).
const INJECTS = args.reduce((acc, a, i) => {
  if (a === '--inject' && args[i + 1]) {
    const [rank, dorsal, name, team, gap] = args[i + 1].split('|');
    acc.push({ rank: parseInt(rank, 10), bib: String(dorsal).trim(), name: (name || '').trim(), team: (team || '').trim(), gap: (gap || '+0:00').trim() });
  }
  return acc;
}, []);
// Remapeo de dorsal: "--remap-bib FEED:STARTLIST" (repetible). El cronómetro a
// veces asigna un dorsal distinto al de la startlist UCI (p. ej. Zanardi va 57
// en sportstiming y 56 en la UCI) → el resolve por dorsal falla y la web la deja
// sin enlazar. Se reescribe el bib del feed AL de la startlist antes de emitir.
const REMAP = new Map(args.reduce((acc, a, i) => {
  if (a === '--remap-bib' && args[i + 1]) {
    const [from, to] = args[i + 1].split(':');
    if (from && to) acc.push([String(from).trim(), String(to).trim()]);
  }
  return acc;
}, []));
const CODE = getArg('code') || (EVENT && CAT ? `${EVENT}|${CAT}` : null);
const COMPETITION_ID = getArg('competition-id');
const DATE_ARG = getArg('date');
// Anclado al directorio del script, NO al cwd: invocado a mano desde otra carpeta
// escribía el JSON en una ruta distinta de la que imprime, y una lectura posterior
// se quedaba con un fichero viejo (cazado en el TdF E12, relegación de Van Mechelen).
const OUT = getArg('out') || join(dirname(fileURLToPath(import.meta.url)), '_results_run', `sportstiming-${(CODE || 'x').replace(/[^\w-]+/g, '_')}`);
const PRETTY = hasFlag('pretty');
// Fuente HTML local: cuando sportstiming muestra su challenge ("Verify you're
// human"), el fetch programático recibe la página de verificación y devuelve 0
// filas. El challenge NO se intenta rodear: se resuelve a mano en el navegador,
// como cualquier visitante, y se le pasa a este script la página ya cargada con
// --html-file <ruta>, que se parsea con la MISMA lógica (parseRows).
// Es el motivo de que esta fuente sea de volcado MANUAL: ningún workflow la usa.
const HTML_FILE = getArg('html-file');

const BASE = 'https://www.sportstiming.dk';
// UA de referencia del proyecto: nos identificamos y damos URL de contacto.
// El UA de Chrome que había aquí no servía de nada: sportstiming sirve su página
// de bot-protection a AMBOS por igual (verificado 2026-07-18, respuesta byte a
// byte idéntica). Cuando salta el challenge, la vía es --html-file (ver arriba).
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// ── IDs sintéticos (negativos, deterministas; salt "sportstiming:") ──────────
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// ≤199999 → eventId > -2^31 garantizado. Sin --event/--cat (CODE null) queda NaN: solo
// lo usa main(), que valida los args antes (importar el módulo desde un test no ejecuta
// nada). Los reduce de --inject/--remap-bib de arriba son puros sobre argv → import-safe.
const ID_BASE = CODE ? fnv1a(`sportstiming:${CODE}`) % 200000 : NaN;

// Validación de args: DENTRO de main(), no a nivel de módulo — un process.exit() al
// importar mataría el runner de tests.
function checkArgs() {
  if (!EVENT || !CAT) { log('FATAL: faltan --event <id> y --cat "<etiqueta>"'); process.exit(1); }
  if (hasFlag('suggest-id')) {
    process.stdout.write(String(-ID_BASE) + '\n');
    process.exit(0);
  }
  if (!COMPETITION_ID || !/^-\d+$/.test(COMPETITION_ID)) {
    log(`FATAL: falta --competition-id <entero NEGATIVO sintético> (sugerido para "${CODE}": ${-ID_BASE})`);
    process.exit(1);
  }
}

// Carrera de un día → un solo slot/clasificación (stage/stage). idx fijo igual
// que los demás fetchers para que el eventId sea estable.
const STAGE_SLOT = 1;
const CLASS_IDX = { 'stage/stage': 1 };
const synthRaceId = () => -(ID_BASE * 10000 + STAGE_SLOT * 100);
const synthEventId = (kind, scope) => -(ID_BASE * 10000 + STAGE_SLOT * 100 + (CLASS_IDX[`${kind}/${scope}`] ?? 1));

// ── normalización ────────────────────────────────────────────────────────────
// Exportadas para tests (js/__tests__/sportstimingResultsFetch.test.js). El script sigue
// siendo ejecutable: main() solo corre si se invoca directamente (ver pie del fichero).
export function clean(s) { return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim(); }
export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
export function stripTags(s) { return decodeEntities(String(s).replace(/<[^>]+>/g, ' ')); }

// placement de sportstiming → códigos IRM UCI (los que entiende js/uci-irm.js).
const IRM_MAP = { DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ', DQ: 'DSQ', OTL: 'OTL', HD: 'OTL', AB: 'DNF', NP: 'DNS' };
export function irmOf(placement) {
  const st = clean(placement).toUpperCase();
  if (!st || /^\d+$/.test(st)) return null;
  if (st === '-' || st === '') return null;
  return IRM_MAP[st] || st;
}

// tiempo absoluto "3:32:30" / "55:12" → tal cual (ya es el formato de BD); resto → null.
export function normAbsTime(v) {
  const t = clean(v);
  return /^\d+(:\d{2}){1,2}$/.test(t) ? t : null;
}
// gap sportstiming → estilo UCI en BD, alineado con secondsToGap() de js/resultados.js
// (la referencia canónica: bajo el minuto emite segundos sueltos, +0" / +12").
//   "+0:00" → "+0"  ·  "+0:12" → "+12"  ·  "+1:02" → "+1:02"  ·  "+1:02:03" tal cual.
// Sportstiming da SIEMPRE el gap con el grupo de minutos por delante ("+0:12"); ese
// "0:" sobra y hay que colapsarlo, o el mismo gap se escribe distinto según la fuente
// (livetiming ya emite "+12"). Es display: la BD guarda el texto tal cual llega.
export function normGap(g) {
  const v = clean(g).replace(/^\+\s*/, '+');
  if (!v.startsWith('+')) return null;
  const body = v.slice(1);
  if (!/^[\d:]+$/.test(body)) return null;
  const parts = body.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  // Colapsa los grupos de cabecera a cero: [0,0]→"0" · [0,12]→"12" · [0,1,2]→"1:02".
  while (parts.length > 1 && parts[0] === 0) parts.shift();
  const out = parts
    .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, '0')))
    .join(':');
  return '+' + out;
}

// ── parseo de la tabla HTML ───────────────────────────────────────────────────
// Cada corredor es un <tr> plano con celdas (verificado contra /event/16511):
//   <td>Plac</td><td>Tiempo</td><td>gap</td>
//   <td><a .../results/{id}><span>Nombre (DORSAL)</span></a><div>EQUIPO</div></td>
//   <td><img flag><span> IOC3</span></td><td><span>EQUIPO</span></td>[...crossings]
// El dorsal va entre paréntesis tras el nombre; el equipo bajo el nombre y en su
// celda; el país como código IOC-3. NO se usan las columnas de "crossings".
export function parseRows(html) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html)) !== null) {
    const seg = m[1];
    if (!/\/results\/\d+/.test(seg)) continue;        // no es fila de corredor
    const tdsRaw = [...seg.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1]);
    const tds = tdsRaw.map((c) => stripTags(c).replace(/\s+/g, ' ').trim());
    if (tds.length < 4) continue;

    // Nombre + dorsal: el <span> dentro del <a .../results/{id}>.
    const nameSpan = (seg.match(/<a\b[^>]*\/results\/\d+[^>]*>\s*<span>([\s\S]*?)<\/span>/i) || [])[1]
      || (seg.match(/<a\b[^>]*\/results\/\d+[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '';
    const nameCell = stripTags(nameSpan).replace(/\s+/g, ' ').trim();
    const bibM = nameCell.match(/\((\d+)\)\s*$/);
    const bib = bibM ? bibM[1] : null;
    const name = clean(nameCell.replace(/\s*\(\d+\)\s*$/, ''));

    const placement = tds[0] || '';
    const irm = irmOf(placement);
    const rank = /^\d+$/.test(placement) ? parseInt(placement, 10) : null;
    const timeRaw = tds[1] || '';
    const gapRaw = tds[2] || '';

    // Celdas tras el nombre: País (IOC-3) y Equipo (su propia <td>). La celda de
    // nombre (la del enlace /results/) trae el <div> del equipo concatenado → se
    // EXCLUYE del barrido buscando el índice de esa td. País = primera IOC-3;
    // equipo = primera celda de texto largo que NO sea esa celda de nombre.
    const nameTdIdx = tdsRaw.findIndex((c) => /\/results\/\d+/.test(c));
    let country = null, team = null;
    for (let i = nameTdIdx + 1; i < tds.length; i++) {
      const c = tds[i];
      if (!country && /^[A-Z]{3}$/.test(c)) { country = c; continue; }
      if (!team && c && !/^[+\-\d:]+$/.test(c) && c.length > 3 && !/^[A-Z]{3}$/.test(c)) team = c;
    }
    // Fallback: el equipo también va en el <div> bajo el nombre (misma td).
    if (!team && nameTdIdx >= 0) {
      const divM = tdsRaw[nameTdIdx].match(/<div\b[^>]*>([\s\S]*?)<\/div>/i);
      if (divM) team = clean(stripTags(divM[1]));
    }

    if (irm) {
      rows.push({ rank: null, rankText: irm, bib, riderDisplay: name || null, teamName: team || null,
        country: country || null, resultValue: null, timeText: null, gapText: null, points: null, irm });
      continue;
    }
    const abs = normAbsTime(timeRaw);
    const gap = rank === 1 ? null : normGap(gapRaw);
    rows.push({
      rank, rankText: rank != null ? String(rank) : null, bib,
      riderDisplay: name || null, teamName: team || null, country: country || null,
      resultValue: rank === 1 ? abs : (gap || abs), timeText: rank === 1 ? abs : null,
      gapText: gap, points: null, irm: null,
    });
  }
  return rows;
}

// ── cliente HTTP ───────────────────────────────────────────────────────────
async function getHtml(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' } });
  if (!res.ok) { log(`  HTTP ${res.status} en ${path}`); return null; }
  return await res.text();
}

// deduce YYYY-MM-DD del catLabel "Elite Women (13. June)" si --date no se pasa.
export function dateFromCat(cat) {
  if (DATE_ARG) return DATE_ARG;
  const m = clean(cat).match(/\((\d{1,2})\.\s*([A-Za-z]+)\)/);
  if (!m) return null;
  const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  const mo = months[m[2].toLowerCase()];
  if (!mo) return null;
  const y = new Date().getUTCFullYear();
  return `${y}-${String(mo).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

// ── pipeline ───────────────────────────────────────────────────────────────
async function main() {
  checkArgs();
  mkdirSync(OUT, { recursive: true });
  log(`Fetcher sportstiming — event=${EVENT} cat="${CAT}" (puente sintético ${COMPETITION_ID}) · code="${CODE}" · idBase=${ID_BASE}`);

  const url = `/event/${EVENT}/results?cat=${encodeURIComponent(CAT)}`;
  let html;
  if (HTML_FILE) {
    html = readFileSync(HTML_FILE, 'utf8');
    log(`  (HTML local desde ${HTML_FILE}, ${html.length} bytes — anti-bot bypass)`);
  } else {
    html = await getHtml(url);
  }
  if (!html) { log(`FATAL: sportstiming no responde para ${url}`); process.exit(1); }

  let rows = parseRows(html);

  // Remapeo de dorsal (desfase sportstiming↔startlist UCI). Se aplica antes que
  // todo lo demás para que el resolve por dorsal case y la web enlace.
  if (REMAP.size) {
    for (const r of rows) {
      if (r.bib != null && REMAP.has(String(r.bib))) {
        const to = REMAP.get(String(r.bib));
        log(`  remap-bib: ${r.riderDisplay || '?'} #${r.bib} → #${to}`);
        r.bib = to;
      }
    }
  }

  // Inyección manual (corredores sin transponder). Solo si ese dorsal NO está ya
  // en el feed; se inserta en su rank y desplaza +1 los clasificados >= rank.
  for (const inj of INJECTS) {
    if (rows.some((r) => r.bib && String(r.bib) === inj.bib)) {
      log(`  inject: dorsal ${inj.bib} ya está en el feed → no se inyecta`);
      continue;
    }
    if (!rows.some((r) => r.rank != null)) {     // sin clasificación aún → no inyectar
      log(`  inject: aún sin clasificación publicada → ${inj.name} no se inyecta todavía`);
      continue;
    }
    for (const r of rows) if (r.rank != null && r.rank >= inj.rank) r.rank += 1;
    rows.push({
      rank: inj.rank, rankText: String(inj.rank), bib: inj.bib,
      riderDisplay: inj.name || null, teamName: inj.team || null, country: null,
      resultValue: inj.gap, timeText: null, gapText: inj.gap, points: null, irm: null,
    });
    rows.sort((a, b) => {
      if (a.irm && !b.irm) return 1;
      if (!a.irm && b.irm) return -1;
      return (a.rank ?? 1e9) - (b.rank ?? 1e9);
    });
    log(`  inject: ${inj.name} (#${inj.bib}) insertada como rank ${inj.rank}, desplazado el resto +1`);
  }

  const finishers = rows.filter((r) => r.rank != null);
  const dnfs = rows.filter((r) => r.irm);
  if (!finishers.length && !dnfs.length) {
    log('⚠️  0 filas — la clasificación de meta aún no está publicada (carrera en directo / no terminada).');
    // emitir JSON vacío con 0 etapas → el upsert no escribe (sin clasificaciones).
  }
  log(`  parseadas: ${rows.length} filas (${finishers.length} clasificados, ${dnfs.length} IRM)`);
  if (finishers[0]) log(`  ganador: #${finishers[0].bib} ${finishers[0].riderDisplay} (${finishers[0].teamName}) ${finishers[0].timeText}`);

  const stages = [];
  if (rows.length) {
    const winner = rows.find((r) => r.rank === 1);
    const cl = {
      eventId: synthEventId('stage', 'stage'),
      classKind: 'stage', scope: 'stage',
      eventName: 'Stage Classification',
      isTeamEvent: false,
      winnerName: winner ? winner.riderDisplay : null,
      rowCount: rows.length,
      rows,
    };
    stages.push({
      uciRaceId: synthRaceId(),
      stageNumber: null,                  // one_day: la jornada única (sin stageNumber)
      stageName: clean(CAT),
      isFinalClassification: false,
      dateKey: dateFromCat(CAT),
      raceType: null,
      startLocation: null,
      classificationCount: 1,
      classifications: [cl],
    });
  }

  const out = {
    competitionId: Number(COMPETITION_ID),
    disciplineId: 10,
    source: 'sportstiming',
    sportstimingEvent: String(EVENT),
    sportstimingCat: clean(CAT),
    sportstimingCode: CODE,
    fetchedAt: new Date().toISOString(),
    stageCount: stages.length,
    stages,
  };

  const file = join(OUT, `${COMPETITION_ID}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`\n✅ ${stages.length} clasificación(es), ${rows.length} filas → ${file}`);
  if (PRETTY) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

// Solo se ejecuta si se invoca como script; importarlo (tests) no dispara nada.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
}
