#!/usr/bin/env node
// Publicador del VPS: publica todas las familias, vigila los cambios y republica lo afectado.
// Solo lee la base de datos (PUBLICADOR_DATABASE_URL). El sitio base se regenera con vps/base.sh.
//
//   node tools/publicacion/servicio.mjs --trabajo <dir> --salida <árbol> --base <sitio base> [--fuente <checkout>] [--destino-base <dir>]
//
// Registro en <trabajo>/servicio.jsonl.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { cxSeason } from '../../js/cx/season.js';
import { conectar, leerClasificacionesHoy, leerHoy, leerPorFilas, leerInscritosPorLotes, leerInscritos, leerCarrera, leerPortada, leerResultadosFeed, leerTemporadas, leerTodo, Senal, Datos, DatosInscritos, TABLAS_PORTADA } from './datos.mjs';
import { montar, publicarCalendario, publicarCampeonatos, publicarCarreras, publicarCompeticiones, publicarCx, publicarEtapas, publicarHoy, publicarMercado, publicarPortada, publicarRegeneradas, publicarResultados, todasLasEntradas } from './publicacion.mjs';

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto = null) => { const at = argumentos.indexOf(`--${nombre}`); return at === -1 ? porDefecto : argumentos[at + 1]; };
const trabajo = opcion('trabajo');
const salida = opcion('salida');
process.env.CC_BASE = opcion('base', process.env.CC_BASE);
const fuente = opcion('fuente');
const SONDEO_MS = Number(opcion('cada', 2000));
const LOTE_CARRERAS = 60;
// Lo que pesa de leer se agrupa: como mucho una vez por intervalo.
// El sitio base y las familias que salen de él releen jornadas y CX enteras: como mucho cada 15 min.
// Los resultados de una carrera de Hoy no esperan al intervalo de Hoy (`resultadosHoy`).
const INTERVALOS = { mercado: 2_000, cx: 60_000, hoy: 30_000, resultadosHoy: 3_000, feed: 30_000, temporada: 30_000, etapas: 30_000, base: 15 * 60_000 };
// Un movimiento genera el mercado entero al momento, sin pasar por el sitio base.
const TABLAS_MERCADO = new Set(['rider_transfers', 'rider_team_affiliations', 'team_seasons', 'teams', 'riders_men', 'riders_women']);
// Fichas CX y torneos: se relee CX entero y se repinta la temporada en curso. Un mapa o una guía
// (assets con cxRaceId) repinta solo su ficha y sus torneos, de cualquier temporada, y la agenda.
const TABLAS_CX = new Set(['cx_races', 'cx_race_categories', 'cx_broadcasts', 'cx_videos', 'cx_results', 'cx_startlist_riders', 'cx_standings_state', 'cx_tournament_standings', 'cx_tournaments']);
const TABLAS_COMPETICION = new Set(['races', 'race_days', 'broadcasts', 'assets', 'race_uci_stages']);
// Hoy de carretera: lo que sale en las tarjetas de un día y en el cintillo.
const TABLAS_HOY = new Set(['races', 'race_days', 'broadcasts', 'assets', 'race_uci_stages', 'race_featured_overrides', 'today_highlights']);
const TABLAS_BASE = new Set(['races', 'race_days', 'broadcasts', 'assets', 'cx_races', 'cx_race_categories', 'cx_broadcasts', 'cx_videos', 'cx_results', 'cx_startlist_riders', 'cx_standings_state', 'cx_tournament_standings', 'cx_tournaments']);
const TABLAS_FEED = new Set(['race_uci_stages', 'race_uci_results', 'race_days', 'races', 'race_classifications', 'uci_team_rankings', 'cx_results', 'cx_race_categories']);
const TABLAS_TEMPORADA = new Set(['races', 'race_days', 'challenge_groups']);
// Modal del calendario (pruebas de un día sin página): emisiones, documentos, clasificaciones y equipos.
// Solo cuentan las carreras que tienen modal.
const TABLAS_MODAL = new Set(['broadcasts', 'assets', 'race_uci_stages', 'startlist_teams']);
const TABLAS_ETAPA = new Set(['race_days', 'races', 'assets', 'start_order_entries', 'startlist_teams']);
const TABLAS_CARRERA = new Set(['race_uci_stages', 'race_uci_results', 'race_classifications', 'race_days', 'races', 'assets', 'startlist_teams', 'startlist_riders', 'teams', 'team_seasons', 'riders_men', 'riders_women']);

