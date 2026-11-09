// Proceso de pintado por idioma, con la zona horaria de su idioma: compone la
// página entera con los renderizadores que usa el navegador y head.mjs.
//
// Dos modos de página:
// - isla: el navegador no vuelve a pintar; script previo al primer pintado e isla.
// - híbrido: el HTML lleva la huella y el JS actual, que confirma con Supabase y
//   conserva el DOM si coincide. Es el primer paso de una migración: no toca el
//   cliente de la familia.
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installBrowserEnv } from '../site/prerender-jornadas.mjs';
import { PRIMARY_ICONS, STRINGS, headerHtml } from '../../js/header-html.js';
import { buildInhouseResultsMatcher, hasCalendarForYear } from '../../js/services/races.js';
import { isNearToday } from '../../js/services/refresh-window.js';
import { reviveBroadcastsForDay, hasReviveBroadcastsForDay } from '../../js/broadcast-priority.js';
import { htmlFingerprint } from '../../js/html-fingerprint.js';
import { cabezaInscritos, cabezaJornada } from './head.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lang = process.argv[2];
const ZONAS = { es: { zona: 'Europe/Madrid', etiqueta: null }, en: { zona: 'Etc/GMT', etiqueta: 'GMT' } };
const { zona, etiqueta } = ZONAS[lang];

installBrowserEnv(lang);
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const { initI18n, t } = await load('js/i18n.js');
const { raceUrl, filterBroadcastsByRegion, withRaceTechnicalGuide, broadcastRegionBadgeLabel,
  articuloNombre, conArticulo, deArticulo, originalNameDistinto, raceSearchName } = await load('js/shared.js');
const AYUDAS = { articuloNombre, conArticulo, deArticulo, originalNameDistinto, raceSearchName };
const { jornadaHtml } = await load('js/jornada-html.js');
const { prepareStartlistData } = await load('js/startlist/data.js');
const { inscritosHtml } = await load('js/inscritos-html.js');
await initI18n();

let ACTIVOS = null;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const huella = text => createHash('sha1').update(text).digest('hex').slice(0, 12);

// Grupos de emisión que distingue filterBroadcastsByRegion(); misma regla, con
// el grupo como parámetro.
const GRUPOS = [
  ...['ES', 'PT', 'FR', 'BE', 'NL', 'IT', 'DE_AT_CH', 'UK_IE', 'SCANDI', 'EE'].map(group => ({ clave: group, group, eu: true })),
  { clave: '_EU', group: null, eu: true },
  ...['LATAM', 'NORTEAM', 'ASIAPAC', 'AFRICA', 'MENA'].map(group => ({ clave: group, group, eu: false })),
  { clave: '_X', group: null, eu: false },
];

function visiblePara(b, { group, eu }) {
  if (!b.country || b.country === 'ALL') return true;
  if (b.country === 'EUROPA') return eu && group !== 'UK_IE';
  return !!group && b.country === group;
}

const PANEL = /<section class="jornada-section tv-panel">[\s\S]*?<\/section>/;
const INSIGNIA = /<span class="badge badge--uci tv-region-badge">[^<]*<\/span>/g;
const FILA = /<div class="tv-entry(?: tv-entry--regional-hidden)?"[^>]*>/g;

// El HTML de una variante sale de jornadaHtml() con la región del proceso: las
// insignias se rehacen para que marquen lo que ese grupo no ve.
function corregirInsignias(panel, filas, ocultas) {
  const trozos = panel.split(FILA);
  const cabeceras = panel.match(FILA) || [];
  let salida = trozos[0];
  cabeceras.forEach((cabecera, at) => {
    const b = filas[at];
    let fila = trozos[at + 1].replace(INSIGNIA, '');
    if (b && ocultas.has(b.id)) {
      const texto = broadcastRegionBadgeLabel(b.country);
      if (texto) fila = fila.replace(/<\/div>\s*<\/div>\s*<div class="tv-entry__actions">/, m => `<span class="badge badge--uci tv-region-badge">${texto}</span>${m}`);
    }
    salida += cabecera + fila;
  });
  return salida;
}

