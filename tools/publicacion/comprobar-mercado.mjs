#!/usr/bin/env node
// Comprueba el mercado de fichajes servido por el VPS: mismo contenido que producción en todos
// los equipos e idiomas, sin saltos al abrir un equipo, en todos los estados de un movimiento.
//   node tools/publicacion/comprobar-mercado.mjs --trabajo <dir> [--origen <url>] [--produccion <url>] [--hilos 5] [--pausa <ms tras el clic>] [--solo paridad|enlace|clic|funciones]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto = null) => { const at = argumentos.indexOf(`--${nombre}`); return at === -1 ? porDefecto : argumentos[at + 1]; };
const trabajo = opcion('trabajo');
const B = opcion('origen', 'https://116.203.47.20:8443');
const A = opcion('produccion', 'https://calendariociclismo.app');
const HILOS = Number(opcion('hilos', 5));
const SOLO = opcion('solo');
const PAUSA_CLIC = Number(opcion('pausa', 700));
mkdirSync(trabajo, { recursive: true });

const RAPIDO = { metricas: MOVIL.metricas, agente: MOVIL.agente, red: null, cpu: 1 };
const espera = ms => new Promise(hecho => setTimeout(hecho, ms));
const normalizar = texto => texto.replace(/\s+/g, ' ').trim();
const SECCIONES = ['trSecStaying', 'trSecDoubtful', 'trSecContractEnds', 'trSecArrivals', 'trSecDepartures', 'trTeamEmpty'];
const POSICION = `(() => { const salida = {}; for (const id of ${JSON.stringify(SECCIONES)}) { const e = document.getElementById(id); if (e && !e.hidden && e.getClientRects().length) { const r = e.getBoundingClientRect(); salida[id] = Math.round(r.top + scrollY) + ':' + Math.round(r.left); } } const c = document.querySelector('.tr-team-header__name'); const h = document.getElementById('trHome'); return { secciones: salida, filas: document.querySelectorAll('#trTeamView .tr-row').length, equipo: c?.innerText || null, portada: !!h && !h.hidden && getComputedStyle(h).visibility !== 'hidden' && h.getClientRects().length > 0, flecha: !!document.querySelector('#backBtn:not(.back-btn--placeholder)') }; })()`;
const VIGIA = `(() => { window.__vistas = []; let ultimo = ''; const leer = () => { const v = ${POSICION}; const s = JSON.stringify(v); if (s !== ultimo) { ultimo = s; window.__vistas.push({ t: Math.round(performance.now()), ...v }); } requestAnimationFrame(leer); }; requestAnimationFrame(leer); })()`;
// Sigue los cambios del DOM en lugar de los fotogramas: una pestaña de fondo no pinta.
const VIGIA_DOM = `(() => { window.__vistas = []; let ultimo = ''; const leer = () => { const v = ${POSICION}; const s = JSON.stringify(v); if (s !== ultimo) { ultimo = s; window.__vistas.push({ t: Math.round(performance.now()), ...v }); } }; new MutationObserver(leer).observe(document.getElementById('transfersContent'), { childList: true, subtree: true, attributes: true }); leer(); })()`;
const sumaSaltos = saltos => Number(saltos.reduce((total, salto) => total + salto.v, 0).toFixed(4));

const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-comprobar-mercado'));
const guardar = () => writeFileSync(join(trabajo, `comprobacion-mercado${SOLO ? `-${SOLO}` : ''}.json`), JSON.stringify(informe, null, 1));
const informe = { equipos: 0, estados: null, paridad: { total: 0, iguales: 0, diferencias: [] }, saltos: { total: 0, limpios: 0, fallos: [] }, clic: { total: 0, limpios: 0, fallos: [] }, funciones: [] };

async function enParalelo(tareas, accion) {
  const cola = [...tareas];
  await Promise.all(Array.from({ length: HILOS }, async () => {
    while (cola.length) await accion(cola.shift());
  }));
}

