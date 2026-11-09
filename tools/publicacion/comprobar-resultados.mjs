#!/usr/bin/env node
// Comprueba la portada de resultados frente a producción: mismo texto por vista, zona e
// idioma, y funcionamiento de lo interactivo. Solo local.
//
//   node tools/publicacion/comprobar-resultados.mjs --trabajo <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';
import { montar, publicarResultados } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

const PUERTO = 8822;
const B = `https://localhost:${PUERTO}`;
const A = 'https://calendariociclismo.app';
const argumentos = process.argv.slice(2);
const trabajo = argumentos[argumentos.indexOf('--trabajo') + 1];
const capturas = join(trabajo, 'capturas-resultados');
mkdirSync(capturas, { recursive: true });

const { portada, feed, publicador, salida } = await montar(trabajo, join(trabajo, 'arbol-comprobar-resultados'));
const fase = await publicarResultados(publicador, feed, portada, { forzar: true });
if (fase.errores.length) throw new Error(fase.errores.join(' | '));
const servidor = await crearServidor({ puerto: PUERTO, tls: certificado(join(trabajo, 'tls')), raiz: salida, espejo: { origen: A, cache: join(trabajo, 'espejo') } });
const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-resultados'));
const informe = { paridad: { total: 0, iguales: 0, diferencias: [] }, funciones: [] };

const espera = ms => new Promise(done => setTimeout(done, ms));
const normalizar = texto => texto.replace(/\s+/g, ' ').trim();
const LEER = `(() => ({
  texto: document.getElementById('resultsContent')?.innerText || '',
  filas: document.querySelectorAll('#resultsFeedPanel .feed-row').length,
  dias: document.querySelectorAll('#resultsFeedPanel .feed-day').length,
  enlaces: [...document.querySelectorAll('#resultsFeedPanel a.feed-row')].map(a => a.getAttribute('href')).join(),
  ranking: document.querySelectorAll('#resultsFeedPanel .uci-ranking-row').length,
  cargador: !!document.querySelector('.loading, .page-loading--active'),
}))()`;
const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;

function primeraDiferencia(a, b) {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return { en: at, produccion: a.slice(Math.max(0, at - 60), at + 100), prototipo: b.slice(Math.max(0, at - 60), at + 100) };
}

const VISTAS = [
  ['inicial', null],
  ['latest', '[data-results-view="latest"]'],
  ['ranking', '[data-results-view="ranking"]'],
  ['ranking-femenino', '[data-ranking-gender="female"]'],
];

