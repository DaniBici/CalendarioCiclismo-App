// Datos del prototipo de publicación por página: índice en memoria de las
// jornadas (mismas filas que tools/site/prerender-jornadas.sql), lectura de una
// carrera y señal de cambio por `xmin`. Solo lee: toda consulta va en una
// transacción de solo lectura con el rol cc_agent.
import { readFileSync } from 'node:fs';
import { escribirVolcado, planVolcado } from '../../scripts/db/volcado-filas.mjs';
import { STAGE_SIBLING_COLUMNS, firstTechnicalGuide, stageSiblings } from '../../js/services/races.js';
import { PG_CONNECTION_LIMITS, databaseUrl, loadEnv } from '../../scripts/db/env.mjs';

const sortOrderOf = row => row.sortOrder ?? Infinity;

function agrupar(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = typeof key === 'function' ? key(row) : row[key];
    if (value == null) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

const SIBLING_COLUMNS = STAGE_SIBLING_COLUMNS.split(',');

/** Filas de una carrera, en la forma del volcado de prerender-jornadas.sql. */
export class Datos {
  constructor(volcado) {
    this.races = new Map(volcado.races.map(race => [race.id, race]));
    this.days = agrupar(volcado.days, 'raceId');
    const broadcasts = [...volcado.broadcasts].sort((a, b) =>
      sortOrderOf(a) === sortOrderOf(b) ? 0 : sortOrderOf(a) < sortOrderOf(b) ? -1 : 1);
    this.broadcasts = agrupar(broadcasts, 'raceDayId');
    this.assets = agrupar(volcado.assets, 'raceDayId');
    this.guides = agrupar(volcado.guides, row => row.race_days?.raceId);
    this.uci = agrupar(volcado.uci, 'raceId');
  }

  static desdeArchivo(file) {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return new Datos(Array.isArray(parsed) ? parsed[0] : parsed);
  }

  carreras() {
    return [...this.days.keys()];
  }

  jornadas(raceId) {
    return this.days.get(raceId) || [];
  }

  /** Sustituye las filas de una carrera por las leídas en `leerCarrera()`. */
  reemplazarCarrera(raceId, filas) {
    if (filas.race) this.races.set(raceId, filas.race);
    for (const day of this.jornadas(raceId)) {
      this.broadcasts.delete(day.id);
      this.assets.delete(day.id);
    }
    this.days.set(raceId, filas.days);
    const broadcasts = [...filas.broadcasts].sort((a, b) =>
      sortOrderOf(a) === sortOrderOf(b) ? 0 : sortOrderOf(a) < sortOrderOf(b) ? -1 : 1);
    for (const [dayId, rows] of agrupar(broadcasts, 'raceDayId')) this.broadcasts.set(dayId, rows);
    for (const [dayId, rows] of agrupar(filas.assets, 'raceDayId')) this.assets.set(dayId, rows);
    this.guides.set(raceId, filas.guides);
    this.uci.set(raceId, filas.uci);
  }

  /** Argumentos de jornadaHtml() de cada jornada de la carrera. */
  entradas(raceId) {
    const race = this.races.get(raceId);
    const days = this.jornadas(raceId);
    if (!race || !days.length) return [];
    const siblings = race.raceFormat !== 'one_day'
      ? stageSiblings(days.map(day => Object.fromEntries(SIBLING_COLUMNS.map(column => [column, day[column] ?? null]))))
      : [];
    const guides = this.guides.get(raceId) || [];
    // Para el grupo canónico del <head>: solo depende de la carrera.
    const diasCarrera = days.map(({ id, slug, slugEn, raceId: raza, stageNumber, dateKey, startLocation, finishLocation }) =>
      ({ id, slug, slugEn, raceId: raza, stageNumber, dateKey, startLocation, finishLocation }));
    return days.filter(day => day.slug || day.slugEn).map(day => {
      const rd = { ...day };
      const match = siblings.find(sibling => sibling.id === rd.id);
      if (match?._stageSuffix) rd._stageSuffix = match._stageSuffix;
      return {
        rd, race, siblings, diasCarrera,
        broadcasts: this.broadcasts.get(day.id) || [],
        assets: this.assets.get(day.id) || [],
        guide: guides.length ? firstTechnicalGuide(guides) : null,
        uci: this.uci.get(raceId) || [],
        hasStartlist: !!race.startlistImportedAt,
      };
    });
  }
}

/** Inscritos de las carreras con lista, en la forma de tools/site/prerender-inscritos.sql. */
export class DatosInscritos {
  constructor(volcado) {
    this.carrerasPorId = new Map();
    this.filas = new Map();
    this.absorber(volcado, null);
  }

  /** Incorpora un volcado; `ids`, las carreras que cubre (null: todas). */
  absorber(volcado, ids) {
    for (const raceId of ids || []) { this.carrerasPorId.delete(raceId); this.filas.delete(raceId); }
    const etapaCarrera = new Map(volcado.stages.map(etapa => [etapa.id, etapa.raceId]));
    const grupos = {
      teamRows: agrupar(volcado.teams, 'raceId'), riders: agrupar(volcado.riders, 'raceId'), raceDays: agrupar(volcado.days, 'raceId'),
      uciStages: agrupar(volcado.stages, 'raceId'), outRows: agrupar(volcado.results, fila => etapaCarrera.get(fila.stageRef)),
    };
    const unDia = new Map();
    for (const dia of volcado.oneDays) if (!unDia.has(dia.raceId)) unDia.set(dia.raceId, dia);
    const guias = agrupar(volcado.guides, fila => fila.race_days?.raceId);
    const recuentos = new Map(volcado.counts.map(fila => [fila.raceId, fila]));
    for (const race of volcado.races) {
      const { assets: oneDayAssets = [], ...oneDayRd } = unDia.get(race.id) || {};
      this.carrerasPorId.set(race.id, race);
      this.filas.set(race.id, {
        familia: 'inscritos', race,
        rows: Object.fromEntries(Object.entries(grupos).map(([nombre, grupo]) => [nombre, grupo.get(race.id) || []])),
        oneDayRd: race.raceFormat === 'one_day' && oneDayRd.id ? oneDayRd : null, oneDayAssets,
        guide: guias.has(race.id) ? firstTechnicalGuide(guias.get(race.id)) : null,
        recuentos: { teams: Number(recuentos.get(race.id)?.teams || 0), riders: Number(recuentos.get(race.id)?.riders || 0) },
      });
    }
  }

  carreras() {
    return [...this.filas.keys()];
  }

  entradas(raceId) {
    const entrada = this.filas.get(raceId);
    return entrada ? [entrada] : [];
  }
}

// La consulta del volcado del build, sin ventana de fechas y limitable a unas carreras.
function consultaInscritos() {
  let consulta = readFileSync(new URL('../site/prerender-inscritos.sql', import.meta.url), 'utf8');
  const cambios = [
    ["set local timezone = 'UTC';", ''],
    ['select (current_date - 7)::text as since', 'select null::text as since'],
    ['where (p.since is null or coalesce(r."endDate", r."startDate") >= p.since)', 'where ($1::text[] is null or r.id = any($1))'],
    ['as guides;', `as guides,
  (select coalesce(jsonb_agg(jsonb_build_object('raceId', c."raceId", 'teams', c.teams, 'riders', c.riders)), '[]'::jsonb)
     from public.startlist_counts() c where c."raceId" in (select id from scope)) as counts`],
  ];
  for (const [de, a] of cambios) {
    if (!consulta.includes(de)) throw new Error(`prerender-inscritos.sql sin «${de}»`);
    consulta = consulta.replace(de, a);
  }
  return consulta;
}

/** Inscritos de las carreras `ids`, o de todas con null. */
export async function leerInscritos(client, ids = null) {
  const { rows } = await client.query(consultaInscritos(), [ids]);
  return rows[0];
}

const planes = new Map();

/**
 * Lee un .sql de volcado (relativo a este archivo) por filas, en una misma foto de los datos: el
 * servidor no monta cada clave en un solo JSON. Nada de esto va dentro de otra transacción.
 * `claves`: solo esas claves del volcado.
 */
export async function leerPorFilas(client, archivo, { claves = null } = {}) {
  if (!planes.has(archivo)) planes.set(archivo, planVolcado(readFileSync(new URL(archivo, import.meta.url), 'utf8')));
  const plan = planes.get(archivo);
  const trozos = [];
  await escribirVolcado(client, claves ? { ...plan, claves: plan.claves.filter(({ clave }) => claves.includes(clave)) } : plan,
    { write: trozo => trozos.push(trozo) > 0 });
  return JSON.parse(trozos.join(''))[0];
}

/** Datos de la portada: agenda, rondas, destacadas y cintillo (portada.sql). */
export const leerPortada = client => leerPorFilas(client, './portada.sql');

export const leerResultadosFeed = client => leerPorFilas(client, './resultados-feed.sql');

export const leerTemporadas = client => leerPorFilas(client, './temporada.sql');

export const leerHoy = client => leerPorFilas(client, './hoy.sql');

/** Solo las clasificaciones con resultados de la ventana de Hoy (clave `stages` de hoy.sql). */
export const leerClasificacionesHoy = async client => (await leerPorFilas(client, './hoy.sql', { claves: ['stages'] })).stages;

/** Archivos del calendario: una temporada por año y lo que lee cada modal. */
export function archivosCalendario(volcado) {
  const archivos = {};
  const anios = new Set(volcado.races.map(race => race.year));
  for (const anio of anios) {
    archivos[`d/temporada/${anio}.json`] = JSON.stringify({
      races: volcado.races.filter(race => race.year === anio),
      days: volcado.race_days.filter(dia => dia.dateKey?.startsWith(`${anio}-`)),
      groups: volcado.challenge_groups,
    });
  }
  for (const fila of volcado.modal) {
    if (!fila.rd || !fila.race) continue;
    archivos[`d/modal/${fila.id}.json`] = JSON.stringify({
      races: [fila.race], race_days: [fila.rd], broadcasts: fila.broadcasts, assets: fila.assets, race_uci_stages: fila.clasificaciones,
      startlist_teams: Array.from({ length: fila.equipos }, () => ({ raceId: fila.race.id })),
    });
  }
  return archivos;
}

/** Archivos publicados que lee el navegador: temporada y cintillo. */
export function archivosPortada(volcado) {
  const destacadas = new Set(volcado.featured.map(fila => fila.cxRaceId));
  const archivos = { 'd/cintillo.json': null };
  const temporadas = new Set(volcado.agenda.map(race => race.seasonKey));
  for (const seasonKey of temporadas) {
    archivos[`d/cx/${seasonKey}.json`] = JSON.stringify({
      rows: volcado.agenda.filter(race => race.seasonKey === seasonKey).map(race => ({ ...race, featured: destacadas.has(race.id) })),
      rondas: volcado.rondas.filter(race => race.seasonKey === seasonKey),
    });
  }
  archivos['d/cintillo.json'] = JSON.stringify({
    today_highlights: volcado.today_highlights, races: volcado.races, race_days: volcado.race_days, cx_tournaments: volcado.cx_tournaments,
    cx_races: volcado.agenda.filter(race => volcado.today_highlights.some(fila => fila.cxRaceId === race.id)),
  });
  return archivos;
}

/**
 * Todas las listas por lotes, con una pausa entre ellos: una sola consulta tarda más de
 * 20 s, y esa lectura ocurre a diario. `informar(ms)` recibe lo que tarda cada lote.
 */
export async function leerInscritosPorLotes(client, { tamano = 100, pausaMs = 200, informar = null } = {}) {
  const { rows } = await client.query('select distinct "raceId"::text as id from startlist_teams where "raceId" is not null order by 1');
  const ids = rows.map(fila => fila.id);
  const total = { races: [], teams: [], riders: [], days: [], stages: [], results: [], oneDays: [], guides: [], counts: [] };
  for (let at = 0; at < ids.length; at += tamano) {
    const inicio = performance.now();
    const lote = await leerInscritos(client, ids.slice(at, at + tamano));
    informar?.(performance.now() - inicio);
    for (const nombre of Object.keys(total)) total[nombre].push(...lote[nombre]);
    await new Promise(done => setTimeout(done, pausaMs));
  }
  return total;
}

const CONSULTA_CARRERA = `
select
  (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb)
     from race_days d where d."editorialStatus" = 'published' and d."raceId" = $1) as days,
  (select to_jsonb(r) from races r where r.id = $1) as race,
  (select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)
     from broadcasts b join race_days d on d.id = b."raceDayId" where d."raceId" = $1) as broadcasts,
  (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)
     from assets a join race_days d on d.id = a."raceDayId" where d."raceId" = $1) as assets,
  (select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('race_days',
            jsonb_build_object('raceId', d."raceId", 'dateKey', d."dateKey")) order by a.id), '[]'::jsonb)
     from assets a join race_days d on d.id = a."raceDayId"
    where a.type = 'technicalGuide' and d."raceId" = $1) as guides,
  (select coalesce(jsonb_agg(jsonb_build_object('raceId', u."raceId", 'raceDayId', u."raceDayId",
            'stageNumber', u."stageNumber") order by u.id), '[]'::jsonb)
     from race_uci_stages u where u."keepForWeb" and u."rowCount" > 0 and u."raceId" = $1) as uci,
  (select max(u."updatedAt") from race_uci_stages u where u."raceId" = $1) as "marcaResultados"`;

// Señal en dos niveles, sin triggers, columnas ni publicaciones:
// 1. Cada pasada, una firma por tabla. En las pequeñas, recuento y suma de `xmin`,
//    que cambia con cualquier escritura en la fila, también en las tablas sin
//    `updatedAt` (broadcasts, assets, races). Las grandes, una de cada 15 pasadas: unos
//    100 ms de consulta. No sirven los contadores de pg_stat_user_tables: están a cero.
// 2. Solo en las tablas cuya firma cambió, la comparación fila a fila o, en las
//    grandes, carrera a carrera, para saber qué carreras o fichas CX volver a pintar.
export const TABLAS_PORTADA = ['cx_races', 'cx_race_categories', 'cx_broadcasts', 'cx_videos', 'cx_tournaments', 'cx_race_featured', 'today_highlights', 'races', 'race_days'];

const TABLAS = {
  race_days: { raza: 'd."raceId"', de: 'race_days d' },
  races: { raza: 'd.id', de: 'races d' },
  broadcasts: { raza: 'j."raceId"', de: 'broadcasts d left join race_days j on j.id = d."raceDayId"' },
  // De carretera por la jornada (raceId); de ciclocross, por su ficha (cxRaceId).
  assets: { raza: 'j."raceId"', cx: 'd."cxRaceId"', de: 'assets d left join race_days j on j.id = d."raceDayId"' },
  race_uci_stages: { raza: 'd."raceId"', de: 'race_uci_stages d' },
  race_uci_results: {
    grande: true,
    filas: `select d."raceId"::text as id, count(*)::text || ':' || coalesce(sum(d.xmin::text::bigint), 0)::text as x, d."raceId"::text as r
              from race_uci_results d group by d."raceId"`,
  },
  startlist_teams: { raza: 'd."raceId"', de: 'startlist_teams d' },
  startlist_riders: {
    grande: true,
    filas: `select d."raceId"::text as id, count(*)::text || ':' || coalesce(sum(d.xmin::text::bigint), 0)::text as x, d."raceId"::text as r
              from startlist_riders d where d."raceId" is not null group by d."raceId"`,
  },
  race_classifications: { raza: 'd."raceId"', de: 'race_classifications d', id: 'd."raceId"::text || d."classKind"' },
  start_order_entries: { raza: 'j."raceId"', de: 'start_order_entries d left join race_days j on j.id = d."raceDayId"' },
  // Sin carrera: Últimos resultados, calendario y sitio base las vuelven a leer enteras.
  uci_team_rankings: { raza: 'null', de: 'uci_team_rankings d', id: 'd.gender::text || d.rank::text' },
  challenge_groups: { raza: 'null', de: 'challenge_groups d' },
  rider_transfers: { raza: 'null', de: 'rider_transfers d' },
  rider_team_affiliations: { raza: 'null', de: 'rider_team_affiliations d' },
  race_featured_overrides: { raza: 'null', de: 'race_featured_overrides d', id: 'd."raceId"::text' },
  cx_results: { raza: 'null', de: 'cx_results d' },
  cx_startlist_riders: { raza: 'null', de: 'cx_startlist_riders d' },
  cx_standings_state: { raza: 'null', de: 'cx_standings_state d', id: 'd.ctid::text' },
  cx_tournament_standings: { raza: 'null', de: 'cx_tournament_standings d' },
  // Portada: cualquier cambio la vuelve a leer entera, sin carrera.
  cx_races: { raza: 'null', de: 'cx_races d', portada: true },
  cx_race_categories: { raza: 'null', de: 'cx_race_categories d', portada: true },
  cx_broadcasts: { raza: 'null', de: 'cx_broadcasts d', portada: true },
  cx_videos: { raza: 'null', de: 'cx_videos d', portada: true },
  cx_tournaments: { raza: 'null', de: 'cx_tournaments d', portada: true },
  cx_race_featured: { raza: 'null', de: 'cx_race_featured d', portada: true, id: 'd."cxRaceId"::text' },
  today_highlights: { raza: 'null', de: 'today_highlights d', portada: true },
  // Abanico: la fila no lleva carrera; se buscan las carreras que la usan.
  teams: { raza: 'd.id', de: 'teams d', abanico: 'select distinct "raceId"::text as r, "teamId"::text as origen from startlist_teams where "teamId" = any($1)' },
  team_seasons: { raza: 'd."teamId"', de: 'team_seasons d', abanico: 'select distinct "raceId"::text as r, "teamId"::text as origen from startlist_teams where "teamId" = any($1)' },
  riders_men: { raza: 'd.id', de: 'riders_men d', abanico: 'select distinct "raceId"::text as r, "globalRiderId"::text as origen from startlist_riders where "globalRiderId" = any($1)' },
  riders_women: { raza: 'd.id', de: 'riders_women d', abanico: 'select distinct "raceId"::text as r, "globalRiderId"::text as origen from startlist_riders where "globalRiderId" = any($1)' },
};

const firmaDe = tabla => `select '${tabla}' as tabla, count(*)::text as n, coalesce(sum(xmin::text::bigint), 0)::text as s from ${tabla}`;
const PASADAS_GRANDES = 15;

/** Conexión persistente en solo lectura. */
export async function conectar() {
  loadEnv();
  // En el VPS, el rol de solo lectura; en local, el de agentes.
  const url = process.env.PUBLICADOR_DATABASE_URL || databaseUrl();
  if (!url) throw new Error('Falta PUBLICADOR_DATABASE_URL o AGENT_DATABASE_URL');
  const { default: pg } = await import('pg');
  // Un reinicio de la base puede dejar el socket medio abierto: sin límites, el proceso esperaría
  // para siempre. Mismos límites que los workers del VPS (scripts/db/env.mjs).
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, ...PG_CONNECTION_LIMITS, query_timeout: 60_000 });
  // La caída se ve en la consulta siguiente; sin oyente, el evento terminaría el proceso.
  client.on('error', () => {});
  await client.connect();
  await client.query(`set session characteristics as transaction read only; set timezone = 'UTC'`);
  return client;
}