// Equipos y movimientos, tal como se publican.
const inicial = await pestaña(nav, RAPIDO, 'Europe/Madrid');
await inicial.ir(`${B}/fichajes/`, { espera: 500 });
const { equipos, estados } = await inicial.valor(`(async () => {
  const docs = await Promise.all(['', '?div=PT', '?div=WWT', '?div=PRW'].map(q => fetch('/fichajes/' + q).then(r => r.text())));
  const equipos = [...new Set(docs.flatMap(html => [...html.matchAll(/class="tr-team-card" href="\\?team=([a-z0-9-]+)"/g)].map(m => m[1])))];
  const d = await fetch('/d/fichajes.json').then(r => r.ok ? r.json() : null).catch(() => null);
  if (!d) return { equipos, estados: null };
  const mercado = d.transfers.filter(x => !x.midSeason);
  const fin = x => x.type === 'transfer' && !x.toTeamId && x.toTeamName === '?';
  const contar = f => mercado.filter(f).length;
  return { equipos, estados: {
    entradaConfirmada: contar(x => x.type === 'transfer' && x.toTeamId && x.status === 'confirmed'),
    entradaRumor: contar(x => x.type === 'transfer' && x.toTeamId && x.status === 'rumor'),
    salidaConfirmada: contar(x => x.type === 'transfer' && x.fromTeamId && !fin(x) && x.status === 'confirmed'),
    salidaRumor: contar(x => x.type === 'transfer' && x.fromTeamId && !fin(x) && x.status === 'rumor'),
    finContrato: contar(fin),
    retirada: contar(x => x.type === 'retirement'),
    renovacionConfirmada: contar(x => x.type === 'renewal' && x.status === 'confirmed'),
    renovacionRumor: contar(x => x.type === 'renewal' && x.status === 'rumor'),
    renovacionEnDuda: contar(x => x.type === 'renewal' && x.status === 'doubt'),
    mitadDeTemporada: d.transfers.filter(x => x.midSeason).length,
    equipoEnDuda: d.seasons.filter(s => s.continuityDoubt && ['WT', 'PT', 'WWT', 'PRW'].includes(s.category)).length,
    plantillas: Object.keys(d.rosters).length,
    equiposSinCorredores: Object.values(d.rosters).filter(r => !r.length).length,
  } };
})()`);
await inicial.cerrar();
informe.equipos = equipos.length;
informe.estados = estados;
console.log(`${equipos.length} equipos`, JSON.stringify(estados));
const IDIOMAS = [['fichajes', 'Europe/Madrid'], ['en/transfers', 'Europe/London']];
const tareas = IDIOMAS.flatMap(([dir, zona]) => equipos.map(equipo => ({ dir, zona, equipo })));

// 1. Mismo contenido que producción en cada equipo e idioma.
if (!SOLO || SOLO === 'paridad') {
  const LEER = `document.getElementById('trTeamView')?.innerText || ''`;
  await enParalelo(tareas, async ({ dir, zona, equipo }) => {
    const lecturas = [];
    for (const [origen, pausa] of [[A, 2500], [B, 1200]]) {
      const tab = await pestaña(nav, RAPIDO, zona);
      await tab.ir(`${origen}/${dir}/?team=${equipo}`, { espera: pausa });
      lecturas.push(normalizar(await tab.valor(LEER)));
      await tab.cerrar();
    }
    informe.paridad.total++;
    if (lecturas[0] && lecturas[0] === lecturas[1]) informe.paridad.iguales++;
    else {
      let at = 0;
      while (at < lecturas[0].length && lecturas[0][at] === lecturas[1][at]) at++;
      informe.paridad.diferencias.push({ dir, equipo, produccion: lecturas[0].slice(Math.max(0, at - 40), at + 70), vps: lecturas[1].slice(Math.max(0, at - 40), at + 70) });
    }
  });
  console.log(`Contenido igual: ${informe.paridad.iguales}/${informe.paridad.total}`);
  for (const diferencia of informe.paridad.diferencias.slice(0, 12)) console.log('  DIFERENCIA', JSON.stringify(diferencia));
}

// Todos los equipos donde más varía la disposición y una muestra en el resto.
const muestra = equipos.filter((_, at) => at % 5 === 0);

