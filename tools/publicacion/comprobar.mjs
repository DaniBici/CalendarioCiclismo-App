#!/usr/bin/env node
// Comprueba que el prototipo conserva lo que hace la web actual en una jornada:
// paridad de texto visible por zona e idioma frente a la copia de producción y
// funcionamiento de lo interactivo. Solo local.
//
//   node tools/publicacion/comprobar.mjs --trabajo <dir>
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';
import { montar, todasLasEntradas } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

const PUERTO_B = 8811;
const PUERTO_ESPEJO = 8812;
const PUERTO_HIBRIDO = 8813;
const B = `https://localhost:${PUERTO_B}`;
const A = `https://localhost:${PUERTO_ESPEJO}`;
const H = `https://localhost:${PUERTO_HIBRIDO}`;
const argumentos = process.argv.slice(2);
const trabajo = argumentos[argumentos.indexOf('--trabajo') + 1];

const PAGINAS = [
  'jornada/giro-de-italia-2026-etapa-10/',
  'jornada/tour-de-francia-2026-etapa-21/',
  'jornada/campeonato-del-mundo-linea-masculino-2026/',
  'jornada/tour-de-francia-2027-etapa-16/',
  'en/stage/giro-ditalia-2026-stage-10/',
  'en/stage/tour-de-france-2026-stage-21/',
];
const ZONAS = ['Europe/Madrid', 'Atlantic/Canary', 'Europe/London', 'Europe/Paris', 'America/Bogota', 'America/New_York', 'Asia/Tokyo', 'Etc/GMT'];

const normalizar = texto => texto.replace(/\s+/g, ' ').trim();
const LEER = `(() => {
  const main = document.querySelector('main');
  const barra = document.getElementById('icalBar');
  return { main: main.innerText, barra: barra ? barra.innerText : '', titulo: document.title,
    tv: [...main.querySelectorAll('.tv-panel .tv-entry')].filter(el => el.style.display !== 'none').map(el => el.innerText.replace(/\\s+/g, ' ').trim()) };
})()`;

function primeraDiferencia(a, b) {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return { en: at, actual: a.slice(Math.max(0, at - 40), at + 80), prototipo: b.slice(Math.max(0, at - 40), at + 80) };
}

const tls = certificado(join(trabajo, 'tls'));
const espejo = { origen: 'https://calendariociclismo.app', cache: join(trabajo, 'espejo') };
const isla = await montar(trabajo);
const hibrido = await montar(trabajo, join(trabajo, 'arbol-hibrido-comprobar'), { modoJornada: 'hibrido' });
await isla.publicador.publicar(todasLasEntradas(isla.datos, isla.inscritos), { forzar: true });
await hibrido.publicador.publicar(todasLasEntradas(isla.datos, isla.inscritos), { forzar: true });
const servidores = [
  await crearServidor({ puerto: PUERTO_B, tls, raiz: isla.salida, espejo }),
  await crearServidor({ puerto: PUERTO_HIBRIDO, tls, raiz: hibrido.salida, espejo }),
  await crearServidor({ puerto: PUERTO_ESPEJO, tls, espejo }),
];
const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-comprobar'));
const informe = { paridad: { total: 0, iguales: 0, diferencias: [] }, hibrido: { total: 0, conservadas: 0, repintadas: [] }, funciones: [] };

for (const pagina of PAGINAS) {
  for (const zona of ZONAS) {
    const lecturas = [];
    for (const origen of [A, B]) {
      const tab = await pestaña(nav, ESCRITORIO, zona);
      await tab.ir(`${origen}/${pagina}`, { espera: 1200 });
      lecturas.push(await tab.valor(LEER));
      await tab.cerrar();
    }
    const [a, b] = lecturas;
    informe.paridad.total++;
    if (normalizar(a.main) === normalizar(b.main) && normalizar(a.barra) === normalizar(b.barra)) {
      informe.paridad.iguales++;
    } else {
      const diferencia = { pagina, zona, ...primeraDiferencia(normalizar(a.main), normalizar(b.main)), tvActual: a.tv.length, tvPrototipo: b.tv.length, barra: normalizar(a.barra) === normalizar(b.barra) };
      informe.paridad.diferencias.push(diferencia);
      console.log('DIFERENCIA', JSON.stringify(diferencia));
    }
  }
}
console.log(`Paridad de texto: ${informe.paridad.iguales}/${informe.paridad.total}`);