/** Todas las jornadas, con la consulta del volcado del build. */
export const leerTodo = client => leerPorFilas(client, '../site/prerender-jornadas.sql');

export async function leerCarrera(client, raceId) {
  const { rows } = await client.query(CONSULTA_CARRERA, [raceId]);
  return rows[0];
}

/** Señal de cambio: detecta qué carreras tienen filas nuevas, tocadas o borradas. */
export class Senal {
  constructor(client) {
    this.client = client;
    this.firmas = new Map();
    this.filas = new Map();
    this.pasadas = 0;
  }

  async leerFilas(tabla) {
    const { raza, cx, de, filas, id = 'd.id::text' } = TABLAS[tabla];
    const { rows } = await this.client.query(filas || `select ${id} as id, d.xmin::text as x, ${raza}::text as r${cx ? `, ${cx}::text as c` : ''} from ${de}`);
    return new Map(rows.map(row => [row.id, row]));
  }

  /**
   * Carga el estado inicial. Vigila las tablas que el rol puede leer; una sin permiso deja
   * sin avisos a lo que dependa de ella, no al resto. `sinPermiso`: las que faltan.
   */
  async iniciar() {
    const { rows: legibles } = await this.client.query("select t from unnest($1::text[]) t where has_table_privilege(current_user, 'public.' || t, 'select')", [Object.keys(TABLAS)]);
    const tablas = new Set(legibles.map(fila => fila.t));
    this.sinPermiso = Object.keys(TABLAS).filter(tabla => !tablas.has(tabla));
    this.consultaFirmas = [...tablas].map(firmaDe).join(' union all ');
    this.consultaLigera = [...tablas].filter(tabla => !TABLAS[tabla].grande).map(firmaDe).join(' union all ');
    const { rows } = await this.client.query(this.consultaFirmas);
    for (const row of rows) {
      this.firmas.set(row.tabla, `${row.n}:${row.s}`);
      this.filas.set(row.tabla, await this.leerFilas(row.tabla));
    }
  }

