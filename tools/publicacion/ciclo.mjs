#!/usr/bin/env node
// Ciclo de vida de las páginas del prototipo: altas, cambios del <head>, cambios de
// slug, bajas y traslados entre carreras, servidos por HTTP. Los cambios se aplican
// a los datos en memoria: no se escribe en la base de datos. Las dos últimas
// comprobaciones leen producción en solo lectura.
//
//   node tools/publicacion/ciclo.mjs --trabajo <dir>
import { connect } from 'node:http2';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conectar, leerCarrera, leerInscritos, Senal } from './datos.mjs';
import { montar, todasLasEntradas } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

const PUERTO = 8821;
const argumentos = process.argv.slice(2);
const trabajo = argumentos[argumentos.indexOf('--trabajo') + 1];
const arbol = join(trabajo, 'arbol-ciclo');
rmSync(arbol, { recursive: true, force: true });

const { datos, inscritos, publicador } = await montar(trabajo, arbol);
const inicio = performance.now();
await publicador.publicar(todasLasEntradas(datos, inscritos), { forzar: true });
console.log(`Base publicada en ${Math.round(performance.now() - inicio)} ms`);
const servidor = await crearServidor({ puerto: PUERTO, tls: certificado(join(trabajo, 'tls')), raiz: arbol });
const sesion = connect(`https://localhost:${PUERTO}`, { rejectUnauthorized: false });

function pedir(ruta) {
  return new Promise((done, fail) => {
    const flujo = sesion.request({ ':path': ruta });
    const trozos = [];
    let cabeceras = {};
    flujo.on('response', valor => { cabeceras = valor; });
    flujo.on('data', trozo => trozos.push(trozo));
    flujo.on('error', fail);
    flujo.on('end', () => done({ estado: cabeceras[':status'], destino: cabeceras.location ?? null, cuerpo: Buffer.concat(trozos).toString('utf8') }));
    flujo.end();
  });
}

const resultados = [];
function comprobar(prueba, nombre, condicion, detalle = null) {
  resultados.push({ prueba, nombre, correcto: !!condicion, detalle });
  console.log(`${condicion ? 'correcto' : 'FALLO   '} · ${prueba} · ${nombre}${!condicion && detalle ? ` (${JSON.stringify(detalle)})` : ''}`);
}

const titulo = html => /<title>([\s\S]*?)<\/title>/.exec(html)?.[1] ?? null;
const canonica = html => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null;
const hreflang = (html, lang) => new RegExp(`hreflang="${lang}" href="([^"]*)"`).exec(html)?.[1] ?? null;
const eventoLd = html => JSON.parse(/<script type="application\/ld\+json" id="jsonld-main">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? 'null');
const huella = texto => createHash('sha1').update(texto).digest('hex');

const giroEtapa = slug => datos.jornadas(giro).find(dia => dia.slug === slug);
const giro = [...datos.days.entries()].find(([, dias]) => dias.some(dia => dia.slug === 'giro-de-italia-2026-etapa-10'))[0];
const mundial = [...datos.days.entries()].find(([, dias]) => dias.some(dia => dia.slug === 'campeonato-del-mundo-linea-masculino-2026'))[0];
const rutas = raceId => datos.entradas(raceId).flatMap(({ rd }) => [`/jornada/${rd.slug}/`, ...(rd.slugEn ? [`/en/stage/${rd.slugEn}/`] : [])]);
const listaDe = slug => inscritos.carreras().find(raceId => inscritos.entradas(raceId)[0].race.slug === slug);

async function huellas(raceId) {
  const salida = {};
  for (const ruta of rutas(raceId)) salida[ruta] = huella((await pedir(ruta)).cuerpo);
  return salida;
}

/** Filas de la carrera en memoria, para modificarlas y aplicarlas como lo haría una lectura real. */
function filasDe(raceId) {
  const days = datos.jornadas(raceId).map(dia => ({ ...dia }));
  const broadcasts = days.flatMap(dia => datos.broadcasts.get(dia.id) || []);
  const assets = days.flatMap(dia => datos.assets.get(dia.id) || []);
  return { days, race: { ...datos.races.get(raceId) }, broadcasts, assets, guides: datos.guides.get(raceId) || [], uci: datos.uci.get(raceId) || [] };
}

