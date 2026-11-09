// Hoy de carretera pintado en el servidor: un documento por día de la ventana publicada, con las
// tarjetas que pinta el navegador (js/today-agenda-html.js). Zona, región y día del visitante se
// resuelven antes del primer pintado (cliente/pre-pintado-hoy.js); nginx sirve el del día con
// ?date=. Depende de la hora: se vuelve a pintar cada minuto y solo se publica si cambia.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { piezasBase } from './base-html.mjs';
import { RESERVA_ANDROID, crearCintillo } from './familia-portada.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const pad = valor => String(valor).padStart(2, '0');
const hoyLocal = (ahora = new Date()) => `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
export const DUEÑO_HOY = 'hoy';

export async function crearFamiliaHoy({ lang, t, headerHtml, pie, huella, grupos, visiblePara }) {
  const { agendaDateHtml } = await load('js/shared.js');
  const { agendaCardHtml, dateBarHtml, emptyDayHtml } = await load('js/today-agenda-html.js');
  const { agendaPlaceholders, findNextDayWithRaces, prepareAgendaDays } = await load('js/services/today-nav.js');
  const { sortAgenda } = await load('js/services/today-agenda-order.js');
  const { cyclocrossHome, cyclocrossLanding } = await load('js/services/today-season.js');
  const { isChampWeekFilterLock } = await load('js/campeonatos-config.js');
  const { disciplineSwitchHtml } = await load('js/components/discipline-switch.js');
  const cintillo = await crearCintillo();
  const dir = lang === 'en' ? 'en' : '';
  const BASE = grupos.find(grupo => grupo.clave === 'ES');

  // El resto de grupos de una jornada, agrupados por las emisiones que ven.
  function variantes(rd) {
    const todas = rd._allBroadcasts || [];
    const porEmisiones = new Map();
    for (const grupo of grupos) {
      if (grupo === BASE) continue;
      const broadcasts = todas.filter(b => visiblePara(b, grupo));
      const firma = broadcasts.map(b => b.id).join();
      if (!porEmisiones.has(firma)) porEmisiones.set(firma, { claves: [], broadcasts, blocked: todas.length > 0 && broadcasts.length === 0 });
      porEmisiones.get(firma).claves.push(grupo.clave);
    }
    return [...porEmisiones.values()];
  }

  function contenidoDia(dia, input, ahora) {
    const datos = input.dias[dia] || { rows: [], activas: [], featured: [] };
    const featured = new Map([[dia, new Set(datos.featured)]]);
    const { raceDays } = prepareAgendaDays(structuredClone(datos.rows), { dateKey: dia, featured, filterBroadcasts: lista => lista.filter(b => visiblePara(b, BASE)) });
    const placeholders = agendaPlaceholders(datos.activas, raceDays, dia);
    const items = [...raceDays, ...placeholders.map(ph => ({ _placeholder: true, _race: ph, _phRace: ph }))];
    if (items.length) {
      const orden = sortAgenda(items, 'category');
      return { dia, html: orden.map(item => agendaCardHtml(item, { agendaCat: 'all', agendaSort: 'category', variantes, now: ahora })).join('') };
    }
    // Sin carreras: como en el navegador, el siguiente día con carreras de ese año.
    const siguiente = findNextDayWithRaces(dia, 'all', input.anios[dia.slice(0, 4)] || []);
    if (siguiente && input.dias[siguiente]) return contenidoDia(siguiente, input, ahora);
    return siguiente ? null : { dia, html: emptyDayHtml(t('today.noRaces'), null) };
  }

  return async function componerHoy(item, activos) {
    const { input } = item;
    const ahora = Date.now();
    const hoy = hoyLocal();
    const fuente = readFileSync(join(activos.base, lang === 'en' ? 'en/index.html' : 'index.html'), 'utf8');
    const partes = piezasBase(fuente, { tema: activos.tema, fuente: activos.fuente, css: activos.hoy.css, isla: activos.hoy.isla });
    if (!partes) throw new Error('Portada del sitio base sin la estructura esperada');
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(fuente.slice(fuente.indexOf('<main')))?.[1];
    const franja = await cintillo({ ...input.cintillo, cx_races: [] }, 'road');
    const conmutador = cyclocrossHome(hoy) ? disciplineSwitchHtml('road', hoy) : '';
    const cabecera = `<header class="site-header" id="siteHeader">${headerHtml({ lang, hasBack: false, active: 'today' }).replace('href="#main"', 'href="#raceList"')}</header>`;

    const documento = (slug, ruta, contenido) => {
      const version = huella(contenido.html + franja + contenido.dia + hoy);
      const entre = partes.entre
        .replace(/<div id="giroCountdown"[^>]*><\/div>/, () => `<div id="giroCountdown" class="giro-countdown"${franja ? '' : ' hidden'}>${franja}</div>`)
        .replace(/(<div class="date-bar" id="dateBar">)[\s\S]*?(<\/div>)/, (_, abre, cierra) => `${abre}${dateBarHtml(contenido.dia, hoy)}${cierra}`)
        .replace('<span class="agenda-date" id="agendaDate"></span>', () => `<span class="agenda-date" id="agendaDate">${agendaDateHtml(contenido.dia)}</span>`)
        .replace('<div class="agenda-filters__inner">', () => `<div class="agenda-filters__inner">${conmutador}`);
      const sirve = /^\d{4}-/.test(slug) ? slug : '';
      const atributos = ` class="race-list" id="raceList" tabindex="-1" data-dia="${attr(contenido.dia)}" data-sirve="${attr(sirve)}" data-hoy="${attr(hoy)}" data-dias="${attr(t('days.abbr').join())}"`;
      const pagina = `${partes.head.replace('</head>', `<meta name="cc:v" content="${version}"></head>`)}<body>\n${RESERVA_ANDROID}\n${partes.antes}${cabecera}\n${entre}\n`
        + `${h1 ? `<h1 class="sr-only">${h1}</h1>\n` : ''}<main${atributos}>${contenido.html}</main>\n<script>${activos.hoy.prePintado}</script>\n${pie()}\n`
        + `<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.hoy.isla}"></script>\n</body>\n</html>\n`;
      return { slug, clave: `hoy-${lang}/${slug}`, version, pagina, raceId: DUEÑO_HOY, dayId: slug, fragmento: null, datos: null, ruta };
    };

    const salida = [];
    const fechas = input.solo ? input.solo.filter(dia => input.todas.includes(dia)) : input.todas;
    for (const dia of fechas) {
      // La semana de Campeonatos fuerza filtros: la resuelve el navegador, como hoy.
      if (isChampWeekFilterLock(dia)) continue;
      const contenido = contenidoDia(dia, input, ahora);
      if (contenido) salida.push(documento(dia, `f/hoy-${lang}/${dia}`, contenido));
    }
    if (!isChampWeekFilterLock(hoy)) {
      const contenido = contenidoDia(hoy, input, ahora);
      if (contenido) {
        salida.push(documento('hoy', `f/hoy-${lang}/hoy`, contenido));
        // Terminada la temporada de ciclocross, Hoy de carretera vuelve a ser la portada.
        if (!cyclocrossLanding(hoy)) salida.push(documento('raiz', dir, contenido));
      }
    }
    return salida;
  };
}
