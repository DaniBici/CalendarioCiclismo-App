#!/usr/bin/env node
// Comprueba las páginas de resultados por carrera frente a producción: mismo texto por
// clasificación e idioma, funcionamiento de lo interactivo y coste de publicar. Solo local.
//
//   CC_BASE=<sitio base> node tools/publicacion/comprobar-carrera.mjs --trabajo <dir> --tablas <volcado>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';
import { montar, publicarCarreras } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

const PUERTO = 8829;
const B = `https://localhost:${PUERTO}`;
const A = 'https://calendariociclismo.app';
const argumentos = process.argv.slice(2);
const dato = nombre => argumentos[argumentos.indexOf(`--${nombre}`) + 1];
const trabajo = dato('trabajo');
const capturas = join(trabajo, 'capturas-carrera');
mkdirSync(capturas, { recursive: true });

let inicio = performance.now();
let tablas = JSON.parse(readFileSync(dato('tablas'), 'utf8'));
if (Array.isArray(tablas)) tablas = tablas[0];
console.log(`Volcado leído en ${Math.round(performance.now() - inicio)} ms`);
const { datos: jornadas, publicador, salida, activos } = await montar(trabajo, join(trabajo, 'arbol-comprobar-carrera'));
inicio = performance.now();
const fase = await publicarCarreras(publicador, tablas, { forzar: true });
console.log(JSON.stringify({ total: Math.round(performance.now() - inicio), paginas: fase.paginas, errores: fase.errores.length, primeros: fase.errores.slice(0, 5), pintadoMs: Math.round(fase.pintadoMs), escrituraMs: Math.round(fase.escrituraMs), mb: Math.round(fase.bytes / 1048576), mbComprimidos: Math.round(fase.bytesBr / 1048576), isla: activos.pesos[activos.carrera.isla.split('/').pop()] }));
// El perfil lee los datos publicados de la jornada.
await publicador.publicar(jornadas.entradas(tablas.races.find(race => race.slug === 'giro-de-italia-2026').id), { forzar: true });
const memoria = process.memoryUsage();
console.log(`Memoria del proceso principal: ${Math.round(memoria.rss / 1048576)} MB`);
const servidor = await crearServidor({ puerto: PUERTO, tls: certificado(join(trabajo, 'tls')), raiz: salida, espejo: { origen: A, cache: join(trabajo, 'espejo') } });
const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-carrera'));
const informe = { paridad: { total: 0, iguales: 0, diferencias: [] }, funciones: [], publicacion: fase.paginas };

const espera = ms => new Promise(done => setTimeout(done, ms));
const normalizar = texto => texto.replace(/\s+/g, ' ').trim();
const LEER = `(() => {
  const r = document.getElementById('resultsContent');
  // El perfil se monta en producción al cargar y aquí al verlo: se compara aparte.
  const sinPerfil = r ? r.cloneNode(true) : null;
  sinPerfil?.querySelectorAll('#resProfile, .sr-only').forEach(nodo => nodo.remove());
  return {
    texto: sinPerfil?.textContent || '',
    filas: r?.querySelectorAll('tr.so-row').length || 0,
    enlaces: [...(r?.querySelectorAll('a[href]') || [])].map(a => a.getAttribute('href')).join(),
    activa: r?.querySelector('#resTabs .res-tab--active')?.dataset.class || null,
    cargador: !!document.querySelector('.loading, .page-loading--active'),
  };
})()`;
const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
function primeraDiferencia(a, b) {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return { en: at, produccion: a.slice(Math.max(0, at - 60), at + 110), prototipo: b.slice(Math.max(0, at - 60), at + 110) };
}

