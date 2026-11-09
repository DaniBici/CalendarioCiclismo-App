#!/usr/bin/env node
// Prototipo de publicación por página sobre las jornadas (solo local y solo
// lectura de la base de datos). Órdenes:
//
//   node tools/publicacion/publicacion.mjs familia --trabajo <dir>
//     Construye activos y publica todas las jornadas ES y EN. Mide tiempos y disco.
//   node tools/publicacion/publicacion.mjs head --trabajo <dir>
//     Coteja el <head> en Node con el de gen_og_pages.py (plantillas/).
//   node tools/publicacion/publicacion.mjs activos --trabajo <dir> [--arbol <dir>]
//     Construye los activos y escribe activos.json, para máquinas sin esbuild (CC_ACTIVOS).
//   node tools/publicacion/publicacion.mjs portada --trabajo <dir>
//     Lee los datos de la portada a datos/portada.json.
//   node tools/publicacion/publicacion.mjs coste --trabajo <dir> [--arbol <dir>]
//     Mide lo que cuesta publicar en esta máquina, a partir de los volcados.
//   node tools/publicacion/publicacion.mjs servir --trabajo <dir> [--puerto 8801] [--rtt 37] [--tls 74]
//     Sirve el árbol. Rutas locales: /__simular?slug=<slug>[&tipo=tv|hora|documento]
//     publica un cambio simulado de esa jornada y devuelve sus tiempos.
//   node tools/publicacion/publicacion.mjs vigilar --trabajo <dir> [--cada 2000] [--minutos 30]
//       [--repintar-cada <min>] [--caida-a <s>] [--registro vigilancia.jsonl]
//     Sondea la señal y publica lo que cambia en producción, sin escribir en ella.
//     Reintenta la conexión y resincroniza al volver. Repinta todo a las 00:05 de
//     Madrid o cada --repintar-cada minutos. --caida-a corta su propia conexión,
//     para probar el reintento.
//
// <dir> contiene datos/jornadas.json (tools/site/prerender-jornadas.sql) y, solo
// para la orden head, plantillas/ (gen_og_pages.py --family stages, ejecutado en
// ese directorio).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { archivosPortada, conectar, Datos, DatosInscritos, leerCarrera, leerInscritos, leerInscritosPorLotes, leerPortada, leerResultadosFeed, leerTemporadas, archivosCalendario, leerTodo, Senal, TABLAS_PORTADA } from './datos.mjs';
import { Publicador } from './publicador.mjs';
import { certificado, crearServidor } from './servidor.mjs';

function argumentos(argv) {
  const opciones = { orden: argv[0] };
  for (let at = 1; at < argv.length; at++) if (argv[at].startsWith('--')) opciones[argv[at].slice(2)] = argv[++at];
  return opciones;
}

const ms = valor => Math.round(valor * 10) / 10;

async function configPublica(trabajo) {
  const file = join(trabajo, 'config.js');
  if (!existsSync(file)) {
    const respuesta = await fetch('https://calendariociclismo.app/js/config.js');
    if (!respuesta.ok) throw new Error(`js/config.js: ${respuesta.status}`);
    writeFileSync(file, await respuesta.text());
  }
  const config = readFileSync(file, 'utf8');
  // En el VPS, las lecturas que quedan van por el mismo origen.
  return process.env.CC_DATOS_MISMO_ORIGEN === '1' ? config.replace(/const SUPABASE_URL\s*=\s*'[^']*'/, 'const SUPABASE_URL = location.origin') : config;
}

async function paginaPublicada(trabajo, familia, ruta) {
  const file = join(trabajo, `publicada-${familia}.html`);
  if (!existsSync(file)) {
    const respuesta = await fetch(`https://calendariociclismo.app/${ruta}`);
    if (!respuesta.ok) throw new Error(`${ruta}: ${respuesta.status}`);
    writeFileSync(file, await respuesta.text());
  }
  return readFileSync(file, 'utf8');
}

// En el VPS no hay esbuild: CC_ACTIVOS apunta al manifiesto ya construido.
async function activosDe(trabajo, salida) {
  if (process.env.CC_ACTIVOS) return JSON.parse(readFileSync(process.env.CC_ACTIVOS, 'utf8'));
  const { construirActivos } = await import('./construir.mjs');
  const publicadas = {
    jornada: await paginaPublicada(trabajo, 'jornada', 'jornada/giro-de-italia-2026-etapa-10/'),
    inscritos: await paginaPublicada(trabajo, 'inscritos', 'inscritos/giro-de-italia-2026/'),
    'portada-es-home': await paginaPublicada(trabajo, 'portada-es-home', ''),
    'portada-en-home': await paginaPublicada(trabajo, 'portada-en-home', 'en/'),
    'portada-es-agenda': await paginaPublicada(trabajo, 'portada-es-agenda', 'ciclocross/'),
    'portada-en-agenda': await paginaPublicada(trabajo, 'portada-en-agenda', 'en/cyclocross/'),
    'resultados-es': await paginaPublicada(trabajo, 'resultados-es', 'resultados/'),
    'resultados-en': await paginaPublicada(trabajo, 'resultados-en', 'en/results/'),
    'calendario-es': await paginaPublicada(trabajo, 'calendario-es', 'calendario/'),
    'calendario-en': await paginaPublicada(trabajo, 'calendario-en', 'en/calendar/'),
  };
  return construirActivos(salida, await configPublica(trabajo), publicadas);
}