// 2. Enlace directo: una sola disposición desde el primer pintado y ningún salto.
if (!SOLO || SOLO === 'enlace') {
  const casos = [
    ...equipos.map(equipo => ({ dir: 'fichajes', zona: 'Europe/Madrid', equipo, perfil: MOVIL, nombre: 'movil' })),
    ...equipos.map(equipo => ({ dir: 'fichajes', zona: 'Europe/Madrid', equipo, perfil: ESCRITORIO, nombre: 'escritorio' })),
    ...equipos.map(equipo => ({ dir: 'en/transfers', zona: 'Europe/London', equipo, perfil: ESCRITORIO, nombre: 'escritorio' })),
    ...muestra.map(equipo => ({ dir: 'en/transfers', zona: 'Europe/London', equipo, perfil: MOVIL, nombre: 'movil' })),
  ];
  const sinPintar = [];
  const medirEnlace = async caso => {
    const { dir, zona, equipo, perfil, nombre, aParte = false } = caso;
    const tab = await pestaña(nav, perfil, zona);
    if (aParte) await tab.enviar('Page.bringToFront');
    await tab.enviar('Page.addScriptToEvaluateOnNewDocument', { source: VIGIA });
    await tab.ir(`${B}/${dir}/?team=${equipo}`, { espera: perfil === MOVIL ? 3500 : 2200 });
    const m = await tab.valor('window.__m');
    const vistas = await tab.valor('window.__vistas');
    // Lo que había en el primer pintado y lo que cambió después.
    const fcp = m.fcp ?? 0;
    const pintadas = [vistas.filter(vista => vista.t <= fcp).at(-1), ...vistas.filter(vista => vista.t > fcp)].filter(Boolean);
    const completa = pintadas[0]?.equipo && Object.keys(pintadas[0].secciones).length > 0;
    // Una pestaña de fondo puede no llegar a pintar con muchas abiertas: se repite sola, al frente.
    if (!pintadas.length && !aParte) {
      sinPintar.push({ ...caso, aParte: true });
      await tab.cerrar();
      return;
    }
    const disposiciones = new Set(pintadas.map(vista => JSON.stringify(vista.secciones)));
    const conPortada = pintadas.some(vista => vista.portada);
    const saltos = sumaSaltos(m.saltos);
    const lecturas = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co') || url.includes('/rest/v1/'));
    informe.saltos.total++;
    if (completa && disposiciones.size === 1 && !conPortada && saltos === 0 && pintadas[0]?.flecha && !lecturas.length && !m.errores.length) informe.saltos.limpios++;
    else informe.saltos.fallos.push({ dir, equipo, nombre, completa: Boolean(completa), disposiciones: disposiciones.size, conPortada, saltos, recorrido: pintadas.slice(0, 4).map(vista => ({ t: vista.t, filas: vista.filas, secciones: Object.keys(vista.secciones).length })), fuentes: m.saltos.flatMap(s => s.fuentes || []).slice(0, 3), flecha: pintadas[0]?.flecha, lecturas: lecturas.slice(0, 2), errores: m.errores.slice(0, 2) });
    await tab.cerrar();
  };
  await enParalelo(casos, medirEnlace);
  console.log(`Repetidos al frente: ${sinPintar.length}`);
  for (const caso of sinPintar) await medirEnlace(caso);
  console.log(`Enlace directo sin saltos: ${informe.saltos.limpios}/${informe.saltos.total}`);
  for (const fallo of informe.saltos.fallos.slice(0, 12)) console.log('  FALLO', JSON.stringify(fallo).slice(0, 500));
  guardar();
}