const CASOS = [
  ['resultados/giro-de-italia-2026/etapa-10/', 'Europe/Madrid', ESCRITORIO],
  ['resultados/giro-de-italia-2026/etapa-10/', 'Europe/Madrid', MOVIL],
  ['resultados/giro-de-italia-2026/', 'America/Bogota', MOVIL],
  ['en/results/giro-ditalia-2026/stage-10/', 'Europe/London', ESCRITORIO],
  ['en/results/giro-ditalia-2026/stage-10/', 'America/New_York', MOVIL],
  ['resultados/tour-de-francia-2026/', 'Europe/Madrid', ESCRITORIO],
  ['resultados/campeonato-de-australia-cri-femenino-2027/', 'Europe/Madrid', MOVIL],
  ['en/results/australian-championships-womens-itt-2027/', 'Europe/London', MOVIL],
];
for (const [ruta, zona, perfil] of CASOS) {
  const pestañas = [];
  for (const origen of [A, B]) {
    const tab = await pestaña(nav, perfil, zona);
    await tab.ir(`${origen}/${ruta}`, { espera: 3500 });
    pestañas.push(tab);
  }
  const tipos = (await pestañas[0].valor(`[...document.querySelectorAll('#resTabs [data-class]')].map(b => b.dataset.class)`)) || [];
  for (const tipo of [null, ...tipos.slice(1)]) {
    const lecturas = [];
    for (const tab of pestañas) if (tipo) await tab.valor(clic(`#resTabs [data-class="${tipo}"]`));
    if (tipo) await espera(2000);
    for (const tab of pestañas) lecturas.push(await tab.valor(LEER));
    const [a, b] = lecturas;
    informe.paridad.total++;
    const iguales = normalizar(a.texto) === normalizar(b.texto) && a.filas === b.filas && a.enlaces === b.enlaces;
    if (iguales) informe.paridad.iguales++;
    else {
      const diferencia = { ruta, zona, tipo, filas: [a.filas, b.filas], enlaces: a.enlaces === b.enlaces, ...primeraDiferencia(normalizar(a.texto), normalizar(b.texto)) };
      informe.paridad.diferencias.push(diferencia);
      console.log('DIFERENCIA', JSON.stringify(diferencia).slice(0, 640));
    }
  }
  for (const tab of pestañas) await tab.cerrar();
}
console.log(`Paridad de texto: ${informe.paridad.iguales}/${informe.paridad.total}`);

