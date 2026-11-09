#!/usr/bin/env node
// Comprueba la portada y la agenda del prototipo frente a producción: mismo texto
// visible por zona e idioma y funcionamiento de lo interactivo. Solo local.
//
//   node tools/publicacion/comprobar-portada.mjs --trabajo <dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';
import { montar, publicarPortada } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

const PUERTO = 8821;
const B = `https://localhost:${PUERTO}`;
const A = 'https://calendariociclismo.app';
const argumentos = process.argv.slice(2);
const trabajo = argumentos[argumentos.indexOf('--trabajo') + 1];
const capturas = join(trabajo, 'capturas-portada');
mkdirSync(capturas, { recursive: true });

const { portada, publicador, salida } = await montar(trabajo, join(trabajo, 'arbol-comprobar-portada'));
const fase = await publicarPortada(publicador, portada, { forzar: true });
if (fase.errores.length) throw new Error(fase.errores.join(' | '));
const servidor = await crearServidor({ puerto: PUERTO, tls: certificado(join(trabajo, 'tls')), raiz: salida, espejo: { origen: A, cache: join(trabajo, 'espejo') } });
const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-portada'));
const informe = { paridad: { total: 0, iguales: 0, diferencias: [] }, funciones: [] };

const normalizar = texto => texto.replace(/\s+/g, ' ').trim();
const LEER = `(() => ({
  main: document.getElementById('cxAgendaContent')?.innerText || '',
  cintillo: document.querySelector('#giroCountdown .giro-text-area')?.innerText || '',
  tarjetas: document.querySelectorAll('#cxAgendaList .race-card').length,
  fecha: document.querySelector('.agenda-date')?.innerText || '',
  pastillas: [...document.querySelectorAll('.date-pill')].map(p => p.dataset.dk).join(),
}))()`;

function primeraDiferencia(a, b) {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return { en: at, produccion: a.slice(Math.max(0, at - 50), at + 90), prototipo: b.slice(Math.max(0, at - 50), at + 90) };
}

for (const [ruta, zona, perfil] of [
  ['', 'Europe/Madrid', MOVIL], ['', 'Europe/Madrid', ESCRITORIO], ['', 'America/Bogota', MOVIL], ['', 'Asia/Tokyo', MOVIL], ['', 'Europe/London', ESCRITORIO],
  ['ciclocross/', 'Europe/Madrid', MOVIL], ['en/', 'Europe/London', MOVIL], ['en/', 'America/New_York', ESCRITORIO], ['en/cyclocross/', 'Europe/London', ESCRITORIO],
]) {
  const lecturas = [];
  for (const origen of [A, B]) {
    const tab = await pestaña(nav, perfil, zona);
    await tab.ir(`${origen}/${ruta}`, { espera: 2500 });
    lecturas.push(await tab.valor(LEER));
    await tab.cerrar();
  }
  const [a, b] = lecturas;
  informe.paridad.total++;
  const iguales = normalizar(a.main) === normalizar(b.main) && a.tarjetas === b.tarjetas && a.fecha === b.fecha && a.pastillas === b.pastillas;
  if (iguales) informe.paridad.iguales++;
  else {
    const diferencia = { ruta, zona, tarjetas: [a.tarjetas, b.tarjetas], fecha: [a.fecha, b.fecha], ...primeraDiferencia(normalizar(a.main), normalizar(b.main)) };
    informe.paridad.diferencias.push(diferencia);
    console.log('DIFERENCIA', JSON.stringify(diferencia));
  }
}
console.log(`Paridad de texto: ${informe.paridad.iguales}/${informe.paridad.total}`);

async function funcion(nombre, perfil, ruta, zona, cuerpo) {
  const tab = await pestaña(nav, perfil, zona);
  let ok = false;
  let detalle = null;
  try {
    await tab.ir(`${B}/${ruta}`, { espera: 1800 });
    ({ ok, detalle } = await cuerpo(tab));
  } catch (error) {
    detalle = error.message;
  }
  const errores = await tab.valor('window.__m.errores').catch(() => []);
  informe.funciones.push({ nombre, ok: ok && !errores.length, detalle, errores });
  console.log(`${ok && !errores.length ? 'correcto' : 'FALLO'}: ${nombre}${detalle ? ` (${JSON.stringify(detalle).slice(0, 200)})` : ''}${errores.length ? ` errores: ${errores.join(' | ')}` : ''}`);
  await tab.cerrar();
}

const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
const espera = ms => new Promise(done => setTimeout(done, ms));
const estado = `(() => ({ fecha: document.querySelector('.agenda-date')?.innerText, activa: document.querySelector('.date-pill.active')?.dataset.dk, tarjetas: document.querySelectorAll('#cxAgendaList .race-card').length, chip: document.querySelector('.tcat-btn[aria-pressed="true"]')?.dataset.cat }))()`;