function variantesTv(input, assets, matcher, base) {
  const todas = input.broadcasts;
  if (!todas.length) return '';
  const hasActual = matcher.has(input.rd);
  const idsBase = filterBroadcastsByRegion(todas).map(b => b.id).join();
  const porConjunto = new Map();
  for (const grupo of GRUPOS) {
    const visibles = todas.filter(b => visiblePara(b, grupo));
    const ids = visibles.map(b => b.id).join();
    if (ids === idsBase) continue;
    if (!porConjunto.has(ids)) porConjunto.set(ids, { visibles, claves: [] });
    porConjunto.get(ids).claves.push(grupo.clave);
  }
  if (!porConjunto.size) return '';
  const rdLite = { ...input.rd, elevationProfile: null, profileSummits: null, profileWaypoints: null, description: null, bonuses: null, notes: null, translations: null };
  const panelBase = PANEL.exec(base)?.[0] || '';
  let salida = '';
  for (const { visibles, claves } of porConjunto.values()) {
    const html = jornadaHtml(rdLite, input.race, visibles, assets, [], input.hasStartlist, todas, matcher, { timeZoneLabel: etiqueta }).html;
    let panel = PANEL.exec(html)?.[0] || '';
    if (panel) {
      const revive = hasReviveBroadcastsForDay(visibles, hasActual, input.rd.isCancelledDay);
      const ids = new Set(visibles.map(b => b.id));
      const ocultas = todas.filter(b => !ids.has(b.id));
      const filas = revive ? reviveBroadcastsForDay(visibles, input.rd.isCancelledDay) : [...visibles, ...ocultas];
      panel = corregirInsignias(panel, filas, new Set(ocultas.map(b => b.id)));
    }
    if (panel !== panelBase) salida += `<template data-tv="${claves.join(' ')}">${panel}</template>`;
  }
  return salida;
}

function barraAcciones(rd, race) {
  const CAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
  const FLAG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>';
  const suscribir = hasCalendarForYear(race?.year) && !!rd.slug && !rd.isRestDay && !rd.isCancelledDay;
  return `<div id="icalBar" class="ical-bar">${suscribir ? `<button type="button" class="btn-ical" id="icalOpenBtn">${CAL} ${t('stage.addToCalendar')}</button>` : ''}<button type="button" class="btn-ical btn-ical--report" id="reportBarBtn">${FLAG} ${t('stage.reportChanges')}</button></div>`;
}

function creditos() {
  return lang === 'en'
    ? '<p>&copy; 2026 Calendario Ciclismo - Created and edited by <a href="https://danisanchez.info" target="_blank" rel="noopener">Dani&nbsp;S&aacute;nchez</a> - <a href="/en/privacy/">Privacy</a> - <a href="/en/terms/">Terms</a></p>'
    : '<p>&copy; 2026 Calendario Ciclismo - Ideado y editado por <a href="https://danisanchez.info" target="_blank" rel="noopener">Dani&nbsp;S&aacute;nchez</a> - <a href="/privacidad.html">Privacidad</a> - <a href="/terminos.html">T&eacute;rminos</a></p>';
}

function pie() {
  const s = STRINGS[lang];
  const acciones = `<p class="site-footer__actions"><a class="footer-link footer-link--icon footer-link--about" href="${s.aboutHref}">${PRIMARY_ICONS.about}<span>${s.aboutText}</span></a>`
    + `<a class="footer-link footer-link--icon" href="${s.openHref}">${PRIMARY_ICONS.open}<span>${s.openText}</span></a>`
    + `<a class="footer-link footer-link--icon" href="${s.icalHref}">${PRIMARY_ICONS.calendar}<span>${s.icalText}</span></a></p>`;
  return `<footer class="site-footer">${creditos()}${acciones}</footer>`;
}