async function funcion(nombre, perfil, ruta, zona, cuerpo) {
  const tab = await pestaña(nav, perfil, zona);
  let ok = false;
  let detalle = null;
  try {
    await tab.ir(`${B}/${ruta}`, { espera: 1500 });
    ({ ok, detalle } = await cuerpo(tab));
  } catch (error) {
    detalle = error.message;
  }
  const errores = await tab.valor('window.__m.errores').catch(() => []);
  informe.funciones.push({ nombre, ok: ok && !errores.length, detalle, errores });
  console.log(`${ok && !errores.length ? 'correcto' : 'FALLO'}: ${nombre}${detalle ? ` (${JSON.stringify(detalle).slice(0, 220)})` : ''}${errores.length ? ` errores: ${errores.join(' | ')}` : ''}`);
  await tab.cerrar();
}
const ETAPA = 'resultados/giro-de-italia-2026/etapa-10/';
await funcion('Sin lecturas de Supabase ni cargador', MOVIL, ETAPA, 'Europe/Madrid', async tab => {
  const urls = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co'));
  const { cargador, filas } = await tab.valor(LEER);
  return { ok: !urls.length && !cargador && filas > 100, detalle: { urls: urls.slice(0, 3), filas } };
});
await funcion('Tabla completa en el HTML', ESCRITORIO, ETAPA, 'Europe/Madrid', async tab => {
  const html = await tab.valor(`fetch(location.pathname).then(r => r.text()).then(t => (t.match(/<tr class="so-row/g) || []).length)`);
  const { filas } = await tab.valor(LEER);
  return { ok: html === filas && html > 20, detalle: { html, filas } };
});
await funcion('Cambio de clasificación', ESCRITORIO, ETAPA, 'Europe/Madrid', async tab => {
  const antes = await tab.valor(LEER);
  await tab.valor(clic('#resTabs [data-class="gc"]'));
  await espera(600);
  const despues = await tab.valor(LEER);
  const hash = await tab.valor('location.hash');
  await tab.valor(clic(`#resTabs [data-class="${antes.activa}"]`));
  await espera(200);
  const vuelta = await tab.valor(LEER);
  return { ok: despues.activa === 'gc' && hash === '#gc' && despues.texto !== antes.texto && vuelta.filas === antes.filas, detalle: { antes: antes.filas, gc: despues.filas, vuelta: vuelta.filas } };
});
await funcion('Enlace directo a una clasificación', MOVIL, `${ETAPA}#gc`, 'Europe/Madrid', async tab => {
  await espera(800);
  const { activa, filas } = await tab.valor(LEER);
  return { ok: activa === 'gc' && filas > 0, detalle: { activa, filas } };
});
await funcion('Filtro por equipo y m.t.', ESCRITORIO, ETAPA, 'Europe/Madrid', async tab => {
  const equipo = await tab.valor(`document.querySelector('#resTeamFilter option:nth-child(3)')?.value`);
  await tab.valor(`(() => { const s = document.getElementById('resTeamFilter'); s.value = ${JSON.stringify(equipo)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const visibles = await tab.valor(`[...document.querySelectorAll('#resTableWrap tr.so-row')].filter(f => f.style.display !== 'none').length`);
  await tab.valor(clic('#resTabs [data-class="gc"]'));
  await espera(600);
  const conservado = await tab.valor(`document.getElementById('resTeamFilter')?.value`);
  return { ok: visibles > 0 && visibles < 15 && conservado === equipo, detalle: { equipo, visibles, conservado } };
});
await funcion('Perfil al verlo', ESCRITORIO, ETAPA, 'Europe/Madrid', async tab => {
  await tab.valor(`document.getElementById('resProfile')?.scrollIntoView()`);
  await espera(1500);
  const dibujado = await tab.valor(`!!document.querySelector('#resProfile svg, #resProfile canvas')`);
  const fuente = await tab.valor(`document.getElementById('resultsContent').dataset.perfil`);
  const estado = await tab.valor(`fetch(${JSON.stringify('')} + document.getElementById('resultsContent').dataset.perfil).then(r => r.status)`);
  return { ok: dibujado, detalle: { dibujado, fuente, estado } };
});
await funcion('Etapa sin resultados, sin cargador', MOVIL, 'resultados/campeonato-de-australia-cri-femenino-2027/', 'Europe/Madrid', async tab => {
  const { cargador, texto } = await tab.valor(LEER);
  return { ok: !cargador && texto.length > 10, detalle: texto.slice(0, 70) };
});
await funcion('Selector de idioma', ESCRITORIO, ETAPA, 'Europe/Madrid', async tab => {
  await tab.valor(clic('button.lang-btn[data-lang="en"]'));
  await espera(1500);
  const destino = await tab.valor('location.pathname');
  return { ok: destino === '/en/results/giro-ditalia-2026/stage-10/', detalle: destino };
});

for (const [nombre, origen, perfil] of [['produccion-movil', A, MOVIL], ['prototipo-movil', B, MOVIL], ['produccion-escritorio', A, ESCRITORIO], ['prototipo-escritorio', B, ESCRITORIO]]) {
  const tab = await pestaña(nav, perfil, 'Europe/Madrid');
  await tab.ir(`${origen}/${ETAPA}`, { espera: 3000 });
  const { data } = await tab.enviar('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(capturas, `${nombre}.png`), Buffer.from(data, 'base64'));
  await tab.cerrar();
}
writeFileSync(join(trabajo, 'comprobacion-carrera.json'), JSON.stringify(informe, null, 1));
hijo.kill();
publicador.cerrar();
servidor.close();
process.exit(0);