async function aplicar(raceId, filas) {
  datos.reemplazarCarrera(raceId, filas);
  const antes = performance.now();
  const fase = await publicador.publicarCarrera(raceId, [...datos.entradas(raceId), ...inscritos.entradas(raceId)]);
  return { ...fase, ms: performance.now() - antes, claves: undefined };
}

const original = { giro: filasDe(giro), mundial: filasDe(mundial) };
const huellasGiro = await huellas(giro);
const huellasMundial = await huellas(mundial);
const tiempos = {};

// Alta
{
  const filas = filasDe(giro);
  const modelo = filas.days.find(dia => dia.slug === 'giro-de-italia-2026-etapa-21');
  filas.days.push({ ...modelo, id: 'zz-alta', slug: 'giro-de-italia-2026-etapa-22-prueba', slugEn: 'giro-ditalia-2026-stage-22-test', stageNumber: 22, dateKey: '2026-06-01', startLocation: 'Origen de prueba', finishLocation: 'Meta de prueba', distanceKm: 150 });
  const fase = await aplicar(giro, filas);
  tiempos.alta = fase;
  const es = await pedir('/jornada/giro-de-italia-2026-etapa-22-prueba/');
  const en = await pedir('/en/stage/giro-ditalia-2026-stage-22-test/');
  const vecina = await pedir('/jornada/giro-de-italia-2026-etapa-10/');
  comprobar('alta', 'la página ES responde 200 sin plantilla', es.estado === 200, es.estado);
  comprobar('alta', 'la página EN responde 200 sin plantilla', en.estado === 200, en.estado);
  comprobar('alta', 'título propio', titulo(es.cuerpo) === 'Etapa 22 del Giro de Italia 2026: Origen de prueba › Meta de prueba · 150 km - Calendario Ciclismo App', titulo(es.cuerpo));
  comprobar('alta', 'canónica y alternativa propias', canonica(es.cuerpo)?.endsWith('/jornada/giro-de-italia-2026-etapa-22-prueba/') && hreflang(es.cuerpo, 'en')?.endsWith('/en/stage/giro-ditalia-2026-stage-22-test/'), canonica(es.cuerpo));
  comprobar('alta', 'JSON-LD con la ruta nueva', eventoLd(es.cuerpo)?.location?.name === 'Origen de prueba → Meta de prueba', eventoLd(es.cuerpo)?.location);
  comprobar('alta', 'contenido pintado', es.cuerpo.includes('route-grid') && es.cuerpo.includes('Origen de prueba'));
  comprobar('alta', 'las etapas vecinas la enlazan', vecina.cuerpo.includes('giro-de-italia-2026-etapa-22-prueba'));
}

// Cambio del <head> por la ruta de una etapa
{
  const filas = filasDe(giro);
  filas.days.find(dia => dia.slug === 'giro-de-italia-2026-etapa-10').finishLocation = 'Meta cambiada';
  const fase = await aplicar(giro, filas);
  tiempos.ruta = fase;
  const es = await pedir('/jornada/giro-de-italia-2026-etapa-10/');
  comprobar('head', 'título con la meta nueva', titulo(es.cuerpo)?.includes('Viareggio › Meta cambiada'), titulo(es.cuerpo));
  comprobar('head', 'descripción y og con la meta nueva', /<meta name="description" content="[^"]*meta en Meta cambiada/.test(es.cuerpo) && /property="og:title" content="[^"]*Meta cambiada/.test(es.cuerpo));
  comprobar('head', 'JSON-LD con la meta nueva', eventoLd(es.cuerpo)?.location?.name === 'Viareggio → Meta cambiada', eventoLd(es.cuerpo)?.location);
  comprobar('head', 'el cuerpo también cambia', /route-block__place">Meta cambiada/.test(es.cuerpo));
}

// Cambio del <head> por el nombre de la carrera
{
  const filas = filasDe(giro);
  filas.race.name = 'Giro de Prueba';
  const fase = await aplicar(giro, filas);
  tiempos.nombreCarrera = fase;
  const es = await pedir('/jornada/giro-de-italia-2026-etapa-3/');
  comprobar('head', 'el nombre de la carrera llega a las etapas', es.estado === 200 && titulo(es.cuerpo)?.includes('Giro de Prueba'), titulo(es.cuerpo));
  filas.race.name = original.giro.race.name;
  await aplicar(giro, filas);
}