/**
 * Activos y procesos de un árbol. `modoJornada`: isla o hibrido. Sin volcados, los
 * de datos/jornadas.json y datos/inscritos.json.
 */
export async function montar(trabajo, salida = join(trabajo, 'arbol'), { volcado = null, volcadoInscritos = null, volcadoPortada = null, modoJornada = 'isla' } = {}) {
  mkdirSync(salida, { recursive: true });
  const inicio = performance.now();
  const activos = { ...await activosDe(trabajo, salida), modoJornada, base: process.env.CC_BASE || join(trabajo, 'base') };
  const construccionMs = performance.now() - inicio;
  const datos = volcado ? new Datos(volcado) : Datos.desdeArchivo(join(trabajo, 'datos/jornadas.json'));
  const inscritos = new DatosInscritos(volcadoInscritos || JSON.parse(readFileSync(join(trabajo, 'datos/inscritos.json'), 'utf8')));
  const archivoPortada = join(trabajo, 'datos/portada.json');
  const portada = volcadoPortada || (existsSync(archivoPortada) ? JSON.parse(readFileSync(archivoPortada, 'utf8')) : null);
  const archivoFeed = join(trabajo, 'datos/feed.json');
  const feed = existsSync(archivoFeed) ? JSON.parse(readFileSync(archivoFeed, 'utf8')) : null;
  const archivoTemporada = join(trabajo, 'datos/temporada.json');
  const temporada = existsSync(archivoTemporada) ? JSON.parse(readFileSync(archivoTemporada, 'utf8')) : null;
  const publicador = new Publicador({ salida, activos, estado: join(trabajo, 'publicadas.json') });
  await publicador.iniciar();
  return { datos, inscritos, portada, feed, temporada, publicador, activos, salida, construccionMs };
}

/** Publica portada y agenda con sus archivos de datos. Solo escribe lo que cambia. */
export async function publicarPortada(publicador, portada, opciones = {}) {
  if (!portada) return null;
  for (const [ruta, texto] of Object.entries(archivosPortada(portada))) publicador.publicarRuta(ruta, texto);
  return publicador.publicar(['home', 'agenda'].map(destino => ({ familia: 'portada', destino, agenda: portada.agenda, rondas: portada.rondas, featured: portada.featured, today_highlights: portada.today_highlights, races: portada.races, race_days: portada.race_days, cx_tournaments: portada.cx_tournaments })), opciones);
}

/** Publica la portada de resultados. Solo escribe lo que cambia. */
export async function publicarResultados(publicador, feed, portada, opciones = {}) {
  if (!feed || !portada) return null;
  return publicador.publicar([{ familia: 'resultados', feed, portada: { agenda: portada.agenda, rondas: portada.rondas, featured: portada.featured } }], opciones);
}

/**
 * Publica las páginas de resultados por carrera sobre las del sitio base. `tablas`: el
 * volcado de tools/site/prerender-resultados.sql; `solo`, las carreras a publicar.
 */
export async function publicarCarreras(publicador, tablas, { solo = null, ...opciones } = {}) {
  const { buildIndex, raceData } = await import('../site/prerender-resultados.mjs');
  const indice = buildIndex(tablas);
  const carreras = tablas.races.filter(race => (race.slug || race.slugEn) && (!solo || solo.has(race.id)));
  const datos = raceData(tablas, carreras.map(race => race.id), indice);
  const diasDe = new Map();
  for (const dia of tablas.race_days) (diasDe.get(dia.raceId) || diasDe.set(dia.raceId, {}).get(dia.raceId))[dia.id] = dia;
  const entradas = carreras.map(race => {
    const dias = diasDe.get(race.id) || {};
    return {
      familia: 'carrera', race, dias, datos: datos.get(race.id),
      stagesAll: indice.stagesByRace.get(race.id) || [], allRaceDays: indice.daysByRace.get(race.id) || [],
      classificationConfig: indice.classificationsByRace.get(race.id) || [],
      assets: Object.fromEntries(Object.keys(dias).map(id => [id, indice.assetsByDay.get(id) || []])),
      guide: indice.guideByRace.get(race.id) || null,
    };
  });
  return publicador.publicar(entradas, opciones);
}

/** Publica perfil, mapa y orden de salida. `tablas`: el volcado de tools/site/prerender-auxiliares.sql. */
export async function publicarEtapas(publicador, tablas, { solo = null, ...opciones } = {}) {
  const { buildIndex, pageInputs } = await import('../site/prerender-auxiliares.mjs');
  const indice = buildIndex(tablas);
  const entradas = [];
  for (const dia of tablas.days) {
    if (solo && !solo.has(dia.raceId)) continue;
    for (const tipo of ['perfil', 'mapa', 'orden']) {
      const entrada = pageInputs(tipo, indice, dia.id);
      if (!entrada.reason) entradas.push({ familia: 'etapa', tipo, entrada });
    }
  }
  const fase = await publicador.publicar(entradas, opciones);
  if (solo && !fase.errores.length) publicador.retirarFamilia('etapa', fase.claves, solo);
  return fase;
}