mkdirSync(trabajo, { recursive: true });
const registro = join(trabajo, 'servicio.jsonl');
const anotar = fila => appendFileSync(registro, `${JSON.stringify({ en: new Date().toISOString(), ...fila })}\n`);
const ms = valor => Math.round(valor);
// Avisos a systemd (Type=notify, WatchdogSec): si el proceso deja de avanzar, lo reinicia.
const avisarSystemd = (...avisos) => { if (process.env.NOTIFY_SOCKET) spawn('systemd-notify', avisos, { stdio: 'ignore' }).on('error', () => {}); };
const sql = archivo => readFileSync(new URL(archivo, import.meta.url), 'utf8');

/** Resultados por carrera, por lotes: el volcado completo no cabe con holgura en memoria. */
async function publicarCarrerasPorLotes(publicador, cliente, ids) {
  let paginas = 0;
  let cambiadas = 0;
  const errores = [];
  const consulta = sql('carrera.sql');
  for (let at = 0; at < ids.length; at += LOTE_CARRERAS) {
    const lote = ids.slice(at, at + LOTE_CARRERAS);
    await cliente.query('begin read only');
    let tablas;
    try {
      await cliente.query("set local timezone = 'UTC'");
      tablas = (await cliente.query(consulta, [lote])).rows[0];
    } finally {
      await cliente.query('rollback');
    }
    const fase = await publicarCarreras(publicador, tablas);
    if (!fase.errores.length) publicador.retirarFamilia('carrera', fase.claves, new Set(lote));
    paginas += fase.paginas;
    cambiadas += fase.cambiadas;
    errores.push(...fase.errores);
  }
  return { paginas, cambiadas, errores };
}

const leerCodigo = ruta => { try { return readFileSync(ruta, 'utf8').trim(); } catch { return ''; } };
// El código con el que se generó el sitio base: si no es el de la fuente, hay que rehacerlo.
const CODIGO_BASE = join(trabajo, 'base-codigo');
let generandoBase = null;
// Sube con cada sitio base nuevo: los procesos de pintado vuelven a mirar qué páginas tiene.
let generacionBase = Date.now();
function generarBase() {
  if (generandoBase || !fuente) return generandoBase;
  const inicio = Date.now();
  const version = leerCodigo(join(fuente, '.codigo'));
  generandoBase = new Promise(hecho => {
    const hijo = spawn('nice', ['-n', '10', 'bash', join(fuente, 'tools/publicacion/vps/base.sh'), fuente, process.env.CC_BASE], { cwd: fuente, stdio: ['ignore', 'ignore', 'pipe'] });
    let errores = '';
    hijo.stderr.on('data', trozo => { errores = (errores + trozo).slice(-800); });
    hijo.on('exit', codigo => {
      anotar({ evento: 'base', codigo, segundos: Math.round((Date.now() - inicio) / 1000), errores: codigo ? errores : undefined });
      if (codigo === 0) writeFileSync(CODIGO_BASE, version);
      generacionBase = Date.now();
      generandoBase = null;
      hecho(codigo === 0);
    });
  });
  return generandoBase;
}

const FUENTES_BASE = { jornadas: '../site/prerender-jornadas.sql', cx: '../site/prerender-cx.sql' };
async function publicarSobreBase(publicador, activos, cliente) {
  const inicio = performance.now();
  const volcados = {};
  for (const [nombre, archivo] of Object.entries(FUENTES_BASE)) volcados[nombre] = await leerPorFilas(cliente, archivo);
  const fase = await publicarRegeneradas(publicador, activos, volcados, { generacion: generacionBase });
  anotar({ evento: 'familias-base', totalMs: ms(performance.now() - inicio), ...fase });
}

