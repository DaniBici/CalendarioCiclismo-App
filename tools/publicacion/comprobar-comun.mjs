// Arnés de comparación de una familia frente a producción: mismo texto y enlaces en cada
// caso y funcionamiento de lo interactivo. Solo local.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';
import { certificado, crearServidor } from './servidor.mjs';

export { ESCRITORIO, MOVIL };
export const A = 'https://calendariociclismo.app';
export const espera = ms => new Promise(done => setTimeout(done, ms));
export const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
const normalizar = texto => texto.replace(/\s+/g, ' ').trim();

// `excluir`: selectores que no cuentan (se comprueban aparte).
const lector = (raiz, excluir) => `(() => {
  const r = document.querySelector(${JSON.stringify(raiz)});
  const copia = r ? r.cloneNode(true) : null;
  copia?.querySelectorAll(${JSON.stringify(['.sr-only', ...excluir].join(','))}).forEach(nodo => nodo.remove());
  return {
    texto: copia?.textContent || '',
    enlaces: [...(copia?.querySelectorAll('a[href]') || [])].map(a => a.getAttribute('href')).join(),
    nodos: copia?.querySelectorAll('*').length || 0,
    cargador: !!document.querySelector('.loading, .page-loading--active'),
  };
})()`;

function primeraDiferencia(a, b) {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return { en: at, produccion: a.slice(Math.max(0, at - 60), at + 110), prototipo: b.slice(Math.max(0, at - 60), at + 110) };
}

export async function comprobar({ nombre, trabajo, salida, puerto, raiz, excluir = [], casos, pasos = [], funciones = [], capturaRuta }) {
  const B = `https://localhost:${puerto}`;
  const capturas = join(trabajo, `capturas-${nombre}`);
  mkdirSync(capturas, { recursive: true });
  const servidor = await crearServidor({ puerto, tls: certificado(join(trabajo, 'tls')), raiz: salida, espejo: { origen: A, cache: join(trabajo, 'espejo') } });
  const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, `chrome-${nombre}`));
  const informe = { paridad: { total: 0, iguales: 0, diferencias: [] }, funciones: [] };
  const LEER = lector(raiz, excluir);

  for (const [ruta, zona, perfil] of casos) {
    const pestañas = [];
    for (const origen of [A, B]) {
      const tab = await pestaña(nav, perfil, zona);
      await tab.ir(`${origen}/${ruta}`, { espera: 3500 });
      pestañas.push(tab);
    }
    for (const [paso, accion, ms = 1500] of [['inicial', null, 0], ...pasos]) {
      for (const tab of pestañas) if (accion) await tab.valor(accion);
      if (ms) await espera(ms);
      const [a, b] = [await pestañas[0].valor(LEER), await pestañas[1].valor(LEER)];
      informe.paridad.total++;
      if (normalizar(a.texto) === normalizar(b.texto) && a.enlaces === b.enlaces) informe.paridad.iguales++;
      else {
        const diferencia = { ruta, zona, paso, nodos: [a.nodos, b.nodos], enlaces: a.enlaces === b.enlaces, ...primeraDiferencia(normalizar(a.texto), normalizar(b.texto)) };
        informe.paridad.diferencias.push(diferencia);
        console.log('DIFERENCIA', JSON.stringify(diferencia).slice(0, 640));
      }
    }
    for (const tab of pestañas) await tab.cerrar();
  }
  console.log(`Paridad de texto: ${informe.paridad.iguales}/${informe.paridad.total}`);

  for (const [titulo, perfil, ruta, zona, cuerpo] of funciones) {
    const tab = await pestaña(nav, perfil, zona);
    let ok = false;
    let detalle = null;
    try {
      await tab.ir(`${B}/${ruta}`, { espera: 1500 });
      ({ ok, detalle } = await cuerpo(tab, { LEER, B }));
    } catch (error) {
      detalle = error.message;
    }
    const errores = await tab.valor('window.__m.errores').catch(() => []);
    informe.funciones.push({ titulo, ok: ok && !errores.length, detalle, errores });
    console.log(`${ok && !errores.length ? 'correcto' : 'FALLO'}: ${titulo}${detalle != null ? ` (${JSON.stringify(detalle).slice(0, 220)})` : ''}${errores.length ? ` errores: ${errores.join(' | ')}` : ''}`);
    await tab.cerrar();
  }

  for (const [archivo, origen, perfil] of [['produccion-movil', A, MOVIL], ['prototipo-movil', B, MOVIL], ['produccion-escritorio', A, ESCRITORIO], ['prototipo-escritorio', B, ESCRITORIO]]) {
    const tab = await pestaña(nav, perfil, 'Europe/Madrid');
    await tab.ir(`${origen}/${capturaRuta}`, { espera: 3000 });
    const { data } = await tab.enviar('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(capturas, `${archivo}.png`), Buffer.from(data, 'base64'));
    await tab.cerrar();
  }
  writeFileSync(join(trabajo, `comprobacion-${nombre}.json`), JSON.stringify(informe, null, 1));
  hijo.kill();
  servidor.close();
  return informe;
}

/** Función común: ni Supabase ni cargador en la carga. */
export const sinLecturas = ruta => ['Sin lecturas de Supabase ni cargador', MOVIL, ruta, 'Europe/Madrid', async (tab, { LEER }) => {
  const urls = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co'));
  const { cargador, nodos } = await tab.valor(LEER);
  return { ok: !urls.length && !cargador && nodos > 3, detalle: { urls: urls.slice(0, 3), nodos } };
}];
export const selectorIdioma = (ruta, destino) => ['Selector de idioma', ESCRITORIO, ruta, 'Europe/Madrid', async tab => {
  await tab.valor(clic('button.lang-btn[data-lang="en"]'));
  await espera(1500);
  const final = await tab.valor('location.pathname');
  return { ok: final === destino, detalle: final };
}];