/**
 * Publica el mercado de fichajes entero: datos del JS, portadas y un documento por equipo.
 * Solo se escribe lo que cambia. `tablas`: volcados de prerender-fichajes.sql y mercado-plantillas.sql.
 */
export async function publicarMercado(publicador, tablas, opciones = {}) {
  const { datosMercado } = await import('./familias-base.mjs');
  const { DUEÑO_MERCADO } = await import('./familia-mercado.mjs');
  const datos = await datosMercado(tablas);
  const texto = JSON.stringify(datos);
  publicador.publicarRuta('d/fichajes.json', texto);
  const fase = await publicador.publicar([{ familia: 'mercado', datos }], opciones);
  if (!fase.errores.length) publicador.retirarFamilia('mercado', fase.claves, new Set([DUEÑO_MERCADO]));
  // Al final: una pestaña abierta solo lo ve con todo lo anterior escrito.
  publicador.publicarRuta('v/mercado.txt', createHash('sha1').update(texto).digest('hex').slice(0, 12));
  return fase;
}

/**
 * Publica Hoy de carretera. `tablas`: volcado de hoy.sql; `portada`, lo que lee el cintillo;
 * `solo`, las fechas a repintar (cambia la hora, no los datos). Solo se escribe lo que cambia.
 */
export async function publicarHoy(publicador, tablas, portada, { solo = null, ...opciones } = {}) {
  const { datosHoy } = await import('./familias-base.mjs');
  const { DUEÑO_HOY } = await import('./familia-hoy.mjs');
  const { dias, anios } = datosHoy(tablas);
  const todas = Object.keys(dias);
  if (!solo) {
    for (const [anio, filas] of Object.entries(anios)) publicador.publicarRuta(`d/hoy/anio-${anio}.json`, JSON.stringify(filas));
    for (const [dia, datos] of Object.entries(dias)) {
      const texto = JSON.stringify(datos);
      publicador.publicarRuta(`d/hoy/${dia}.json`, texto);
      publicador.publicarRuta(`v/hoy/${dia}.txt`, createHash('sha1').update(texto).digest('hex').slice(0, 12));
    }
  }
  const cintillo = { today_highlights: portada.today_highlights, races: portada.races, race_days: portada.race_days, cx_tournaments: portada.cx_tournaments };
  const fase = await publicador.publicar([{ familia: 'hoy', dias, anios, todas, solo, cintillo }], opciones);
  if (!solo && !fase.errores.length) publicador.retirarFamilia('hoy', fase.claves, new Set([DUEÑO_HOY]));
  return fase;
}

const POR_TANDA = 120;
const tandas = lista => Array.from({ length: Math.ceil(lista.length / POR_TANDA) }, (_, at) => lista.slice(at * POR_TANDA, (at + 1) * POR_TANDA));

function jornadasDe(jornadas, ids) {
  const carreras = new Set(ids);
  const dias = new Set(jornadas.days.filter(dia => carreras.has(dia.raceId)).map(dia => dia.id));
  return {
    races: jornadas.races.filter(race => carreras.has(race.id)),
    days: jornadas.days.filter(dia => carreras.has(dia.raceId)),
    broadcasts: jornadas.broadcasts.filter(fila => dias.has(fila.raceDayId)),
    assets: jornadas.assets.filter(fila => dias.has(fila.raceDayId)),
    uci: jornadas.uci.filter(fila => carreras.has(fila.raceId)),
  };
}

/**
 * Publica la competición de `ids` con el volcado de prerender-jornadas.sql (o una parte con la misma
 * forma). Por tandas: el proceso principal no retiene todas las páginas a la vez.
 */
export async function publicarCompeticiones(publicador, jornadas, ids, generacion = 0) {
  const { archivosFamiliasBase } = await import('./familias-base.mjs');
  const claves = [];
  for (const tanda of tandas(ids)) {
    const tablas = jornadasDe(jornadas, tanda);
    for (const [ruta, texto] of Object.entries(await archivosFamiliasBase({ jornadas: tablas }))) publicador.publicarRuta(ruta, texto);
    const fase = await publicador.publicar([{ familia: 'regeneradas', tipo: 'competicion', tablas, generacion }]);
    claves.push(...fase.claves);
  }
  return claves;
}

/**
 * Publica fichas CX y torneos con el volcado de prerender-cx.sql. Sin `temporada` ni `solo`, todos;
 * si no, los de esa temporada y las carreras del conjunto `solo`, de cualquier temporada.
 */
