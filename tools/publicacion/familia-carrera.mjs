// Páginas de resultados por carrera, pintadas en el servidor con las funciones que usa
// js/resultados.js. El <head> y la estructura salen del sitio base. La página lleva la
// clasificación inicial entera; las demás, un archivo aparte por página.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { piezasBase } from './base-html.mjs';
import { RESERVA_ANDROID } from './familia-portada.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const IDIOMAS = {
  es: { dir: 'resultados', canonBase: '/resultados/', timeZone: 'Europe/Madrid', etiqueta: null, slug: race => race.slug },
  en: { dir: 'en/results', canonBase: '/en/results/', timeZone: 'Etc/GMT', etiqueta: 'GMT', slug: race => race.slugEn || race.slug },
};
const archivada = year => Number.isInteger(Number(year)) && Number(year) >= 2020 && Number(year) <= 2025;

export async function crearFamiliaCarrera({ lang, headerHtml, pie, huella }) {
  const H = await load('js/resultados-html.js');
  const { withRaceTechnicalGuide } = await load('js/shared.js');
  const { stageMetricsHtml } = await load('js/stage/context.js');
  const { isNearToday } = await load('js/services/refresh-window.js');
  const { localClient, requestedFromPath } = await load('tools/site/prerender-resultados.mjs');
  const { headerOptions } = await load('tools/site/prerender-jornadas.mjs');
  const { timeZone, etiqueta, canonBase, slug: slugDe, dir } = IDIOMAS[lang];
  const isEn = lang === 'en';

  /** Huecos de una clasificación: estado, filtro, aviso y tabla. */
  async function huecos(fila, { race, raceDay, resolver, datos, configByKind, isOneDay, conPestanas, ahora }) {
    const barra = conPestanas || !(fila.classKind === 'teams' || fila.isTeamEvent);
    const publicacion = H.publicationHtml(fila, { configByKind, isOneDay, inBar: barra && !conPestanas, isEn, timeZone, now: ahora.getTime() });
    let tabla;
    let filtro = '';
    if (fila._cancelledStage) tabla = H.cancelledNoticeHtml(isEn);
    else {
      const filas = datos.results[fila.id] || [];
      if (!filas.length) tabla = H.emptyClassificationHtml(isEn);
      else {
        const cliente = localClient(datos.catalog);
        await H.enrichRiders(cliente, resolver, filas.map(row => row.globalRiderId).filter(Boolean), ahora);
        await H.enrichOverrideTeams(cliente, resolver, filas.map(row => row.teamId).filter(Boolean));
        const clasificacion = H.classificationHtml(filas, fila, { race, raceDay, isOneDay, resolver, lang });
        tabla = clasificacion.ttt ? clasificacion.head : H.classificationTableHtml(clasificacion);
        filtro = H.teamFilterHtml(clasificacion, '', isEn);
      }
    }
    return { status: barra ? publicacion.status : '', filter: barra ? filtro : '', publication: publicacion.publication, table: tabla };
  }

  const rellenar = (esqueleto, partes, metricas) => {
    let html = esqueleto;
    const poner = (vacio, contenido) => {
      if (!html.includes(vacio)) return;
      html = html.replace(vacio, () => vacio.replace(/<\/[a-z]+>$/, cierre => `${contenido}${cierre}`));
    };
    poner('<div class="res-tabs__status" id="resStatusSlot"></div>', partes.status);
    poner('<div class="res-tabs__filter" id="resTeamFilterSlot"></div>', partes.filter);
    poner('<div class="res-publication" id="resPublication" aria-live="polite"></div>', partes.publication);
    poner('<div class="res-table-wrap" id="resTableWrap"></div>', partes.table);
    if (metricas != null) poner('<dl></dl>', metricas);
    return html;
  };

  return async function componerCarrera(item, activos) {
    const { race, stagesAll, allRaceDays, classificationConfig, dias, assets, guide, datos } = item.input;
    const ahora = new Date();
    const salida = [];
    const carpeta = join(activos.base, dir, slugDe(race));
    if (!existsSync(carpeta)) return salida;
    const paginas = ['', ...readdirSync(carpeta, { withFileTypes: true }).filter(entrada => entrada.isDirectory()).map(entrada => entrada.name)];
    for (const segmento of paginas) {
      const rutaPagina = `${dir}/${slugDe(race)}${segmento ? `/${segmento}` : ''}`;
      const archivoBase = join(activos.base, rutaPagina, 'index.html');
      if (!existsSync(archivoBase)) continue;
      const source = readFileSync(archivoBase, 'utf8');
      const partes = piezasBase(source, { tema: activos.tema, fuente: activos.fuente, css: activos.carrera.css, isla: activos.carrera.isla });
      if (!partes || archivada(race.year) || race.year == null) continue;
      const pedido = requestedFromPath(segmento || '');
      const stages = H.resultsStages({ stagesAll, allRaceDays, ...pedido });
      const clave = `carrera-${lang}/${slugDe(race)}${segmento ? `-${segmento}` : ''}`;
      const opciones = headerOptions(source, lang);
      const cabecera = `<header class="site-header" id="siteHeader"${partes.atributosCabecera}>${headerHtml(opciones)}</header>`;
      let contenido;
      let extra = null;
      let sondeo = isNearToday(race.startDate, race.endDate, { now: ahora });
      let dia = null;
      if (stages.missing) {
        const { requestedStage, stageSuffixParam } = pedido;
        if (requestedStage !== undefined) {
          const es = requestedStage === 0 ? 'el prólogo' : `la ${H.stagePathLabel(requestedStage, false, stageSuffixParam).toLowerCase()}`;
          const en = requestedStage === 0 ? 'the prologue' : H.stagePathLabel(requestedStage, true, stageSuffixParam).toLowerCase();
          contenido = isEn ? `No results available yet for ${en}. Check back after the stage for the official classification.` : `Aún no hay resultados disponibles para ${es}. Vuelve después de la etapa para consultar la clasificación oficial.`;
        } else contenido = isEn ? 'No results available yet for this race.' : 'Aún no hay resultados disponibles para esta carrera.';
        contenido = `<div class="startlist-empty">${H.statusIcon('pending')}${contenido}</div>`;
      } else {
        const active = H.resultsActive(stages, { stagesAll, classificationConfig, allRaceDays });
        const { activeClass, activeStages, configByKind, raceDayId, contextDayId } = active;
        const contextDay = contextDayId ? dias[contextDayId] ?? null : null;
        const raceDay = raceDayId ? contextDay : null;
        const contextAssets = withRaceTechnicalGuide(contextDayId ? assets[contextDayId] || [] : [], guide);
        const actionAssets = raceDayId ? contextAssets : withRaceTechnicalGuide([], guide);
        const isOneDay = race.raceFormat === 'one_day';
        const resolver = H.createResultsResolver({ race, slRiders: datos.riders, slTeamsRows: datos.teams, isEn });
        const conPestanas = activeStages.length > 1;
        const comunes = { race, raceDay, resolver, datos, configByKind, isOneDay, conPestanas, ahora };
        const esqueleto = H.resultsPageHtml({ race, stages, active, raceDay, contextDay, contextAssets, actionAssets, canonBase, canonSlug: slugDe(race), isEn });
        const metricas = contextDay ? stageMetricsHtml(contextDay, { timeZoneLabel: etiqueta }) : null;
        contenido = rellenar(esqueleto, await huecos(activeClass, comunes), metricas);
        // Las demás clasificaciones, aparte.
        const otras = [];
        for (const fila of activeStages) {
          if (fila.classKind === activeClass.classKind) continue;
          const partesFila = await huecos(fila, comunes);
          otras.push(`<template data-clase="${attr(fila.classKind)}">${Object.entries(partesFila).map(([nombre, valor]) => `<template data-hueco="${nombre}">${valor}</template>`).join('')}</template>`);
        }
        if (otras.length) extra = otras.join('');
        sondeo ||= activeStages.some(fila => fila.publicationStatus === 'provisional' || fila.updating);
        dia = contextDay;
      }
      const version = huella(contenido + (extra || ''));
      const archivoClases = `f/resultados-${lang}/${slugDe(race)}${segmento ? `/${segmento}` : ''}.html`;
      const atributos = `id="resultsContent" data-publicada="${version}" data-lang="${lang}" data-sondeo="${sondeo ? 1 : 0}"`
        + ` data-clases="${extra ? `/${archivoClases}` : ''}" data-perfil="${dia?.slug ? `/d/${lang}/${attr(lang === 'en' ? dia.slugEn || dia.slug : dia.slug)}.json` : ''}"`
        + (dia?.dateKey ? ` data-date-key="${attr(dia.dateKey)}"` : '');
      const head = partes.head.replace('</head>', `<meta name="cc:clave" content="${attr(clave)}"><meta name="cc:v" content="${version}"></head>`);
      const pagina = `${head}<body>\n${RESERVA_ANDROID}\n${partes.antes}${cabecera}\n${partes.entre}\n<main ${atributos}>${contenido}</main>\n`
        + `<script>${activos.carrera.prePintado}</script>\n${pie()}\n<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.carrera.isla}"></script>\n</body>\n</html>\n`;
      salida.push({ slug: segmento || '_', clave, version, pagina, raceId: race.id, dayId: segmento || '_', fragmento: null, datos: null, ruta: rutaPagina, archivos: extra ? { [archivoClases]: extra } : {} });
    }
    return salida;
  };
}