// 3. Clic desde la portada: todas las secciones en el mismo fotograma. El código es el mismo en
// todos los equipos: todos en escritorio y una muestra en móvil y en inglés.
if (!SOLO || SOLO === 'clic') {
  const clics = [
    ...equipos.map(equipo => ({ dir: 'fichajes', zona: 'Europe/Madrid', equipo, perfil: ESCRITORIO, nombre: 'escritorio' })),
    ...muestra.map(equipo => ({ dir: 'fichajes', zona: 'Europe/Madrid', equipo, perfil: MOVIL, nombre: 'movil' })),
    ...muestra.map(equipo => ({ dir: 'en/transfers', zona: 'Europe/London', equipo, perfil: ESCRITORIO, nombre: 'escritorio' })),
  ];
  await enParalelo(clics, async ({ dir, zona, equipo, perfil, nombre }) => {
    const tab = await pestaña(nav, perfil, zona);
    await tab.ir(`${B}/${dir}/`, { espera: perfil === MOVIL ? 3500 : 1800 });
    // Con el JS montado: antes, la tarjeta es un enlace y navega al documento del equipo.
    await tab.valor(`new Promise(hecho => { const fin = Date.now() + 20000; const mirar = () => { const c = document.getElementById('transfersContent'); if ((c && !c.hasAttribute('data-prerendered')) || Date.now() > fin) hecho(true); else setTimeout(mirar, 100); }; mirar(); })`);
    await tab.valor(`(async () => { for (const d of ['WT', 'PT', 'WWT', 'PRW']) { const t = document.querySelector('.tr-team-card[href="?team=${equipo}"]'); if (t) return; document.querySelector('[data-div="' + d + '"]')?.click(); await new Promise(h => setTimeout(h, 40)); } })()`);
    await espera(100);
    await tab.valor(VIGIA_DOM);
    const antes = (await tab.valor('window.__m.saltos')).length;
    const pulsado = await tab.valor(`(() => { const a = document.querySelector('.tr-team-card[href="?team=${equipo}"]'); if (!a) return false; window.__t0 = performance.now(); a.click(); return true; })()`);
    await espera(PAUSA_CLIC);
    const vistas = await tab.valor('window.__vistas');
    const t0 = await tab.valor('window.__t0 || 0');
    const tras = vistas.filter(vista => vista.equipo);
    const disposiciones = new Set(tras.map(vista => JSON.stringify(vista.secciones)));
    const saltos = sumaSaltos((await tab.valor('window.__m.saltos')).slice(antes));
    const errores = await tab.valor('window.__m.errores');
    informe.clic.total++;
    const ms = tras[0] ? tras[0].t - Math.round(t0) : null;
    if (pulsado && disposiciones.size === 1 && tras[0]?.flecha && !errores.length && !tras.some(vista => vista.portada)) informe.clic.limpios++;
    else informe.clic.fallos.push({ dir, equipo, nombre, pulsado, disposiciones: disposiciones.size, saltos, ms, flecha: tras[0]?.flecha, errores: errores.slice(0, 2) });
    await tab.cerrar();
  });
  console.log(`Clic sin saltos: ${informe.clic.limpios}/${informe.clic.total}`);
  for (const fallo of informe.clic.fallos.slice(0, 12)) console.log('  FALLO', JSON.stringify(fallo).slice(0, 500));
  guardar();
}