// Página con el JS actual: mismo marcado que los prerender del build.
function paginaHibrida({ head, container, atributos = '', html, familia }) {
  const shell = ACTIVOS.hibrido[familia];
  const cabecera = `<header class="site-header" id="siteHeader" data-back>${headerHtml({ lang, hasBack: true, active: null })}</header>${shell.scriptCabecera}`;
  return `${head}<body>\n${cabecera}\n<main id="${container}"${atributos} data-prerendered="${htmlFingerprint(html)}">\n${html}\n</main>\n`
    + `<footer class="site-footer">${creditos()}</footer>\n${shell.scriptsPie}\n</body>\n</html>\n`;
}

function etiquetasHibridas(familia) {
  return ACTIVOS.hibrido[familia].precargas;
}

function activosHibridos(familia) {
  const { tema, css } = ACTIVOS.hibrido[familia];
  return { tema, css, fuente: null, conSupabase: true };
}

function componerInscritos(item) {
  const { input, slug } = item;
  const prepared = prepareStartlistData(input.race, input.rows);
  if (!prepared) throw new Error('sin equipos');
  const html = inscritosHtml(input.race, prepared, { oneDayRd: input.oneDayRd, assets: withRaceTechnicalGuide(input.oneDayAssets, input.guide) });
  const clave = `inscritos-${lang}/${slug}`;
  const version = huella(html);
  const sondeo = input.race.startlistProvisional || isNearToday(input.race.startDate, input.race.endDate);
  const { tema, fuente, inscritos } = ACTIVOS;
  const head = cabezaInscritos(lang, input.race, input.recuentos, { tema, fuente, css: inscritos.css, conSupabase: false }, AYUDAS,
    `<meta name="cc:clave" content="${attr(clave)}"><meta name="cc:v" content="${version}"><link rel="modulepreload" fetchpriority="low" href="${inscritos.isla}">`);
  const cabecera = `<header class="site-header" id="siteHeader" data-back>${headerHtml({ lang, hasBack: true, active: null })}</header>`;
  const atributos = `id="${lang === 'en' ? 'startlistContent' : 'inscritosContent'}" data-clave="${attr(clave)}" data-sondeo="${sondeo ? 1 : 0}" data-volver="${attr(raceUrl(input.race))}"`;
  return {
    slug, clave, version, raceId: input.race.id, dayId: input.race.id,
    pagina: `${head}<body>\n${RESERVA_ANDROID}\n${cabecera}\n<main ${atributos}>\n${html}\n</main>\n${pie()}\n<script defer src="${ACTIVOS.clasicos}"></script>\n<script type="module" src="${inscritos.isla}"></script>\n</body>\n</html>\n`,
    fragmento: null, datos: JSON.stringify({ race: input.race, rows: input.rows }),
  };
}