// Cambio de slug, en cadena y de vuelta
{
  const ANTIGUO = 'giro-de-italia-2026-etapa-10';
  const NUEVO = 'giro-de-italia-2026-etapa-10-nuevo';
  const OTRO = 'giro-de-italia-2026-etapa-10-otro';
  const filas = filasDe(giro);
  filas.days.find(dia => dia.slug === ANTIGUO).slug = NUEVO;
  const fase = await aplicar(giro, filas);
  tiempos.slug = fase;
  const viejo = await pedir(`/jornada/${ANTIGUO}/`);
  const nuevo = await pedir(`/jornada/${NUEVO}/`);
  const en = await pedir('/en/stage/giro-ditalia-2026-stage-10/');
  comprobar('slug', 'la URL antigua redirige con 301', viejo.estado === 301 && viejo.destino === `/jornada/${NUEVO}/`, [viejo.estado, viejo.destino]);
  comprobar('slug', 'la URL nueva responde 200 con su canónica', nuevo.estado === 200 && canonica(nuevo.cuerpo)?.endsWith(`/jornada/${NUEVO}/`), canonica(nuevo.cuerpo));
  comprobar('slug', 'la página EN enlaza la URL nueva', hreflang(en.cuerpo, 'es')?.endsWith(`/jornada/${NUEVO}/`), hreflang(en.cuerpo, 'es'));
  comprobar('slug', 'una pestaña abierta recibe el traslado', (await pedir(`/v/es/${ANTIGUO}.txt`)).cuerpo === `→/jornada/${NUEVO}/`);
  comprobar('slug', 'los datos de la URL antigua desaparecen', (await pedir(`/d/es/${ANTIGUO}.json`)).estado === 404 && (await pedir(`/f/es/${ANTIGUO}.html`)).estado === 404);
  filas.days.find(dia => dia.slug === NUEVO).slug = OTRO;
  await aplicar(giro, filas);
  const cadena = await pedir(`/jornada/${ANTIGUO}/`);
  comprobar('slug', 'con un segundo cambio la primera URL apunta al destino final', cadena.estado === 301 && cadena.destino === `/jornada/${OTRO}/`, cadena.destino);
  filas.days.find(dia => dia.slug === OTRO).slug = ANTIGUO;
  await aplicar(giro, filas);
  const vuelta = await pedir(`/jornada/${ANTIGUO}/`);
  const previo = await pedir(`/jornada/${OTRO}/`);
  comprobar('slug', 'al volver al slug original sirve la página, no la redirección', vuelta.estado === 200, vuelta.estado);
  comprobar('slug', 'el slug abandonado redirige al original', previo.estado === 301 && previo.destino === `/jornada/${ANTIGUO}/`, previo.destino);
}

// Baja de una jornada
{
  const SLUG = 'giro-de-italia-2026-etapa-20';
  const dia = giroEtapa(SLUG);
  const slugEn = dia.slugEn;
  const filas = filasDe(giro);
  filas.days = filas.days.filter(fila => fila.slug !== SLUG);
  filas.broadcasts = filas.broadcasts.filter(fila => fila.raceDayId !== dia.id);
  filas.assets = filas.assets.filter(fila => fila.raceDayId !== dia.id);
  const fase = await aplicar(giro, filas);
  tiempos.baja = fase;
  comprobar('baja', 'la página ES responde 404', (await pedir(`/jornada/${SLUG}/`)).estado === 404);
  comprobar('baja', 'la página EN responde 404', (await pedir(`/en/stage/${slugEn}/`)).estado === 404);
  comprobar('baja', 'desaparecen versión, datos y fragmento', (await pedir(`/v/es/${SLUG}.txt`)).estado === 404 && (await pedir(`/d/es/${SLUG}.json`)).estado === 404 && (await pedir(`/f/es/${SLUG}.html`)).estado === 404);
  comprobar('baja', 'las etapas vecinas dejan de enlazarla', !(await pedir('/jornada/giro-de-italia-2026-etapa-19/')).cuerpo.includes(`/${SLUG}/`));
  comprobar('baja', 'se cuentan como retiradas, sin redirección', fase.retiradas.length === 2 && !fase.redirigidas.length, [fase.retiradas, fase.redirigidas]);
}