await funcion('Sin lecturas de Supabase', MOVIL, '', 'Europe/Madrid', async tab => {
  const urls = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co'));
  return { ok: !urls.length, detalle: urls.slice(0, 3) };
});
await funcion('La agenda se incorpora sin repintar', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const reemplazos = await tab.valor('window.__m.reemplazos');
  const lista = await tab.valor(`document.querySelectorAll('#cxAgendaList .race-card').length`);
  return { ok: reemplazos === 0 && lista > 0, detalle: { reemplazos, lista } };
});
await funcion('Flecha al día siguiente con carreras', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const antes = await tab.valor(estado);
  await tab.valor(clic('.date-week-arrow[data-direction="next"]'));
  await espera(900);
  const despues = await tab.valor(estado);
  return { ok: despues.activa > antes.activa && despues.fecha !== antes.fecha, detalle: { antes: antes.activa, despues: despues.activa, tarjetas: despues.tarjetas } };
});
// Un día sin carreras salta al siguiente con carreras, también en producción: se elige
// una pastilla posterior a la del día siguiente con carreras.
await funcion('Pastilla de otro día', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const antes = await tab.valor(estado);
  const destino = await tab.valor(`[...document.querySelectorAll('.date-pill')].at(-1)?.dataset.dk`);
  await tab.valor(clic(`.date-pill[data-dk="${destino}"]`));
  await espera(900);
  const despues = await tab.valor(estado);
  return { ok: despues.fecha !== antes.fecha, detalle: { destino, activa: despues.activa, fecha: despues.fecha } };
});
await funcion('Filtro de categoría', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const antes = await tab.valor(estado);
  await tab.valor(clic('.tcat-btn[data-cat="spain"]'));
  await espera(700);
  const despues = await tab.valor(estado);
  return { ok: despues.chip === 'spain' && antes.chip === 'all', detalle: { chip: despues.chip, tarjetas: [antes.tarjetas, despues.tarjetas], activa: despues.activa } };
});
await funcion('Ordenar', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const orden = () => tab.valor(`[...document.querySelectorAll('#cxAgendaList .race-card')].map(c => c.querySelector('a[href]')?.getAttribute('href')).join()`);
  const antes = await orden();
  await tab.valor(`(() => { const s = document.getElementById('cxAgendaSortSelect'); s.value = 'tvtime'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await espera(400);
  const despues = await orden();
  return { ok: despues.split(',').length === antes.split(',').length, detalle: { igual: antes === despues, tarjetas: antes.split(',').length } };
});
await funcion('Enlace a la ficha de una carrera', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const destino = await tab.valor(`document.querySelector('#cxAgendaList .race-card a[href*="/ciclocross/"]')?.getAttribute('href') || null`);
  return { ok: !!destino, detalle: destino };
});
await funcion('Cintillo con flechas', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const texto = () => tab.valor(`document.querySelector('#giroCountdown .giro-text-area')?.innerText || ''`);
  const antes = await texto();
  await tab.valor(clic('#giroCountdown [data-direction="next"]'));
  await espera(250);
  const despues = await texto();
  return { ok: !!antes && antes !== despues, detalle: { antes: antes.slice(0, 40), despues: despues.slice(0, 40) } };
});
await funcion('Conmutador a Hoy de carretera', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  const href = await tab.valor(`document.querySelector('.discipline-switch a')?.getAttribute('href') || null`);
  await tab.valor(clic('.discipline-switch a'));
  await espera(2500);
  const ruta = await tab.valor('location.pathname + location.search');
  const hoy = await tab.valor(`document.getElementById('raceList') ? document.querySelectorAll('#raceList .race-card').length : -1`);
  return { ok: !!href && ruta.includes('index-ruta.html') && hoy >= 0, detalle: { href, ruta, hoy } };
});
await funcion('Con Carretera fijada, Hoy de carretera', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  await tab.valor(`localStorage.setItem('cc_default_discipline', 'road')`);
  await tab.ir(`${B}/`, { espera: 2500 });
  const ruta = await tab.valor('location.pathname');
  return { ok: ruta === '/index-ruta.html', detalle: ruta };
});
await funcion('Selector de idioma', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  await tab.valor(clic('button.lang-btn[data-lang="en"]'));
  await espera(1500);
  const destino = await tab.valor('location.pathname');
  return { ok: destino === '/en/', detalle: destino };
});
await funcion('Modal de apps', ESCRITORIO, '', 'Europe/Madrid', async tab => {
  await tab.valor(clic('#navAppsBtn'));
  await espera(400);
  return { ok: await tab.valor(`!!document.querySelector('dialog[open]')`) };
});

for (const [nombre, origen, perfil] of [['produccion-movil', A, MOVIL], ['prototipo-movil', B, MOVIL], ['produccion-escritorio', A, ESCRITORIO], ['prototipo-escritorio', B, ESCRITORIO]]) {
  const tab = await pestaña(nav, perfil, 'Europe/Madrid');
  await tab.ir(`${origen}/`, { espera: 2500 });
  const { data } = await tab.enviar('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(capturas, `${nombre}.png`), Buffer.from(data, 'base64'));
  await tab.cerrar();
}

writeFileSync(join(trabajo, 'comprobacion-portada.json'), JSON.stringify(informe, null, 1));
hijo.kill();
publicador.cerrar();
servidor.close();
process.exit(0);