// Modo híbrido: el JS actual lee Supabase y debe conservar el HTML publicado.
for (const pagina of [...PAGINAS, 'inscritos/giro-de-italia-2026/', 'inscritos/tour-de-francia-2026/', 'en/startlist/tour-de-france-2026/']) {
  const zona = pagina.startsWith('en/stage') ? 'Etc/GMT' : 'Europe/Madrid';
  const tab = await pestaña(nav, ESCRITORIO, zona);
  await tab.ir(`${H}/${pagina}`, { espera: 1500 });
  const reemplazos = await tab.valor('window.__m.reemplazos');
  const errores = await tab.valor('window.__m.errores');
  await tab.cerrar();
  informe.hibrido.total++;
  if (reemplazos === 0 && !errores.length) informe.hibrido.conservadas++;
  else informe.hibrido.repintadas.push({ pagina, reemplazos, errores });
}
console.log(`Híbrido: ${informe.hibrido.conservadas}/${informe.hibrido.total} páginas conservadas`, JSON.stringify(informe.hibrido.repintadas));

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
  console.log(`${ok && !errores.length ? 'correcto' : 'FALLO'}: ${nombre}${detalle ? ` (${JSON.stringify(detalle)})` : ''}${errores.length ? ` errores: ${errores.join(' | ')}` : ''}`);
  await tab.cerrar();
}

const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
const espera = ms => new Promise(done => setTimeout(done, ms));
const GIRO = 'jornada/giro-de-italia-2026-etapa-10/';