async function publicarMercadoEntero(publicador, cliente) {
  const inicio = performance.now();
  let tablas;
  try {
    tablas = { ...await leerPorFilas(cliente, '../site/prerender-fichajes.sql'), ...await leerPorFilas(cliente, './mercado-plantillas.sql') };
  } catch (error) {
    // Sin permiso de lectura el mercado se queda como está; el resto sigue publicando.
    if (error.code !== '42501') throw error;
    if (publicador.pasada) publicador.pasada.conErrores = true;
    return { errorPermiso: error.message };
  }
  const lectura = performance.now();
  const fase = await publicarMercado(publicador, tablas);
  return { lecturaMs: ms(lectura - inicio), totalMs: ms(performance.now() - inicio), paginas: fase.paginas, cambiadas: fase.cambiadas, errores: fase.errores.slice(0, 5) };
}

const leerAuxiliares = cliente => leerPorFilas(cliente, '../site/prerender-auxiliares.sql');

async function principal() {
  // Máquina recién instalada: las páginas se apoyan en el sitio base, que aún no existe.
  if (fuente && !existsSync(join(process.env.CC_BASE, 'index.html'))) {
    anotar({ evento: 'base-inicial' });
    await generarBase();
  }
  let publicador = null;
  let activos = null;
  let datos = null;
  let inscritos = null;
  let portada = null;
  let feed = null;
  let hoyDatos = null;
  let carrerasModal = new Set();
  let diaProceso = null;
  let espera = 1000;
  // Cada minuto basta con ayer, hoy y mañana: los demás días no dependen de la hora.
  const alrededorDeHoy = () => [-1, 0, 1].map(delta => new Date(Date.now() + delta * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }));
  // Código nuevo: el sitio base se rehace al acabar la primera pasada, sin esperar a un cambio de datos.
  const baseDesfasada = Boolean(fuente) && leerCodigo(join(fuente, '.codigo')) !== leerCodigo(CODIGO_BASE);
  const pendiente = { cx: false, fichasCx: new Set(), portada: false, hoy: false, resultadosHoy: false, mercado: false, feed: false, temporada: false, etapas: new Set(), base: baseDesfasada };
  const cxPendiente = () => pendiente.cx || pendiente.fichasCx.size > 0;
  const ultimo = { cx: 0, hoy: 0, mercado: 0, feed: 0, temporada: 0, etapas: 0, base: baseDesfasada ? 0 : Date.now(), reloj: 0 };
  // La generación del sitio base corre aparte; al terminar, una conexión propia para publicar encima.
  const publicarSobreBaseSeguro = () => conectar().then(async segundo => {
    try { await publicarSobreBase(publicador, activos, segundo); } finally { await segundo.end().catch(() => {}); }
  }).catch(error => anotar({ evento: 'familias-base-fallo', error: error.message }));

  // Hoy de carretera y Campeonatos. `soloClasificaciones`: de Hoy solo han cambiado resultados desde la
  // última lectura; se releen esos y no la ventana entera.
  async function refrescarHoy(cliente, { soloClasificaciones = false } = {}) {
    ultimo.hoy = Date.now();
    pendiente.hoy = false;
    pendiente.resultadosHoy = false;
    hoyDatos = soloClasificaciones ? { ...hoyDatos, stages: await leerClasificacionesHoy(cliente) } : await leerHoy(cliente);
    const fase = await publicarHoy(publicador, hoyDatos, portada);
    if (fase.cambiadas) anotar({ evento: 'hoy', soloClasificaciones: soloClasificaciones || undefined, paginas: fase.paginas, cambiadas: fase.cambiadas, pintadoMs: ms(fase.pintadoMs), errores: fase.errores.slice(0, 5) });
    await publicarCampeonatos(publicador, await leerPorFilas(cliente, './campeonatos.sql'), portada);
  }

  async function refrescarMercado(cliente) {
    ultimo.mercado = Date.now();
    pendiente.mercado = false;
    anotar({ evento: 'mercado', ...await publicarMercadoEntero(publicador, cliente) });
  }

  async function publicarTemporadas(cliente) {
    const temporada = await leerTemporadas(cliente);
    carrerasModal = new Set(temporada.modal.map(fila => fila.race?.id).filter(Boolean));
    await publicarCalendario(publicador, temporada);
  }

  async function todo(cliente, evento) {
    const inicio = performance.now();
    const volcado = await leerTodo(cliente);
    const volcadoInscritos = await leerInscritosPorLotes(cliente, {});
    portada = await leerPortada(cliente);
    if (publicador) {
      datos = new Datos(volcado);
      inscritos = new DatosInscritos(volcadoInscritos);
    } else {
      ({ publicador, datos, inscritos, activos } = await montar(trabajo, salida, { volcado, volcadoInscritos, volcadoPortada: portada }));
    }
    publicador.abrirPasada();
    const fase = await publicador.sincronizar(todasLasEntradas(datos, inscritos));
    avisarSystemd('WATCHDOG=1');
    anotar({ evento, paso: 'jornadas-inscritos', totalMs: ms(performance.now() - inicio), paginas: fase.paginas, cambiadas: fase.cambiadas, errores: fase.errores?.slice(0, 5) });
    // Portada (Hoy y agenda CX) y Últimos resultados se leen antes que las fichas CX y se publican
    // detrás de ellas: la copa de una manga no aparece antes que sus resultados en la ficha.
    feed = await leerResultadosFeed(cliente);
    await publicarTemporadas(cliente);
    await publicarEtapas(publicador, await leerAuxiliares(cliente));
    const { rows } = await cliente.query('select id from races order by id');
    const carreras = await publicarCarrerasPorLotes(publicador, cliente, rows.map(fila => fila.id));
    avisarSystemd('WATCHDOG=1');
    anotar({ evento, paso: 'carreras', paginas: carreras.paginas, cambiadas: carreras.cambiadas, errores: carreras.errores.slice(0, 5) });
    await publicarSobreBase(publicador, activos, cliente);
    await publicarPortada(publicador, portada);
    await publicarResultados(publicador, feed, portada);
    anotar({ evento, paso: 'mercado', ...await publicarMercadoEntero(publicador, cliente) });
    hoyDatos = await leerHoy(cliente);
    await publicarCampeonatos(publicador, await leerPorFilas(cliente, './campeonatos.sql'), portada);
    const faseHoy = await publicarHoy(publicador, hoyDatos, portada);
    anotar({ evento, paso: 'hoy', paginas: faseHoy.paginas, cambiadas: faseHoy.cambiadas, pintadoMs: ms(faseHoy.pintadoMs), errores: faseHoy.errores.slice(0, 5) });
    const retiradas = publicador.cerrarPasada();
    anotar({ evento, paso: 'fin', totalMs: ms(performance.now() - inicio), retiradas: retiradas.length, memoriaMb: ms(process.memoryUsage().rss / 1048576) });
  }

  for (;;) {
    let cliente = null;
    try {
      cliente = await conectar();
      const senal = new Senal(cliente);
      await senal.iniciar();
      if (senal.sinPermiso.length) anotar({ evento: 'tablas-sin-permiso', tablas: senal.sinPermiso });
      await todo(cliente, publicador ? 'resincronizado' : 'inicio');
      espera = 1000;
      avisarSystemd('--ready');
      ultimo.reloj = Date.now();
      diaProceso = alrededorDeHoy()[1];
      for (;;) {
        avisarSystemd('WATCHDOG=1');
        const cambios = await senal.comprobar();
        if (cambios.length) {
          const inicio = performance.now();
          const tablas = new Set(cambios.map(cambio => cambio.tabla));
          const carreras = [...new Set(cambios.map(cambio => cambio.raceId).filter(Boolean))];
          const fichasCx = [...new Set(cambios.map(cambio => cambio.cxRaceId).filter(Boolean))];
          fichasCx.forEach(id => pendiente.fichasCx.add(id));
          if ([...tablas].some(tabla => TABLAS_CX.has(tabla))) pendiente.cx = true;
          // La agenda abre una ficha CX según tenga mapa o guía: sus assets también la cambian. Con un
          // repintado CX pendiente, la portada (Hoy y agenda, con la copa de cada manga) sale detrás de
          // las fichas, para que una manga no tenga copa sin resultados en su ficha.
          if (fichasCx.length || cambios.some(cambio => TABLAS_PORTADA.includes(cambio.tabla))) {
            if (cxPendiente()) pendiente.portada = true;
            else {
              portada = await leerPortada(cliente);
              await publicarPortada(publicador, portada);
            }
          }
          // Resultados de una carrera de la ventana de Hoy: la copa sale al momento, antes que las páginas
          // de la carrera.
          const tablasHoy = [...tablas].filter(tabla => TABLAS_HOY.has(tabla));
          const soloClasificaciones = !pendiente.hoy && tablasHoy.every(tabla => tabla === 'race_uci_stages');
          if (tablasHoy.length) pendiente.hoy = true;
          if (hoyDatos && tablas.has('race_uci_stages')) {
            const deHoy = new Set(hoyDatos.days.map(dia => dia.raceId));
            if (cambios.some(cambio => cambio.tabla === 'race_uci_stages' && deHoy.has(cambio.raceId))) pendiente.resultadosHoy = true;
          }
          if (pendiente.resultadosHoy && Date.now() - ultimo.hoy > INTERVALOS.resultadosHoy) await refrescarHoy(cliente, { soloClasificaciones });
          // Un movimiento sale antes que las carreras en que figuran el corredor o el equipo: repintarlas
          // lleva hasta medio minuto.
          if ([...tablas].some(tabla => TABLAS_MERCADO.has(tabla))) pendiente.mercado = true;
          if (pendiente.mercado && Date.now() - ultimo.mercado > INTERVALOS.mercado) await refrescarMercado(cliente);
          if (carreras.length) {
            inscritos.absorber(await leerInscritos(cliente, carreras), carreras);
            const conCompeticion = [...tablas].some(tabla => TABLAS_COMPETICION.has(tabla));
            for (const raceId of carreras) {
              const filas = await leerCarrera(cliente, raceId);
              datos.reemplazarCarrera(raceId, filas);
              await publicador.publicarCarrera(raceId, [...datos.entradas(raceId), ...inscritos.entradas(raceId)]);
              if (conCompeticion && filas.race) {
                await publicarCompeticiones(publicador, { races: [filas.race], days: filas.days, broadcasts: filas.broadcasts, assets: filas.assets, uci: filas.uci }, [raceId], generacionBase);
              }
            }
            if ([...tablas].some(tabla => TABLAS_CARRERA.has(tabla))) await publicarCarrerasPorLotes(publicador, cliente, carreras);
            if ([...tablas].some(tabla => TABLAS_ETAPA.has(tabla))) carreras.forEach(id => pendiente.etapas.add(id));
          }
          if (cambios.some(cambio => TABLAS_MODAL.has(cambio.tabla) && carrerasModal.has(cambio.raceId))) pendiente.temporada = true;
          if ([...tablas].some(tabla => TABLAS_FEED.has(tabla))) pendiente.feed = true;
          if ([...tablas].some(tabla => TABLAS_TEMPORADA.has(tabla))) pendiente.temporada = true;
          if ([...tablas].some(tabla => TABLAS_BASE.has(tabla))) pendiente.base = true;
          anotar({ evento: 'publicado', tablas: [...tablas], carreras: carreras.length, fichasCx: fichasCx.length || undefined, totalMs: ms(performance.now() - inicio) });
        }
        const ahora = Date.now();
        // La portada y Últimos resultados dependen de la hora: se vuelven a pintar cada minuto con
        // los datos que ya hay, y solo se publican si cambian.
        if (ahora - ultimo.reloj > 60_000) {
          ultimo.reloj = ahora;
          // Latido para la monitorización externa: la hora de la última vuelta.
          publicador.publicarRuta('v/latido.txt', new Date().toISOString());
          await publicarPortada(publicador, portada);
          await publicarResultados(publicador, feed, portada);
          const diaAhora = alrededorDeHoy()[1];
          if (diaProceso && diaAhora !== diaProceso) {
            // Día nuevo: los módulos fijan la fecha al cargarse (CX_HOME) y la ventana se mueve.
            await publicador.reiniciar();
            pendiente.hoy = true;
            ultimo.hoy = 0;
          } else {
            await publicarHoy(publicador, hoyDatos, portada, { solo: alrededorDeHoy() });
          }
          diaProceso = diaAhora;
        }
        if (cxPendiente() && ahora - ultimo.cx > INTERVALOS.cx) {
          ultimo.cx = ahora;
          const temporada = pendiente.cx ? cxSeason() : null;
          const solo = pendiente.fichasCx;
          const conPortada = pendiente.portada;
          const conFeed = pendiente.feed;
          pendiente.cx = false;
          pendiente.fichasCx = new Set();
          pendiente.portada = false;
          pendiente.feed = false;
          const inicio = performance.now();
          // Leídos antes que CX: nunca llevan un resultado que la ficha aún no tenga.
          const portadaNueva = conPortada ? await leerPortada(cliente) : null;
          const feedNuevo = conFeed ? await leerResultadosFeed(cliente) : null;
          const cx = await leerPorFilas(cliente, FUENTES_BASE.cx);
          const fase = await publicarCx(publicador, cx, { temporada, solo, generacion: generacionBase });
          if (portadaNueva) {
            portada = portadaNueva;
            await publicarPortada(publicador, portada);
          }
          if (feedNuevo) {
            ultimo.feed = Date.now();
            feed = feedNuevo;
            await publicarResultados(publicador, feed, portada);
          }
          anotar({ evento: 'cx', totalMs: ms(performance.now() - inicio), temporada, fichas: solo.size || undefined, carreras: fase.carreras, torneos: fase.torneos, paginas: fase.claves.length,
            portada: conPortada || undefined, feed: conFeed || undefined });
        }
        if (pendiente.hoy && ahora - ultimo.hoy > (pendiente.resultadosHoy ? INTERVALOS.resultadosHoy : INTERVALOS.hoy)) await refrescarHoy(cliente);
        if (pendiente.mercado && ahora - ultimo.mercado > INTERVALOS.mercado) await refrescarMercado(cliente);
        if (pendiente.feed && !cxPendiente() && ahora - ultimo.feed > INTERVALOS.feed) {
          ultimo.feed = ahora;
          pendiente.feed = false;
          feed = await leerResultadosFeed(cliente);
          await publicarResultados(publicador, feed, portada);
        }
        if (pendiente.temporada && ahora - ultimo.temporada > INTERVALOS.temporada) {
          ultimo.temporada = ahora;
          pendiente.temporada = false;
          await publicarTemporadas(cliente);
        }
        if (pendiente.etapas.size && ahora - ultimo.etapas > INTERVALOS.etapas) {
          ultimo.etapas = ahora;
          const solo = pendiente.etapas;
          pendiente.etapas = new Set();
          await publicarEtapas(publicador, await leerAuxiliares(cliente), { solo });
        }
        if (pendiente.base && ahora - ultimo.base > INTERVALOS.base && !generandoBase) {
          ultimo.base = ahora;
          pendiente.base = false;
          generarBase().then(() => publicarSobreBaseSeguro());
        }
        await new Promise(hecho => setTimeout(hecho, SONDEO_MS));
      }
    } catch (error) {
      anotar({ evento: 'caida', error: error.message, pila: error.stack?.slice(0, 500), esperaMs: espera });
      await new Promise(hecho => setTimeout(hecho, espera));
      espera = Math.min(espera * 2, 60_000);
    } finally {
      await cliente?.end().catch(() => {});
    }
  }
}

principal().catch(error => { anotar({ evento: 'error-fatal', error: error.message, pila: error.stack?.slice(0, 500) }); process.exit(1); });
