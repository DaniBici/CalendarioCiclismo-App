#!/usr/bin/env node
/**
 * uci-backfill-links.mjs — Backfill one-shot de race_uci_links (Fase 4 del plan,
 * PLAN-resultados-web.md §4). Enlaza en bloque las carreras de la temporada que
 * el MATCHER (uci-match-poc.mjs) resuelve de forma INEQUÍVOCA, dejando ambiguas
 * y sin-match para revisión manual (futuro botón del panel).
 *
 * NO re-implementa el matching: EJECUTA uci-match-poc.mjs como subproceso y lee
 * su match-report.json → una sola fuente de verdad para el matcher (si se afina
 * el matcher, el backfill hereda la mejora sin tocar nada).
 *
 * QUÉ ENLAZA
 *   Solo los `unique` DENTRO DEL HORIZONTE UCI (las carreras futuras aún no
 *   publicadas por la UCI no tienen candidato → se enlazarán en un backfill
 *   posterior, o por el panel, cuando la UCI las publique). Los `ambiguous` y
 *   `none` NUNCA se enlazan automáticamente → se reportan.
 *
 * REGLA DE ORO — NO PISA ENLACES EXISTENTES
 *   INSERT ... ON CONFLICT (raceId) DO NOTHING. Una carrera ya enlazada (por el
 *   upsert, o a mano desde el panel) se RESPETA y se cuenta como "ya enlazada".
 *   El backfill nunca degrada un enlace manual ni rompe uno con resultados.
 *   (--force permite re-enlazar pisando, pero por defecto: jamás.)
 *
 * autoMatched=true (lo puso el matcher, no un humano), syncStatus='pending'
 * (enlace creado; los resultados se traen después con el fetcher+upsert).
 *
 * Uso (desde la raíz del repo; fetch nativo; `pg` instalado con `npm i --no-save pg`):
 *   # JSON → SQL revisable
 *   node scripts/results-fetchers/uci-backfill-links.mjs --year 2026 --emit-sql out.sql
 *   # JSON → escribir directo a Postgres (DATABASE_URL del .env)
 *   node scripts/results-fetchers/uci-backfill-links.mjs --year 2026 --apply
 *   # reutilizar un match-report.json ya generado (no re-correr el matcher)
 *   node scripts/results-fetchers/uci-backfill-links.mjs --report <ruta> --apply
 *
 * Args:
 *   --year       temporada (default 2026). Se pasa al matcher.
 *   --slack      días de tolerancia de fechas para el matcher (default 1).
 *   --report     ruta de un match-report.json existente → NO re-corre el matcher.
 *   --apply      aplica a Postgres (DATABASE_URL). Sin esto → modo SQL.
 *   --emit-sql   ruta de salida del SQL (default <report dir>/backfill-links.sql). '-' = stdout.
 *   --force      re-enlaza pisando enlaces existentes (ON CONFLICT DO UPDATE). Úsese con cuidado.
 */
'use strict';

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

// Todo lo que este script invoca o escribe va anclado a SU directorio, no al cwd:
// con rutas relativas, ejecutarlo desde scripts/results-fetchers/ no encontraba
// el matcher (Cannot find module .../scripts/results-fetchers/scripts/...).
const HERE = dirname(fileURLToPath(import.meta.url));
const MATCHER = join(HERE, 'uci-match-poc.mjs');

// Si el consumidor del stdout cierra la tubería (p.ej. `| head`), no abortar con EPIPE.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const hasFlag = (n) => args.includes(`--${n}`);

const YEAR = parseInt(getArg('year') || '2026', 10);
const SLACK = getArg('slack') || '1';
const REPORT_IN = getArg('report');
const APPLY = hasFlag('apply');
const FORCE = hasFlag('force');
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

// seasonId road por año (espejo de uci-match-poc.mjs; solo para el metadato del link).
const ROAD_SEASON = { 2026: 464, 2025: 444, 2024: 432, 2023: 414, 2022: 159, 2021: 150 };

