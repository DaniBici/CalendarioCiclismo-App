// Lo común a las páginas que se apoyan en el sitio base: su JS lee archivos publicados en lugar de
// Supabase, cuando la página ya está pintada, y adapta hora y región del visitante.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { piezasBase } from './base-html.mjs';
import { RESERVA_ANDROID } from './familia-portada.mjs';

const quitarScripts = html => html.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>\s*/g, '');

/** La página del sitio base con el JS de su isla. */
export function conIsla(source, { tema, fuente, css, isla, clasicos }) {
  const partes = piezasBase(source, { tema, fuente, css, isla });
  if (!partes) return null;
  const inicio = source.indexOf('<body');
  const cuerpo = source.indexOf('>', inicio) + 1;
  const abreCabecera = source.indexOf('<header class="site-header"', cuerpo);
  const cierraCabecera = source.indexOf('</header>', abreCabecera) + '</header>'.length;
  const abreMain = source.indexOf('<main', cierraCabecera);
  const cierraMain = source.indexOf('</main>', abreMain) + '</main>'.length;
  const fin = source.lastIndexOf('</body>');
  if (cierraMain < abreMain || fin < cierraMain) return null;
  return `${partes.head}${source.slice(inicio, cuerpo)}\n${RESERVA_ANDROID}\n${partes.antes}${source.slice(abreCabecera, cierraCabecera)}\n${partes.entre}\n${source.slice(abreMain, cierraMain)}\n`
    + `${quitarScripts(source.slice(cierraMain, fin)).trim()}\n<script defer src="${clasicos}"></script>\n<script type="module" src="${isla}"></script>\n</body>\n</html>\n`;
}

/** Rutas con index.html bajo `dir` del sitio base, salvo los subdirectorios `omitir` de primer nivel. */
export function paginasBajo(base, dir, omitir = []) {
  const salida = [];
  const recorrer = relativa => {
    for (const entrada of readdirSync(join(base, relativa), { withFileTypes: true })) {
      if (!entrada.isDirectory() || omitir.includes(entrada.name) && relativa === dir) continue;
      const ruta = `${relativa}/${entrada.name}`;
      if (existsSync(join(base, ruta, 'index.html'))) salida.push(ruta);
      recorrer(ruta);
    }
  };
  if (existsSync(join(base, dir))) recorrer(dir);
  return salida;
}

// Inscritos de una carrera sin lista: lo mismo que pinta js/inscritos.js sin equipos. Las que tienen
// lista las publica su familia, aunque el sitio base aún no lo sepa.
const SIN_LISTA = { inscritos: 'No hay lista de inscritos disponible para esta carrera.', 'en/startlist': 'No startlist available for this race' };

export function publicarInscritosSinLista(activos, salida, escribir, conservar = () => {}) {
  let paginas = 0;
  const { tema, fuente } = activos;
  for (const [dir, aviso] of Object.entries(SIN_LISTA)) {
    for (const ruta of paginasBajo(activos.base, dir)) {
      if (existsSync(join(salida, ruta, 'index.html')) && readFileSync(join(salida, ruta, 'index.html'), 'utf8').includes('startlist-grid')) {
        conservar(`${ruta}/index.html`);
        continue;
      }
      const source = readFileSync(join(activos.base, ruta, 'index.html'), 'utf8');
      if (!/class="[^"]*\bloading\b/.test(source)) continue;
      const pagina = conIsla(source, { tema, fuente, clasicos: activos.clasicos, css: activos.inscritos.css, isla: activos.inscritos.isla });
      if (!pagina) continue;
      escribir(`${ruta}/index.html`, pagina.replace(/<main([^>]*)>[\s\S]*?<\/main>/, (_, atributos) => `<main${atributos.replace(/\sdata-prerendered="[^"]*"/, '')} data-clave="inscritos-vacio/${ruta.split('/').pop()}" data-sondeo="0" data-volver=""><div class="startlist-empty">${aviso}</div></main>`));
      paginas++;
    }
  }
  return paginas;
}

/**
 * Lo que publica la familia del mercado y lee su JS. `tablas`: volcados de
 * tools/site/prerender-fichajes.sql y mercado-plantillas.sql.
 */
export async function datosMercado({ seasons, prevSeasons, transfers, men, women, extraTeams, afiliaciones, plantillaHombres, plantillaMujeres }) {
  const { installBrowserEnv } = await import('../site/prerender-jornadas.mjs');
  const pedir = globalThis.fetch;
  installBrowserEnv('es');
  globalThis.fetch = pedir;
  const { attachRiders, buildMarket, hasTeamView, rosterFromRows, rosterGender } = await import('../../js/fichajes-html.js');
  const movimientos = attachRiders(transfers, men, women);
  const market = buildMarket({ seasons, prevSeasons, transfers: movimientos, extraTeams });
  const hombres = new Map(plantillaHombres.map(ficha => [ficha.id, ficha]));
  const mujeres = new Map(plantillaMujeres.map(ficha => [ficha.id, ficha]));
  const rosters = {};
  for (const { teamId } of seasons) {
    if (!hasTeamView(market, teamId)) continue;
    const filas = afiliaciones.filter(fila => fila.teamId === teamId);
    const genero = rosterGender(market, teamId);
    const fichas = (tabla, nombre) => filas.filter(fila => (fila.riderGender || genero) === nombre).map(fila => tabla.get(fila.riderId)).filter(Boolean);
    rosters[teamId] = rosterFromRows(filas, fichas(hombres, 'male'), fichas(mujeres, 'female'));
  }
  return { seasons, prevSeasons, transfers: movimientos, extraTeams, rosters };
}

