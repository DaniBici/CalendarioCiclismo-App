#!/usr/bin/env node
// Paridad local del prerender de jornadas, inscritos, resultados, perfiles,
// mapas y órdenes de salida (solo en local, nunca en CI). Obligatoria antes de
// integrar un cambio de js/jornada-html.js, js/inscritos-html.js,
// js/resultados-html.js, js/perfil-mapa-html.js, js/orden-salida-html.js o de
// sus dependencias (docs/runbooks/pages-build-selectivo.md).
//
//   node tools/site/check-prerender-parity.mjs --data datos.json --work <dir> \
//     [--page jornada|inscritos|resultados|perfil|mapa|orden] [--lang es|en] [--timezone <zona>] [--count 20] [--seed <n>] \
//     [--slugs a,b] [--since AAAA-MM-DD] [--chrome <ruta>]
//   node tools/site/check-prerender-parity.mjs --work <dir> --reuse 1 [--page inscritos] [--lang en] [--timezone <zona>]
//
// 1. Compone <dir>/_site como CI: fuentes públicas, js/config.js del checkout
//    principal y las páginas publicadas elegidas del tipo (--page, jornada por
//    defecto) y del idioma (calendariociclismo.app/jornada/<slug>/,
//    /en/stage/<slugEn>/, /inscritos/<slug>/, /en/startlist/<slugEn>/,
//    /resultados/<slug>/[<etapa>/], /perfil/<slug>/, /mapa/<slug>/ u
//    /orden-salida/<slug>/, HTML de gen_og_pages.py). --slugs lleva los slugs
//    de las páginas de ese idioma (en resultados, con la etapa:
//    giro-de-italia-2026/etapa-10).
// 2. Ejecuta el prerender del tipo (prerender-jornadas.mjs,
//    prerender-inscritos.mjs, prerender-resultados.mjs o
//    prerender-auxiliares.mjs con su tipo; ámbito es o all, --data; --since
//    solo en inscritos), bundle_assets.mjs y version_assets.py
//    con el mapa de precargas. En resultados, las páginas que el prerender deja
//    fuera de su ámbito (sin cerrar, CRE…) se descartan de la muestra.
// 3. Sirve <dir>/_site en 127.0.0.1 y carga cada página en Chrome sin interfaz
//    (perfil temporal en <dir>), en móvil y escritorio. Zona: --timezone o la
//    del build del idioma (ES Europe/Madrid, EN Etc/GMT).
//
// Con --reuse se omiten 1 y 2 y se cargan las páginas del tipo de <dir>/_site.
//
// Falla si una página no se generó, si hay errores en consola o si alguna
// hora (<time datetime>) no sale en la zona del navegador, con «GMT» solo en
// EN y en una zona sin desplazamiento en todo el año. En la zona del build
// falla además si el navegador repinta el contenido o la cabecera generados
// (la huella no coincide); en otra zona el repintado de una jornada, un
// perfil, un mapa o un orden de salida es el esperado. Inscritos y resultados
// no dependen de la zona: fallan si repintan en cualquiera. En resultados se comprueban además los huecos (filas de la
// tabla, aviso de publicación, estado y filtro por equipo), que deben seguir
// siendo los generados; la lista de datos de la jornada lleva la hora de
// salida en la zona del navegador y puede sustituirse.
// `datos.json`: volcado del .sql del prerender del tipo, tomado justo antes; el
// navegador lee los datos vigentes y un cambio intermedio se ve como repintado.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDump } from './prerender-jornadas.mjs';
import { candidateRaces } from './prerender-resultados.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGIN = 'https://calendariociclismo.app';
const SOURCES = ['index.html', 'js', 'css', 'fonts', 'flags', 'i18n', 'favicon.ico', 'favicon.svg', 'favicon-16x16.png',
  'favicon-32x32.png', 'favicon-96x96.png', 'apple-touch-icon.png', 'manifest.json'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
const VIEWPORTS = {
  movil: { width: 412, height: 823, deviceScaleFactor: 2.625, mobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' },
  escritorio: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false, userAgent: null },
};
// Por tipo de página: prerender, slugs del volcado, selector del aviso de
// error, si la huella depende de la zona y, por idioma, directorio,
// contenedor, zona del build y configuración regional del navegador.
const PAGES = {
  jornada: {
    script: 'tools/site/prerender-jornadas.mjs',
    slugs: (data, lang) => data.days.filter(day => day.slug).map(day => (lang === 'en' ? day.slugEn || day.slug : day.slug)),
    failed: '.empty-state',
    zoned: true,
    langs: {
      es: { dir: 'jornada', container: 'jornadaContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
      en: { dir: 'en/stage', container: 'jornadaContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  inscritos: {
    script: 'tools/site/prerender-inscritos.mjs',
    slugs: (data, lang) => data.races.map(race => (lang === 'en' ? race.slugEn : race.slug)).filter(Boolean),
    failed: '.startlist-empty',
    zoned: false,
    langs: {
      es: { dir: 'inscritos', container: 'inscritosContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
      en: { dir: 'en/startlist', container: 'startlistContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  resultados: {
    script: 'tools/site/prerender-resultados.mjs',
    slugs: resultPaths,
    // Error de carga (init) o de lectura de filas; «sin datos» es contenido.
    failed: '[data-initial-retry], .res-update-note',
    // La hora de salida es un hueco aparte (datos de la jornada): el resto no
    // depende de la zona.
    zoned: false,
    // Huecos generados que deben conservarse con la huella.
    slots: ['#resTableWrap tbody tr', '#resPublication > *', '#resStatusSlot > *', '#resTeamFilter'],
    // Sin máximo de lecturas: ninguna página de la muestra queda pendiente de relleno.
    args: data => ['--max-reads', String(candidateRaces(data.races, data.resultados_stages).length)],
    langs: {
      es: { dir: 'resultados', container: 'resultsContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
    },
  },
  // Perfil, mapa y orden de salida (prerender-auxiliares.mjs, solo ES): el
  // volcado es el de prerender-auxiliares.sql y el ámbito, el tipo.
  perfil: {
    script: 'tools/site/prerender-auxiliares.mjs',
    slugs: data => data.days.filter(day => day.slug && day.elevationProfile && !day.profileNotViewable).map(day => day.slug),
    failed: '.pfe-loading',
    zoned: true,
    langs: { es: { dir: 'perfil', container: 'perfilEtapaContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'perfil' } },
  },
  mapa: {
    script: 'tools/site/prerender-auxiliares.mjs',
    slugs: data => data.days.filter(day => day.slug && day.routeGpxUrl).map(day => day.slug),
    failed: '.pfe-loading',
    zoned: true,
    langs: { es: { dir: 'mapa', container: 'mapaEtapaContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'mapa' } },
  },
  orden: {
    script: 'tools/site/prerender-auxiliares.mjs',
    slugs: data => data.days.filter(day => day.slug && day.startOrderImportedAt).map(day => day.slug),
    failed: '.startlist-empty',
    zoned: true,
    langs: { es: { dir: 'orden-salida', container: 'startOrderContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'orden' } },
  },
};

// Rutas de resultados de las carreras candidatas del volcado
// (prerender-resultados.sql) con todas sus clasificaciones oficiales: la de la
// carrera y una por etapa (prólogo, etapa-N), sin las CRE.
function resultPaths(data) {
  const official = new Map();
  for (const stage of data.resultados_stages) {
    official.set(stage.raceId, (official.get(stage.raceId) ?? true) && stage.publicationStatus === 'official' && !stage.updating);
  }
  const races = new Map(data.races.map(race => [race.id, race]));
  const paths = [];
  for (const raceId of candidateRaces(data.races, data.resultados_stages)) {
    const race = races.get(raceId);
    if (!race.slug || !official.get(raceId)) continue;
    paths.push(race.slug);
    if (race.raceFormat === 'one_day') continue;
    for (const day of data.race_days) {
      if (day.raceId !== raceId || day.isRestDay || day.stageNumber == null || day.primaryType === 'ttt') continue;
      paths.push(`${race.slug}/${day.stageNumber === 0 ? 'prologo' : `etapa-${day.stageNumber}`}`);
    }
  }
  return [...new Set(paths)];
}
const pagePath = slug => slug.split('/').map(encodeURIComponent).join('/');
const CHROME_PATHS = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium'];

function parseArgs(argv) {
  const options = { count: '20', lang: 'es', page: 'jornada' };
  for (let at = 0; at < argv.length; at++) {
    if (argv[at].startsWith('--')) options[argv[at].slice(2)] = argv[++at];
  }
  return options;
}

// Muestra reproducible: mulberry32 con la semilla indicada.
function shuffled(items, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const list = [...items];
  for (let at = list.length - 1; at > 0; at--) {
    const other = Math.floor(random() * (at + 1));
    [list[at], list[other]] = [list[other], list[at]];
  }
  return list;
}

async function composeSite(site, data, options, page, lang) {
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  for (const source of SOURCES) {
    cpSync(join(ROOT, source), join(site, source), { recursive: true, filter: path => !path.split(sep).includes('__tests__') });
  }
  const main = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim());
  const config = join(main, 'js/config.js');
  if (!existsSync(config)) throw new Error(`Falta ${config}: la página necesita la configuración pública de Supabase`);
  cpSync(config, join(site, 'js/config.js'));
  const slugs = options.slugs
    ? options.slugs.split(',').map(slug => slug.trim()).filter(Boolean)
    : shuffled(page.slugs(data, options.lang).sort(), Number(options.seed));
  const wanted = options.slugs ? slugs.length : Number(options.count);
  const pages = [];
  for (const slug of slugs) {
    if (pages.length === wanted) break;
    const response = await fetch(`${ORIGIN}/${lang.dir}/${pagePath(slug)}/`);
    if (!response.ok) {
      console.log(`  ${slug}: ${response.status} en producción, se descarta`);
      continue;
    }
    mkdirSync(join(site, lang.dir, slug), { recursive: true });
    writeFileSync(join(site, lang.dir, slug, 'index.html'), await response.text());
    pages.push(slug);
  }
  return pages;
}

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}

function serve(site) {
  const server = createServer((request, response) => {
    let path = normalize(join(site, decodeURIComponent(new URL(request.url, 'http://localhost').pathname)));
    if (!path.startsWith(site)) return response.writeHead(403).end();
    if (existsSync(path) && !extname(path)) path = join(path, 'index.html');
    if (!existsSync(path)) return response.writeHead(404).end('not found');
    response.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    response.end(readFileSync(path));
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

async function launchChrome(chrome, profile) {
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const child = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let wait = 0; !existsSync(portFile) || !readFileSync(portFile, 'utf8').includes('\n'); wait++) {
    if (wait > 100) throw new Error('Chrome no abrió el puerto de depuración');
    await new Promise(done => setTimeout(done, 100));
  }
  return { child, port: readFileSync(portFile, 'utf8').split('\n')[0] };
}

async function openTab(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener('open', done, { once: true }));
  let sequence = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  const send = (method, params = {}) => new Promise(done => {
    const id = ++sequence;
    pending.set(id, done);
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, listeners, close: () => socket.close() };
}

// Antes de los módulos (readyState «interactive»), guarda el primer hijo de
// <main>, la cabecera y los huecos (`slots`) generados y cuenta los hijos
// directos que se retiran: conservar el DOM no retira ninguno; repintar los
// retira todos.
const observer = (container, slots = []) => `(() => {
  const state = window.__ccParity = { generated: false, removed: 0, first: null, header: null, slots: [] };
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const main = document.getElementById(${JSON.stringify(container)});
    if (!main) return;
    state.generated = main.hasAttribute('data-prerendered');
    state.first = main.firstElementChild;
    state.header = document.querySelector('#siteHeader .site-header__inner');
    state.slots = ${JSON.stringify(slots)}.map(selector => [selector, main.querySelector(selector)]).filter(([, node]) => node);
    new MutationObserver(records => { for (const record of records) state.removed += record.removedNodes.length; })
      .observe(main, { childList: true });
  });
  try { localStorage.setItem('cc_apps_popup_dismissed', '1'); } catch (error) {}
})()`;

// Resuelve cuando render() ha decidido (retira data-prerendered en ambos
// casos) y la página lleva 1,5 s sin más cambios. `times`: horas cuyo texto no
// es el de su datetime en la zona del navegador (con « GMT» en EN si la zona no
// tiene desplazamiento en enero ni en julio).
const settled = (lang, container, failed) => `new Promise(resolve => {
  const started = performance.now();
  const year = new Date().getFullYear();
  const label = ${JSON.stringify(lang)} === 'en' && [0, 6].every(month => !new Date(year, month, 1).getTimezoneOffset()) ? ' GMT' : '';
  const report = timeout => {
    const state = window.__ccParity;
    const main = document.getElementById(${JSON.stringify(container)});
    const times = [...(main?.querySelectorAll('time[datetime]') || [])].map(time => {
      const expected = new Date(time.dateTime).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) + label;
      return time.textContent === expected ? null : \`«\${time.textContent}» en lugar de «\${expected}»\`;
    }).filter(Boolean);
    return JSON.stringify({ timeout, generated: state.generated, removed: state.removed,
      kept: !!state.first?.isConnected, headerKept: !!state.header?.isConnected,
      slotsRepainted: state.slots.filter(([, node]) => !node.isConnected).map(([selector]) => selector),
      failed: !!main?.querySelector(${JSON.stringify(failed)}), times });
  };
  const tick = () => {
    const main = document.getElementById(${JSON.stringify(container)});
    // Retiradas todas las marcas: la del contenido y las de sus huecos.
    if (main && !main.hasAttribute('data-prerendered') && !main.querySelector('[data-prerendered]')) return setTimeout(() => resolve(report(false)), 1500);
    if (performance.now() - started > 20000) return resolve(report(true));
    setTimeout(tick, 100);
  };
  tick();
})`;

// Problemas de la carga y si el navegador conservó el contenido generado.
// `keep`: zona del build, donde repintar es un fallo.
async function checkPage(tab, url, { lang, keep, container, failed }) {
  const errors = [];
  const listener = message => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) {
      errors.push(message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' '));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(`${message.params.entry.text} ${message.params.entry.url || ''}`.trim());
  };
  tab.listeners.add(listener);
  const loaded = new Promise(done => {
    const onLoad = message => { if (message.method === 'Page.loadEventFired') { tab.listeners.delete(onLoad); done(); } };
    tab.listeners.add(onLoad);
  });
  await tab.send('Page.navigate', { url });
  await loaded;
  const { result } = await tab.send('Runtime.evaluate', { expression: settled(lang, container, failed), awaitPromise: true, returnByValue: true });
  tab.listeners.delete(listener);
  const state = JSON.parse(result?.result?.value || '{}');
  const problems = [];
  if (!state.generated) problems.push('sin contenido generado');
  if (state.timeout) problems.push('render() no terminó');
  if (state.failed) problems.push('error al cargar la página');
  const kept = state.generated && state.kept && !state.removed && !state.slotsRepainted?.length;
  if (keep && state.generated && !kept) problems.push(`repintado (${state.removed} nodos retirados${state.slotsRepainted?.length ? `; huecos ${state.slotsRepainted.join(', ')}` : ''})`);
  if (keep && state.generated && !state.headerKept) problems.push('cabecera repintada');
  problems.push(...(state.times || []).slice(0, 3).map(time => `hora ${time}`));
  problems.push(...errors.map(error => `consola: ${error}`));
  return { problems, kept };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options.work || (!options.data && !options.reuse)) {
    throw new Error('Uso: check-prerender-parity.mjs --data datos.json --work <dir> [--page jornada|inscritos|resultados|perfil|mapa|orden] [--lang es|en] [--timezone zona] [--count 20] [--seed n] [--slugs a,b] [--since AAAA-MM-DD] [--chrome ruta] | --work <dir> --reuse 1 [--page inscritos] [--lang en] [--timezone zona]');
  }
  const page = PAGES[options.page];
  if (!page) throw new Error(`Tipo de página no admitido: «${options.page}» (jornada, inscritos, resultados, perfil, mapa u orden)`);
  const lang = page.langs[options.lang];
  if (!lang) throw new Error(`Idioma no admitido: «${options.lang}» (es o en)`);
  const timeZone = options.timezone || lang.timeZone;
  const keep = !page.zoned || timeZone === lang.timeZone;
  options.seed ??= String(Date.now() % 1e6);
  const work = resolve(options.work);
  const site = join(work, '_site');
  const preloadMap = join(work, '.module-preload.json');
  let slugs;
  if (options.reuse) {
    slugs = readdirSync(join(site, lang.dir)).sort();
    if (page.slots) {
      slugs = slugs.flatMap(slug => [slug, ...readdirSync(join(site, lang.dir, slug), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => `${slug}/${entry.name}`)])
        .filter(slug => existsSync(join(site, lang.dir, slug, 'index.html')));
    }
  } else {
    console.log(`Componiendo ${site} (${options.page}, ${options.lang}, semilla ${options.seed})`);
    const data = readDump(options.data);
    slugs = await composeSite(site, data, options, page, lang);
    run(process.execPath, [join(ROOT, page.script), site, '--scope', lang.scope, '--data', resolve(options.data),
      ...(options.since ? ['--since', options.since] : []), ...(page.args?.(data) ?? [])]);
    if (page.slots) {
      // Resultados: las páginas fuera del ámbito del prerender salen de la muestra.
      const generated = slugs.filter(slug => readFileSync(join(site, lang.dir, slug, 'index.html'), 'utf8').includes('data-prerendered'));
      for (const slug of slugs) if (!generated.includes(slug)) console.log(`  ${slug}: fuera del ámbito del prerender, se descarta`);
      slugs = generated;
    }
    run(process.execPath, [join(ROOT, 'tools/site/bundle_assets.mjs'), site, '--preload-map', preloadMap]);
    run('python3', [join(ROOT, 'tools/site/version_assets.py'), site, '--preload-map', preloadMap]);
  }

  const chrome = options.chrome || process.env.CHROME_PATH || CHROME_PATHS.find(path => existsSync(path));
  if (!chrome) throw new Error('No se encontró Chrome: indicar --chrome <ruta>');
  const server = await serve(site);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { child, port } = await launchChrome(chrome, join(work, 'chrome-profile'));
  const failures = [];
  let kept = 0;
  console.log(`Zona ${timeZone}: ${keep ? 'el contenido generado debe conservarse' : 'el navegador repinta con las horas de la zona'}`);
  try {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const tab = await openTab(port);
      for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await tab.send(`${domain}.enable`);
      await tab.send('Network.setCacheDisabled', { cacheDisabled: true });
      await tab.send('Emulation.setTimezoneOverride', { timezoneId: timeZone });
      await tab.send('Emulation.setLocaleOverride', { locale: lang.locale });
      const { userAgent, ...metrics } = viewport;
      await tab.send('Emulation.setDeviceMetricsOverride', metrics);
      await tab.send('Emulation.setTouchEmulationEnabled', { enabled: viewport.mobile, maxTouchPoints: viewport.mobile ? 5 : 0 });
      if (userAgent) await tab.send('Emulation.setUserAgentOverride', { userAgent });
      await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: observer(lang.container, page.slots) });
      for (const slug of slugs) {
        const result = await checkPage(tab, `${origin}/${lang.dir}/${pagePath(slug)}/`,
          { lang: options.lang, keep, container: lang.container, failed: page.failed });
        const { problems } = result;
        if (result.kept) kept++;
        const mode = keep ? '' : ` (${result.kept ? 'conservada' : 'repintada'})`;
        console.log(`  ${problems.length ? '✗' : '✓'} ${name} ${slug}${mode}${problems.length ? `: ${problems.join('; ')}` : ''}`);
        if (problems.length) failures.push(`${name} ${slug}`);
      }
      tab.close();
    }
  } finally {
    const exited = new Promise(done => child.once('exit', done));
    child.kill();
    await exited;
    server.close();
    // Los procesos auxiliares de Chrome pueden seguir escribiendo en el perfil
    // unos instantes tras cerrar el principal; quedar sin borrar no invalida la
    // comprobación.
    try {
      rmSync(join(work, 'chrome-profile'), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (error) {
      console.log(`  Aviso: perfil temporal sin borrar (${error.code}): ${join(work, 'chrome-profile')}`);
    }
  }
  const loads = slugs.length * 2;
  console.log(keep
    ? `Paridad del prerender: ${loads - failures.length}/${loads} cargas sin repintado ni errores`
    : `Paridad del prerender (${timeZone}): ${loads - failures.length}/${loads} cargas sin errores, ${kept} conservadas y ${loads - kept} repintadas`);
  return failures.length || !slugs.length ? 1 : 0;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
  console.error(error.message);
  process.exitCode = 1;
});
