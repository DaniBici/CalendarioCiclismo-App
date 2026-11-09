// Perfil, mapa y orden de salida pintados en el servidor con las funciones del navegador. El
// <head> y la estructura salen del sitio base.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { piezasBase } from './base-html.mjs';
import { RESERVA_ANDROID } from './familia-portada.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const attr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const DIRS = {
  perfil: { es: 'perfil', en: 'en/profile' },
  mapa: { es: 'mapa', en: 'en/route-map' },
  orden: { es: 'orden-salida', en: 'en/start-order' },
};

export async function crearFamiliaEtapa({ lang, t, headerHtml, pie, huella }) {
  const { perfilHtml, mapaHtml, stagePageNoticeHtml } = await load('js/perfil-mapa-html.js');
  const { ordenSalidaEmptyHtml, ordenSalidaHtml } = await load('js/orden-salida-html.js');
  const { withRaceTechnicalGuide, jornadaUrl } = await load('js/shared.js');
  const { headerOptions } = await load('tools/site/prerender-jornadas.mjs');
  const etiqueta = lang === 'en' ? 'GMT' : null;

  return async function componerEtapa(item, activos) {
    const { tipo, entrada } = item.input;
    const { rd, race } = entrada;
    const slug = lang === 'en' ? rd.slugEn || rd.slug : rd.slug;
    const ruta = `${DIRS[tipo][lang]}/${slug}`;
    const archivo = join(activos.base, ruta, 'index.html');
    if (!slug || !existsSync(archivo)) return [];
    const source = readFileSync(archivo, 'utf8');
    const { tema, fuente } = activos;
    const partes = piezasBase(source, { tema, fuente, css: activos.carrera.css, isla: activos.etapa.isla });
    if (!partes) return [];
    const assets = entrada.notice ? [] : withRaceTechnicalGuide(entrada.assets, entrada.guide);
    let html;
    if (entrada.notice) html = tipo === 'orden' ? ordenSalidaEmptyHtml() : stagePageNoticeHtml(entrada.notice);
    else if (tipo === 'perfil') html = perfilHtml({ ...entrada, assets, timeZoneLabel: etiqueta });
    else if (tipo === 'mapa') html = mapaHtml({ ...entrada, assets, timeZoneLabel: etiqueta });
    // Publicado en la hora de la jornada: el visitante en otra zona la convierte antes de pintar.
    else html = ordenSalidaHtml({ ...entrada, assets, userTz: rd.timezone || null }).html;
    const clave = `etapa-${lang}/${tipo}-${slug}`;
    const version = huella(html);
    const lugar = (lang === 'en' ? rd.startLocationEn : null) || rd.startLocation || (rd.timezone ? rd.timezone.split('/').pop().replace(/_/g, ' ') : '');
    const atributos = `${partes.atributosMain} data-clave="${attr(clave)}" data-tipo="${tipo}" data-aviso="${entrada.notice ? 1 : 0}" data-volver="${attr(jornadaUrl(rd))}"`
      + ` data-date-key="${attr(rd.dateKey || '')}" data-dias="${attr(t('days.abbr').join())}" data-tz-texto="${attr(t('stage.yourTimezone'))}"`
      + (tipo === 'orden' ? ` data-race-tz="${attr(rd.timezone || '')}" data-lugar="${attr(lugar)}"` : '');
    const head = partes.head.replace('</head>', `<meta name="cc:clave" content="${attr(clave)}"><meta name="cc:v" content="${version}"></head>`);
    const cabecera = `<header class="site-header" id="siteHeader"${partes.atributosCabecera}>${headerHtml(headerOptions(source, lang))}</header>`;
    const prePintado = tipo === 'orden' ? activos.etapa.prePintadoOrden : activos.prePintado;
    const pagina = `${head}<body>\n${RESERVA_ANDROID}\n${partes.antes}${cabecera}\n${partes.entre}\n<main${atributos}>\n${html}\n</main>\n`
      + `<script>${prePintado}</script>\n${pie()}\n<script defer src="${activos.clasicos}"></script>\n<script type="module" src="${activos.etapa.isla}"></script>\n</body>\n</html>\n`;
    return [{ slug: `${tipo}-${slug}`, clave, version, pagina, raceId: rd.raceId, dayId: rd.id, fragmento: null, ruta, datos: entrada.notice ? null : JSON.stringify({ rd, race, assets }) }];
  };
}