await funcion('Volver con origen del calendario', ESCRITORIO, `${GIRO}?from=mes&month=4&year=2026`, 'Europe/Madrid', async tab => {
  const href = await tab.valor(`document.getElementById('backBtn')?.getAttribute('href')`);
  return { ok: /calendario/.test(href || '') && /2026-05/.test(href || ''), detalle: href };
});
await funcion('Diálogo de aviso', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
  await tab.valor(clic('#reportBarBtn'));
  await espera(800);
  return { ok: await tab.valor(`!!document.querySelector('#reportModalOverlay[open]')`) };
});
await funcion('Diálogo de calendario', ESCRITORIO, 'jornada/tour-de-francia-2027-etapa-16/', 'Europe/Madrid', async tab => {
  await tab.valor(clic('#icalOpenBtn'));
  await espera(800);
  return { ok: await tab.valor(`!!document.querySelector('.rd-modal-overlay[open]')`) };
});
await funcion('Modo oficial del perfil', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
  await espera(600);
  const dibujado = await tab.valor(`!!document.querySelector('.stage-profile-graphic svg')`);
  await tab.valor(clic('[data-mode="official"]'));
  await espera(500);
  return { ok: dibujado && await tab.valor(`!!document.querySelector('.stage-profile-graphic img, .stage-profile-graphic iframe')`), detalle: { dibujado } };
});
await funcion('Barra de acciones junto al perfil en escritorio', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
  await espera(600);
  return { ok: await tab.valor(`document.getElementById('icalBar')?.parentElement?.classList.contains('stage-side__actions')`) };
});
await funcion('Barra de acciones sobre el pie en móvil', MOVIL, GIRO, 'Europe/Madrid', async tab => {
  await espera(1500);
  return { ok: await tab.valor(`document.getElementById('icalBar')?.nextElementSibling?.matches('footer.site-footer')`) };
});
await funcion('Visor de documentos', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
  await espera(800);
  const abierto = await tab.valor(`(() => { const enlace = [...document.querySelectorAll('a.asset-btn')].find(a => /\\.pdf/i.test(a.href)); if (!enlace) return 'sin pdf'; enlace.click(); return enlace.href; })()`);
  await espera(600);
  return { ok: await tab.valor(`typeof window.openAssetModal === 'function' && !!document.querySelector('dialog[open], [class*="asset-modal"][open], .asset-modal--open, .asset-viewer--open')`), detalle: abierto };
});
// Jornada sin resultados con una emisión de España y otra de Francia, en memoria:
// aparece el botón y hay filas ocultas que mostrar.
{
  const input = isla.datos.entradas(isla.datos.carreras().find(raceId => isla.datos.jornadas(raceId).some(dia => dia.slug === 'tour-de-francia-2027-etapa-16'))).find(entrada => entrada.rd.slug === 'tour-de-francia-2027-etapa-16');
  const fila = (id, country, channel) => ({ id, raceDayId: input.rd.id, channel, country, url: 'https://example.com/directo', startTimeUtc: null, sortOrder: 0, embeddable: false, note: null, showInRevive: false });
  await isla.publicador.publicar([input], { transformar: entrada => ({ ...entrada, broadcasts: [fila('zz-es', 'ES', 'Canal ES'), fila('zz-fr', 'FR', 'Canal FR')] }) });
}
await funcion('Filtro de televisión', ESCRITORIO, 'jornada/tour-de-francia-2027-etapa-16/', 'Europe/Madrid', async tab => {
  const visibles = () => tab.valor(`[...document.querySelectorAll('.tv-panel .tv-entry')].filter(el => el.style.display !== 'none').length`);
  const insignia = () => tab.valor(`[...document.querySelectorAll('.tv-region-badge')].some(el => getComputedStyle(el).display !== 'none')`);
  const antes = await visibles();
  const hay = await tab.valor(clic('[data-tv-filter]'));
  await espera(100);
  const despues = await visibles();
  const conInsignia = await insignia();
  await tab.valor(clic('[data-tv-filter]'));
  await espera(100);
  const vuelta = await visibles();
  return { ok: hay && antes === 1 && despues === 2 && conInsignia && vuelta === 1, detalle: { hay, antes, despues, conInsignia, vuelta } };
});
await funcion('Variante de televisión de otra región', ESCRITORIO, 'jornada/tour-de-francia-2027-etapa-16/', 'Europe/Paris', async tab => {
  const texto = await tab.valor(`[...document.querySelectorAll('.tv-panel .tv-entry')].filter(el => el.style.display !== 'none').map(el => el.innerText.trim().split('\\n')[0]).join('|')`);
  return { ok: texto.includes('Canal FR') && !texto.includes('Canal ES'), detalle: texto };
});
{
  const input = isla.datos.entradas(isla.datos.carreras().find(raceId => isla.datos.jornadas(raceId).some(dia => dia.slug === 'tour-de-francia-2027-etapa-16'))).find(entrada => entrada.rd.slug === 'tour-de-francia-2027-etapa-16');
  await isla.publicador.publicar([input]);
}
await funcion('Modal de apps', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
  await tab.valor(clic('#navAppsBtn'));
  await espera(400);
  return { ok: await tab.valor(`!!document.querySelector('dialog[open], .apps-modal--open, .apps-modal[open], #appsModal[open]')`) };
});
await funcion('Selector de idioma', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
  const hay = await tab.valor(clic('button.lang-btn[data-lang="en"]'));
  await espera(1500);
  const destino = await tab.valor('location.pathname');
  return { ok: hay && destino === '/en/stage/giro-ditalia-2026-stage-10/', detalle: destino };
});
await funcion('Sin lecturas de Supabase', MOVIL, GIRO, 'Europe/Madrid', async tab => {
  const urls = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co'));
  return { ok: !urls.length, detalle: urls.slice(0, 3) };
});

writeFileSync(join(trabajo, 'comprobacion.json'), JSON.stringify(informe, null, 1));
hijo.kill();
isla.publicador.cerrar();
hibrido.publicador.cerrar();
for (const servidor of servidores) servidor.close();
process.exit(0);
