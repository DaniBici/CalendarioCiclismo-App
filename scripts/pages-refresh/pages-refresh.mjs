#!/usr/bin/env node
// Vigilante de Pages en el VPS (docs/runbooks/pages-refresh-vps.md).
//
//   node scripts/pages-refresh/pages-refresh.mjs [--state ruta.json] [--dry-run]
//
// Compara cada minuto la base de datos con la instantánea del tick anterior y
// lanza build-site.yml cuando una página publicada queda desfasada y ningún
// build posterior la cubre (scripts/pages-refresh/plan.mjs): incremental
// `stage_slugs` para páginas que solo rehace ese build (jornadas nuevas,
// <head> de inscritos) y dispatch `refresh` para los prerender. Sin
// instantánea previa, o con otra versión del estado, solo la guarda.
//
// - Base de datos: DATABASE_URL (rol cc_results_worker en el VPS) o, en local,
//   AGENT_DATABASE_URL del .env del checkout principal. Solo lectura.
// - GitHub: GITHUB_TOKEN con permiso de Actions (lectura y escritura) sobre
//   GITHUB_REPOSITORY. Sin él registra los cambios y no lanza nada.
// - Estado: $STATE_DIRECTORY/state.json (StateDirectory de systemd) o --state.
// - --dry-run: informa sin lanzar builds ni escribir el estado.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseUrl, loadEnv, withUrl } from '../db/env.mjs';
import {
  QUIET_MS, STATE_VERSION, coverDecision, emptyState, pageDecision, publishedStartlist, readsResults, snapshotChanges,
} from './plan.mjs';

const ORIGIN = 'https://calendariociclismo.app';
const WORKFLOW = 'build-site.yml';
const TIMEOUT_MS = 20_000;
// Jornadas nuevas: las de fechas anteriores no se crean con un incremental
// de última hora y pueden pertenecer a temporadas archivadas.
const STAGE_PAST_DAYS = 7;

const SQL = {
  // Carreras con lista, su página y la primera jornada publicada (incremental).
  inscritos: `select r.id, r.slug, r."startlistProvisional" as provisional,
                (select d.slug from race_days d
                  where d."raceId" = r.id and d."editorialStatus" = 'published' and d.slug is not null
                  order by d."dateKey", d.id limit 1) as "daySlug"
              from races r
              where exists (select 1 from startlist_teams t where t."raceId" = r.id)`,
  orden: `select d.id, d."startOrderImportedAt"::text as value from race_days d
          where d."editorialStatus" = 'published' and d."startOrderImportedAt" is not null`,
  // Documentos y datos del perfil y el mapa que pintan jornada, perfil y mapa.
  perfiles: `select d.id, md5(concat_ws('|', d."profileNotViewable", d."routeGpxUrl",
                md5(coalesce(d."elevationProfile"::text, '')), md5(coalesce(d."profileSummits"::text, '')),
                md5(coalesce(d."profileWaypoints"::text, '')),
                (select string_agg(a.type || ':' || a.url, ',' order by a.id) from assets a
                  where a."raceDayId" = d.id))) as value
             from race_days d where d."editorialStatus" = 'published'`,
  // Carreras cerradas (fuera de la ventana de sondeo, día de Madrid) con la
  // firma de resultados_signature() de site_data.py.
  resultados: `select r.id, md5(concat_ws('|', r."startlistImportedAt",
                  string_agg(concat_ws('|', s.id, s."updatedAt", s."rowCount", s."publicationStatus", s.updating),
                             ',' order by s.id))) as value
               from races r join race_uci_stages s on s."raceId" = r.id and s."keepForWeb" and s."rowCount" > 0
               where r.year is not null and r."startDate" is not null
                 and not ((now() at time zone 'Europe/Madrid')::date
                          between left(r."startDate", 10)::date - 1
                              and left(coalesce(r."endDate", r."startDate"), 10)::date + 1)
               group by r.id`,
  jornadas: `select d.slug from race_days d
             where d."editorialStatus" = 'published' and d.slug is not null
               and d."dateKey" >= to_char(current_date - ${STAGE_PAST_DAYS}, 'YYYY-MM-DD')
             order by d.slug`,
};

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function log(message) {
  console.log(message);
}