export async function publicarCx(publicador, cx, { temporada = null, solo = null, generacion = 0 } = {}) {
  const { archivosFamiliasBase } = await import('./familias-base.mjs');
  for (const [ruta, texto] of Object.entries(await archivosFamiliasBase({ cx }))) publicador.publicarRuta(ruta, texto);
  const carreras = cx.races.filter(race => (!temporada && !solo) || (temporada && race.seasonKey === temporada) || solo?.has(race.id));
  const torneos = [...new Set(carreras.map(race => race.tournamentId).filter(Boolean))];
  const claves = [];
  // La primera tanda lleva el volcado: el proceso de pintado conserva su índice para las demás.
  await publicador.publicar([{ familia: 'regeneradas', tipo: 'cx', tablas: cx, generacion }]);
  for (const tanda of tandas(carreras.map(race => race.id))) {
    const fase = await publicador.publicar([{ familia: 'regeneradas', tipo: 'cx', carreras: tanda, generacion }]);
    claves.push(...fase.claves);
  }
  const fase = await publicador.publicar([{ familia: 'regeneradas', tipo: 'cx', torneos, generacion }]);
  claves.push(...fase.claves);
  return { claves, carreras: carreras.length, torneos: torneos.length };
}

/**
 * Publica Campeonatos Nacionales. `tablas`: volcado de campeonatos.sql; `portada`, lo que lee el
 * cintillo. Solo se escribe lo que cambia.
 */
export async function publicarCampeonatos(publicador, tablas, portada) {
  const { datosCampeonatos } = await import('./familias-base.mjs');
  const filas = await datosCampeonatos(tablas);
  publicador.publicarRuta('d/campeonatos.json', JSON.stringify(filas));
  const cintillo = { today_highlights: portada.today_highlights, races: portada.races, race_days: portada.race_days, cx_tournaments: portada.cx_tournaments };
  return publicador.publicar([{ familia: 'regeneradas', tipo: 'campeonatos', filas, cintillo }]);
}

/** Publica enteras competición, fichas CX y torneos, sobre el sitio base. */
export async function publicarRegeneradas(publicador, activos, volcados, { generacion = 0 } = {}) {
  const { DUEÑO_REGENERADAS } = await import('./familia-regeneradas.mjs');
  const { publicarInscritosSinLista } = await import('./familias-base.mjs');
  // Antes que las páginas: la lista anterior de rutas aún puede contener las de estas familias.
  const vigentes = new Set();
  const conservar = ruta => vigentes.add(ruta);
  const escribir = (ruta, texto) => { conservar(ruta); publicador.publicarRuta(ruta, texto); };
  const inscritosSinLista = publicarInscritosSinLista(activos, publicador.salida, escribir, conservar);
  const retiradas = publicador.retirarRutasAusentes('regeneradas', vigentes).length;
  const claves = await publicarCompeticiones(publicador, volcados.jornadas, volcados.jornadas.races.map(race => race.id), generacion);
  const fichas = await publicarCx(publicador, volcados.cx, { generacion });
  const avisos = await publicador.publicar([{ familia: 'regeneradas', tipo: 'avisos', generacion }]);
  const todas = [...claves, ...fichas.claves, ...avisos.claves];
  publicador.retirarFamilia('regeneradas', todas, new Set([DUEÑO_REGENERADAS]));
  return { paginas: todas.length, carrerasCx: fichas.carreras, torneos: fichas.torneos, inscritosSinLista, retiradas };
}

/** Publica el calendario con sus archivos de datos. Solo escribe lo que cambia. */
export async function publicarCalendario(publicador, temporada, opciones = {}) {
  if (!temporada) return null;
  for (const [ruta, texto] of Object.entries(archivosCalendario(temporada))) publicador.publicarRuta(ruta, texto);
  return publicador.publicar([{ familia: 'calendario', temporada: { races: temporada.races, race_days: temporada.race_days, challenge_groups: temporada.challenge_groups } }], opciones);
}

/** Todas las entradas de jornadas e inscritos. */
export const todasLasEntradas = (datos, inscritos) => [
  ...datos.carreras().flatMap(raceId => datos.entradas(raceId)),
  ...inscritos.carreras().flatMap(raceId => inscritos.entradas(raceId)),
];

// Campos del <head> que importan a buscadores y redes; el JSON-LD se compara como dato.
const CAMPOS_HEAD = {
  titulo: /<title>([\s\S]*?)<\/title>/, descripcion: /<meta name="description" content="([^"]*)"/, robots: /<meta name="robots" content="([^"]*)"/,
  canonica: /<link rel="canonical" href="([^"]*)"/, es: /hreflang="es" href="([^"]*)"/, en: /hreflang="en" href="([^"]*)"/, xdefault: /hreflang="x-default" href="([^"]*)"/,
  fecha: /<meta name="date" content="([^"]*)"/, modificada: /<meta name="last-modified" content="([^"]*)"/,
  ogTitulo: /property="og:title" content="([^"]*)"/, ogDescripcion: /property="og:description" content="([^"]*)"/, ogUrl: /property="og:url" content="([^"]*)"/,
  ogLocale: /property="og:locale" content="([^"]*)"/, ogSitio: /property="og:site_name" content="([^"]*)"/, ogImagen: /property="og:image" content="([^"]*)"/,
  twTitulo: /name="twitter:title" content="([^"]*)"/, twDescripcion: /name="twitter:description" content="([^"]*)"/,
  jornada: /name="cc:race-day-id" content="([^"]*)"/, carrera: /name="cc:race-id" content="([^"]*)"/,
};

function ordenado(valor) {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map(clave => [clave, ordenado(valor[clave])]));
  return valor;
}