// Baja de una carrera entera
{
  const paginas = rutas(mundial);
  const listaMundial = inscritos.entradas(mundial);
  inscritos.filas.delete(mundial);
  const fase = await aplicar(mundial, { days: [], race: null, broadcasts: [], assets: [], guides: [], uci: [] });
  tiempos.bajaCarrera = fase;
  if (listaMundial.length) inscritos.filas.set(mundial, listaMundial[0]);
  let todas = true;
  for (const ruta of paginas) todas = todas && (await pedir(ruta)).estado === 404;
  comprobar('baja', `las ${paginas.length} páginas de jornada de la carrera responden 404`, todas && paginas.every(ruta => fase.retiradas.some(clave => ruta.endsWith(`/${clave.split('/')[1]}/`))), fase.retiradas);
}

// Traslado de una jornada entre carreras, en los dos órdenes de llegada
{
  const destino = datos.carreras().find(raceId => raceId !== giro && raceId !== mundial && datos.jornadas(raceId).length > 1);
  const SLUG = 'giro-de-italia-2026-etapa-5';
  for (const orden of ['destino primero', 'origen primero']) {
    const origenFilas = filasDe(giro);
    const destinoFilas = filasDe(destino);
    const dia = origenFilas.days.find(fila => fila.slug === SLUG);
    const movidas = origenFilas.broadcasts.filter(fila => fila.raceDayId === dia.id);
    origenFilas.days = origenFilas.days.filter(fila => fila.slug !== SLUG);
    destinoFilas.days.push({ ...dia, raceId: destino });
    destinoFilas.broadcasts.push(...movidas);
    if (orden === 'destino primero') {
      await aplicar(destino, destinoFilas);
      await aplicar(giro, origenFilas);
    } else {
      await aplicar(giro, origenFilas);
      await aplicar(destino, destinoFilas);
    }
    const pagina = await pedir(`/jornada/${SLUG}/`);
    comprobar('traslado', `${orden}: la página sigue servida con la carrera nueva`, pagina.estado === 200 && pagina.cuerpo.includes(`name="cc:race-id" content="${destino}"`), pagina.estado);
    // Vuelta atrás para el siguiente orden.
    const vuelta = filasDe(destino);
    const movida = vuelta.days.find(fila => fila.slug === SLUG);
    vuelta.days = vuelta.days.filter(fila => fila.slug !== SLUG);
    await aplicar(destino, vuelta);
    const origenVuelta = filasDe(giro);
    origenVuelta.days.push({ ...movida, raceId: giro });
    origenVuelta.broadcasts.push(...movidas);
    await aplicar(giro, origenVuelta);
  }
  const final = filasDe(destino);
  await aplicar(destino, final);
}

// Restauración: todo vuelve a ser idéntico byte a byte
{
  await aplicar(giro, original.giro);
  await aplicar(mundial, original.mundial);
  const giroFinal = await huellas(giro);
  const mundialFinal = await huellas(mundial);
  const distintas = [...Object.keys(huellasGiro).filter(ruta => huellasGiro[ruta] !== giroFinal[ruta]), ...Object.keys(huellasMundial).filter(ruta => huellasMundial[ruta] !== mundialFinal[ruta])];
  comprobar('restauración', 'las páginas son idénticas a las iniciales', !distintas.length, distintas.slice(0, 5));
}

