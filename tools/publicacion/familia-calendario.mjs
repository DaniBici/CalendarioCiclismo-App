// Calendario pintado en el servidor con el HTML y los filtros del navegador
// (js/temporada-html.js): la temporada del año por defecto, con todas sus jornadas.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RESERVA_ANDROID } from './familia-portada.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const hoyLocal = (ahora = new Date()) => `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const quitarScripts = html => html.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/g, '');

export async function crearFamiliaCalendario({ lang, t, headerHtml, pie, huella }) {
  const { S, temporadaCountries, temporadaListHtml, tCountryName } = await load('js/temporada-html.js');
  const { seasonCalendarYear } = await load('js/services/today-season.js');
  const { isOnChampionshipsPage } = await load('js/campeonatos-config.js');
  const { PIN_STORAGE_KEY } = await load('js/shared.js');
  const isEn = lang === 'en';
  const clave = `calendario-${lang}/temporada`;

  return async function componerCalendario(item, activos) {
    const { races, race_days: dias, challenge_groups: grupos } = item.input.temporada;
    const hoy = hoyLocal();
    const anio = seasonCalendarYear(hoy);
    const porCarrera = new Map();
    for (const dia of dias) (porCarrera.get(dia.raceId) || porCarrera.set(dia.raceId, []).get(dia.raceId)).push(dia);
    const filas = races.filter(race => race.year === anio).map(race => ({ ...race, _days: porCarrera.get(race.id) || [] }));
    S.activeYear = anio;
    S.activeCat = 'all';
    S.activeCountry = '';
    S.expandedChallenges = new Set();
    S.allRaces = filas.filter(race => race._days.length > 0 || race.startDate || race.isPlaceholder === true);
    S.allChallengeGroups = grupos.map(grupo => ({ ...grupo, _races: S.allRaces.filter(race => (Array.isArray(grupo.raceIds) ? grupo.raceIds : []).includes(race.id)) })).filter(grupo => grupo._races.length > 0);
    const listaHtml = temporadaListHtml();

    const actual = new Date().getFullYear();
    const anios = [...new Set([actual + 1, actual, actual - 1, anio])].filter(valor => valor >= 2026).sort((a, b) => b - a);
    const opcionesAnio = anios.map(valor => `<option value="${valor}"${valor === anio ? ' selected' : ''}>${valor}</option>`).join('');
    const paises = temporadaCountries(S.allRaces.filter(race => !isOnChampionshipsPage(race)));
    const opcionesPais = `<option value="">${attr(t('season.countryPlaceholder'))}</option>${paises.map(code => `<option value="${code}">${attr(tCountryName(code))}</option>`).join('')}`;

    const shell = activos.calendario.paginas[lang];
    const filtros = shell.filtros
      .replace('id="temporadaFilters" hidden', 'id="temporadaFilters"')
      .replace(/(<select[^>]*id="filterYear"[^>]*>)<\/select>/, `$1${opcionesAnio}`.concat('</select>'))
      .replace(/(<select[^>]*id="filterCountry"[^>]*>)[\s\S]*?<\/select>/, `$1${opcionesPais}</select>`)
      .replace(/<button type="button" aria-pressed="true" class="tcat-btn tcat-btn--active"/g, '<button type="button" aria-pressed="false" class="tcat-btn"')
      .replace(/<button type="button" aria-pressed="false" class="tcat-btn" data-cat="all"/g, '<button type="button" aria-pressed="true" class="tcat-btn tcat-btn--active" data-cat="all"');
    const version = huella(listaHtml + opcionesPais);
    const titulo = `${isEn ? 'Season' : 'Temporada'} ${anio} - ${t('seo.siteName')}`;
    const descripcion = isEn
      ? `All races of the ${anio} season, with their routes, schedules, dates and how to watch on TV.`
      : `Listado con todas las carreras de la temporada ${anio}, con acceso a la información sobre sus recorridos, horarios, fechas y cómo ver por TV.`;
    const head = shell.head
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${attr(titulo)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*/, `$1${attr(descripcion)}`)
      .replace(/(<meta property="og:title" content=")[^"]*/, `$1${attr(titulo)}`)
      .replace(/(<meta property="og:description" content=")[^"]*/, `$1${attr(descripcion)}`)
      .replace('</head>', `<style>#temporadaContent[data-pendiente]{visibility:hidden}</style><meta name="cc:clave" content="${clave}"><meta name="cc:v" content="${version}"></head>`);
    const cabecera = `<header class="site-header" id="siteHeader">${headerHtml({ lang, hasBack: false, active: 'calendar' })}</header>`;
    const pagina = `${head}<body>\n${RESERVA_ANDROID}\n${shell.antes}${cabecera}\n${filtros}\n<main class="temporada-main" id="calMain">${shell.h1}`
      + `<div id="temporadaContent" data-anio="${anio}" data-pin-clave="${attr(PIN_STORAGE_KEY)}">${listaHtml}</div><div id="mesContent" hidden></div>`
      + `<script>${activos.calendario.prePintado}</script></main>\n${pie()}\n<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.calendario.isla}"></script>\n</body>\n</html>\n`;
    return { slug: 'temporada', clave, version, pagina, raceId: null, dayId: 'temporada', fragmento: null, datos: null, ruta: isEn ? 'en/calendar' : 'calendario', anio, filas: S.allRaces.length };
  };
}

/** Lo que el calendario conserva de su página publicada. */
export function shellCalendario(html, activos) {
  const inicio = html.indexOf('<body');
  if (inicio < 0) throw new Error('Calendario publicado sin <body>');
  const cuerpo = html.indexOf('>', inicio) + 1;
  const abreCabecera = html.indexOf('<header class="site-header"', cuerpo);
  const cierraCabecera = html.indexOf('</header>', abreCabecera) + '</header>'.length;
  const abreMain = html.indexOf('<main', cierraCabecera);
  if (abreCabecera < 0 || abreMain < 0) throw new Error('Calendario publicado sin la estructura esperada');
  let enlaces = false;
  const head = html.slice(0, inicio)
    .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
    .replace(/<link rel="preconnect" href="https:\/\/[^"]*supabase\.co"[^>]*>\s*/g, '')
    .replace(/<script src="[^"]*theme\.js[^"]*"><\/script>/, `<script src="${activos.tema}"></script>`)
    .replace(/<link rel="stylesheet" href="[^"]*">\s*/g, () => {
      if (enlaces) return '';
      enlaces = true;
      return `<link rel="stylesheet" href="${activos.fuente}"><link rel="stylesheet" href="${activos.calendario.css}"><link rel="modulepreload" fetchpriority="low" href="${activos.calendario.isla}">`;
    });
  if (!enlaces) throw new Error('Calendario publicado sin hoja de estilos');
  const titulo = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html.slice(abreMain))?.[1];
  return {
    head,
    antes: quitarScripts(html.slice(cuerpo, abreCabecera)).trim(),
    filtros: quitarScripts(html.slice(cierraCabecera, abreMain)).trim(),
    h1: titulo ? `<h1 class="sr-only">${titulo}</h1>` : '',
  };
}
