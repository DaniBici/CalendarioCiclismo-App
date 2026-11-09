// Activos con hash del prototipo: isla y sus trozos, CSS y fuentes, scripts
// clásicos y el script en línea previo al primer pintado.
import { build, transform } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shellCalendario } from './familia-calendario.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const hash = contenido => createHash('sha1').update(contenido).digest('hex').slice(0, 10);

// El cliente de Supabase no entra en el paquete: lo poco que aún consulta (el cintillo)
// lee los datos publicados.
const sinSupabase = {
  name: 'sin-supabase',
  setup(b) {
    b.onResolve({ filter: /supabase-client\.js$/ }, () => ({ path: 'supabase-client', namespace: 'prototipo' }));
    b.onLoad({ filter: /.*/, namespace: 'prototipo' }, () => ({
      contents: `import { clienteEstatico } from ${JSON.stringify(join(HERE, 'cliente/cliente-estatico.js'))};
let datos = null;
const cargar = () => (datos ||= fetch('/d/cintillo.json', { cache: 'no-cache' }).then(respuesta => respuesta.json()));
export function getSupabaseClient() { return clienteEstatico(() => (globalThis.__ccDatosEstaticos ? Promise.resolve(globalThis.__ccDatosEstaticos) : cargar())); }`,
      loader: 'js', resolveDir: HERE,
    }));
  },
};

