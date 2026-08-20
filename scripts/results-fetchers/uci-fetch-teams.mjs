#!/usr/bin/env node
/**
 * uci-fetch-teams.mjs — Descarga la lista oficial de equipos de carretera 2026 de la
 * API JSON de la UCI y filtra los Continental (CTM = masc, CTW = fem).
 *
 * Fuente: https://www.uci.org/api/teams/ROA/2026?page=N  (paginado, pageSize 25)
 *   Cada item: { teamName, teamCode, countryCode (ISO-3), url:"/team-details/<id>",
 *                disciplineCode:"ROA", categoryName: "WTT"|"WTW"|"PRT"|"PRW"|"CTM"|"CTW" }
 *
 * Sin Cloudflare (es una API JSON), pero usamos Playwright para reutilizar el contexto de
 * navegador: algunos edges de la UCI piden visitar el origen antes de servir la API, y así
 * heredamos sus cookies. Salida: JSON con TODOS los equipos + un subconjunto Continental.
 *
 * Uso (desde la raíz del repo):
 *   node scripts/results-fetchers/uci-fetch-teams.mjs --year 2026 \
 *     --out scripts/results-fetchers/_riders_run/uci-teams.json
 */
'use strict';

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
const getArg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i !== -1 ? args[i + 1] : d; };
const YEAR = parseInt(getArg('year') || '2026', 10);
const OUT = getArg('out');
const UA = 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto('https://www.uci.org/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1000);

  const all = [];
  let pageNo = 1, total = Infinity;
  while (all.length < total) {
    const url = `https://www.uci.org/api/teams/ROA/${YEAR}?page=${pageNo}`;
    const resp = await page.request.get(url, { timeout: 30000 });
    if (resp.status() !== 200) { log(`  page ${pageNo}: HTTP ${resp.status()} — stop`); break; }
    const j = JSON.parse(await resp.text());
    total = j.totalItems;
    for (const it of j.items) all.push(it);
    log(`  page ${pageNo}: +${j.items.length} (acum ${all.length}/${total})`);
    if (j.items.length === 0) break;
    pageNo++;
    await sleep(250);
  }
  await browser.close();

  const idFromUrl = (u) => { const m = String(u || '').match(/\/team-details\/(\d+)/); return m ? m[1] : null; };
  const teams = all.map((t) => ({ ...t, uciId: idFromUrl(t.url) }));
  const continental = teams.filter((t) => t.categoryName === 'CTM' || t.categoryName === 'CTW');
  const byCat = {};
  for (const t of teams) byCat[t.categoryName] = (byCat[t.categoryName] || 0) + 1;

  const out = { year: YEAR, total: teams.length, byCategory: byCat, teams, continental };
  if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 1)); log(`\nJSON → ${OUT}`); }
  log(`\nRESUMEN: total=${teams.length}  porCategoría=${JSON.stringify(byCat)}  continental(CTM+CTW)=${continental.length}`);
}

main().catch((e) => { log('FATAL: ' + (e.stack || e.message)); process.exit(1); });
