// Competición, fichas CX y torneos pintados desde la base de datos con los generadores del build,
// sobre el <head> y la estructura del sitio base. Una carrera que cambia se repinta al momento; el
// sitio base solo aporta las URL nuevas. El JS llega al quedar libre la página (familias-base.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { conIsla, paginasBajo } from './familias-base.mjs';
import { crearCintillo } from './familia-portada.mjs';
import { composePage as componerJornada, headerOptions } from '../site/prerender-jornadas.mjs';
import { buildIndex as indiceCompeticion, competitionInputs, RACE_META } from '../site/prerender-competicion.mjs';
import { buildIndex as indiceCx, composePage as componerCx, composeTournamentPage, pageRaceId, pageTournamentId, raceInputs, tournamentPage } from '../site/prerender-cx.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const DIRS = {
  es: { competicion: 'competicion', cx: 'ciclocross', omitir: 'torneos', torneos: 'ciclocross/torneos' },
  en: { competicion: 'en/race', cx: 'en/cyclocross', omitir: 'series', torneos: 'en/cyclocross/series' },
};
export const DUEÑO_REGENERADAS = 'regeneradas';

export async function crearFamiliaRegeneradas({ lang, headerHtml, huella }) {
  const { filterBroadcastsByRegion, countryFlag, stageLabel, raceName } = await load('js/shared.js');
  const { annotateDoubleSectors } = await load('js/services/races.js');
  const { competitionPageHtml, sortCompetitionDays } = await load('js/competicion-html.js');
  const { cxTournamentRounds } = await load('js/services/cx-data.js');
  const { cxSeasonBounds } = await load('js/cx/season.js');
  const { cxTournamentGeneralCategories } = await load('js/cx/presentation.js');
  const cxHtml = await load('js/cx-race-html.js');
  const agendaHtml = await load('js/cx-agenda-html.js');
  const { htmlFingerprint } = await load('js/html-fingerprint.js');
  const { CX_HOME } = await load('js/header-html.js');
  const ayudas = { filterBroadcastsByRegion, annotateDoubleSectors, sortCompetitionDays };
  const { CAMP } = await load('js/campeonatos-config.js');
  const { campEmptyHtml, campPageHtml, prepareChampionships } = await load('js/campeonatos-html.js');
  const cintillo = await crearCintillo();
  const dirs = DIRS[lang];

  // Qué página del sitio base corresponde a cada carrera y torneo: se rehace con cada generación.
  let mapa = null;
  function mapaBase(activos, generacion) {
    if (mapa?.generacion === generacion) return mapa;
    const nuevo = { generacion, competicion: new Map(), cx: new Map(), torneos: new Map(), sinDatos: [] };
    for (const ruta of paginasBajo(activos.base, dirs.competicion)) {
      const id = RACE_META.exec(readFileSync(join(activos.base, ruta, 'index.html'), 'utf8'))?.[1];
      if (id) nuevo.competicion.set(id, ruta);
      else nuevo.sinDatos.push({ ruta, tipo: 'competicion' });
    }
    for (const ruta of paginasBajo(activos.base, dirs.cx, [dirs.omitir])) {
      const id = pageRaceId(readFileSync(join(activos.base, ruta, 'index.html'), 'utf8'));
      if (id) (nuevo.cx.get(id) || nuevo.cx.set(id, []).get(id)).push(ruta);
      else nuevo.sinDatos.push({ ruta, tipo: 'cx' });
    }
    for (const ruta of paginasBajo(activos.base, dirs.torneos)) {
      const id = pageTournamentId(readFileSync(join(activos.base, ruta, 'index.html'), 'utf8'));
      if (id) nuevo.torneos.set(id, ruta);
      else nuevo.sinDatos.push({ ruta, tipo: 'torneo' });
    }
    mapa = nuevo;
    return mapa;
  }

  const documento = (ruta, html, activos, tipo) => {
    const { css, isla } = activos.regeneradas[tipo];
    const pagina = conIsla(html, { tema: activos.tema, fuente: activos.fuente, clasicos: activos.clasicos, css, isla });
    if (!pagina) throw new Error(`${ruta}: sin la estructura esperada`);
    const slug = ruta.replace(/\//g, '_');
    return { slug, clave: `regeneradas-${lang}/${slug}`, version: huella(pagina), pagina, raceId: DUEÑO_REGENERADAS, dayId: slug, fragmento: null, datos: null, ruta };
  };
  const fuente = (activos, ruta) => readFileSync(join(activos.base, ruta, 'index.html'), 'utf8');
  const existe = (activos, ruta) => existsSync(join(activos.base, ruta, 'index.html'));

  function competicion(input, activos, base) {
    const indice = indiceCompeticion(input.tablas);
    const salida = [];
    for (const race of input.tablas.races) {
      const ruta = base.competicion.get(race.id);
      if (!ruta || !existe(activos, ruta)) continue;
      const entrada = competitionInputs(indice, race.id, ayudas);
      if (!entrada) continue;
      const opciones = { race: entrada.race, flag: countryFlag(entrada.race.countryCode), tooltipName: raceName(entrada.race) };
      const tarjeta = rd => ({ ...opciones, title: stageLabel(rd.stageNumber, rd._stageSuffix) });
      const source = fuente(activos, ruta);
      const pagina = componerJornada(source, {
        container: 'competicionContent', headerInner: headerHtml(headerOptions(source, lang)),
        html: competitionPageHtml(entrada.race, entrada.days, tarjeta, { dynamic: true }),
        fingerprint: htmlFingerprint(competitionPageHtml(entrada.race, entrada.days, tarjeta, { dynamic: false })),
      });
      if (pagina) salida.push(documento(ruta, pagina, activos, 'competicion'));
    }
    return salida;
  }

  // CX llega por tandas sobre un mismo índice, que se conserva entre ellas.
  let cx = null;
  function fichasCx(input, activos, base) {
    if (input.tablas) cx = { indice: indiceCx(input.tablas, { cxTournamentRounds, cxSeasonBounds }), carreras: input.tablas.races };
    const salida = [];
    const activa = CX_HOME ? 'today' : 'cyclocross';
    const at = new Date();
    for (const raceId of input.carreras || []) {
      const rutas = base.cx.get(raceId) || [];
      const entrada = raceInputs(cx.indice, raceId);
      if (!entrada) continue;
      const model = cxHtml.cxRaceModel(entrada.race, entrada.rows, { at });
      for (const ruta of rutas) {
        if (!existe(activos, ruta)) continue;
        const source = fuente(activos, ruta);
        const seleccion = cxHtml.cxRaceSelection(model, { pathname: `/${ruta}/` });
        const cabecera = headerOptions(source, lang);
        const pagina = componerCx(source, { raceId, headerInner: headerHtml({ ...cabecera, active: cabecera.active || activa }), ...cxHtml.cxRacePrerenderedHtml(model, seleccion, htmlFingerprint) });
        if (pagina) salida.push(documento(ruta, pagina, activos, 'cx'));
      }
    }
    const pad = valor => String(valor).padStart(2, '0');
    const hoy = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    for (const torneoId of input.torneos || []) {
      const ruta = base.torneos.get(torneoId);
      if (!ruta || !existe(activos, ruta)) continue;
      const pintado = tournamentPage(cx.indice, torneoId, { agendaHtml, cxTournamentGeneralCategories, fingerprint: htmlFingerprint, todayKey: hoy });
      if (!pintado) continue;
      const source = fuente(activos, ruta);
      const cabecera = headerOptions(source, lang);
      const pagina = composeTournamentPage(source, { tournamentId: torneoId, headerInner: headerHtml({ ...cabecera, active: cabecera.active || activa }), ...pintado });
      if (pagina) salida.push(documento(ruta, pagina, activos, 'torneo'));
    }
    return salida;
  }

  // Campeonatos Nacionales: una página por idioma, con su cintillo.
  async function campeonatos(input, activos) {
    const fuentePagina = lang === 'en' ? `en/${CAMP.SLUG_EN}/index.html` : `${CAMP.SLUG_ES}.html`;
    const source = readFileSync(join(activos.base, fuentePagina), 'utf8');
    const estado = prepareChampionships(structuredClone(input.filas));
    const html = estado ? campPageHtml(estado) : campEmptyHtml(lang === 'en');
    const franja = await cintillo({ ...input.cintillo, cx_races: [] }, 'road');
    const conCabecera = source
      .replace(/<header class="site-header" id="siteHeader"([^>]*)>[\s\S]*?<\/header>/, (_, atributos) => `<header class="site-header" id="siteHeader"${atributos}>${headerHtml({ ...headerOptions(source, lang), lang })}</header>`)
      .replace(/<div id="giroCountdown"[^>]*><\/div>/, () => `<div id="giroCountdown" class="giro-countdown"${franja ? '' : ' hidden'}>${franja}</div>`)
      .replace(/(<main id="campeonatosContent"[^>]*>)[\s\S]*?(<\/main>)/, (_, abre, cierra) => `${abre}${html}${cierra}`);
    const { css, isla } = activos.regeneradas.campeonatos;
    const pagina = conIsla(conCabecera, { tema: activos.tema, fuente: activos.fuente, clasicos: activos.clasicos, css, isla });
    if (!pagina) throw new Error('Campeonatos sin la estructura esperada');
    return [{ slug: 'pagina', clave: `campeonatos-${lang}/pagina`, version: huella(pagina), pagina, raceId: 'campeonatos', dayId: 'pagina', fragmento: null, datos: null, ruta: lang === 'en' ? `en/${CAMP.SLUG_EN}` : 'f/campeonatos-es' }];
  }

  return function componerRegeneradas(item, activos) {
    const { input } = item;
    if (input.tipo === 'campeonatos') return campeonatos(input, activos);
    const base = mapaBase(activos, input.generacion);
    if (input.tipo === 'competicion') return competicion(input, activos, base);
    if (input.tipo === 'cx') return fichasCx(input, activos, base);
    // Avisos del sitio base sin datos propios (EN de una carrera nacional): tal cual, con su isla.
    return base.sinDatos.map(({ ruta, tipo }) => documento(ruta, fuente(activos, ruta), activos, tipo));
  };
}