// js/ciclocross.js sobre el HTML ya publicado: no rehace la página, parchea la lista en
// lugar de sustituirla y lee los datos de la temporada publicados.
const agendaPublicada = {
  name: 'agenda-publicada',
  setup(b) {
    b.onLoad({ filter: /js\/ciclocross\.js$/ }, args => {
      let source = readFileSync(args.path, 'utf8');
      const cambios = [
        ["from './services/cx-data.js'", `from ${JSON.stringify(join(HERE, 'cliente/cx-datos-estaticos.js'))}`],
        ['else root.innerHTML=tournamentMode', 'else if(root.dataset.publicada==null)root.innerHTML=tournamentMode'],
        ["  list.innerHTML=LOADING_HTML;\n  try {\n    const [rows,rounds]", "  if(root.dataset.publicada==null)list.innerHTML=LOADING_HTML;\n  try {\n    const [rows,rounds]"],
        ["list.innerHTML=races.map(race=>card(race,currentDay)).join('');", "patchHtml(list,races.map(race=>card(race,currentDay)).join(''));"],
        ['if(filterCatsNode){\n  renderFilterPins(', "if(filterCatsNode){\n  if(root.dataset.publicada!=null&&agendaFilter!=='all')for(const node of filterCatsNode.querySelectorAll('.tcat-btn'))setPressed(node,node.dataset.cat===agendaFilter);\n  renderFilterPins("],
      ];
      for (const [de, a] of cambios) {
        if (!source.includes(de)) throw new Error(`js/ciclocross.js sin «${de}»`);
        source = source.replace(de, a);
      }
      source = `import {patchHtml} from ${JSON.stringify(join(ROOT, 'js/dom-patch.js'))};\n${source}`;
      return { contents: source, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

// El calendario sin cargador y sin leer al cargar: lee los archivos publicados, parchea
// la lista en lugar de sustituirla y avisa cuando escucha. No hay copia local que repintar.
const calendarioPublicado = {
  name: 'calendario-publicado',
  setup(b) {
    b.onResolve({ filter: /local-cache\.js$/ }, () => ({ path: 'local-cache', namespace: 'calendario' }));
    b.onLoad({ filter: /.*/, namespace: 'calendario' }, () => ({
      contents: 'export async function staleWhileRevalidate(_clave, leer, aplicar) { const datos = await leer(); aplicar(datos); return datos; }',
      loader: 'js',
    }));
    const parchear = (filtro, cambios, cabecera = '') => b.onLoad({ filter: filtro }, args => {
      let source = readFileSync(args.path, 'utf8');
      for (const [de, a] of cambios) {
        const nuevo = source.replace(de, a);
        if (nuevo === source) throw new Error(`${args.path} sin «${de}»`);
        source = nuevo;
      }
      return { contents: cabecera + source, loader: 'js', resolveDir: dirname(args.path) };
    });
    const datos = JSON.stringify(join(HERE, 'cliente/calendario-datos.js'));
    parchear(/js\/calendario\.js$/, [
      [/content\.innerHTML = LOADING_HTML;\n\s*removeStaticLoading\(\);\n\s*await import\('\.\/temporada\.js'\)/, "removeStaticLoading();\n      await import('./temporada.js')"],
      [/content\.innerHTML = LOADING_HTML;\n\s*removeStaticLoading\(\);\n\s*const mod = await import/, 'removeStaticLoading();\n      const mod = await import'],
    ]);
    parchear(/js\/temporada\.js$/, [
      ['  years.forEach(y => {', '  yearSel.replaceChildren();\n  years.forEach(y => {'],
      ['S.activeCat = getPinnedFilter() || \'all\';', "S.activeCat = getPinnedFilter() || 'all';\ndocument.querySelectorAll('.t-race--challenge[aria-expanded=\"true\"]').forEach(boton => S.expandedChallenges.add(boton.dataset.cgid));"],
      ['    if (raceObj) openRaceDataModal(rdId, raceObj);', ''],
      [/content\.innerHTML = `<div class="loading">[\s\S]*?`;\n/, ''],
      ['  await loadYear();\n}\n', "  await loadYear();\n  dispatchEvent(new Event('cc-temporada-lista'));\n}\n"],
      ['async function fetchSeasonBundle(year) {', 'async function fetchSeasonBundle(year) { return leerTemporada(year); }\nasync function _bundleOriginal(year) {'],
      ['function render({ refresh = false } = {}) {', 'function render({ refresh = false } = {}) {\n  if (!S.allRaces.length && !window.__ccTemporadaLeida) return;'],
      ['render({ refresh: painted });', "window.__ccTemporadaLeida = true;\n    const pendiente = document.getElementById('temporadaContent').dataset.pendiente != null;\n    render({ refresh: painted || !pendiente });\n    document.getElementById('temporadaContent').removeAttribute('data-pendiente');"],
      ['content.innerHTML = html;\n\n  // Altura de los filtros', 'patchHtml(content, html);\n\n  // Altura de los filtros'],
    ], `import {patchHtml} from ${JSON.stringify(join(ROOT, 'js/dom-patch.js'))};\nimport {leerTemporada} from ${datos};\n`);
    parchear(/js\/calendario-mes\.js$/, [
      ['async function fetchMonthData(year, month0) {', 'async function fetchMonthData(year, month0) { return leerMes(year, monthDateRange(year, month0)); }\nasync function _mesOriginal(year, month0) {'],
      ["  content.innerHTML = LOADING_HTML;\n  content.querySelector('.loading__text').textContent = t('loading.month');\n", ''],
    ], `import {leerMes} from ${datos};\n`);
  },
};

// Las hojas de cada página, sin los subconjuntos que lleva incrustados la hoja de la fuente.
const sinFuentePrincipal = {
  name: 'sin-fuente-principal',
  setup(b) {
    b.onLoad({ filter: /css\/fonts\.css$/ }, args => ({
      contents: readFileSync(args.path, 'utf8').replace(/@font-face\s*\{[^}]*google-sans-latin(?:-ext)?\.woff2[^}]*\}\s*/g, ''),
      loader: 'css', resolveDir: dirname(args.path),
    }));
  },
};

// El cintillo, con lo publicado.
const cintilloPublicado = {
  name: 'cintillo-publicado',
  setup(b) {
    const estatico = JSON.stringify(join(HERE, 'cliente/cliente-estatico.js'));
    b.onLoad({ filter: /js\/cintillo\.js$/ }, args => {
      const source = readFileSync(args.path, 'utf8');
      if (!source.includes('import { supabase, toDateKey,')) throw new Error('js/cintillo.js sin la importación esperada');
      return {
        contents: `import {clienteEstatico} from ${estatico};\nconst supabase = clienteEstatico(() => fetch('/d/cintillo.json', { cache: 'no-cache' }).then(respuesta => respuesta.json()));\n${source.replace('import { supabase, toDateKey,', 'import { toDateKey,')}`,
        loader: 'js', resolveDir: dirname(args.path),
      };
    });
  },
};

// Hoy de carretera con lo que lee al cargar desde archivos publicados.
const hoyPublicado = {
  name: 'hoy-publicado',
  setup(b) {
    const datos = JSON.stringify(join(HERE, 'cliente/hoy-datos.js'));
    b.onLoad({ filter: /js\/app\.js$/ }, args => {
      let source = readFileSync(args.path, 'utf8');
      const cambios = [
        [/const \{ data: rdData, error: dayError \} = await supabase\.from\('race_days'\)\.select\(DAY_SELECT\)[\s\S]*?ascending: true \}\);/, 'const { data: rdData, error: dayError } = await hoyDia(dateKey);'],
        ['const featuredPromise = loadFeaturedRaces(supabase, [dateKey]);', 'const featuredPromise = hoyDestacadas(dateKey);'],
        [/return Promise\.resolve\(supabase\.from\('races'\)\.select\(ACTIVE_RACE_COLUMNS\)[\s\S]*?\.gte\('endDate', dateKey\)\);/, 'return hoyActivas(dateKey);'],
        ["() => fetchAllRowsParallel(() => supabase.from('races').select(YEAR_NAV_COLUMNS).eq('year', year).order('id')),", '() => hoyAnio(year),'],
        ['async function dayChanged(probe) {', 'async function dayChanged(probe) { return hoyCambio(probe.dateKey); }\nasync function _dayChangedOriginal(probe) {'],
        // La comprobación es un archivo estático de 12 bytes: cada 10 s, no cada minuto.
        ['const dayRefreshTimer=setInterval(refreshToday,60000);', 'const dayRefreshTimer=setInterval(refreshToday,10000);'],
        ['function renderAgendaItems(items) {', "function renderAgendaItems(items) {\n  document.getElementById('raceList').style.visibility = '';"],
        ['function showEmptyDay(list, message, nextDateKey) {', "function showEmptyDay(list, message, nextDateKey) {\n  list.style.visibility = '';"],
      ];
      for (const [de, a] of cambios) {
        const nuevo = source.replace(de, a);
        if (nuevo === source) throw new Error(`js/app.js sin «${de}»`);
        source = nuevo;
      }
      return { contents: `import {hoyActivas,hoyAnio,hoyCambio,hoyDestacadas,hoyDia} from ${datos};\n${source}`, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

// Competición, fichas CX y fichajes con lo que leen al cargar desde archivos publicados. Lo
// interactivo (diálogos, plantillas, generales) sigue leyendo datos, por el mismo origen.
const lecturasPublicadas = {
  name: 'lecturas-publicadas',
  setup(b) {
    const datos = JSON.stringify(join(HERE, 'cliente/datos-publicados.js'));
    const parchear = (filtro, cambios, cabecera = '') => b.onLoad({ filter: filtro }, args => {
      let source = readFileSync(args.path, 'utf8');
      for (const [de, a] of cambios) {
        const nuevo = source.replace(de, a);
        if (nuevo === source) throw new Error(`${args.path} sin «${de}»`);
        source = nuevo;
      }
      return { contents: cabecera + source, loader: 'js', resolveDir: dirname(args.path) };
    });
    parchear(/js\/competicion\.js$/, [
      ['const inhouseRequest = id ? loadInhouseStageSet([id]) : null;', 'const inhouseRequest = id ? trofeosPublicados(id) : null;'],
      [/const \{ data \} = await supabase\.from\('races'\)\.select\(RACE_WITH_DAYS\)\s*\.eq\('id', id\)[\s\S]*?\.maybeSingle\(\);\s*row = data;/, 'row = await competicionPublicada(id);'],
    ], `import {competicionPublicada,trofeosPublicados} from ${datos};\n`);
    parchear(/js\/cx-race\.js$/, [
      ["from './services/cx-data.js'", `from ${JSON.stringify(join(HERE, 'cliente/cx-datos-estaticos.js'))}`],
      ['async function findRace() {', 'async function findRace() {\n  if(sourceId)return (await cxPublicada(sourceId)).race;'],
      [/const \[broadcasts,videos,inscritos,results,teamRows,rounds,docAssets,\[states,standings,tournamentRaceRows\]\]=await Promise\.all\(\[[\s\S]*?\[\[\],\[\],\[\]\]\]\);/, 'const {broadcasts,videos,inscritos,results,docAssets,states,standings,tournamentRaceRows}=(await cxPublicada(race.id)).rows;const [teamRows,rounds]=await Promise.all([cxEquipos(),cxSeasonRounds(supabase,race.seasonKey).then(map=>map,()=>null)]);'],
    ], `import {cxEquipos,cxPublicada} from ${datos};\n`);
    parchear(/js\/campeonatos\.js$/, [
      [/supabase\.from\('races'\)\s*\.select\('\*,race_days[\s\S]*?\.gt\('race_uci_stages\.rowCount', 0\),/, "fetch('/d/campeonatos.json', { cache: 'no-cache' }).then(respuesta => respuesta.json()).then(data => ({ data, error: null })),"],
      ['content.innerHTML = campPageHtml(_state, _campFilter);', 'patchHtml(content, campPageHtml(_state, _campFilter));'],
    ], `import {patchHtml} from ${JSON.stringify(join(ROOT, 'js/dom-patch.js'))};\n`);
    parchear(/js\/fichajes\.js$/, [
      ['      writeCache(CACHE_KEY, market);\n', ''],
      ['async function fetchMarket() {', 'async function fetchMarket() { return mercadoPublicado(); }\nasync function _mercadoOriginal() {'],
    ], `import {mercadoPublicado} from ${datos};\n`);
  },
};

// js/jornada.js sin arranque ni filtro de TV (lo lleva la isla), con los diálogos
// exportados; el resto se elimina por no usarse.
const jornadaSinArranque = {
  name: 'jornada-sin-arranque',
  setup(b) {
    b.onLoad({ filter: /js\/jornada\.js$/ }, args => {
      let source = readFileSync(args.path, 'utf8');
      const fin = source.lastIndexOf('init();');
      if (fin < 0) throw new Error('js/jornada.js sin init() final');
      source = `${source.slice(0, fin)}\nexport { setupReportModal, setupIcalModal };\n`;
      const filtro = "document.addEventListener('click', e => {\n  const tvBtn";
      if (!source.includes(filtro)) throw new Error('js/jornada.js sin el filtro de TV esperado');
      source = source.replace(filtro, "if (false) document.addEventListener('click', e => {\n  const tvBtn");
      return { contents: source, loader: 'js', resolveDir: dirname(args.path) };
    });
    b.onResolve({ filter: /jornada-html\.js$|html-fingerprint\.js$/ }, async args => {
      if (args.pluginData?.omitir) return undefined;
      const resuelto = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { omitir: true } });
      return { ...resuelto, sideEffects: false };
    });
  },
};

async function clasico(contenido) {
  const { code } = await transform(contenido, { loader: 'js', minifyWhitespace: true, minifySyntax: true, legalComments: 'none', target: 'es2022' });
  return code;
}

function escribirConHash(dir, nombre, extension, contenido) {
  const file = `${nombre}-${hash(contenido)}.${extension}`;
  writeFileSync(join(dir, file), contenido);
  return `/a/${file}`;
}

function archivos(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? archivos(full) : [full];
  });
}

/**
 * Lo que el modo híbrido copia de una página publicada de la familia: JS, CSS y
 * precargas de la versión vigente, para que el HTML nuevo y el cliente coincidan.
 */
function shellPublicada(html) {
  const tema = /<script src="(\/js\/theme\.js[^"]*)"/.exec(html)?.[1];
  const css = /<link rel="stylesheet" href="(\/css\/app\.css[^"]*)"/.exec(html)?.[1];
  const precargas = [...html.matchAll(/<link rel="modulepreload"[^>]*>/g)].map(match => match[0]).join('');
  const scriptCabecera = /<script type="module" src="\/js\/header\.js[^"]*"><\/script>/.exec(html)?.[0];
  const pie = html.indexOf('</footer>');
  const fin = html.indexOf('</body>');
  if (!tema || !css || !scriptCabecera || pie < 0 || fin < 0) throw new Error('Página publicada sin la estructura esperada');
  return { tema, css, precargas, scriptCabecera, scriptsPie: html.slice(pie + '</footer>'.length, fin).trim() };
}

