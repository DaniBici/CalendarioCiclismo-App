// Mercado de fichajes pintado entero en cada movimiento: la portada por división y un documento
// por equipo con todas sus secciones, con el HTML que pinta el navegador (js/fichajes-html.js).
// nginx sirve el del equipo con ?team=<slug> y el de la división con ?div=: el navegador no
// compone nada al cargar. Solo se escribe lo que cambia.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { conIsla } from './familias-base.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = file => import(pathToFileURL(join(ROOT, file)).href);
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const DIRECTORIOS = { es: 'fichajes', en: 'en/transfers' };
export const DUEÑO_MERCADO = 'mercado';

export async function crearFamiliaMercado({ lang, t, huella }) {
  const { DIVISIONS, buildMarket, hasTeamView, marketHomeHtml, teamViewHtml } = await load('js/fichajes-html.js');
  const { htmlFingerprint } = await load('js/html-fingerprint.js');
  const { BACK_ICON, BACK_PLACEHOLDER } = await load('js/header-html.js');
  const dir = DIRECTORIOS[lang];

  return function componerMercado(item, activos) {
    const { datos } = item.input;
    const market = buildMarket(datos);
    const { css, isla, prePintado } = activos.regeneradas.fichajes;
    const plantilla = conIsla(readFileSync(join(activos.base, dir, 'index.html'), 'utf8'), { tema: activos.tema, fuente: activos.fuente, clasicos: activos.clasicos, css, isla });
    if (!plantilla) throw new Error('Mercado sin la estructura esperada');

    const documento = (slug, ruta, html, { equipo = null, flecha = null } = {}) => {
      const atributos = `data-prerendered="${attr(htmlFingerprint(html))}"${equipo ? ` data-painted-team="${attr(equipo)}"` : ''}`;
      const posterior = equipo ? `<script>${prePintado}</script>` : '';
      let pagina = plantilla.replace(/(<main\b[^>]*>)[\s\S]*?(<\/main>)/, (_, abre, cierra) => `${abre}\n<div id="transfersContent" ${atributos}>${html}</div>\n${cierra}${posterior}`);
      // La página fuente oculta la portada con ?team= hasta que llega el JS: aquí el equipo ya está.
      if (equipo) pagina = pagina.replace(/<script>(?:(?!<\/script>)[\s\S])*trStaticLoading(?:(?!<\/script>)[\s\S])*<\/script>\s*/, '');
      // La flecha de volver llega pintada: sin JS lleva a la portada del mercado.
      if (flecha) pagina = pagina.replace(BACK_PLACEHOLDER, () => `<a class="back-btn" id="backBtn" href="${attr(flecha)}" aria-label="${attr(t('transfers.back'))}">${BACK_ICON}</a>`);
      return { slug, clave: `mercado-${lang}/${slug}`, version: huella(html), pagina, raceId: DUEÑO_MERCADO, dayId: slug, fragmento: null, datos: null, ruta };
    };

    const salida = DIVISIONS.map((activeDiv, at) => {
      const html = marketHomeHtml(market, { activeDiv });
      return at === 0 ? documento('portada', dir, html) : documento(`_${activeDiv}`, `f/mercado-${lang}/_${activeDiv}`, html);
    });
    for (const [teamId, season] of market.seasonsByTeamId) {
      if (!hasTeamView(market, teamId)) continue;
      const slug = market.teamIdToSlug.get(teamId);
      const teamHtml = teamViewHtml(market, teamId, datos.rosters[teamId] || []);
      const html = marketHomeHtml(market, { activeDiv: season.category, teamHtml });
      const flecha = `/${dir}/${season.category === DIVISIONS[0] ? '' : `?div=${season.category}`}`;
      salida.push(documento(slug, `f/mercado-${lang}/${slug}`, html, { equipo: teamId, flecha }));
    }
    return salida;
  };
}