function componer(item, activos) {
  if (item.familia === 'portada') return componerPortada(item, activos);
  if (item.familia === 'resultados') return componerResultados(item, activos);
  if (item.familia === 'calendario') return componerCalendario(item, activos);
  if (item.familia === 'carrera') return componerCarrera(item, activos);
  if (item.familia === 'mercado') return componerMercado(item, activos);
  if (item.familia === 'hoy') return componerHoy(item, activos);
  if (item.familia === 'regeneradas') return componerRegeneradas(item, activos);
  if (item.familia === 'etapa') return componerEtapa(item, activos);
  if (item.familia === 'inscritos') return componerInscritos(item);
  const { input, slug } = item;
  const assets = withRaceTechnicalGuide(input.assets, input.guide);
  const matcher = buildInhouseResultsMatcher(input.uci);
  const { html, hasActualResults } = jornadaHtml(input.rd, input.race, filterBroadcastsByRegion(input.broadcasts), assets,
    input.siblings, input.hasStartlist, input.broadcasts, matcher, { timeZoneLabel: etiqueta });
  const clave = `${lang}/${slug}`;
  if (activos.modoJornada === 'hibrido') {
    const head = cabezaJornada(lang, input.rd, input.race, input.diasCarrera, activosHibridos('jornada'), AYUDAS, etiquetasHibridas('jornada'));
    return {
      slug, clave, version: htmlFingerprint(html), raceId: input.rd.raceId, dayId: input.rd.id,
      pagina: paginaHibrida({ head, container: 'jornadaContent', atributos: ` style="--card-color:${attr(input.race.colorHex || '#888')}"`, html, familia: 'jornada' }),
      fragmento: null, datos: null,
    };
  }
  const variantes = variantesTv(input, assets, matcher, html);
  const version = huella(html + variantes);

  const cabecera = `<header class="site-header" id="siteHeader" data-back>${headerHtml({ lang, hasBack: true, active: null }).replace('href="#main"', 'href="#jornadaContent"')}</header>`;
  const atributos = `id="jornadaContent" tabindex="-1" style="--card-color:${attr(input.race.colorHex || '#888')}" data-date-key="${attr(input.rd.dateKey || '')}"`
    + ` data-tz="${zona}" data-dias="${attr(t('days.abbr').join())}" data-tz-texto="${attr(t('stage.yourTimezone'))}"`
    + ` data-tv-todas="${attr(t('tv.filterAll'))}" data-tv-mias="${attr(t('tv.filterMine'))}"`
    + ` data-ver="${attr(t('stage.watch'))}" data-cerrar="${attr(t('ical.closeLabel'))}"`;

  const head = cabezaJornada(lang, input.rd, input.race, input.diasCarrera, activos, AYUDAS,
    `<meta name="cc:clave" content="${attr(clave)}"><meta name="cc:v" content="${version}"><link rel="modulepreload" fetchpriority="low" href="${activos.isla}">`);

  const pagina = `${head}<body>\n${RESERVA_ANDROID}\n${cabecera}\n<main ${atributos}>\n${html}\n</main>\n${variantes}${barraAcciones(input.rd, input.race)}\n`
    + `<script>${activos.prePintado}</script>\n${pie()}\n`
    + `<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.isla}"></script>\n</body>\n</html>\n`;

  return {
    slug, clave, version, pagina, raceId: input.rd.raceId, dayId: input.rd.id,
    fragmento: `${html}\n${variantes}`,
    datos: JSON.stringify({ rd: input.rd, race: input.race, assets, hasActualResults }),
  };
}

// Después de instalar el entorno: sus módulos lo leen al cargarse.
const { crearFamiliaPortada, RESERVA_ANDROID } = await import('./familia-portada.mjs');
const componerPortada = await crearFamiliaPortada({ lang, t, headerHtml, pie, huella });
const { crearFamiliaResultados } = await import('./familia-resultados.mjs');
const componerResultados = await crearFamiliaResultados({ lang, headerHtml, pie, huella });
const { crearFamiliaCalendario } = await import('./familia-calendario.mjs');
const componerCalendario = await crearFamiliaCalendario({ lang, t, headerHtml, pie, huella });
const { crearFamiliaCarrera } = await import('./familia-carrera.mjs');
const componerCarrera = await crearFamiliaCarrera({ lang, headerHtml, pie, huella });
const { crearFamiliaMercado } = await import('./familia-mercado.mjs');
const componerMercado = await crearFamiliaMercado({ lang, t, huella });
const { crearFamiliaRegeneradas } = await import('./familia-regeneradas.mjs');
const componerRegeneradas = await crearFamiliaRegeneradas({ lang, headerHtml, huella });
const { crearFamiliaHoy } = await import('./familia-hoy.mjs');
const componerHoy = await crearFamiliaHoy({ lang, t, headerHtml, pie, huella, grupos: GRUPOS, visiblePara });
const { crearFamiliaEtapa } = await import('./familia-etapa.mjs');
const componerEtapa = await crearFamiliaEtapa({ lang, t, headerHtml, pie, huella });

process.on('message', async ({ id, items, activos }) => {
  ACTIVOS = activos;
  const inicio = performance.now();
  const salida = [];
  const errores = [];
  for (const item of items) {
    try {
      salida.push(...[].concat(await componer(item, activos)));
    } catch (error) {
      errores.push(`${lang}/${item.slug}: ${error.message}`);
    }
  }
  process.send({ id, salida, errores, ms: performance.now() - inicio });
});
process.send({ listo: true });