/** Lo que la portada conserva de su página publicada: el <head> y el título. */
function shellPortada(html, activos, { home, lang }) {
  const inicio = html.indexOf('<body');
  if (inicio < 0) throw new Error('Portada publicada sin <body>');
  const destinoRuta = lang === 'en' ? '/en/index-ruta.html' : '/index-ruta.html';
  // Hoy de carretera sigue en la página de hoy: con fecha o con Carretera fijada.
  const ruta = home ? `<script>!function(){try{var s=new URLSearchParams(location.search);if(s.has('date')||localStorage.getItem('cc_default_discipline')==='road')location.replace('${destinoRuta}'+location.search)}catch(e){}}()</script>` : '';
  let enlaces = false;
  const head = html.slice(0, inicio)
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace(/<link rel="preconnect" href="https:\/\/[^"]*supabase\.co"[^>]*>\s*/g, '')
    .replace(/<script src="[^"]*theme\.js[^"]*"><\/script>/, `${ruta}<script src="${activos.tema}"></script>`)
    .replace(/<link rel="stylesheet" href="[^"]*">\s*/g, () => {
      if (enlaces) return '';
      enlaces = true;
      return `<link rel="stylesheet" href="${activos.fuente}"><link rel="stylesheet" href="${activos.portada.css}"><link rel="modulepreload" fetchpriority="low" href="${activos.portada.isla}">`;
    });
  if (!enlaces) throw new Error('Portada publicada sin hoja de estilos');

  const titulo = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html.slice(inicio))?.[1];
  return { head, h1: titulo ? `<h1 class="sr-only">${titulo}</h1>\n` : '' };
}