function camposHead(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  const campos = Object.fromEntries(Object.entries(CAMPOS_HEAD).map(([nombre, patron]) => [nombre, patron.exec(head)?.[1] ?? null]));
  campos.jsonLd = JSON.stringify([...head.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(match => ordenado(JSON.parse(match[1]))));
  return campos;
}

async function cotejarHead(trabajo) {
  const { datos, inscritos, publicador } = await montar(trabajo, join(trabajo, 'arbol-head'));
  const trabajos = publicador.trabajos(todasLasEntradas(datos, inscritos));
  const informe = { paginas: 0, iguales: 0, sinPlantilla: 0, porFamilia: {}, porCampo: {}, ejemplos: [] };
  const DIRS = { es: 'jornada', en: 'en/stage', 'inscritos-es': 'inscritos', 'inscritos-en': 'en/startlist' };
  for (const [lang, items] of Object.entries(trabajos)) {
    for (let at = 0; at < items.length; at += 200) {
      const parte = await publicador.pintar(lang, items.slice(at, at + 200));
      if (parte.errores.length) throw new Error(parte.errores[0]);
      for (const pagina of parte.salida) {
        const familia = pagina.clave.split('/')[0];
        const file = join(trabajo, 'plantillas', DIRS[familia], pagina.slug, 'index.html');
        if (!existsSync(file)) { informe.sinPlantilla++; continue; }
        informe.paginas++;
        informe.porFamilia[familia] = (informe.porFamilia[familia] || 0) + 1;
        const esperado = camposHead(readFileSync(file, 'utf8'));
        const obtenido = camposHead(pagina.pagina);
        const distintos = Object.keys(esperado).filter(campo => esperado[campo] !== obtenido[campo]);
        if (!distintos.length) { informe.iguales++; continue; }
        for (const campo of distintos) {
          informe.porCampo[campo] = (informe.porCampo[campo] || 0) + 1;
          if (informe.ejemplos.filter(ejemplo => ejemplo.campo === campo).length < 3) informe.ejemplos.push({ clave: pagina.clave, campo, esperado: String(esperado[campo]).slice(0, 400), obtenido: String(obtenido[campo]).slice(0, 400) });
        }
      }
    }
  }
  writeFileSync(join(trabajo, 'head.json'), JSON.stringify(informe, null, 1));
  console.log(JSON.stringify(informe, null, 1));
  publicador.cerrar();
}

// Lo que cuesta publicar en la máquina donde corre: familia completa, pasada sin
// cambios, una carrera, un abanico y memoria. Sin base de datos: usa los volcados.
async function pruebaCoste(trabajo, opciones) {
  const { datos, inscritos, publicador } = await montar(trabajo, opciones.arbol || join(trabajo, 'arbol'));
  const med = valores => [...valores].sort((a, b) => a - b)[valores.length >> 1];
  const resumen = fase => ({ paginas: fase.paginas, cambiadas: fase.cambiadas, pintadoMs: ms(fase.pintadoMs), pintadoCpuMs: ms(fase.pintadoCpuMs), escrituraMs: ms(fase.escrituraMs), totalMs: ms(fase.totalMs), errores: fase.errores.length });
  const entradas = todasLasEntradas(datos, inscritos);
  const informe = { entradas: entradas.length, familia: resumen(await publicador.publicar(entradas, { forzar: true })) };
  informe.sinCambios = resumen(await publicador.publicar(entradas));
  const buscar = slug => [...datos.days.entries()].find(([, dias]) => dias.some(dia => dia.slug === slug))[0];
  for (const [nombre, slug] of [['giro', 'giro-de-italia-2026-etapa-10'], ['mundial', 'campeonato-del-mundo-linea-masculino-2026']]) {
    const raceId = buscar(slug);
    const carrera = [...datos.entradas(raceId), ...inscritos.entradas(raceId)];
    const tiempos = [];
    let paginas = 0;
    let cambiadas = 0;
    for (let vez = 0; vez < 20; vez++) {
      const fase = await publicador.publicar(carrera, { transformar: entrada => (entrada.rd?.slug === slug && vez % 2 === 0 ? simular('tv', entrada) : entrada) });
      tiempos.push(fase.totalMs);
      paginas = fase.paginas;
      cambiadas = fase.cambiadas;
    }
    informe[`carrera-${nombre}`] = { paginas, cambiadas, medianaMs: ms(med(tiempos)) };
  }
  const usos = new Map();
  for (const raceId of inscritos.carreras()) {
    for (const fila of inscritos.entradas(raceId)[0].rows.teamRows) {
      if (!fila.teamId) continue;
      if (!usos.has(fila.teamId)) usos.set(fila.teamId, new Set());
      usos.get(fila.teamId).add(raceId);
    }
  }
  const [equipo, carreras] = [...usos].sort((a, b) => b[1].size - a[1].size)[0];
  const renombrar = entrada => ({ ...entrada, rows: { ...entrada.rows, teamRows: entrada.rows.teamRows.map(fila => (fila.teamId === equipo && fila.team
    ? { ...fila, team: { ...fila.team, name: 'Equipo De Prueba', team_seasons: (fila.team.team_seasons || []).map(temporada => ({ ...temporada, name: 'Equipo De Prueba' })) } }
    : fila)) } });
  const lista = [...carreras].flatMap(raceId => inscritos.entradas(raceId));
  informe.abanico = { carreras: carreras.size, ...resumen(await publicador.publicar(lista, { transformar: renombrar })) };
  await publicador.publicar(lista);
  const pico = pid => {
    try { return Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]) / 1024; } catch { return null; }
  };
  informe.memoriaMb = { principal: pico(process.pid), ...Object.fromEntries(Object.entries(publicador.trabajadores).map(([lang, hijo]) => [lang, pico(hijo.pid)])) };
  writeFileSync(join(trabajo, 'coste.json'), JSON.stringify(informe, null, 1));
  console.log(JSON.stringify(informe, null, 1));
  publicador.cerrar();
}