for (const [ruta, zona, perfil] of [
  ['resultados/', 'Europe/Madrid', MOVIL], ['resultados/', 'Europe/Madrid', ESCRITORIO], ['resultados/', 'America/Bogota', MOVIL],
  ['en/results/', 'Europe/London', MOVIL], ['en/results/', 'America/New_York', ESCRITORIO],
]) {
  const pestañas = [];
  for (const origen of [A, B]) {
    const tab = await pestaña(nav, perfil, zona);
    await tab.ir(`${origen}/${ruta}`, { espera: 3500 });
    pestañas.push(tab);
  }
  for (const [nombre, selector] of VISTAS) {
    const lecturas = [];
    for (const tab of pestañas) {
      if (selector) { await tab.valor(clic(selector)); await espera(nombre === 'inicial' ? 0 : 2500); }
      lecturas.push(await tab.valor(LEER));
    }
    const [a, b] = lecturas;
    informe.paridad.total++;
    const iguales = normalizar(a.texto) === normalizar(b.texto) && a.filas === b.filas && a.enlaces === b.enlaces && a.ranking === b.ranking;
    if (iguales) informe.paridad.iguales++;
    else {
      const diferencia = { ruta, zona, nombre, filas: [a.filas, b.filas], ranking: [a.ranking, b.ranking], enlaces: a.enlaces === b.enlaces, ...primeraDiferencia(normalizar(a.texto), normalizar(b.texto)) };
      informe.paridad.diferencias.push(diferencia);
      console.log('DIFERENCIA', JSON.stringify(diferencia).slice(0, 600));
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

const estado = `(() => ({ vista: document.getElementById('resultsFeedPanel').dataset.view, filas: document.querySelectorAll('#resultsFeedPanel .feed-row').length, dias: [...document.querySelectorAll('#resultsFeedPanel .feed-day__hdr')].map(n => n.innerText).join('|'), ranking: document.querySelectorAll('#resultsFeedPanel .uci-ranking-row').length, activa: document.querySelector('[aria-pressed="true"][data-results-view], .feed-view-tab--active')?.dataset.resultsView, cargador: !!document.querySelector('.loading') }))()`;

await funcion('Sin lecturas de Supabase ni cargador', MOVIL, 'resultados/', 'Europe/Madrid', async tab => {
  const urls = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co'));
  const { cargador } = await tab.valor(estado);
  return { ok: !urls.length && !cargador, detalle: urls.slice(0, 3) };
});
await funcion('Cambio de vista sin leer datos', ESCRITORIO, 'resultados/', 'Europe/Madrid', async tab => {
  const datos = () => [...tab.peticiones.values()].map(r => r.url).filter(url => /supabase\.co|\/f\/|\/d\//.test(url)).length;
  const antes = datos();
  await tab.valor(clic('[data-results-view="latest"]'));
  const carretera = await tab.valor(estado);
  await tab.valor(clic('[data-results-view="ranking"]'));
  await espera(300);
  const ranking = await tab.valor(estado);
  await tab.valor(clic('[data-ranking-gender="female"]'));
  const femenino = await tab.valor(estado);
  await tab.valor(clic('[data-results-view="cx"]'));
  const cx = await tab.valor(estado);
  return { ok: carretera.vista === 'latest' && carretera.activa === 'latest' && carretera.filas > 0 && ranking.ranking > 0 && femenino.ranking > 0 && femenino.ranking !== ranking.ranking && cx.vista === 'cx' && cx.filas > 0 && datos() === antes, detalle: { carretera: carretera.filas, ranking: ranking.ranking, femenino: femenino.ranking, cx: cx.filas, lecturas: datos() - antes } };
});
await funcion('Cargar más de carretera, tres días', ESCRITORIO, 'resultados/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('[data-results-view="latest"]'));
  const antes = await tab.valor(estado);
  await tab.valor(clic('#feedMoreBtn'));
  await espera(700);
  await tab.valor(clic('#feedMoreBtn'));
  await espera(700);
  await tab.valor(clic('#feedMoreBtn'));
  await espera(700);
  const despues = await tab.valor(estado);
  const orden = await tab.valor(`[...document.querySelectorAll('#resultsFeedPanel > .feed-day')].length`);
  return { ok: despues.filas > antes.filas && !despues.cargador, detalle: { antes: antes.filas, despues: despues.filas, dias: orden } };
});
await funcion('Cargar más conserva lo cargado al volver', ESCRITORIO, 'resultados/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('[data-results-view="latest"]'));
  await tab.valor(clic('#feedMoreBtn'));
  await espera(700);
  await tab.valor(clic('#feedMoreBtn'));
  await espera(700);
  const cargado = await tab.valor(estado);
  await tab.valor(clic('[data-results-view="cx"]'));
  await tab.valor(clic('[data-results-view="latest"]'));
  const vuelta = await tab.valor(estado);
  return { ok: cargado.filas === vuelta.filas, detalle: { cargado: cargado.filas, vuelta: vuelta.filas } };
});
await funcion('Cargar más de ciclocross', ESCRITORIO, 'resultados/', 'Europe/Madrid', async tab => {
  const antes = await tab.valor(estado);
  const hay = await tab.valor(clic('#cxMoreBtn'));
  await espera(800);
  const despues = await tab.valor(estado);
  return { ok: !hay || despues.filas >= antes.filas, detalle: { hay, antes: antes.filas, despues: despues.filas } };
});
await funcion('Chincheta: fija Carretera y abre en ella', ESCRITORIO, 'resultados/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('[data-results-view="latest"]'));
  await tab.valor(clic('button.discipline-switch__pin'));
  const fijada = await tab.valor(`localStorage.getItem('cc_default_discipline')`);
  await tab.ir(`${B}/resultados/`, { espera: 1200 });
  const abierta = await tab.valor(estado);
  const oculta = await tab.valor(`getComputedStyle(document.getElementById('resultsFeedPanel')).visibility`);
  await tab.valor(clic('[data-results-view="cx"]'));
  const cx = await tab.valor(estado);
  await tab.valor(`localStorage.removeItem('cc_default_discipline')`);
  return { ok: fijada === 'road' && abierta.vista === 'latest' && abierta.activa === 'latest' && oculta === 'visible' && cx.vista === 'cx' && cx.filas > 0, detalle: { fijada, vista: abierta.vista, oculta, cx: cx.filas } };
});
await funcion('Regla del ránking al tocar una fila', MOVIL, 'resultados/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('[data-results-view="ranking"]'));
  const abre = await tab.valor(`(() => { const f = document.querySelector('.uci-ranking-row--explained'); if (!f) return null; f.click(); return f.classList.contains('uci-ranking-row--tooltip-open'); })()`);
  return { ok: abre !== false, detalle: abre };
});
await funcion('Filas destacadas colocadas en dos columnas', ESCRITORIO, 'en/results/', 'Europe/London', async tab => {
  const destacadas = await tab.valor(`[...document.querySelectorAll('#resultsFeedPanel .feed-row--cx')].map(n => n.style.gridRow).filter(Boolean).length`);
  const total = await tab.valor(`document.querySelectorAll('#resultsFeedPanel .feed-row--cx').length`);
  return { ok: destacadas === total, detalle: { destacadas, total } };
});
await funcion('Selector de idioma', ESCRITORIO, 'resultados/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('button.lang-btn[data-lang="en"]'));
  await espera(1500);
  const destino = await tab.valor('location.pathname');
  return { ok: destino === '/en/results/', detalle: destino };
});

for (const [nombre, origen, perfil] of [['produccion-movil', A, MOVIL], ['prototipo-movil', B, MOVIL], ['produccion-escritorio', A, ESCRITORIO], ['prototipo-escritorio', B, ESCRITORIO]]) {
  const tab = await pestaña(nav, perfil, 'Europe/Madrid');
  await tab.ir(`${origen}/resultados/`, { espera: 3000 });
  const { data } = await tab.enviar('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(capturas, `${nombre}.png`), Buffer.from(data, 'base64'));
  await tab.cerrar();
}

writeFileSync(join(trabajo, 'comprobacion-resultados.json'), JSON.stringify(informe, null, 1));
hijo.kill();
publicador.cerrar();
servidor.close();
process.exit(0);
