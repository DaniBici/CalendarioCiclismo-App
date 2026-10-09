import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { gunzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseUciTeamRoster } from '../results-fetchers/uci-team-roster.mjs';

export const CATEGORIES = Object.freeze({
  WTT: ['male', 'WT'], PRT: ['male', 'PT'], CTM: ['male', 'CT'],
  WTW: ['female', 'WWT'], PRW: ['female', 'PRW'], CTW: ['female', 'CTW'],
});
export const CATEGORIES_BY_YEAR = Object.freeze({
  2020: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'CTW']),
  2021: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'CTW']),
  2022: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'CTW']),
  2023: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'CTW']),
  2024: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'CTW']),
  2025: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'PRW', 'CTW']),
  2026: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'PRW', 'CTW']),
  2027: Object.freeze(['WTT', 'PRT', 'CTM', 'WTW', 'PRW', 'CTW']),
});
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const sha256 = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
export const madridDate = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export function parseRider(html) {
  const match = String(html).match(/data-component="RiderDetailsModule"[^>]*data-props="([^"]*)"/);
  if (!match) throw new Error('missing_rider_module');
  const data = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&'));
  const d = data.details;
  if (!d?.givenName || !d.familyName || (data.history != null && !Array.isArray(data.history.teams))) throw new Error('invalid_rider_schema');
  const dob = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d.dob || '');
  const birthDate = dob ? `${dob[3]}-${dob[2]}-${dob[1]}` : null;
  if (birthDate && new Date(`${birthDate}T00:00:00Z`).toISOString().slice(0, 10) !== birthDate) throw new Error('invalid_birth_date');
  return { givenName: d.givenName, familyName: d.familyName, nationality: d.nationality || null,
    birthDate, headerTeam: d.location || null, history: data.history?.teams || [] };
}

export function validateIndex(pages, year) {
  const expectedCategories = CATEGORIES_BY_YEAR[year];
  if (!expectedCategories) throw new Error('unsupported_category_year');
  const first = pages[0];
  if (!first || !Number.isInteger(first.totalItems) || first.totalItems < 5 || first.totalItems > 1000
    || !Number.isInteger(first.pageSize) || first.pageSize < 1 || first.pageSize > 100) throw new Error('invalid_index');
  const count = Math.ceil(first.totalItems / first.pageSize);
  if (pages.length !== count) throw new Error('incomplete_index');
  const seen = new Set();
  const teams = pages.flatMap((p, i) => {
    if (p.page !== i + 1 || p.totalItems !== first.totalItems || p.pageSize !== first.pageSize
      || !Array.isArray(p.items) || p.items.length !== Math.min(first.pageSize, first.totalItems - i * first.pageSize)) throw new Error('index_pagination_changed');
    return p.items.map(t => {
      const id = /^\/team-details\/(\d{1,10})$/.exec(t.url || '')?.[1];
      if (!id || seen.has(id) || !CATEGORIES[t.categoryName] || t.disciplineCode !== 'ROA' || !t.teamName) throw new Error('invalid_team_index');
      seen.add(id);
      return { uciTeamProfileId: id, teamName: t.teamName, teamCode: t.teamCode,
        countryCode: t.countryCode, categoryName: t.categoryName, gender: CATEGORIES[t.categoryName][0] };
    });
  });
  const actualCategories = [...new Set(teams.map(t => t.categoryName))].sort();
  const expected = [...expectedCategories].sort();
  if (actualCategories.length !== expected.length || actualCategories.some((value, index) => value !== expected[index])) {
    throw new Error('historical_division_mismatch');
  }
  return teams.sort((a, b) => a.uciTeamProfileId.localeCompare(b.uciTeamProfileId));
}

export function retryDelay(value, now = Date.now()) {
  if (!value) return 30000;
  const seconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(seconds) ? Math.max(1000, seconds) : 30000;
}