// 4. Funciones.
async function funcion(nombre, perfil, ruta, zona, cuerpo, pausa = 2000) {
  const tab = await pestaña(nav, perfil, zona);
  let ok = false;
  let detalle = null;
  try {
    await tab.ir(`${B}/${ruta}`, { espera: pausa });
    ({ ok, detalle } = await cuerpo(tab));
  } catch (error) {
    detalle = error.message;
  }
  const errores = await tab.valor('window.__m.errores').catch(() => []);
  informe.funciones.push({ nombre, ok: ok && !errores.length, detalle, errores });
  console.log(`${ok && !errores.length ? 'correcto' : 'FALLO'}: ${nombre}${detalle ? ` (${JSON.stringify(detalle).slice(0, 260)})` : ''}${errores.length ? ` errores: ${errores.join(' | ').slice(0, 300)}` : ''}`);
  await tab.cerrar();
}
const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
const estado = `(() => ({ ruta: location.pathname + location.search, portada: !document.getElementById('trHome').hidden, equipo: document.querySelector('.tr-team-header__name')?.innerText || null, tarjetas: document.querySelectorAll('.tr-team-card').length, division: document.querySelector('#trDivBtns .tr-div-btn--active')?.dataset.div, flecha: !!document.querySelector('#backBtn:not(.back-btn--placeholder)') }))()`;
if (!SOLO || SOLO === 'funciones') {
  const [primero] = equipos;
  await funcion('Equipo: flecha de volver a la portada', ESCRITORIO, 'fichajes/', 'Europe/Madrid', async tab => {
    await tab.valor(clic('.tr-team-card'));
    await espera(300);
    const dentro = await tab.valor(estado);
    await tab.valor(clic('#backBtn'));
    await espera(300);
    const fuera = await tab.valor(estado);
    return { ok: !!dentro.equipo && dentro.flecha && !dentro.portada && fuera.portada && !fuera.flecha, detalle: { dentro: dentro.ruta, fuera: fuera.ruta } };
  });
  await funcion('Atrás del navegador desde un equipo', ESCRITORIO, 'fichajes/', 'Europe/Madrid', async tab => {
    await tab.valor(clic('.tr-team-card'));
    await espera(300);
    await tab.valor('history.back()');
    await espera(300);
    const fuera = await tab.valor(estado);
    return { ok: fuera.portada && fuera.tarjetas > 0, detalle: fuera.ruta };
  });
  await funcion('De un equipo a otro por una fila', ESCRITORIO, `fichajes/?team=${primero}`, 'Europe/Madrid', async tab => {
    const antes = await tab.valor(estado);
    const pulsado = await tab.valor(clic('#trTeamView a.tr-row--link'));
    await espera(300);
    const despues = await tab.valor(estado);
    return { ok: !pulsado || (despues.equipo !== antes.equipo && despues.ruta.includes('team=')), detalle: { pulsado, antes: antes.equipo, despues: despues.equipo } };
  });
  await funcion('Del resumen de fichajes a un equipo', ESCRITORIO, 'fichajes/', 'Europe/Madrid', async tab => {
    await tab.valor(clic('#trFeed a.tr-row--link'));
    await espera(300);
    const dentro = await tab.valor(estado);
    return { ok: !!dentro.equipo && !dentro.portada, detalle: dentro.ruta };
  });
  await funcion('Documento de la división', ESCRITORIO, 'fichajes/?div=PRW', 'Europe/Madrid', async tab => {
    const dentro = await tab.valor(estado);
    return { ok: dentro.division === 'PRW' && dentro.portada, detalle: dentro };
  }, 300);
  await funcion('Botón de división sin recargar', ESCRITORIO, 'fichajes/', 'Europe/Madrid', async tab => {
    await tab.valor(clic('[data-div="PT"]'));
    await espera(150);
    const dentro = await tab.valor(estado);
    return { ok: dentro.division === 'PT' && dentro.ruta.includes('div=PT'), detalle: dentro.ruta };
  });
  await funcion('Fichajes y renovaciones en móvil', MOVIL, 'fichajes/', 'Europe/Madrid', async tab => {
    await tab.valor(clic('[data-feed="renewals"]'));
    await espera(200);
    return { ok: await tab.valor(`document.querySelector('.tr-feed-column--active .tr-feed-title')?.textContent.length > 0 && document.querySelector('[data-feed="renewals"]').classList.contains('tr-div-btn--active')`) };
  }, 5000);
  await funcion('Portada: lo pulsado antes de llegar el JS', MOVIL, 'fichajes/', 'Europe/Madrid', async tab => {
    await tab.valor(clic('[data-feed="renewals"]'));
    await espera(5000);
    return { ok: await tab.valor(`document.querySelector('[data-feed="renewals"]').classList.contains('tr-div-btn--active')`) };
  }, 200);
  await funcion('Sin JS: una tarjeta navega al documento del equipo', ESCRITORIO, 'fichajes/', 'Europe/Madrid', async tab => {
    const destino = await tab.valor(`document.querySelector('.tr-team-card').getAttribute('href')`);
    await tab.ir(`${B}/fichajes/${destino}`, { espera: 100 });
    const pintado = await tab.valor(`document.getElementById('transfersContent').hasAttribute('data-painted-team')`);
    return { ok: pintado, detalle: destino };
  }, 300);
  await funcion('Id antiguo de equipo: abre sin enseñar la portada', ESCRITORIO, 'fichajes/', 'Europe/Madrid', async tab => {
    const id = await tab.valor(`document.querySelector('.tr-team-card').dataset.team`);
    await tab.enviar('Page.addScriptToEvaluateOnNewDocument', { source: VIGIA });
    await tab.ir(`${B}/fichajes/?team=${encodeURIComponent(id)}`, { espera: 2000 });
    const vistas = await tab.valor('window.__vistas');
    const fin = await tab.valor(estado);
    return { ok: !!fin.equipo && !vistas.some(vista => vista.portada), detalle: { id, equipo: fin.equipo } };
  }, 300);
  await funcion('Equipo inexistente: queda la portada', ESCRITORIO, 'fichajes/?team=no-existe', 'Europe/Madrid', async tab => {
    const fin = await tab.valor(estado);
    return { ok: fin.portada && !fin.equipo && await tab.valor(`!document.getElementById('transfersContent').hidden && !document.getElementById('trStaticLoading')`), detalle: fin.ruta };
  });
  await funcion('Con ?equipo= del enlace antiguo', ESCRITORIO, `fichajes/?equipo=${primero}`, 'Europe/Madrid', async tab => {
    const fin = await tab.valor(estado);
    return { ok: !!fin.equipo && await tab.valor(`document.getElementById('transfersContent').hasAttribute('data-painted-team')`), detalle: fin.equipo };
  });
  await funcion('Sin lecturas de Supabase al cargar', MOVIL, `fichajes/?team=${primero}`, 'Europe/Madrid', async tab => {
    await espera(2500);
    const urls = [...tab.peticiones.values()].map(r => r.url);
    const lecturas = urls.filter(url => url.includes('supabase.co') || url.includes('/rest/v1/'));
    return { ok: !lecturas.length && urls.filter(url => url.includes('/d/fichajes.json')).length === 1, detalle: lecturas.slice(0, 3) };
  });
  await funcion('Movimiento con la pestaña abierta: entra sin mover la página', MOVIL, `fichajes/?team=${primero}`, 'Europe/Madrid', async tab => {
    await espera(2000);
    const y = 300;
    await tab.valor(`(() => { document.body.scrollTop = ${y}; window.scrollTo(0, ${y}); })()`);
    await espera(150);
    const antes = await tab.valor(`({ filas: document.querySelectorAll('#trTeamView .tr-row').length, y: document.body.scrollTop || window.scrollY, ancla: Math.round(document.querySelector('#trTeamView section:last-of-type')?.getBoundingClientRect().top ?? 0) })`);
    const saltosAntes = (await tab.valor('window.__m.saltos')).length;
    await tab.valor(`(() => {
      const pedir = window.fetch;
      window.fetch = async (url, opciones) => {
        if (String(url).includes('/v/mercado.txt')) return new Response('simulado');
        if (String(url).includes('/d/fichajes.json')) {
          const datos = await pedir(url, opciones).then(r => r.json());
          const equipo = document.getElementById('transfersContent').dataset.paintedTeam;
          datos.transfers.unshift({ id: 'simulado', season: 2027, type: 'transfer', status: 'confirmed', toTeamId: equipo, fromTeamName: 'Simulado', riderId: 'simulado', riderGender: 'male', rider: { firstName: 'Ana', lastName: 'Zzz', nationality: 'es' }, contractUntil: 2028, dateVisible: false });
          return new Response(JSON.stringify(datos));
        }
        return pedir(url, opciones);
      };
      document.dispatchEvent(new Event('visibilitychange'));
    })()`);
    await espera(900);
    const despues = await tab.valor(`({ filas: document.querySelectorAll('#trTeamView .tr-row').length, y: document.body.scrollTop || window.scrollY, nueva: !!document.querySelector('#trArrivals [data-key="simulado"]') })`);
    const saltos = sumaSaltos((await tab.valor('window.__m.saltos')).slice(saltosAntes));
    return { ok: despues.nueva && despues.filas === antes.filas + 1 && Math.abs(despues.y - antes.y) <= 90, detalle: { antes, despues, saltos } };
  });
  await funcion('Selector de idioma desde un equipo', ESCRITORIO, `fichajes/?team=${primero}`, 'Europe/Madrid', async tab => {
    await tab.valor(clic('button.lang-btn[data-lang="en"]'));
    await espera(1200);
    const ruta = await tab.valor('location.pathname + location.search');
    return { ok: ruta.startsWith('/en/transfers/'), detalle: ruta };
  });
}

guardar();
hijo.kill();
process.exit(0);
