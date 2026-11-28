// Páginas de Últimos resultados: una URL por vista, para que cada una tenga su
// título, descripción y canonical en Google. La web las sirve ya pintadas
// (tools/publicacion/familia-resultados.mjs) y cambiar de pestaña no recarga:
// la página actualiza la URL con pushState. El sitio base (reserva) las copia
// de /resultados/ con tools/site/results-views.mjs.
//
// - latest: /resultados/, portada de la sección. Mientras la home es
//   Ciclocross (services/today-season.js) abre en Ciclocross, salvo con
//   Carretera fijada, sin cambiar de URL ni de título.
// - cx: /resultados/ciclocross/, todo el año. No cuelga de /ciclocross/: las
//   apps abren esas rutas y la tomarían por una prueba.
// - ranking y ranking-female: el ránking UCI de equipos de cada género.

const PATHS = {
  latest: { es: '/resultados/', en: '/en/results/' },
  cx: { es: '/resultados/ciclocross/', en: '/en/results/cyclocross/' },
  ranking: { es: '/ranking-uci/', en: '/en/uci-ranking/' },
  'ranking-female': { es: '/ranking-uci/femenino/', en: '/en/uci-ranking/women/' },
};

export const FEED_PAGES = Object.keys(PATHS);

const langKey = lang => (lang === 'en' ? 'en' : 'es');

/** Ruta de la página `page` en `lang`, con barra final. */
export const feedPagePath = (page, lang) => PATHS[page][langKey(lang)];

/** Página de Últimos resultados de `pathname`, o null si no es una de ellas. */
export function feedPageFromPath(pathname) {
  const path = String(pathname || '').replace(/\/index\.html$/, '/').replace(/([^/])$/, '$1/');
  return FEED_PAGES.find(page => PATHS[page].es === path || PATHS[page].en === path) || null;
}

/** Vista de la página: latest, cx o ranking. */
export const pageView = page => (page === 'ranking-female' ? 'ranking' : page);

/** Género del ránking de la página. */
export const pageGender = page => (page === 'ranking-female' ? 'female' : 'male');

/** Página de una vista y, en el ránking, de un género. */
export const viewPage = (view, gender = 'male') => (view === 'ranking' && gender === 'female' ? 'ranking-female' : view);

/**
 * Título, descripción y h1 de la página. `cxSeason`: temporada CX en curso
 * (2026-27); `rankingSeason`: temporada del ránking que se muestra (2027).
 */
export function feedPageMeta(page, lang, { cxSeason, rankingSeason }) {
  const en = lang === 'en';
  const suffix = en ? ' - Calendario Ciclismo' : ' - Calendario Ciclismo App';
  const next = Number(rankingSeason) + 1;
  const texts = {
    latest: en ? {
      h1: 'Latest cycling results',
      title: 'Latest cycling results: stages and one-day races',
      description: 'Latest professional cycling results: stages and one-day classics in reverse chronological order, with winners and full classifications.',
    } : {
      h1: 'Últimos resultados de ciclismo',
      title: 'Últimos resultados de ciclismo: etapas y clásicas',
      description: 'Últimos resultados del ciclismo profesional: etapas y clásicas en orden cronológico inverso, con ganador y clasificaciones completas.',
    },
    cx: en ? {
      h1: `Cyclocross results ${cxSeason}`,
      title: `Cyclocross results ${cxSeason}: World Cup, Superprestige and X2O`,
      description: `Cyclocross results of the ${cxSeason} season: winners in every category of the UCI World Cup, Superprestige, X2O Trofee and the other UCI races.`,
    } : {
      h1: `Resultados de ciclocross ${cxSeason}`,
      title: `Resultados de ciclocross ${cxSeason}: Copa del Mundo, Superprestige y X2O`,
      description: `Resultados de ciclocross de la temporada ${cxSeason}: ganadores de cada categoría en la Copa del Mundo, Superprestige, X2O Trofee, Copa de España y el resto de pruebas UCI.`,
    },
    ranking: en ? {
      h1: `UCI Team Ranking ${rankingSeason}`,
      title: `UCI Team Ranking ${rankingSeason}: WorldTour, ProTeams and invitations`,
      description: `Up-to-date ${rankingSeason} UCI men's team ranking: points of every WorldTeam and ProTeam and the ${next} invitations to the Grand Tours, the WorldTour and the ProSeries.`,
    } : {
      h1: `Ránking UCI de equipos ${rankingSeason}`,
      title: `Ránking UCI de equipos ${rankingSeason}: WorldTour, ProTeams e invitaciones`,
      description: `Ránking UCI de equipos masculinos ${rankingSeason} actualizado: puntos de cada WorldTeam y ProTeam e invitaciones de ${next} a las Grandes Vueltas, el WorldTour y las ProSeries.`,
    },
    'ranking-female': en ? {
      h1: `UCI Women's Team Ranking ${rankingSeason}`,
      title: `UCI Women's Team Ranking ${rankingSeason}: Women's WorldTour and invitations`,
      description: `Up-to-date ${rankingSeason} UCI women's team ranking: points of every Women's WorldTeam and ProTeam and the ${next} invitations to the Women's WorldTour.`,
    } : {
      h1: `Ránking UCI femenino de equipos ${rankingSeason}`,
      title: `Ránking UCI femenino de equipos ${rankingSeason}: Women's WorldTour e invitaciones`,
      description: `Ránking UCI de equipos femeninos ${rankingSeason} actualizado: puntos de cada Women's WorldTeam y ProTeam e invitaciones de ${next} al Women's WorldTour.`,
    },
  }[page];
  return { ...texts, title: texts.title + suffix };
}
