#!/usr/bin/env node
// Comprueba el calendario frente a producción: mismo texto y enlaces por filtro, año,
// vista e idioma, y funcionamiento de lo interactivo. Solo local.
//
//   node tools/publicacion/comprobar-calendario.mjs --trabajo <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';
import { montar, publicarCalendario } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

const PUERTO = 8824;
const B = `https://localhost:${PUERTO}`;
const A = 'https://calendariociclismo.app';
const argumentos = process.argv.slice(2);
const trabajo = argumentos[argumentos.indexOf('--trabajo') + 1];
const capturas = join(trabajo, 'capturas-calendario');
mkdirSync(capturas, { recursive: true });

const { temporada, publicador, salida } = await montar(trabajo, join(trabajo, 'arbol-comprobar-calendario'));
const fase = await publicarCalendario(publicador, temporada, { forzar: true });
if (fase.errores.length) throw new Error(fase.errores.join(' | '));
const servidor = await crearServidor({ puerto: PUERTO, tls: certificado(join(trabajo, 'tls')), raiz: salida, espejo: { origen: A, cache: join(trabajo, 'espejo') } });
const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-calendario'));
const informe = { paridad: { total: 0, iguales: 0, diferencias: [] }, funciones: [] };

const espera = ms => new Promise(done => setTimeout(done, ms));
const normalizar = texto => texto.replace(/\s+/g, ' ').trim();
const LEER = `(() => {
  const vistaMes = !document.getElementById('mesContent').hidden;
  const raiz = document.getElementById(vistaMes ? 'mesContent' : 'temporadaContent');
  return {
    vista: vistaMes ? 'mes' : 'temporada',
    texto: (() => { const copia = raiz.cloneNode(true); copia.querySelectorAll('.sr-only, .t-race__dates').forEach(nodo => nodo.remove()); return copia.textContent; })(),
    filas: raiz.querySelectorAll('.t-race').length,
    enlaces: [...raiz.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).join(),
    anio: document.getElementById('filterYear').value,
    paises: document.getElementById('filterCountry').options.length,
    cargador: !!document.querySelector('.loading'),
  };
})()`;
const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
const elegir = (id, valor) => `(() => { const s = document.getElementById(${JSON.stringify(id)}); s.value = ${JSON.stringify(valor)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`;

function primeraDiferencia(a, b) {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return { en: at, produccion: a.slice(Math.max(0, at - 60), at + 100), prototipo: b.slice(Math.max(0, at - 60), at + 100) };
}

const PASOS = [
  ['inicial', null, 0],
  ['WorldTour', clic('#filterCats .tcat-btn[data-cat="uwt"]'), 1500],
  ['Pro', clic('#filterCats .tcat-btn[data-cat="pro"]'), 400],
  ['Todas', clic('#filterCats .tcat-btn[data-cat="all"]'), 400],
  ['Francia', elegir('filterCountry', 'fr'), 400],
  ['Todos los países', elegir('filterCountry', ''), 400],
  ['Año 2026', elegir('filterYear', '2026'), 2500],
  ['Vista Mes', clic('[data-cal-switch="mes"]'), 2500],
];