// Presupuestos globales, también para reintentos. Nunca se elude una denegación.
export class Collector {
  constructor({ directory, fetcher = fetch, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)),
    intervalMs = 1000, maxRequests = 6000, maxBytes = 256 * 1024 * 1024, maxMs = 120 * 60000,
    resumeManifest = [] } = {}) {
    Object.assign(this, { directory, fetcher, now, sleep, intervalMs, maxRequests, maxBytes, maxMs });
    this.started = now(); this.next = 0; this.gate = Promise.resolve(); this.stopped = false;
    this.stats = { requests: 0, cacheHits: 0, decodedBytes: 0, transferBytesUpperBound: 0, errors: 0 };
    this.manifest = [];
    this.resume = new Map(resumeManifest.filter(item => item?.status === 200 && item.path && item.sha256)
      .map(item => [item.path, item]));
  }
  async slot() {
    const previous = this.gate;
    let release; this.gate = new Promise(r => { release = r; });
    await previous;
    try {
      // Un 429 puede ampliar la pausa mientras otro slot ya está esperando.
      while (this.next > this.now()) {
        if (this.stopped || this.next - this.started >= this.maxMs) throw new Error('collection_budget_exhausted');
        await this.sleep(this.next - this.now());
      }
      if (this.stopped || this.stats.requests >= this.maxRequests || this.now() - this.started >= this.maxMs
        || this.stats.decodedBytes >= this.maxBytes) throw new Error('collection_budget_exhausted');
      this.next = this.now() + this.intervalMs; this.stats.requests++;
    } finally { release(); }
  }
  async get(path) {
    if (!/^\/(?:api\/teams\/ROA\/\d{4}\?page=\d+|team-details\/\d+|rider-details\/\d+)$/.test(path)) throw new Error('source_url_rejected');
    const cached = this.resume.get(path);
    if (cached && this.directory) {
      try {
        const body = gunzipSync(await readFile(join(this.directory, `${cached.sha256}.gz`)));
        if (sha256(body) !== cached.sha256 || body.byteLength !== cached.bytes) throw new Error('cache_mismatch');
        this.stats.cacheHits++; this.stats.decodedBytes += body.byteLength;
        this.manifest.push(cached);
        return { text: body.toString('utf8'), sha256: cached.sha256 };
      } catch (error) {
        if (error.message === 'cache_mismatch') throw error;
        this.resume.delete(path);
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.slot();
      let response;
      try {
        response = await this.fetcher(`https://www.uci.org${path}`, { redirect: 'error',
          signal: AbortSignal.timeout(Math.min(30000, this.maxMs - (this.now() - this.started))),
          headers: { 'User-Agent': 'calendariociclismo-bot/2.0 (+https://calendariociclismo.app)', 'Cache-Control': 'no-cache' } });
      } catch {
        this.stats.errors++;
        if (attempt === 2) throw new Error('uci_network_error');
        await this.sleep(2000 * (attempt + 1)); continue;
      }
      if ([401, 403, 429].includes(response.status)) {
        await response.body?.cancel(); this.stats.errors++;
        if (response.status !== 429) { this.stopped = true; throw new Error(`uci_denied_${response.status}`); }
        const wait = retryDelay(response.headers.get('retry-after'), this.now());
        this.next = Math.max(this.next, this.now() + wait);
        if (this.next - this.started >= this.maxMs || attempt === 2) { this.stopped = true; throw new Error('uci_rate_limited'); }
        continue;
      }
      if (response.status >= 500 && attempt < 2) {
        this.stats.errors++; await response.body?.cancel(); await this.sleep(3000 * (attempt + 1)); continue;
      }
      if (response.status !== 200) { this.stats.errors++; await response.body?.cancel(); throw new Error(`uci_http_${response.status}`); }
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.byteLength; this.stats.decodedBytes += chunk.byteLength;
        if (bytes > 2 * 1024 * 1024 || this.stats.decodedBytes > this.maxBytes) {
          this.stopped = true; throw new Error('uci_body_budget_exhausted');
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks); const hash = sha256(body);
      this.stats.transferBytesUpperBound += Number(response.headers.get('content-length')) || bytes;
      this.manifest.push({ path, observedAt: new Date(this.now()).toISOString(), status: 200, sha256: hash, bytes });
      if (this.directory) await writeFile(join(this.directory, `${hash}.gz`), gzipSync(body), { mode: 0o600 });
      return { text: body.toString('utf8'), sha256: hash };
    }
    throw new Error('uci_retries_exhausted');
  }
  async index(year) {
    const pages = [JSON.parse((await this.get(`/api/teams/ROA/${year}?page=1`)).text)];
    const p = pages[0];
    if (!Number.isInteger(p.totalItems) || p.totalItems < 5 || p.totalItems > 1000 || !Number.isInteger(p.pageSize) || p.pageSize < 1 || p.pageSize > 100) throw new Error('invalid_index');
    for (let n = 2; n <= Math.ceil(p.totalItems / p.pageSize); n++) pages.push(JSON.parse((await this.get(`/api/teams/ROA/${year}?page=${n}`)).text));
    return validateIndex(pages, year);
  }
  async collect(year, progress = () => {}) {
    if (this.directory) await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const teams = await this.index(year); const profiles = new Set(); const errors = [];
    await pool(teams, async t => {
      const page = await this.get(`/team-details/${t.uciTeamProfileId}`);
      const roster = parseUciTeamRoster(page.text);
      if (roster.details?.teamCode !== t.teamCode || roster.details?.teamName !== t.teamName) throw new Error('roster_index_mismatch');
      t.sha256 = page.sha256;
      t.riders = [...roster.regular, ...roster.trainees];
      t.rosterStatus = roster.regular.length ? 'published' : 'empty_at_source';
      t.sourceWebsite = roster.details?.website?.url || null;
      t.jerseyUrl = roster.details?.pictureTeamJersey || null;
      for (const r of t.riders) profiles.add(r.uciProfileId);
      progress(this.stats);
    });
    const riders = [];
    await pool([...profiles].sort(), async id => {
      try {
        const page = await this.get(`/rider-details/${id}`);
        riders.push({ uciProfileId: id, ...parseRider(page.text), sha256: page.sha256 });
      } catch (e) {
        if (this.stopped || /budget|rate_limited|denied/.test(e.message)) throw e;
        errors.push({ uciProfileId: id, code: e.message });
      }
      progress(this.stats);
    });
    const finalTeams = await this.index(year);
    const firstIndex = teams.map(({ riders, sha256, rosterStatus, sourceWebsite, jerseyUrl, ...t }) => t);
    if (sha256(firstIndex) !== sha256(finalTeams)) throw new Error('index_changed_during_capture');
    return { version: 1, year, startedAt: new Date(this.started).toISOString(), completedAt: new Date(this.now()).toISOString(),
      complete: true, teams, riders: riders.sort((a, b) => a.uciProfileId.localeCompare(b.uciProfileId)), errors,
      stats: this.stats, manifest: this.manifest };
  }
}

async function pool(items, fn) {
  let index = 0, error;
  await Promise.all([0, 1].map(async () => {
    while (!error && index < items.length) {
      const item = items[index++];
      try { await fn(item); } catch (e) { error ||= e; }
    }
  }));
  if (error) throw error;
}