async function familia(trabajo) {
  const { datos, inscritos, portada, feed, temporada, publicador, activos, salida, construccionMs } = await montar(trabajo);
  const entradas = todasLasEntradas(datos, inscritos);
  const fase = await publicador.publicar(entradas, { forzar: true });
  await publicarPortada(publicador, portada, { forzar: true });
  await publicarResultados(publicador, feed, portada, { forzar: true });
  await publicarCalendario(publicador, temporada, { forzar: true });
  const disco = execSync(`du -sk ${JSON.stringify(salida)}`).toString().split('\t')[0];
  const informe = { construccionMs: ms(construccionMs), entradas: entradas.length, ...fase, claves: undefined, clavesCambiadas: undefined, errores: fase.errores.slice(0, 10), erroresTotal: fase.errores.length, discoKb: Number(disco), pesos: activos.pesos };
  writeFileSync(join(trabajo, 'familia.json'), JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ ...informe, pesos: undefined }, null, 1));
  publicador.cerrar();
}

// Cambio simulado sobre la entrada de una jornada, en memoria: nada se escribe
// en la base de datos.
export function simular(tipo, input) {
  if (tipo === 'cancelada') return { ...input, rd: { ...input.rd, isCancelledDay: true } };
  if (tipo === 'sinperfil') return { ...input, rd: { ...input.rd, elevationProfile: null, profileSummits: null, profileWaypoints: null, routeGpxUrl: null, profileNotViewable: true } };
  if (tipo === 'hora') {
    const rd = { ...input.rd, neutralStartTimeUtc: new Date(new Date(input.rd.neutralStartTimeUtc || Date.UTC(2026, 6, 1, 10)).getTime() + 300000).toISOString() };
    return { ...input, rd };
  }
  if (tipo === 'documento') {
    return { ...input, assets: [...input.assets, { id: 'zz-prototipo', raceDayId: input.rd.id, type: 'roadbook', url: 'https://assets.calendariociclismo.app/og/calendario-ciclismo.jpg', filePath: null }] };
  }
  return {
    ...input,
    broadcasts: [{ id: 'zz-prototipo', raceDayId: input.rd.id, channel: 'Canal de prueba', country: 'ALL', url: 'https://example.com/directo',
      startTimeUtc: input.broadcasts[0]?.startTimeUtc || null, sortOrder: -1, embeddable: false, note: null, showInRevive: true }, ...input.broadcasts],
  };
}

async function servir(trabajo, opciones) {
  const { datos, inscritos, portada, feed, temporada, publicador } = await montar(trabajo);
  const jornadas = datos.carreras().flatMap(raceId => datos.entradas(raceId));
  const porSlug = new Map();
  for (const input of jornadas) {
    porSlug.set(input.rd.slug, input);
    if (input.rd.slugEn) porSlug.set(input.rd.slugEn, input);
  }
  await publicador.publicar(todasLasEntradas(datos, inscritos), { forzar: true });
  await publicarPortada(publicador, portada, { forzar: true });
  await publicarResultados(publicador, feed, portada, { forzar: true });
  await publicarCalendario(publicador, temporada, { forzar: true });
  console.log(`Árbol listo: ${jornadas.length} jornadas e ${inscritos.carreras().length} listas`);
  const admin = async (url, stream) => {
    const slug = url.searchParams.get('slug');
    const tipo = url.searchParams.get('tipo') || 'tv';
    const input = porSlug.get(slug);
    const responder = (status, cuerpo) => { stream.respond({ ':status': status, 'content-type': 'application/json' }); stream.end(JSON.stringify(cuerpo)); };
    if (!input) return responder(404, { error: 'jornada desconocida' });
    if (url.pathname === '/__restaurar') {
      return responder(200, await publicador.publicar([input]));
    }
    return responder(200, await publicador.publicar([input], { transformar: entrada => simular(tipo, entrada) }));
  };
  const tls = certificado(join(trabajo, 'tls'));
  await crearServidor({ puerto: Number(opciones.puerto || 8801), tls, raiz: join(trabajo, 'arbol'), espejo: { origen: 'https://calendariociclismo.app', cache: join(trabajo, 'espejo') }, rtt: Number(opciones.rtt || 0), tlsMs: Number(opciones.tls || 0), admin });
  console.log(`Sirviendo en https://localhost:${opciones.puerto || 8801}/`);
}