for (const [ruta, zona, perfil] of [['calendario/', 'Europe/Madrid', ESCRITORIO], ['calendario/', 'America/Bogota', MOVIL], ['en/calendar/', 'Europe/London', MOVIL]]) {
  const pestañas = [];
  for (const origen of [A, B]) {
    const tab = await pestaña(nav, perfil, zona);
    await tab.ir(`${origen}/${ruta}`, { espera: 4500 });
    // Producción carga cada mes al verlo: se recorren todos antes de comparar.
    if (origen === A) {
      for (let at = 0; at < 14; at++) {
        await tab.valor(`document.querySelectorAll('.temporada-month')[${at}]?.scrollIntoView()`);
        await espera(350);
      }
      await espera(800);
    }
    pestañas.push(tab);
  }
  for (const [nombre, accion, ms] of PASOS) {
    const lecturas = [];
    for (const tab of pestañas) if (accion) await tab.valor(accion);
    await espera(ms);
    // Primer uso con conexión lenta: el prototipo trae aquí su JS y sus datos.
    if (nombre === 'WorldTour' && perfil === MOVIL) await espera(7000);
    // Año 2026 y Mes cargan datos, y producción carga cada mes al verlo.
    if (ms > 2000) await espera(4000);
    if (nombre === 'Año 2026') {
      for (let at = 0; at < 14; at++) {
        await pestañas[0].valor(`document.querySelectorAll('.temporada-month')[${at}]?.scrollIntoView()`);
        await espera(350);
      }
      await espera(800);
    }
    for (const tab of pestañas) lecturas.push(await tab.valor(LEER));
    const [a, b] = lecturas;
    informe.paridad.total++;
    const iguales = normalizar(a.texto) === normalizar(b.texto) && a.filas === b.filas && a.enlaces === b.enlaces && a.anio === b.anio && a.paises === b.paises;
    if (iguales) informe.paridad.iguales++;
    else {
      const diferencia = { ruta, zona, nombre, filas: [a.filas, b.filas], enlaces: a.enlaces === b.enlaces, anio: [a.anio, b.anio], paises: [a.paises, b.paises], ...primeraDiferencia(normalizar(a.texto), normalizar(b.texto)) };
      informe.paridad.diferencias.push(diferencia);
      console.log('DIFERENCIA', JSON.stringify(diferencia).slice(0, 700));
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
const lecturas = tab => [...tab.peticiones.values()].map(r => r.url).filter(url => /supabase\.co|\/d\/temporada\/|\/d\/modal\//.test(url));

await funcion('Al cargar: sin lecturas de datos ni cargador', MOVIL, 'calendario/', 'Europe/Madrid', async tab => {
  const urls = lecturas(tab);
  const { cargador, filas } = await tab.valor(LEER);
  return { ok: !urls.length && !cargador && filas > 100, detalle: { urls: urls.slice(0, 3), filas } };
});
await funcion('Primer filtro: lee solo el archivo publicado', ESCRITORIO, 'calendario/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('#filterCats .tcat-btn[data-cat="uwt"]'));
  await espera(1500);
  const urls = lecturas(tab);
  const { filas } = await tab.valor(LEER);
  const activa = await tab.valor(`document.querySelector('#filterCats .tcat-btn[aria-pressed="true"]')?.dataset.cat`);
  return { ok: urls.length === 1 && urls[0].includes('/d/temporada/') && activa === 'uwt' && filas > 0, detalle: { urls, filas, activa } };
});
await funcion('Grupo desplegado antes de cargar el JS completo se conserva', ESCRITORIO, 'calendario/', 'Europe/Madrid', async tab => {
  const id = await tab.valor(`(() => { const b = document.querySelector('.t-race--challenge'); b.click(); return b.dataset.cgid; })()`);
  const abierto = await tab.valor(`document.querySelector('.t-race--challenge[data-cgid="${id}"]').getAttribute('aria-expanded')`);
  await tab.valor(clic('#filterCats .tcat-btn[data-cat="pro"]'));
  await espera(1200);
  await tab.valor(clic('#filterCats .tcat-btn[data-cat="all"]'));
  await espera(400);
  const despues = await tab.valor(`document.querySelector('.t-race--challenge[data-cgid="${id}"]')?.getAttribute('aria-expanded')`);
  return { ok: abierto === 'true' && despues === 'true', detalle: { id, abierto, despues } };
});
await funcion('Selector de mes', ESCRITORIO, 'calendario/', 'Europe/Madrid', async tab => {
  const antes = await tab.valor('scrollY');
  await tab.valor(elegir('filterMonth', '06'));
  await espera(1200);
  const despues = await tab.valor('scrollY');
  return { ok: despues > antes, detalle: { antes, despues } };
});
await funcion('Modal de una prueba sin página', ESCRITORIO, 'calendario/', 'Europe/Madrid', async tab => {
  const hay = await tab.valor(clic('.t-race--modal'));
  await espera(1200);
  const abierto = await tab.valor(`document.querySelector('.rd-modal__body')?.innerText.length || 0`);
  return { ok: !hay || abierto > 0, detalle: { hay, abierto, urls: lecturas(tab).slice(0, 2) } };
});
await funcion('Enlace a Mes por la URL', ESCRITORIO, 'calendario/?vista=mes', 'Europe/Madrid', async tab => {
  await espera(1200);
  const { vista, cargador } = await tab.valor(LEER);
  const contenido = await tab.valor(`document.getElementById('mesContent').innerText.length`);
  return { ok: vista === 'mes' && contenido > 0 && !cargador, detalle: { vista, contenido } };
});
await funcion('Filtro fijado', ESCRITORIO, 'calendario/', 'Europe/Madrid', async tab => {
  await tab.valor(`localStorage.setItem('cc_default_filter', 'uwt')`);
  await tab.ir(`${B}/calendario/`, { espera: 1800 });
  const activa = await tab.valor(`document.querySelector('#filterCats .tcat-btn[aria-pressed="true"]')?.dataset.cat`);
  const visibilidad = await tab.valor(`getComputedStyle(document.getElementById('temporadaContent')).visibility`);
  const { filas } = await tab.valor(LEER);
  await tab.valor(`localStorage.removeItem('cc_default_filter')`);
  return { ok: activa === 'uwt' && visibilidad === 'visible' && filas > 0 && filas < 200, detalle: { activa, visibilidad, filas } };
});
await funcion('Selector de idioma', ESCRITORIO, 'calendario/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('button.lang-btn[data-lang="en"]'));
  await espera(1500);
  const destino = await tab.valor('location.pathname');
  return { ok: destino === '/en/calendar/', detalle: destino };
});

for (const [nombre, origen, perfil] of [['produccion-movil', A, MOVIL], ['prototipo-movil', B, MOVIL], ['produccion-escritorio', A, ESCRITORIO], ['prototipo-escritorio', B, ESCRITORIO]]) {
  const tab = await pestaña(nav, perfil, 'Europe/Madrid');
  await tab.ir(`${origen}/calendario/`, { espera: 3500 });
  const { data } = await tab.enviar('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(capturas, `${nombre}.png`), Buffer.from(data, 'base64'));
  await tab.cerrar();
}
writeFileSync(join(trabajo, 'comprobacion-calendario.json'), JSON.stringify(informe, null, 1));
hijo.kill();
publicador.cerrar();
servidor.close();
process.exit(0);