/** Filas de Campeonatos Nacionales, con lo que embebe la lectura de js/campeonatos.js. `tablas`: campeonatos.sql. */
export async function datosCampeonatos({ races, days, broadcasts, assets, stages }) {
  const { installBrowserEnv } = await import('../site/prerender-jornadas.mjs');
  const pedir = globalThis.fetch;
  installBrowserEnv('es');
  globalThis.fetch = pedir;
  const { CAMP } = await import('../../js/campeonatos-config.js');
  const agrupar = (filas, clave) => {
    const mapa = new Map();
    for (const fila of filas) (mapa.get(fila[clave]) || mapa.set(fila[clave], []).get(fila[clave])).push(fila);
    return mapa;
  };
  const dias = agrupar(days, 'raceId');
  const emisiones = agrupar(broadcasts, 'raceDayId');
  const documentos = agrupar(assets, 'raceDayId');
  const etapas = agrupar(stages, 'raceId');
  return races
    .filter(race => race.year === CAMP.YEAR && race.startDate >= CAMP.QUERY_START && race.startDate <= CAMP.QUERY_END)
    .map(race => ({
      ...race,
      race_days: (dias.get(race.id) || []).map(dia => ({ ...dia, broadcasts: emisiones.get(dia.id) || [], assets: documentos.get(dia.id) || [] })),
      race_uci_stages: etapas.get(race.id) || [],
    }));
}

/** Hoy de carretera por días: lo que lee js/app.js de cada fecha y las carreras de cada año. `tablas`: hoy.sql. */
export function datosHoy({ days, races, broadcasts, assets, stages, activas, anio, featured }) {
  const agrupar = (filas, clave) => {
    const mapa = new Map();
    for (const fila of filas) (mapa.get(fila[clave]) || mapa.set(fila[clave], []).get(fila[clave])).push(fila);
    return mapa;
  };
  const carreras = new Map(races.map(race => [race.id, race]));
  const etapas = agrupar(stages, 'raceId');
  const emisiones = agrupar(broadcasts, 'raceDayId');
  const documentos = agrupar(assets, 'raceDayId');
  const destacadas = agrupar(featured, 'dateKey');
  const porDia = agrupar(days, 'dateKey');
  const fechas = [...porDia.keys()];
  // Toda la ventana, también los días sin jornada: las carreras en curso salen sin publicar.
  const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const hasta = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  for (let d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) fechas.push(d.toISOString().slice(0, 10));
  const dias = {};
  for (const dia of [...new Set(fechas)].sort()) {
    dias[dia] = {
      rows: (porDia.get(dia) || []).map(rd => ({
        ...rd,
        race: carreras.has(rd.raceId) ? { ...carreras.get(rd.raceId), race_uci_stages: etapas.get(rd.raceId) || [] } : null,
        broadcasts: emisiones.get(rd.id) || [],
        assets: documentos.get(rd.id) || [],
      })),
      activas: activas.filter(race => race.startDate <= dia && race.endDate >= dia && race.year === Number(dia.slice(0, 4))),
      featured: (destacadas.get(dia) || []).map(fila => fila.raceId),
    };
  }
  const anios = {};
  for (const race of anio) (anios[race.year] ||= []).push(race);
  return { dias, anios };
}

/** Archivos que leen estas islas. `jornadas`, `cx`: volcados de tools/site/prerender-*.sql. */
export async function archivosFamiliasBase({ jornadas, cx }) {
  const archivos = {};
  // Los módulos del navegador piden su entorno al cargarse; el `fetch` del proceso se conserva.
  const { installBrowserEnv } = await import('../site/prerender-jornadas.mjs');
  const pedir = globalThis.fetch;
  installBrowserEnv('es');
  globalThis.fetch = pedir;
  const agrupar = (filas, clave) => {
    const mapa = new Map();
    for (const fila of filas || []) (mapa.get(fila[clave]) || mapa.set(fila[clave], []).get(fila[clave])).push(fila);
    return mapa;
  };
  if (jornadas) {
    const dias = agrupar(jornadas.days, 'raceId');
    const emisiones = agrupar(jornadas.broadcasts, 'raceDayId');
    const documentos = agrupar(jornadas.assets, 'raceDayId');
    const clasificaciones = agrupar(jornadas.uci, 'raceId');
    for (const race of jornadas.races) {
      archivos[`d/competicion/${race.id}.json`] = JSON.stringify({
        fila: { ...race, race_days: (dias.get(race.id) || []).map(dia => ({ ...dia, broadcasts: emisiones.get(dia.id) || [], assets: documentos.get(dia.id) || [] })) },
        clasificaciones: clasificaciones.get(race.id) || [],
      });
    }
  }
  if (cx) {
    const { buildIndex, raceInputs } = await import('../site/prerender-cx.mjs');
    const { cxTournamentRounds, cxSeasonBounds } = await import('../../js/services/cx-data.js');
    const indice = buildIndex(cx, { cxTournamentRounds, cxSeasonBounds });
    archivos['d/cx/equipos.json'] = JSON.stringify(cx.teams);
    for (const race of cx.races) {
      const entrada = raceInputs(indice, race.id);
      if (!entrada) continue;
      const { teamRows: _equipos, rounds: _rondas, ...filas } = entrada.rows;
      archivos[`d/cx/carrera/${race.id}.json`] = JSON.stringify({ race: entrada.race, rows: filas });
    }
  }
  return archivos;
}