  /** Una pasada. Devuelve [{ tabla, id, raceId, cxRaceId }] de las filas que cambiaron. */
  async comprobar() {
    this.pasadas++;
    const { rows } = await this.client.query(this.pasadas % PASADAS_GRANDES === 0 ? this.consultaFirmas : this.consultaLigera);
    const cambios = [];
    for (const row of rows) {
      const firma = `${row.n}:${row.s}`;
      if (this.firmas.get(row.tabla) === firma) continue;
      this.firmas.set(row.tabla, firma);
      const anterior = this.filas.get(row.tabla);
      const actual = await this.leerFilas(row.tabla);
      for (const [id, fila] of actual) {
        const previa = anterior.get(id);
        if (previa?.x === fila.x) continue;
        cambios.push({ tabla: row.tabla, id, raceId: fila.r, cxRaceId: fila.c, tipo: previa ? 'cambio' : 'alta' });
        // Fila movida de carrera: la de origen también cambia.
        if (previa && (previa.r !== fila.r || previa.c !== fila.c)) cambios.push({ tabla: row.tabla, id, raceId: previa.r, cxRaceId: previa.c, tipo: 'salida' });
      }
      for (const [id, fila] of anterior) {
        if (!actual.has(id)) cambios.push({ tabla: row.tabla, id, raceId: fila.r, cxRaceId: fila.c, tipo: 'baja' });
      }
      this.filas.set(row.tabla, actual);
    }
    return this.resolverAbanicos(cambios);
  }

  /**
   * Sustituye el identificador de las filas sin carrera por las carreras que las usan. Cada fila
   * se conserva además sin carrera: el mercado de fichajes lee equipos y corredores que ninguna
   * lista de inscritos usa.
   */
  async resolverAbanicos(cambios) {
    const salida = [];
    const pendientes = new Map();
    for (const cambio of cambios) {
      const { abanico } = TABLAS[cambio.tabla] || {};
      if (!abanico) { salida.push(cambio); continue; }
      if (!pendientes.has(cambio.tabla)) pendientes.set(cambio.tabla, []);
      pendientes.get(cambio.tabla).push(cambio);
      salida.push({ tabla: cambio.tabla, id: cambio.id, raceId: null, tipo: cambio.tipo });
    }
    for (const [tabla, filas] of pendientes) {
      const { rows } = await this.client.query(TABLAS[tabla].abanico, [[...new Set(filas.map(fila => fila.raceId))]]);
      for (const { r, origen } of rows) {
        const fila = filas.find(candidata => candidata.raceId === origen);
        salida.push({ tabla, id: fila.id, raceId: r, tipo: fila.tipo });
      }
    }
    return salida;
  }
}