// ── obtener el match-report (reutilizar o generar vía el matcher canónico) ───
function loadReport() {
  if (REPORT_IN) {
    if (!existsSync(REPORT_IN)) { log(`FATAL: --report ${REPORT_IN} no existe`); process.exit(1); }
    log(`Reutilizando match-report: ${REPORT_IN}`);
    return { report: JSON.parse(readFileSync(REPORT_IN, 'utf8')), path: REPORT_IN };
  }
  // Ejecutar el matcher como subproceso → escribe match-report.json en su --out.
  const outDir = join(HERE, '_results_run', `match-${YEAR}`);
  log(`Ejecutando matcher (uci-match-poc.mjs) — año ${YEAR}, slack ${SLACK}d…`);
  execFileSync(process.execPath, [
    MATCHER,
    '--year', String(YEAR), '--slack', String(SLACK), '--out', outDir,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  const path = join(outDir, 'match-report.json');
  if (!existsSync(path)) { log(`FATAL: el matcher no generó ${path}`); process.exit(1); }
  return { report: JSON.parse(readFileSync(path, 'utf8')), path };
}

// ── construir el plan de statements ─────────────────────────────────────────
function buildPlan(report) {
  const seasonId = ROAD_SEASON[YEAR] ?? report.seasonId ?? null;

  // Enlazables = unique ∩ dentro del horizonte (con competitionId resuelto).
  const linkable = (report.unique || []).filter((r) => r.inHorizon && r.match && r.match.competitionId);
  const uniqueBeyond = (report.unique || []).filter((r) => !r.inHorizon).length; // futuras, aún sin publicar

  const conflict = FORCE
    ? `ON CONFLICT ("raceId") DO UPDATE SET
  "competitionId"=EXCLUDED."competitionId", "seasonId"=EXCLUDED."seasonId",
  "autoMatched"=TRUE, "updatedAt"=now()`
    : `ON CONFLICT ("raceId") DO NOTHING`;

  const plan = linkable.map((r) => ({
    raceId: r.our.id,
    competitionId: r.match.competitionId,
    note: `«${r.our.name}» → #${r.match.competitionId} ${r.match.uciName} [${r.match.uciClass}]${r.match.note ? ' ('+r.match.note+')' : ''}`,
    text: `INSERT INTO public.race_uci_links
  ("raceId","competitionId","disciplineId","seasonId","autoMatched","syncStatus")
VALUES ($1,$2,10,$3,TRUE,'pending')
${conflict}`,
    params: [r.our.id, r.match.competitionId, seasonId],
  }));

  return {
    plan,
    seasonId,
    counts: {
      linkable: linkable.length,
      ambiguous: (report.ambiguous || []).length,
      noneWithinHorizon: report.counts?.noneWithinHorizon ?? null,
      uniqueBeyondHorizon: uniqueBeyond,
    },
    ambiguous: report.ambiguous || [],
    noneWithin: (report.none || []).filter((r) => r.inHorizon),
  };
}

// ── serializar a SQL literal (modo --emit-sql) ──────────────────────────────
function lit(v) {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function toSQL({ text, params }) {
  return text.replace(/\$(\d+)/g, (_, d) => lit(params[Number(d) - 1]));
}

function loadEnv() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8').split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
  );
}

// ── informe de lo que queda para revisión manual (panel, Fase 4b) ───────────
function printPending(res) {
  if (res.ambiguous.length) {
    log(`\n⚠️  AMBIGUAS (${res.ambiguous.length}) — revisar a mano (≥2 candidatos):`);
    res.ambiguous.slice(0, 40).forEach((r) => {
      log(`  «${r.our.name}» [${r.our.class}/${r.our.gender}] ${r.our.dates[0]}→${r.our.dates[1]}`);
      (r.candidates || []).forEach((c) => log(`      ${c.classMatch ? '✓' : ' '}clase ${String(c.uciClass).padEnd(6)} sim=${c.nameSim}  #${c.competitionId} ${c.uciName}`));
    });
  }
  if (res.noneWithin.length) {
    log(`\n∅  SIN MATCH dentro del horizonte (${res.noneWithin.length}) — carrera no-road UCI o sin equivalente:`);
    res.noneWithin.slice(0, 40).forEach((r) => log(`  «${r.our.name}» [${r.our.class}/${r.our.gender}] ${r.our.dates[0]}→${r.our.dates[1]} (${r.our.country})`));
  }
}

async function main() {
  const { report, path } = loadReport();
  const res = buildPlan(report);
  const { plan, counts } = res;

  if (!plan.length) {
    log('No hay carreras enlazables (unique ∩ horizonte). Nada que hacer.');
    printPending(res);
    return;
  }

  if (!APPLY) {
    // ── modo SQL ──
    const out = [
      '-- ════════════════════════════════════════════════════════════════',
      `-- BACKFILL race_uci_links — año ${YEAR} (desde ${path})`,
      `-- ${counts.linkable} carreras enlazables (unique ∩ horizonte).`,
      `-- ${FORCE ? 'FORCE: pisa enlaces existentes.' : 'ON CONFLICT DO NOTHING: respeta enlaces existentes.'}`,
      '-- ════════════════════════════════════════════════════════════════',
      'BEGIN;',
      '',
    ];
    for (const st of plan) { out.push(`-- ${st.note}`); out.push(toSQL(st) + ';'); }
    out.push('', 'COMMIT;');
    const sql = out.join('\n');
    const OUT_SQL = getArg('emit-sql') || join(dirname(path), 'backfill-links.sql');
    if (OUT_SQL === '-') process.stdout.write(sql + '\n');
    else { mkdirSync(dirname(OUT_SQL), { recursive: true }); writeFileSync(OUT_SQL, sql); log(`✅ ${counts.linkable} INSERT → ${OUT_SQL}`); }
    log(`\nResumen: ${counts.linkable} enlazables · ${counts.ambiguous} ambiguas · ${counts.noneWithinHorizon ?? '?'} sin-match(horizonte) · ${counts.uniqueBeyondHorizon} futuras (aún sin publicar)`);
    printPending(res);
    return;
  }

  // ── modo apply ──
  const env = { ...loadEnv(), ...process.env };
  const url = env.DATABASE_URL;
  if (!url) { log('FATAL: --apply necesita DATABASE_URL (en .env o entorno)'); process.exit(1); }
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const st of plan) {
      const r = await client.query(st.text + ' RETURNING "raceId"', st.params);
      inserted += r.rowCount; // 0 si ON CONFLICT DO NOTHING no insertó (ya existía)
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    log('FATAL en apply (rollback hecho): ' + (e.message || e));
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
  const skipped = counts.linkable - inserted;
  log(`✅ aplicado: ${inserted} enlaces nuevos` + (skipped > 0 ? `, ${skipped} ya existían (respetados)` : '') + (FORCE ? ' [FORCE]' : ''));
  log(`   pendiente revisión manual: ${counts.ambiguous} ambiguas · ${counts.noneWithinHorizon ?? '?'} sin-match · ${counts.uniqueBeyondHorizon} futuras (aún sin publicar)`);
  printPending(res);
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