// Inscritos: lista que pasa a oficial, equipo con abanico, lista retirada y lista nueva
{
  const raceId = listaDe('giro-de-italia-2026');
  const ruta = '/inscritos/giro-de-italia-2026/';
  const base = inscritos.entradas(raceId)[0];
  const inicial = huella((await pedir(ruta)).cuerpo);
  const publicarLista = async entrada => publicador.publicarCarrera(raceId, [...datos.entradas(raceId), entrada]);

  let fase = await publicarLista({ ...base, race: { ...base.race, startlistProvisional: true } });
  let pagina = await pedir(ruta);
  comprobar('inscritos', 'lista provisional: cambian título y aviso', titulo(pagina.cuerpo)?.includes('lista provisional de inscritos') && pagina.cuerpo.includes('startlist-disclaimer--provisional'), titulo(pagina.cuerpo));
  comprobar('inscritos', 'solo cambian las páginas de la lista, no las jornadas', fase.clavesCambiadas.every(clave => clave.startsWith('inscritos-')), fase.clavesCambiadas.slice(0, 4));

  fase = await publicarLista({ ...base, recuentos: { ...base.recuentos, riders: base.recuentos.riders + 1 }, rows: { ...base.rows, riders: [{ ...base.rows.riders[0], id: '00-prueba', dorsal: 0, firstName: 'Corredor', lastName: 'De Prueba', globalRiderId: null }, ...base.rows.riders] } });
  pagina = await pedir(ruta);
  comprobar('inscritos', 'corredor añadido: en el cuerpo y en el recuento de la descripción', pagina.cuerpo.includes('De Prueba') && new RegExp(`y ${base.recuentos.riders + 1} corredores`).test(pagina.cuerpo), base.recuentos);

  // Lista retirada: sin equipos, la página sale del árbol y responde la web actual.
  fase = await publicador.publicarCarrera(raceId, datos.entradas(raceId));
  comprobar('inscritos', 'lista retirada: la página sale del árbol', (await pedir(ruta)).estado === 404 && fase.retiradas.includes('inscritos-es/giro-de-italia-2026'), fase.retiradas);

  fase = await publicarLista(base);
  comprobar('inscritos', 'lista nueva: la página vuelve', (await pedir(ruta)).estado === 200);
  comprobar('inscritos', 'restaurada, es idéntica a la inicial', huella((await pedir(ruta)).cuerpo) === inicial);

  // Abanico: el equipo con más carreras cambia de nombre en todas.
  const usos = new Map();
  for (const id of inscritos.carreras()) {
    for (const fila of inscritos.entradas(id)[0].rows.teamRows) {
      if (!fila.teamId) continue;
      if (!usos.has(fila.teamId)) usos.set(fila.teamId, new Set());
      usos.get(fila.teamId).add(id);
    }
  }
  const [equipo, carreras] = [...usos].sort((a, b) => b[1].size - a[1].size)[0];
  const NOMBRE = 'Equipo De Prueba';
  const renombrar = entrada => ({ ...entrada, rows: { ...entrada.rows, teamRows: entrada.rows.teamRows.map(fila => (fila.teamId === equipo && fila.team
    ? { ...fila, team: { ...fila.team, name: NOMBRE, team_seasons: (fila.team.team_seasons || []).map(temporada => ({ ...temporada, name: NOMBRE })) } }
    : fila)) } });
  const antes = performance.now();
  const afectadas = [...carreras].flatMap(id => inscritos.entradas(id));
  const abanico = await publicador.publicar(afectadas, { transformar: renombrar });
  tiempos.abanicoEquipo = { ...abanico, ms: performance.now() - antes, retiradas: [], redirigidas: [] };
  comprobar('inscritos', `abanico: un equipo en ${carreras.size} carreras cambia en casi todas sus listas`, abanico.cambiadas >= abanico.paginas * 0.9, [abanico.paginas, abanico.cambiadas]);
  await publicador.publicar(afectadas);
}