// Repintado completo a las 00:05 de Madrid. Hace dos cosas: actualiza lo que cambia
// con la fecha y no con los datos (CX_HOME, el año del calendario) y sirve de red de
// seguridad, porque toda página que cambie en él tiene una dependencia sin registrar.
const horaMadrid = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

async function vigilar(trabajo, opciones) {
  const cada = Number(opciones.cada || 2000);
  const minutos = Number(opciones.minutos || 30);
  const repintarCada = Number(opciones['repintar-cada'] || 0);
  const caidaA = Number(opciones['caida-a'] || 0);
  const registro = join(trabajo, opciones.registro || 'vigilancia.jsonl');
  const anotar = fila => { appendFileSync(registro, `${JSON.stringify({ en: new Date().toISOString(), ...fila })}\n`); };
  const arranque = Date.now();
  const fin = arranque + minutos * 60_000;
  let publicador = null;
  let datos = null;
  let inscritos = null;
  let portada = null;
  let ultimoReloj = 0;
  let espera = 1000;
  let ultimoRepintado = Date.now();
  let diaRepintado = null;
  let caidaProvocada = false;
  const sondeos = [];
  anotar({ evento: 'inicio', cada, repintarCada });

  async function sincronizar(cliente, evento) {
    const inicio = performance.now();
    const volcado = await leerTodo(cliente);
    const lotes = [];
    const volcadoInscritos = await leerInscritosPorLotes(cliente, { informar: tiempo => lotes.push(tiempo) });
    portada = await leerPortada(cliente);
    const leido = performance.now();
    if (publicador) {
      datos = new Datos(volcado);
      inscritos = new DatosInscritos(volcadoInscritos);
      if (evento === 'repintado') await publicador.reiniciar();
    } else {
      ({ publicador, datos, inscritos } = await montar(trabajo, join(trabajo, 'arbol-vigilar'), { volcado, volcadoInscritos, volcadoPortada: portada }));
    }
    const fase = await publicador.sincronizar(todasLasEntradas(datos, inscritos));
    await publicarPortada(publicador, portada);
    anotar({ evento, lecturaMs: ms(leido - inicio), loteMaxMs: ms(Math.max(...lotes)), totalMs: ms(performance.now() - inicio), paginas: fase.paginas, cambiadas: fase.cambiadas, retiradas: fase.retiradas.length, redirigidas: fase.redirigidas.length, muestra: fase.clavesCambiadas.slice(0, 20), errores: fase.errores.slice(0, 5) });
  }

  while (Date.now() < fin) {
    let cliente = null;
    try {
      cliente = await conectar();
      // La señal arranca antes de leer: lo que cambie durante la lectura se vuelve a publicar.
      const senal = new Senal(cliente);
      await senal.iniciar();
      await sincronizar(cliente, publicador ? 'resincronizado' : 'base');
      espera = 1000;
      while (Date.now() < fin) {
        if (caidaA && !caidaProvocada && Date.now() - arranque > caidaA * 1000) {
          caidaProvocada = true;
          anotar({ evento: 'caida-provocada' });
          await cliente.query('select pg_terminate_backend(pg_backend_pid())');
        }
        const inicio = performance.now();
        const cambios = await senal.comprobar();
        const comprobarMs = performance.now() - inicio;
        sondeos.push(comprobarMs);
        if (cambios.length) {
          const detectado = Date.now();
          const porTabla = {};
          for (const { tabla, tipo } of cambios) porTabla[`${tabla}:${tipo}`] = (porTabla[`${tabla}:${tipo}`] || 0) + 1;
          anotar({ evento: 'cambios', porTabla, comprobarMs: ms(comprobarMs) });
          if (cambios.some(cambio => TABLAS_PORTADA.includes(cambio.tabla))) {
            const antesPortada = performance.now();
            portada = await leerPortada(cliente);
            const leidoPortada = performance.now();
            const fase = await publicarPortada(publicador, portada);
            anotar({ evento: 'portada', motivo: 'datos', lecturaMs: ms(leidoPortada - antesPortada), publicarMs: ms(performance.now() - leidoPortada), cambiadas: fase.clavesCambiadas });
          }
          const carreras = [...new Set(cambios.map(cambio => cambio.raceId).filter(Boolean))];
          const lista = await leerInscritos(cliente, carreras);
          inscritos.absorber(lista, carreras);
          for (const raceId of carreras) {
            const lectura = performance.now();
            const filas = await leerCarrera(cliente, raceId);
            const leido = performance.now();
            datos.reemplazarCarrera(raceId, filas);
            const fase = await publicador.publicarCarrera(raceId, [...datos.entradas(raceId), ...inscritos.entradas(raceId)]);
            const marcas = [...filas.days.map(day => Date.parse(day.updatedAt)), Date.parse(filas.marcaResultados)].filter(Number.isFinite);
            const marca = marcas.length ? Math.max(...marcas) : null;
            anotar({
              evento: 'publicado', raceId, cambios: cambios.filter(cambio => cambio.raceId === raceId).map(({ tabla, tipo }) => `${tabla}:${tipo}`).slice(0, 10),
              lecturaMs: ms(leido - lectura), pintadoMs: ms(fase.pintadoMs), escrituraMs: ms(fase.escrituraMs), paginas: fase.paginas, cambiadas: fase.cambiadas,
              retiradas: fase.retiradas, redirigidas: fase.redirigidas, detectadoAPublicadoMs: ms(Date.now() - detectado),
              ultimaMarca: marca ? new Date(marca).toISOString() : null, marcaAPublicadoMs: marca ? Date.now() - marca : null, errores: fase.errores.slice(0, 5),
            });
          }
          const sinCarrera = cambios.filter(cambio => !cambio.raceId && !TABLAS_PORTADA.includes(cambio.tabla));
          if (sinCarrera.length) anotar({ evento: 'sin-carrera', cambios: sinCarrera.slice(0, 20) });
        }
        if (sondeos.length % 60 === 0) {
          const orden = [...sondeos].sort((a, b) => a - b);
          anotar({ evento: 'sondeo', n: orden.length, medianaMs: ms(orden[orden.length >> 1]), p95Ms: ms(orden[Math.floor(orden.length * 0.95)]) });
        }
        // La portada depende de la hora: se vuelve a pintar cada minuto y solo se publica si cambia.
        if (Date.now() - ultimoReloj > 60_000) {
          ultimoReloj = Date.now();
          const fase = await publicarPortada(publicador, portada);
          if (fase?.cambiadas) anotar({ evento: 'portada', motivo: 'reloj', totalMs: ms(fase.totalMs), cambiadas: fase.clavesCambiadas });
        }
        const partes = Object.fromEntries(horaMadrid.formatToParts(new Date()).map(parte => [parte.type, parte.value]));
        const hoy = `${partes.year}-${partes.month}-${partes.day}`;
        const tocaPorHora = `${partes.hour}:${partes.minute}` === '00:05' && diaRepintado !== hoy;
        if (tocaPorHora || (repintarCada && Date.now() - ultimoRepintado > repintarCada * 60_000)) {
          diaRepintado = hoy;
          ultimoRepintado = Date.now();
          await sincronizar(cliente, 'repintado');
        }
        await new Promise(done => setTimeout(done, cada));
      }
    } catch (error) {
      anotar({ evento: 'caida', error: error.message, esperaMs: espera });
      await new Promise(done => setTimeout(done, espera));
      espera = Math.min(espera * 2, 60_000);
    } finally {
      await cliente?.end().catch(() => {});
    }
  }
  anotar({ evento: 'fin', sondeos: sondeos.length });
  publicador?.cerrar();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const opciones = argumentos(process.argv.slice(2));
  const trabajo = opciones.trabajo;
  if (!trabajo) throw new Error('Falta --trabajo <dir>');
  const ordenes = {
    activos: async () => {
      const salida = opciones.arbol || join(trabajo, 'arbol');
      mkdirSync(salida, { recursive: true });
      writeFileSync(join(trabajo, 'activos.json'), JSON.stringify(await activosDe(trabajo, salida)));
    },
    coste: () => pruebaCoste(trabajo, opciones),
    temporada: async () => {
      const cliente = await conectar();
      const inicio = performance.now();
      const volcado = await leerTemporadas(cliente);
      await cliente.end();
      mkdirSync(join(trabajo, 'datos'), { recursive: true });
      writeFileSync(join(trabajo, 'datos/temporada.json'), JSON.stringify(volcado));
      console.log(`Temporadas leídas en ${Math.round(performance.now() - inicio)} ms: ${volcado.races.length} carreras, ${volcado.race_days.length} jornadas, ${volcado.modal.length} modales`);
    },
    feed: async () => {
      const cliente = await conectar();
      const inicio = performance.now();
      const volcado = await leerResultadosFeed(cliente);
      await cliente.end();
      mkdirSync(join(trabajo, 'datos'), { recursive: true });
      writeFileSync(join(trabajo, 'datos/feed.json'), JSON.stringify(volcado));
      console.log(`Últimos resultados leídos en ${Math.round(performance.now() - inicio)} ms: ${volcado.race_uci_stages.length} clasificaciones`);
    },
    portada: async () => {
      const cliente = await conectar();
      const inicio = performance.now();
      const volcado = await leerPortada(cliente);
      await cliente.end();
      mkdirSync(join(trabajo, 'datos'), { recursive: true });
      writeFileSync(join(trabajo, 'datos/portada.json'), JSON.stringify(volcado));
      console.log(`Portada leída en ${Math.round(performance.now() - inicio)} ms: ${volcado.agenda.length} pruebas, ${volcado.today_highlights.length} entradas de cintillo`);
    },
    familia: () => familia(trabajo), head: () => cotejarHead(trabajo), servir: () => servir(trabajo, opciones), vigilar: () => vigilar(trabajo, opciones) };
  if (!ordenes[opciones.orden]) throw new Error(`Orden desconocida: ${opciones.orden}`);
  await ordenes[opciones.orden]();
}
