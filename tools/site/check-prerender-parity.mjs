#!/usr/bin/env node
// Paridad local del prerender de jornadas, inscritos, resultados, perfiles,
// mapas, órdenes de salida, fichajes, carreras CX y competiciones (solo en
// local, nunca en CI). Obligatoria antes de integrar un cambio de
// js/jornada-html.js, js/inscritos-html.js, js/resultados-html.js,
// js/perfil-mapa-html.js, js/orden-salida-html.js, js/fichajes-html.js,
// js/cx-race-html.js, js/cx-agenda-html.js, js/competicion-html.js o de sus
// dependencias
// (docs/runbooks/pages-build-selectivo.md).
//
//   node tools/site/check-prerender-parity.mjs --data datos.json --site-data site.json --work <dir> \
//     [--page jornada|inscritos|resultados|perfil|mapa|orden|fichajes|cx|torneo|competicion] [--lang es|en] [--timezone <zona>] [--count 20] [--seed <n>] \
//     [--slugs a,b] [--since AAAA-MM-DD] [--chrome <ruta>]
//   node tools/site/check-prerender-parity.mjs --work <dir> --reuse 1 [--page inscritos] [--lang en] [--timezone <zona>]
//
// 1. Compone <dir>/_site como el build de Pages (también el sitio base del
//    VPS, tools/publicacion/vps/base.sh): fuentes públicas, el contenido de
//    js/config.js del checkout principal y las páginas elegidas del tipo
//    (--page, jornada por defecto) y del idioma: jornada/<slug>/,
//    en/stage/<slugEn>/, inscritos/<slug>/, en/startlist/<slugEn>/,
//    resultados/<slug>/[<etapa>/], perfil/<slug>/, mapa/<slug>/,
//    orden-salida/<slug>/, competicion/<slug>/... Su HTML base sale de
//    gen_og_pages.py con la familia del tipo, ejecutado en <dir>/plantillas
//    sobre el volcado --site-data (tools/site/site-data.sql, convertido con
//    site_data.py --from-sql en <dir>/pages-data). Las páginas publicadas no
//    sirven: desde el corte al VPS llevan los paquetes /a/ del publicador.
//    --slugs lleva los slugs de las páginas de ese idioma (en resultados, con
//    la etapa: giro-de-italia-2026/etapa-10). En fichajes, una página por
//    idioma: las fuentes del checkout (fichajes/index.html y
//    en/transfers/index.html), sin --site-data. En cx, ciclocross/<slug>/ y
//    sus secciones inscritos/ y resultados/ (EN: en/cyclocross/<slugEn>/,
//    startlist/, results/); en torneo, ciclocross/torneos/<slug>/ (EN:
//    en/cyclocross/series/<slug>/).
// 2. Ejecuta el prerender del tipo (prerender-jornadas.mjs,
//    prerender-inscritos.mjs, prerender-resultados.mjs,
//    prerender-auxiliares.mjs con su tipo, prerender-fichajes.mjs o
//    prerender-cx.mjs; ámbito es o all, --data; --since
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
// `site.json`: volcado de tools/site/site-data.sql, del mismo momento.
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDump } from './prerender-jornadas.mjs';
import { candidateRaces } from './prerender-resultados.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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
// Por tipo de página: familia de gen_og_pages.py, prerender, slugs del
// volcado, selector del aviso de error, si la huella depende de la zona y, por
// idioma, directorio, contenedor, zona del build y configuración regional del
// navegador.
const PAGES = {
  jornada: {
    family: 'stages',
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
    family: 'extras',
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
    family: 'results',
    script: 'tools/site/prerender-resultados.mjs',
    slugs: resultPaths,
    // Error de carga (init) o de lectura de filas; «sin datos» es contenido.
    failed: '[data-initial-retry], .res-update-note',
    // La hora de salida es un hueco aparte (datos de la jornada): el resto no
    // depende de la zona.
    zoned: false,
    // Huecos generados que deben conservarse con la huella. Se pintan sobre lo
    // que hay (js/dom-patch.js): cada nodo de los huecos debe seguir conectado
    // y con su mismo HTML (las filas añadidas tras las generadas no cuentan).
    slots: ['#resTableWrap thead', '#resTableWrap tbody tr', '#resPublication > *', '#resStatusSlot > *', '#resTeamFilter'],
    deepSlots: true,
    // Sin máximo de lecturas: ninguna página de la muestra queda pendiente de relleno.
    args: data => ['--max-reads', String(candidateRaces(data.races, data.resultados_stages).length)],
    langs: {
      es: { dir: 'resultados', container: 'resultsContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
      en: { dir: 'en/results', container: 'resultsContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  // Perfil, mapa y orden de salida (prerender-auxiliares.mjs): el volcado es el
  // de prerender-auxiliares.sql y el ámbito, el tipo en ES y `all` en EN.
  perfil: {
    family: 'extras',
    script: 'tools/site/prerender-auxiliares.mjs',
    slugs: (data, lang) => data.days.filter(day => day.slug && day.elevationProfile && !day.profileNotViewable).map(day => daySlug(day, lang)),
    failed: '.pfe-loading',
    zoned: true,
    langs: {
      es: { dir: 'perfil', container: 'perfilEtapaContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'perfil' },
      en: { dir: 'en/profile', container: 'perfilEtapaContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  mapa: {
    family: 'extras',
    script: 'tools/site/prerender-auxiliares.mjs',
    slugs: (data, lang) => data.days.filter(day => day.slug && day.routeGpxUrl).map(day => daySlug(day, lang)),
    failed: '.pfe-loading',
    zoned: true,
    langs: {
      es: { dir: 'mapa', container: 'mapaEtapaContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'mapa' },
      en: { dir: 'en/route-map', container: 'mapaEtapaContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  orden: {
    family: 'extras',
    script: 'tools/site/prerender-auxiliares.mjs',
    slugs: (data, lang) => data.days.filter(day => day.slug && day.startOrderImportedAt).map(day => daySlug(day, lang)),
    failed: '.startlist-empty',
    zoned: true,
    langs: {
      es: { dir: 'orden-salida', container: 'startOrderContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'orden' },
      en: { dir: 'en/start-order', container: 'startOrderContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  // Carreras CX (prerender-cx.mjs): esqueleto, sección de la URL, panel de la
  // categoría visible y columna lateral, cada uno con su huella. Programa y
  // columna lateral dependen de la zona; fuera de la del build se repintan.
  cx: {
    family: 'cx',
    script: 'tools/site/prerender-cx.mjs',
    slugs: (data, lang) => data.races.filter(race => lang === 'es' || race.class !== 'NAC').flatMap(race => {
      const slug = lang === 'en' ? race.slugEn || race.slug : race.slug;
      const suffixes = lang === 'en' ? ['startlist', 'results'] : ['inscritos', 'resultados'];
      return slug ? [slug, ...suffixes.map(suffix => `${slug}/${suffix}`)] : [];
    }),
    failed: '[role="alert"]',
    zoned: true,
    slots: ['[data-cx-section]:not([hidden])',
      '[data-cx-classification-content]:not([hidden]), [data-cx-startlist-category]:not([hidden]), [data-cx-general]:not([hidden])',
      '[data-cx-context]'],
    langs: {
      es: { dir: 'ciclocross', container: 'cxRaceContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
      en: { dir: 'en/cyclocross', container: 'cxRaceContent', timeZone: 'Europe/London', locale: 'en-GB', scope: 'all' },
    },
  },
  // Torneos CX (prerender-cx.mjs): esqueleto y lista con la huella de su
  // versión sin estado de categorías ni insignias, que no depende de la zona.
  torneo: {
    family: 'cx',
    script: 'tools/site/prerender-cx.mjs',
    slugs: data => data.tournaments.map(tournament => tournament.slug).filter(Boolean),
    failed: '#cxAgendaError:not(:empty)',
    zoned: false,
    slots: ['#cxAgendaList > *'],
    langs: {
      es: { dir: 'ciclocross/torneos', container: 'cxAgendaContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
      en: { dir: 'en/cyclocross/series', container: 'cxAgendaContent', timeZone: 'Europe/London', locale: 'en-GB', scope: 'all' },
    },
  },
  // Competiciones (prerender-competicion.mjs): la huella es la de la página
  // sin las piezas del momento de cada tarjeta; no depende de la zona. El
  // volcado es el de prerender-jornadas.sql.
  competicion: {
    family: 'races',
    script: 'tools/site/prerender-competicion.mjs',
    slugs: (data, lang) => data.races.map(race => (lang === 'en' ? race.slugEn || race.slug : race.slug)).filter(Boolean),
    failed: '.empty-state__title',
    zoned: false,
    langs: {
      es: { dir: 'competicion', container: 'competicionContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'es' },
      en: { dir: 'en/race', container: 'competicionContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
  // Fichajes (prerender-fichajes.mjs): una página por idioma (`single`), de
  // las fuentes del checkout; el volcado es el de prerender-fichajes.sql.
  fichajes: {
    script: 'tools/site/prerender-fichajes.mjs',
    single: true,
    // Error de carga sin portada generada; un feed vacío es contenido.
    failed: '#transfersContent > .tr-empty',
    zoned: false,
    // Se actualiza sobre lo pintado (js/dom-patch.js): cualquier cambio
    // dentro del contenido es un repintado.
    deep: true,
    langs: {
      es: { dir: 'fichajes', container: 'transfersContent', timeZone: 'Europe/Madrid', locale: 'es-ES', scope: 'all' },
      en: { dir: 'en/transfers', container: 'transfersContent', timeZone: 'Etc/GMT', locale: 'en-GB', scope: 'all' },
    },
  },
};

// Rutas de resultados de las carreras candidatas del volcado
// (prerender-resultados.sql) con todas sus clasificaciones oficiales: la de la
// carrera y una por etapa (prólogo, etapa-N), sin las CRE.
function resultPaths(data, lang) {
  const official = new Map();
  for (const stage of data.resultados_stages) {
    official.set(stage.raceId, (official.get(stage.raceId) ?? true) && stage.publicationStatus === 'official' && !stage.updating);
  }
  const races = new Map(data.races.map(race => [race.id, race]));
  const paths = [];
  for (const raceId of candidateRaces(data.races, data.resultados_stages)) {
    const race = races.get(raceId);
    const slug = lang === 'en' ? race.slugEn || race.slug : race.slug;
    if (!slug || !official.get(raceId)) continue;
    paths.push(slug);
    if (race.raceFormat === 'one_day') continue;
    for (const day of data.race_days) {
      if (day.raceId !== raceId || day.isRestDay || day.stageNumber == null || day.primaryType === 'ttt') continue;
      const segment = day.stageNumber === 0 ? (lang === 'en' ? 'prologue' : 'prologo') : `${lang === 'en' ? 'stage' : 'etapa'}-${day.stageNumber}`;
      paths.push(`${slug}/${segment}`);
    }
  }
  return [...new Set(paths)];
}
const daySlug = (day, lang) => (lang === 'en' ? day.slugEn || day.slug : day.slug);
const pagePath = slug => slug.split('/').map(encodeURIComponent).join('/');
// Ruta de la página de `slug` en `dir`; sin slug (fichajes), la del directorio.
const pageUrl = (dir, slug) => `/${dir}/${slug ? `${pagePath(slug)}/` : ''}`;
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

// HTML base de la familia, como el bloque og-<familia> del build
// (build_generated.py): gen_og_pages.py en <work>/plantillas con el volcado
// compartido. La clave no es válida: una consulta que el volcado no resuelva
// falla en lugar de leer la API.
function generateTemplates(work, family, siteData, dir) {
  const pagesData = join(work, 'pages-data');
  const templates = join(work, 'plantillas');
  for (const path of [pagesData, templates]) rmSync(path, { recursive: true, force: true });
  mkdirSync(templates, { recursive: true });
  run('python3', [join(ROOT, 'tools/site/site_data.py'), pagesData, '--from-sql', resolve(siteData)]);
  execFileSync('python3', [join(ROOT, 'tools/site/gen_og_pages.py'), '--family', family], {
    cwd: templates, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PAGES_DATA: pagesData, SUPABASE_ANON_KEY: 'local' },
  });
  const generated = existsSync(join(templates, dir))
    ? readdirSync(join(templates, dir), { recursive: true }).filter(name => basename(name) === 'index.html').length : 0;
  console.log(`  Build local (gen_og_pages.py --family ${family}): ${generated} páginas en ${dir}/`);
  return templates;
}

function composeSite(site, work, data, options, page, lang) {
  rmSync(site, { recursive: true, force: true });
  mkdirSync(site, { recursive: true });
  const main = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim());
  const config = join(main, 'js/config.js');
  if (!existsSync(config)) throw new Error(`Falta ${config}: la página necesita la configuración pública de Supabase`);
  // js/config.js del checkout (puede ser un enlace al del principal) no se
  // copia: se escribe el contenido del principal.
  const ownConfig = join(ROOT, 'js/config.js');
  for (const source of SOURCES) {
    cpSync(join(ROOT, source), join(site, source), { recursive: true, filter: path => path !== ownConfig && !path.split(sep).includes('__tests__') });
  }
  writeFileSync(join(site, 'js/config.js'), readFileSync(config));
  if (page.single) {
    // Las fuentes de todos los idiomas: el ámbito all las genera juntas.
    for (const { dir } of Object.values(page.langs)) {
      mkdirSync(join(site, dir), { recursive: true });
      cpSync(join(ROOT, dir, 'index.html'), join(site, dir, 'index.html'));
    }
    return [''];
  }
  const templates = generateTemplates(work, page.family, options['site-data'], lang.dir);
  const slugs = options.slugs
    ? options.slugs.split(',').map(slug => slug.trim()).filter(Boolean)
    : shuffled(page.slugs(data, options.lang).sort(), Number(options.seed));
  const wanted = options.slugs ? slugs.length : Number(options.count);
  const pages = [];
  for (const slug of slugs) {
    if (pages.length === wanted) break;
    const template = join(templates, lang.dir, slug, 'index.html');
    if (!existsSync(template)) {
      console.log(`  ${slug}: sin página en el build local, se descarta`);
      continue;
    }
    mkdirSync(join(site, lang.dir, slug), { recursive: true });
    cpSync(template, join(site, lang.dir, slug, 'index.html'));
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
// retira todos. Con `deep` (páginas que se actualizan sobre lo pintado con
// js/dom-patch.js, que no retira los hijos directos) cuenta además los nodos,
// textos y atributos que cambian dentro del contenido. Con `deepSlots`, todos
// los nodos de cada hueco deben conservar su HTML, no solo el primero su nodo.
const observer = (container, slots = [], deep = false, deepSlots = false) => `(() => {
  const state = window.__ccParity = { generated: false, removed: 0, changed: 0, first: null, header: null, slots: [] };
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const main = document.getElementById(${JSON.stringify(container)});
    if (!main) return;
    state.generated = main.hasAttribute('data-prerendered');
    state.first = main.firstElementChild;
    state.header = document.querySelector('#siteHeader .site-header__inner');
    state.slots = ${JSON.stringify(slots)}.flatMap(selector => (${deepSlots} ? [...main.querySelectorAll(selector)] : [main.querySelector(selector)])
      .filter(Boolean).map(node => [selector, node, ${deepSlots} ? node.outerHTML : null]));
    new MutationObserver(records => { for (const record of records) state.removed += record.removedNodes.length; })
      .observe(main, { childList: true });
    if (${deep}) new MutationObserver(records => {
      for (const record of records) {
        if (record.target !== main) state.changed += record.type === 'childList' ? record.addedNodes.length + record.removedNodes.length : 1;
      }
    }).observe(main, { childList: true, subtree: true, characterData: true, attributes: true });
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
    return JSON.stringify({ timeout, generated: state.generated, removed: state.removed, changed: state.changed,
      kept: !!state.first?.isConnected, headerKept: !!state.header?.isConnected,
      slotsRepainted: [...new Set(state.slots.filter(([, node, html]) => !node.isConnected || (html != null && node.outerHTML !== html)).map(([selector]) => selector))],
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
  const kept = state.generated && state.kept && !state.removed && !state.changed && !state.slotsRepainted?.length;
  if (keep && state.generated && !kept) problems.push(`repintado (${state.removed} nodos retirados${state.changed ? `; ${state.changed} cambios dentro` : ''}${state.slotsRepainted?.length ? `; huecos ${state.slotsRepainted.join(', ')}` : ''})`);
  if (keep && state.generated && !state.headerKept) problems.push('cabecera repintada');
  problems.push(...(state.times || []).slice(0, 3).map(time => `hora ${time}`));
  problems.push(...errors.map(error => `consola: ${error}`));
  return { problems, kept };
}

async function main(argv) {
  const options = parseArgs(argv);
  if (!options.work || (!options.data && !options.reuse)) {
    throw new Error('Uso: check-prerender-parity.mjs --data datos.json --site-data site.json --work <dir> [--page jornada|inscritos|resultados|perfil|mapa|orden|fichajes|cx|torneo|competicion] [--lang es|en] [--timezone zona] [--count 20] [--seed n] [--slugs a,b] [--since AAAA-MM-DD] [--chrome ruta] | --work <dir> --reuse 1 [--page inscritos] [--lang en] [--timezone zona]');
  }
  const page = PAGES[options.page];
  if (!page) throw new Error(`Tipo de página no admitido: «${options.page}» (jornada, inscritos, resultados, perfil, mapa, orden, fichajes, cx, torneo o competicion)`);
  const lang = page.langs[options.lang];
  if (!lang) throw new Error(`Idioma no admitido: «${options.lang}» (es o en)`);
  if (!options.reuse && !page.single && !options['site-data']) {
    throw new Error('Falta --site-data: volcado de tools/site/site-data.sql (node scripts/db/sql.mjs --read-only --file tools/site/site-data.sql > site.json)');
  }
  const timeZone = options.timezone || lang.timeZone;
  const keep = !page.zoned || timeZone === lang.timeZone;
  options.seed ??= String(Date.now() % 1e6);
  const work = resolve(options.work);
  const site = join(work, '_site');
  const preloadMap = join(work, '.module-preload.json');
  let slugs;
  if (options.reuse && page.single) {
    slugs = [''];
  } else if (options.reuse) {
    slugs = readdirSync(join(site, lang.dir)).sort();
    if (page.slots) {
      slugs = slugs.flatMap(slug => [slug, ...readdirSync(join(site, lang.dir, slug), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => `${slug}/${entry.name}`)])
        .filter(slug => existsSync(join(site, lang.dir, slug, 'index.html')));
    }
  } else {
    console.log(`Componiendo ${site} (${options.page}, ${options.lang}, semilla ${options.seed})`);
    const data = readDump(options.data);
    slugs = composeSite(site, work, data, options, page, lang);
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
      await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: observer(lang.container, page.slots, page.deep, page.deepSlots) });
      for (const slug of slugs) {
        const result = await checkPage(tab, `${origin}${pageUrl(lang.dir, slug)}`,
          { lang: options.lang, keep, container: lang.container, failed: page.failed });
        const { problems } = result;
        if (result.kept) kept++;
        const mode = keep ? '' : ` (${result.kept ? 'conservada' : 'repintada'})`;
        console.log(`  ${problems.length ? '✗' : '✓'} ${name} ${slug || lang.dir}${mode}${problems.length ? `: ${problems.join('; ')}` : ''}`);
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