// Señal: altas, cambios, bajas y traslados, con un cliente simulado.
{
  const tablas = { race_days: new Map([['a', { x: '1', r: 'R1' }], ['b', { x: '2', r: 'R1' }]]), races: new Map([['R1', { x: '3', r: 'R1' }]]), broadcasts: new Map([['t', { x: '4', r: 'R1' }]]), assets: new Map(), race_uci_stages: new Map(), teams: new Map([['E1', { x: '5', r: 'E1' }]]) };
  const cliente = {
    async query(sql, parametros) {
      if (sql.includes('has_table_privilege')) return { rows: parametros[0].filter(tabla => tabla in tablas).map(t => ({ t })) };
      if (sql.includes('union all')) return { rows: Object.entries(tablas).map(([tabla, filas]) => ({ tabla, n: String(filas.size), s: String([...filas.values()].reduce((suma, fila) => suma + Number(fila.x), 0)) })) };
      if (sql.includes('from startlist_teams where')) return { rows: parametros[0].includes('E1') ? [{ r: 'R7', origen: 'E1' }, { r: 'R8', origen: 'E1' }] : [] };
      const tabla = /from (\w+) d/.exec(sql)[1];
      return { rows: [...tablas[tabla]].map(([id, fila]) => ({ id, ...fila })) };
    },
  };
  const senal = new Senal(cliente);
  await senal.iniciar();
  comprobar('señal', 'sin cambios no detecta nada', !(await senal.comprobar()).length);
  tablas.race_days.set('c', { x: '10', r: 'R2' });
  let cambios = await senal.comprobar();
  comprobar('señal', 'detecta un alta', cambios.length === 1 && cambios[0].tipo === 'alta' && cambios[0].raceId === 'R2', cambios);
  tablas.broadcasts.delete('t');
  cambios = await senal.comprobar();
  comprobar('señal', 'una baja conserva la carrera de la fila', cambios.length === 1 && cambios[0].tipo === 'baja' && cambios[0].raceId === 'R1', cambios);
  tablas.race_days.set('b', { x: '11', r: 'R3' });
  cambios = await senal.comprobar();
  comprobar('señal', 'un traslado avisa a las dos carreras', cambios.map(cambio => cambio.raceId).sort().join() === 'R1,R3', cambios);
  tablas.teams.set('E1', { x: '12', r: 'E1' });
  cambios = await senal.comprobar();
  comprobar('señal', 'un cambio de equipo llega a todas las carreras que lo usan', cambios.map(cambio => cambio.raceId).filter(Boolean).sort().join() === 'R7,R8', cambios);
  tablas.teams.set('E2', { x: '13', r: 'E2' });
  cambios = await senal.comprobar();
  comprobar('señal', 'un equipo sin carreras sigue avisando al mercado', cambios.length === 1 && cambios[0].tabla === 'teams' && cambios[0].raceId === null, cambios);
}

// Lectura real: la consulta por carrera da lo mismo que el volcado del build.
{
  const cliente = await conectar();
  const senal = new Senal(cliente);
  const antes = performance.now();
  const filas = await leerCarrera(cliente, giro);
  const lecturaMs = performance.now() - antes;
  const fase = await aplicar(giro, filas);
  tiempos.lecturaReal = { ...fase, lecturaMs };
  comprobar('lectura real', 'publicar con la lectura por carrera no cambia ninguna página', fase.cambiadas === 0 && !fase.retiradas.length, [fase.cambiadas, fase.retiradas]);
  const raceIdLista = listaDe('giro-de-italia-2026');
  const paginaLista = (await pedir('/inscritos/giro-de-italia-2026/')).cuerpo;
  inscritos.absorber(await leerInscritos(cliente, [raceIdLista]), [raceIdLista]);
  const faseLista = await publicador.publicar(inscritos.entradas(raceIdLista));
  comprobar('lectura real', 'la lista leída por carrera da la misma página', faseLista.cambiadas === 0 && (await pedir('/inscritos/giro-de-italia-2026/')).cuerpo === paginaLista, faseLista.cambiadas);
  await senal.iniciar();
  const espurios = await senal.comprobar();
  // Un cambio real de producción entre las dos pasadas también lo marcaría: se repite la prueba si ocurre.
  comprobar('lectura real', 'dos pasadas seguidas de la señal real no detectan cambios espurios', espurios.length === 0, espurios.slice(0, 5));
  await cliente.end();
}

const correctos = resultados.filter(resultado => resultado.correcto).length;
const resumenTiempos = Object.fromEntries(Object.entries(tiempos).map(([nombre, fase]) => [nombre, { paginas: fase.paginas, cambiadas: fase.cambiadas, retiradas: fase.retiradas?.length, redirigidas: fase.redirigidas?.length, publicarMs: Math.round(fase.ms), pintadoMs: Math.round(fase.pintadoMs), lecturaMs: fase.lecturaMs ? Math.round(fase.lecturaMs) : undefined }]));
console.log(`\n${correctos}/${resultados.length} comprobaciones correctas`);
console.log(JSON.stringify(resumenTiempos, null, 1));
writeFileSync(join(trabajo, 'ciclo.json'), JSON.stringify({ correctos, total: resultados.length, resultados, tiempos: resumenTiempos }, null, 1));
sesion.close();
servidor.close();
publicador.cerrar();
process.exit(correctos === resultados.length ? 0 : 1);