function readState(path) {
  if (!existsSync(path)) return emptyState();
  const state = JSON.parse(readFileSync(path, 'utf8'));
  return state.version === STATE_VERSION ? state : emptyState();
}

function writeState(path, state) {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

async function readDatabase() {
  loadEnv();
  const url = databaseUrl();
  if (!url) throw new Error('Falta DATABASE_URL (VPS) o AGENT_DATABASE_URL (local)');
  return withUrl(url, async client => {
    const rows = async sql => (await client.query(sql)).rows;
    const values = list => Object.fromEntries(list.map(row => [row.id, row.value]));
    const inscritos = await rows(SQL.inscritos);
    const orden = await rows(SQL.orden);
    const perfiles = await rows(SQL.perfiles);
    const resultados = await rows(SQL.resultados);
    const jornadas = await rows(SQL.jornadas);
    return {
      snapshot: {
        inscritos: Object.fromEntries(inscritos.map(row => [row.id, row.provisional === true])),
        orden: values(orden),
        perfiles: values(perfiles),
        resultados: values(resultados),
        jornadas: jornadas.map(row => row.slug),
      },
      races: new Map(inscritos.map(row => [row.id, row])),
    };
  });
}

function github(token, repository) {
  const request = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'calendariociclismo-pages-refresh',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub ${path.split('?')[0]}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  return {
    // Ejecuciones de build-site.yml en main creadas desde `since` (cualquier evento).
    async runs(since) {
      const query = new URLSearchParams({
        branch: 'main', per_page: '100', created: `>=${new Date(since).toISOString().replace(/\.\d+Z$/, 'Z')}`,
      });
      return (await request(`actions/workflows/${WORKFLOW}/runs?${query}`)).workflow_runs;
    },
    dispatch(inputs) {
      return request(`actions/workflows/${WORKFLOW}/dispatches`, {
        method: 'POST', body: JSON.stringify({ ref: 'main', inputs }),
      });
    },
  };
}

// La consulta lleva un parámetro distinto en cada tick: la caché de Pages no
// devuelve una versión guardada antes del despliegue.
async function fetchPage(path, now, method = 'GET') {
  const response = await fetch(`${ORIGIN}${path}?r=${now}`, {
    method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: response.status, html: method === 'GET' && response.ok ? await response.text() : '' };
}

/** Si la página publicada ya refleja la base de datos. */
async function pageCurrent(path, page, snapshot, now) {
  if (page.kind === 'jornada') return (await fetchPage(path, now, 'HEAD')).status === 200;
  const expected = snapshot.inscritos[page.raceId];
  const { status, html } = await fetchPage(path, now);
  const published = status === 200 ? publishedStartlist(html) : null;
  return !!published && published.title === expected && published.body === expected;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const statePath = option(argv, '--state')
    ?? (process.env.STATE_DIRECTORY ? join(process.env.STATE_DIRECTORY.split(':')[0], 'state.json') : null);
  if (!statePath) throw new Error('Falta --state o STATE_DIRECTORY');

  const state = readState(statePath);
  const now = Date.now();
  const { snapshot, races } = await readDatabase();
  const save = () => { if (!dryRun) writeState(statePath, state); };

  if (!state.seeded) {
    Object.assign(state, { snapshot, seeded: true });
    save();
    log(`Instantánea inicial: ${Object.keys(snapshot.inscritos).length} listas, ${Object.keys(snapshot.orden).length} órdenes, `
      + `${Object.keys(snapshot.perfiles).length} jornadas con perfil, ${Object.keys(snapshot.resultados).length} carreras cerradas, `
      + `${snapshot.jornadas.length} jornadas recientes`);
    return;
  }

  const changes = snapshotChanges(state.snapshot, snapshot);
  const pend = (key, reasons) => {
    state[key] = { changedAt: now, dispatches: state[key]?.dispatches ?? 0 };
    log(`Cambios (${key}): ${reasons.join('; ')}`);
  };
  const refresh = [...changes.refresh];
  for (const raceId of changes.inscritos) {
    const race = races.get(raceId);
    const label = `inscritos ${race.slug}: ${snapshot.inscritos[raceId] ? 'provisional' : 'oficial'}`;
    // Sin jornada publicada no hay incremental: el refresco pinta el cuerpo
    // y el <head> espera al build diario.
    if (!race.slug || !race.daySlug) { refresh.push(label); continue; }
    state.pages[`/inscritos/${race.slug}/`] = { kind: 'inscritos', raceId, slug: race.daySlug, seenAt: now, dispatches: 0 };
    log(`Cambio: ${label}`);
  }
  for (const slug of changes.jornadas) {
    state.pages[`/jornada/${slug}/`] = { kind: 'jornada', slug, seenAt: now, dispatches: 0 };
    log(`Jornada publicada: ${slug}`);
  }
  if (refresh.length) pend('refresh', refresh);
  if (changes.resultados.length) pend('results', changes.resultados.map(raceId => `resultados ${raceId}`));
  const published = new Set(snapshot.jornadas);
  for (const [path, page] of Object.entries(state.pages)) {
    const gone = page.kind === 'jornada' ? !published.has(page.slug) : !Object.hasOwn(snapshot.inscritos, page.raceId);
    if (gone) delete state.pages[path];
  }
  state.snapshot = snapshot;

  const paths = Object.keys(state.pages);
  if (!state.refresh && !state.results && !paths.length) return save();

  // Páginas: tras el lote, las que ya reflejan la base de datos dejan de estar pendientes.
  if (paths.length && now - Math.max(...paths.map(path => state.pages[path].seenAt)) >= QUIET_MS) {
    for (const path of paths) {
      if (await pageCurrent(path, state.pages[path], snapshot, now)) {
        delete state.pages[path];
        log(`Página al día: ${path}`);
      }
    }
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    save();
    log('Sin GITHUB_TOKEN: no se consulta ni se lanza build-site.yml');
    return;
  }
  const api = github(token, process.env.GITHUB_REPOSITORY || 'DaniBici/calendario-ciclismo');
  const since = Math.min(now, ...[state.refresh, state.results].filter(Boolean).map(pending => pending.changedAt),
    ...Object.values(state.pages).map(page => page.seenAt));
  const runs = await api.runs(since);

  const pages = pageDecision(state.pages, runs, now);
  for (const path of pages.abandon) {
    log(`::warning::Página desfasada tras ${state.pages[path].dispatches} incrementales: ${path}`);
    delete state.pages[path];
  }
  if (pages.slugs.length) {
    log(`Incremental: ${pages.slugs.join(',')} (${pages.dispatch.join(', ')})`);
    if (!dryRun) await api.dispatch({ stage_slugs: pages.slugs.join(',') });
    for (const path of pages.dispatch) state.pages[path].dispatches += 1;
  }

  // Un incremental lanzado en este tick cubre el refresco; los resultados,
  // solo un refresco o un build completo.
  const decide = (key, covers) => {
    if (!state[key]) return null;
    const decision = coverDecision(state[key], runs, now, covers);
    if (decision === 'covered') {
      log(`Cubierto por un build posterior al cambio (${key})`);
      state[key] = null;
    } else if (decision === 'abandon') {
      log(`::warning::Sin build correcto tras ${state[key].dispatches} dispatch (${key}); queda para el build diario`);
      state[key] = null;
    }
    return decision;
  };
  const refreshNeeded = decide('refresh') === 'dispatch' && !pages.slugs.length;
  const resultsNeeded = decide('results', readsResults) === 'dispatch';
  if (refreshNeeded || resultsNeeded) {
    log(`Refresco: dispatch de build-site.yml (${[refreshNeeded && 'refresh', resultsNeeded && 'results'].filter(Boolean).join(', ')})`);
    if (!dryRun) await api.dispatch({ refresh: true });
    if (refreshNeeded) state.refresh.dispatches += 1;
    if (resultsNeeded) state.results.dispatches += 1;
  }
  save();
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