/** Lo que la portada de resultados conserva de su página publicada: el <head>. */
function shellResultados(html, activos) {
  const inicio = html.indexOf('<body');
  if (inicio < 0) throw new Error('Resultados publicada sin <body>');
  let enlaces = false;
  const head = html.slice(0, inicio)
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace(/<link rel="preconnect" href="https:\/\/[^"]*supabase\.co"[^>]*>\s*/g, '')
    .replace(/<script src="[^"]*theme\.js[^"]*"><\/script>/, `<script src="${activos.tema}"></script>`)
    .replace(/<link rel="stylesheet" href="[^"]*">\s*/g, () => {
      if (enlaces) return '';
      enlaces = true;
      return `<link rel="stylesheet" href="${activos.fuente}"><link rel="stylesheet" href="${activos.portada.css}"><link rel="modulepreload" fetchpriority="low" href="${activos.resultados.isla}">`;
    });
  if (!enlaces) throw new Error('Resultados publicada sin hoja de estilos');
  return { head };
}

/**
 * Construye `/a` en `salida`. `config`: contenido público de js/config.js;
 * `publicadas`: HTML publicado de las páginas que se copian. Devuelve el manifiesto.
 */
export async function construirActivos(salida, config, publicadas) {
  const dir = join(salida, 'a');
  mkdirSync(dir, { recursive: true });

  const isla = await build({
    entryPoints: { isla: join(HERE, 'cliente/isla-jornada.js'), 'isla-portada': join(HERE, 'cliente/isla-portada.js'), 'isla-resultados': join(HERE, 'cliente/isla-resultados.js'), 'isla-calendario': join(HERE, 'cliente/isla-calendario.js'), 'isla-carrera': join(HERE, 'cliente/isla-carrera.js'), 'isla-inscritos': join(HERE, 'cliente/isla-inscritos.js'), 'isla-etapa': join(HERE, 'cliente/isla-etapa.js') },
    outdir: dir, bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022',
    entryNames: '[name]-[hash]', chunkNames: '[name]-[hash]', legalComments: 'none', metafile: true,
    plugins: [sinSupabase, jornadaSinArranque, agendaPublicada, calendarioPublicado], logLevel: 'warning',
  });
  const salidaDe = fuente => Object.entries(isla.metafile.outputs).find(([, meta]) => meta.entryPoint?.endsWith(fuente))?.[0];
  const islasDatos = await build({
    entryPoints: { 'isla-competicion': join(HERE, 'cliente/isla-competicion.js'), 'isla-cx': join(HERE, 'cliente/isla-cx.js'), 'isla-torneo': join(HERE, 'cliente/isla-torneo.js'), 'isla-fichajes': join(HERE, 'cliente/isla-fichajes.js'), 'isla-campeonatos': join(HERE, 'cliente/isla-campeonatos.js') },
    outdir: dir, bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022',
    entryNames: '[name]-[hash]', chunkNames: 'datos-[name]-[hash]', legalComments: 'none', metafile: true,
    plugins: [agendaPublicada, lecturasPublicadas, cintilloPublicado], logLevel: 'warning',
  });
  const islaHoy = await build({
    entryPoints: { 'isla-hoy': join(HERE, 'cliente/isla-hoy.js') },
    outdir: dir, bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022',
    entryNames: '[name]-[hash]', chunkNames: 'hoy-[name]-[hash]', legalComments: 'none', metafile: true,
    plugins: [hoyPublicado, cintilloPublicado], logLevel: 'warning',
  });
  const salidaHoy = `/a/${relative(dir, Object.entries(islaHoy.metafile.outputs).find(([, meta]) => meta.entryPoint?.endsWith('cliente/isla-hoy.js'))[0])}`;
  const salidaDatos = fuente => `/a/${relative(dir, Object.entries(islasDatos.metafile.outputs).find(([, meta]) => meta.entryPoint?.endsWith(fuente))[0])}`;
  const entrada = salidaDe('cliente/isla-jornada.js');
  const entradaPortada = salidaDe('cliente/isla-portada.js');
  const entradaResultados = salidaDe('cliente/isla-resultados.js');
  const entradaCalendario = salidaDe('cliente/isla-calendario.js');
  const entradaCarrera = salidaDe('cliente/isla-carrera.js');
  const entradaInscritos = salidaDe('cliente/isla-inscritos.js');
  const entradaEtapa = salidaDe('cliente/isla-etapa.js');

  const css = await build({
    entryPoints: { app: join(ROOT, 'css/app.css'), 'campeonatos-pub': join(HERE, 'cliente/campeonatos-pub.css'), 'hoy-pub': join(HERE, 'cliente/hoy-pub.css'), portada: join(HERE, 'cliente/portada.css'), 'calendario-pub': join(HERE, 'cliente/calendario-pub.css'), 'carrera-pub': join(HERE, 'cliente/carrera-pub.css'), 'fichajes-pub': join(HERE, 'cliente/fichajes-pub.css') },
    outdir: dir, bundle: true, minify: true, entryNames: '[name]-[hash]', assetNames: '[name]-[hash]', publicPath: '/a',
    loader: { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.webp': 'file', '.svg': 'file', '.gif': 'file' },
    external: ['https://*'], legalComments: 'none', metafile: true, logLevel: 'warning', plugins: [sinFuentePrincipal],
  });
  const salidasCss = Object.keys(css.metafile.outputs);
  const hoja = salidasCss.find(file => basename(file).startsWith('app-') && file.endsWith('.css'));
  const hojaPortada = salidasCss.find(file => basename(file).startsWith('portada-') && file.endsWith('.css'));
  const hojaCalendario = salidasCss.find(file => basename(file).startsWith('calendario-pub-') && file.endsWith('.css'));
  const hojaCarrera = salidasCss.find(file => basename(file).startsWith('carrera-pub-') && file.endsWith('.css'));
  const hojaFichajes = salidasCss.find(file => basename(file).startsWith('fichajes-pub-') && file.endsWith('.css'));
  const hojaCampeonatos = salidasCss.find(file => basename(file).startsWith('campeonatos-pub-') && file.endsWith('.css'));
  const hojaHoy = salidasCss.find(file => basename(file).startsWith('hoy-pub-') && file.endsWith('.css'));

  const clasicos = await clasico(['js/cookie-consent.js', 'js/analytics.js', 'js/apps-modal.js', 'js/lang-switch.js']
    .reduce((acc, file) => `${acc}\n;${readFileSync(join(ROOT, file), 'utf8')}`, config));
  // Sin cortina: el HTML ya es definitivo y page-loading.js, que la retira, no se carga.
  const temaFuente = readFileSync(join(ROOT, 'js/theme.js'), 'utf8');
  const sinCortina = temaFuente.replace("document.documentElement.classList.add('cc-booting');", '');
  if (sinCortina === temaFuente) throw new Error('js/theme.js sin la cortina esperada');
  const tema = await clasico(sinCortina);

  const shared = readFileSync(join(ROOT, 'js/shared.js'), 'utf8');
  const desde = shared.indexOf('const _COUNTRY_TZ_MAP');
  const hasta = shared.indexOf('const { group: _userCountryGroup');
  if (desde < 0 || hasta < 0) throw new Error('js/shared.js sin la detección de región esperada');
  const pre = readFileSync(join(HERE, 'cliente/pre-pintado.js'), 'utf8').replace('/*__GRUPOS__*/', () => shared.slice(desde, hasta));
  const prePintado = (await transform(pre, { loader: 'js', minify: true, legalComments: 'none', target: 'es2020' })).code.replace(/<\/script/g, '<\\/script').trim();

  const prePintadoResultados = (await build({
    entryPoints: [join(HERE, 'cliente/pre-pintado-resultados.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
  })).outputFiles[0].text.replace(/<\/script/g, '<\\/script').trim();

  const prePintadoCalendario = (await build({
    entryPoints: [join(HERE, 'cliente/pre-pintado-calendario.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
  })).outputFiles[0].text.replace(/<\/script/g, '<\\/script').trim();

  const preHoy = readFileSync(join(HERE, 'cliente/pre-pintado-hoy.js'), 'utf8').replace('/*__GRUPOS__*/', () => shared.slice(desde, hasta));
  const prePintadoHoy = (await transform(preHoy, { loader: 'js', minify: true, legalComments: 'none', target: 'es2020' })).code.replace(/<\/script/g, '<\\/script').trim();
  const prePintadoMercado = (await build({
    entryPoints: [join(HERE, 'cliente/pre-pintado-mercado.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
  })).outputFiles[0].text.replace(/<\/script/g, '<\\/script').trim();
  const prePintadoOrden = (await build({
    entryPoints: [join(HERE, 'cliente/pre-pintado-orden.js')], bundle: true, write: false, format: 'iife', minify: true, target: 'es2020', legalComments: 'none', logLevel: 'warning',
  })).outputFiles[0].text.replace(/<\/script/g, '<\\/script').trim();
  const prePintadoCarrera = (await transform(readFileSync(join(HERE, 'cliente/pre-pintado-carrera.js'), 'utf8'), { loader: 'js', minify: true, legalComments: 'none', target: 'es2020' })).code.replace(/<\/script/g, '<\\/script').trim();

  // La fuente, incrustada en una hoja propia que bloquea el primer pintado: nunca se ve la de reserva
  // ni se mueve el texto al llegar. Es una sola hoja para toda la web: se descarga una vez.
  const fuentes = readFileSync(join(ROOT, 'css/fonts.css'), 'utf8');
  const hojaFuente = escribirConHash(dir, 'fuente', 'css', ['latin', 'latin-ext'].map(subconjunto => {
    const bloque = fuentes.match(new RegExp(`@font-face\\s*\\{[^}]*google-sans-${subconjunto}\\.woff2[^}]*\\}`))?.[0];
    if (!bloque) throw new Error(`css/fonts.css sin google-sans-${subconjunto}`);
    const rango = /unicode-range:([^;]+);/.exec(bloque)[1].trim();
    const datos = readFileSync(join(ROOT, `fonts/web/google-sans-${subconjunto}.woff2`)).toString('base64');
    return `@font-face{font-family:'Google Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${datos}) format('woff2');unicode-range:${rango}}`;
  }).join('\n'));
  const manifiesto = {
    isla: `/a/${relative(dir, entrada)}`,
    css: `/a/${relative(dir, hoja)}`,
    fuente: hojaFuente,
    clasicos: escribirConHash(dir, 'clasicos', 'js', clasicos),
    tema: escribirConHash(dir, 'tema', 'js', tema),
    prePintado,
    hibrido: Object.fromEntries(['jornada', 'inscritos'].map(familia => [familia, shellPublicada(publicadas[familia])])),
    portada: { css: `/a/${relative(dir, hojaPortada)}`, isla: `/a/${relative(dir, entradaPortada)}`, paginas: {} },
    resultados: { isla: `/a/${relative(dir, entradaResultados)}`, prePintado: prePintadoResultados, paginas: {} },
    calendario: { css: `/a/${relative(dir, hojaCalendario)}`, isla: `/a/${relative(dir, entradaCalendario)}`, prePintado: prePintadoCalendario, paginas: {} },
    carrera: { css: `/a/${relative(dir, hojaCarrera)}`, isla: `/a/${relative(dir, entradaCarrera)}`, prePintado: prePintadoCarrera },
    inscritos: { css: `/a/${relative(dir, hoja)}`, isla: `/a/${relative(dir, entradaInscritos)}` },
    etapa: { isla: `/a/${relative(dir, entradaEtapa)}`, prePintadoOrden },
    hoy: { css: `/a/${relative(dir, hojaHoy)}`, isla: salidaHoy, prePintado: prePintadoHoy },
    regeneradas: {
      competicion: { css: `/a/${relative(dir, hoja)}`, isla: salidaDatos('cliente/isla-competicion.js') },
      cx: { css: `/a/${relative(dir, hojaPortada)}`, isla: salidaDatos('cliente/isla-cx.js') },
      torneo: { css: `/a/${relative(dir, hojaPortada)}`, isla: salidaDatos('cliente/isla-torneo.js') },
      campeonatos: { css: `/a/${relative(dir, hojaCampeonatos)}`, isla: salidaDatos('cliente/isla-campeonatos.js') },
      fichajes: { css: `/a/${relative(dir, hojaFichajes)}`, isla: salidaDatos('cliente/isla-fichajes.js'), prePintado: prePintadoMercado },
    },
  };
  manifiesto.portada.paginas = {
    'es-home': shellPortada(publicadas['portada-es-home'], manifiesto, { home: true, lang: 'es' }),
    'en-home': shellPortada(publicadas['portada-en-home'], manifiesto, { home: true, lang: 'en' }),
    'es-agenda': shellPortada(publicadas['portada-es-agenda'], manifiesto, { home: false, lang: 'es' }),
    'en-agenda': shellPortada(publicadas['portada-en-agenda'], manifiesto, { home: false, lang: 'en' }),
  };
  manifiesto.resultados.paginas = {
    es: shellResultados(publicadas['resultados-es'], manifiesto),
    en: shellResultados(publicadas['resultados-en'], manifiesto),
  };
  manifiesto.calendario.paginas = {
    es: shellCalendario(publicadas['calendario-es'], manifiesto),
    en: shellCalendario(publicadas['calendario-en'], manifiesto),
  };
  // Hoy de carretera, tal cual está hoy publicada.
  writeFileSync(join(salida, 'index-ruta.html'), publicadas['portada-es-home']);
  mkdirSync(join(salida, 'en'), { recursive: true });
  writeFileSync(join(salida, 'en/index-ruta.html'), publicadas['portada-en-home']);

  for (const file of archivos(dir)) {
    if (!/\.(js|css|svg)$/.test(file)) continue;
    writeFileSync(`${file}.br`, brotliCompressSync(readFileSync(file), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
    if (process.env.CC_GZ === '1') writeFileSync(`${file}.gz`, gzipSync(readFileSync(file), { level: 9 }));
  }

  // Lo que la página pide por ruta fija.
  for (const name of ['favicon.ico', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'favicon-96x96.png', 'apple-touch-icon.png', 'manifest.json']) {
    copyFileSync(join(ROOT, name), join(salida, name));
  }
  mkdirSync(join(salida, 'i18n'), { recursive: true });
  copyFileSync(join(ROOT, 'i18n/en.json'), join(salida, 'i18n/en.json'));
  cpSync(join(ROOT, 'flags'), join(salida, 'flags'), { recursive: true });

  const pesos = {};
  for (const file of archivos(dir)) {
    if (file.endsWith('.br')) continue;
    let br = 0;
    try { br = statSync(`${file}.br`).size; } catch { /* Sin comprimir: fuentes e imágenes. */ }
    pesos[basename(file)] = { bytes: statSync(file).size, br };
  }
  return { ...manifiesto, pesos };
}
