#!/usr/bin/env node
// Spike de solo lectura. No accede a Supabase ni importa calendarios/resultados.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] || '/tmp/cc-cx-f1-spike');
mkdirSync(out, { recursive: true });
const base = 'https://dataride.uci.ch';
const headers = {
  'User-Agent': 'calendariociclismo-bot/1.0 (+https://calendariociclismo.app)',
  'X-Requested-With': 'XMLHttpRequest',
};
const seed = await fetch(base, { headers });
const cookie = seed.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
let requests = 0;
async function request(path, form, authenticatedSession = false) {
  const response = await fetch(`${base}/iframe/${path}`, {
    headers: { ...headers, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(authenticatedSession ? { Cookie: cookie } : {}) },
    ...(form ? { method: 'POST', body: new URLSearchParams(form) } : {}),
  });
  requests++;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const raw = await response.text();
  try { return JSON.parse(raw); } catch { throw new Error(`${path}: HTTP ${response.status}, respuesta no JSON: ${raw.slice(0, 100)}`); }
}
const paging = { take: '500', skip: '0', page: '1', pageSize: '500' };
const seasons = await request('GetDisciplineSeasons/?disciplineId=3');
const resume = process.argv.includes('--resume') && existsSync(`${out}/catalogs.json`);
const catalogSnapshot = resume ? JSON.parse(readFileSync(`${out}/catalogs.json`)) : null;
const catalogs = catalogSnapshot?.catalogs || [];
for (const seasonId of resume ? [] : [472, 455]) {
  const competitions = await request('Competitions/', {
    disciplineId: '3', ...paging, 'sort[0][field]': 'StartDate', 'sort[0][dir]': 'desc',
    'filter[filters][0][field]': 'RaceTypeId', 'filter[filters][0][value]': '0',
    'filter[filters][1][field]': 'CategoryId', 'filter[filters][1][value]': '0',
    'filter[filters][2][field]': 'SeasonId', 'filter[filters][2][value]': String(seasonId),
  });
  if (competitions.total > competitions.data.length) throw new Error('Catálogo paginado: ampliar spike');
  catalogs.push({ seasonId, competitions });
}
if (!resume) writeFileSync(`${out}/catalogs.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), seasons, catalogs }, null, 2));
console.log(JSON.stringify(catalogs.map(c => ({ seasonId: c.seasonId, total: c.competitions.total,
  fields: Object.keys(c.competitions.data[0] || {}), examples: c.competitions.data.slice(0, 3),
  classes: [...new Set(c.competitions.data.map(x => x.ClassCode))] })), null, 2));
const sampleSnapshot = resume && existsSync(`${out}/samples.json`) ? JSON.parse(readFileSync(`${out}/samples.json`)) : null;
const samples = sampleSnapshot?.samples || [];
const previousRequests = sampleSnapshot?.requests || 0;
for (const catalog of catalogs) {
  const selected = new Map();
  for (const competition of catalog.competitions.data) {
    if (catalog.seasonId === 472) selected.set(competition.CompetitionId, competition);
    for (const cls of (competition.ClassCode || '').split(/[,/]/).map(x => x.trim())) {
      if (!selected.has(cls)) selected.set(cls, competition);
    }
    if (/world.*champ|continental|european|koppenberg|tabor|tábor|spain/i.test(competition.CompetitionName)) selected.set(competition.CompetitionId, competition);
    if (competition.CountryIsoCode2 === 'ES' && !selected.has('ES')) selected.set('ES', competition);
    if (/Copa de Espa[nñ]a/i.test(competition.CompetitionName) && !selected.has('Copa')) selected.set('Copa', competition);
  }
  const competitions = [...new Map([...selected.values()].map(c => [c.CompetitionId, c])).values()];
  for (const competition of competitions) {
    if (samples.some(s => s.seasonId === catalog.seasonId && s.competition.CompetitionId === competition.CompetitionId)) continue;
    const races = await request('Races/', { disciplineId: '3', competitionId: String(competition.CompetitionId), ...paging });
    if (races.total !== races.data.length) throw new Error('Races incompleto: paginar');
    const sample = { fetchedAt: new Date().toISOString(), seasonId: catalog.seasonId, competition, races, events: [] };
    for (const race of races.data) {
      const events = await request('Events/', { disciplineId: '3', raceId: String(race.Id) }, true);
      const cold = sample.events.length === 0 ? await request('Events/', { disciplineId: '3', raceId: String(race.Id) }) : undefined;
      const entry = { raceId: race.Id, events, ...(cold ? { withoutCookie: cold } : {}), results: [] };
      for (const event of events) {
        const results = await request('Results/', { disciplineId: '3', eventId: String(event.EventId), ...paging });
        if (results.total !== results.data.length) throw new Error('Results incompleto: paginar');
        entry.results.push({ eventId: event.EventId, results });
      }
      sample.events.push(entry);
    }
    samples.push(sample);
    writeFileSync(`${out}/samples.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), requests: previousRequests + requests, samples }, null, 2));
    const rows = sample.events.reduce((n,e) => n + e.results.reduce((m,r) => m + r.results.data.length, 0), 0);
    console.log(`season ${catalog.seasonId}: ${competition.CompetitionId} ${competition.CompetitionName} ${competition.ClassCode}: ${races.data.length} races, ${rows} result rows`);
  }
}
console.log(`Evidencia: ${out}; ${requests} peticiones`);
