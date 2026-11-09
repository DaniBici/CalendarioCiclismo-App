#!/usr/bin/env node
// Compara la agenda de Hoy de carretera con producción, tarjeta a tarjeta: texto, clases, enlaces y
// atributos, por fecha, zona e idioma, y comprueba lo interactivo.
//   node tools/publicacion/comprobar-hoy.mjs --trabajo <dir> [--origen <url>] [--produccion <url>] [--ruta /] [--hilos 3] [--pausa <ms antes de leer>] [--solo paridad|saltos|funciones]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME, ESCRITORIO, MOVIL, abrirChrome, pestaña } from './medir.mjs';

const argumentos = process.argv.slice(2);
const opcion = (nombre, porDefecto = null) => { const at = argumentos.indexOf(`--${nombre}`); return at === -1 ? porDefecto : argumentos[at + 1]; };
const trabajo = opcion('trabajo');
const B = opcion('origen', 'https://116.203.47.20:8444');
const A = opcion('produccion', 'https://calendariociclismo.app');
const HILOS = Number(opcion('hilos', 3));
const SOLO = opcion('solo');
const PAUSA = Number(opcion('pausa', 1500));
mkdirSync(trabajo, { recursive: true });
const RAPIDO = { metricas: ESCRITORIO.metricas, agente: null, red: null, cpu: 1 };
const espera = ms => new Promise(hecho => setTimeout(hecho, ms));
const normal = texto => (texto || '').replace(/\s+/g, ' ').trim();

// Lo que se ve y lo que se usa de cada tarjeta, sin depender del orden de clases ni de envoltorios.
const LEER = `(async () => {
  const fin = Date.now() + 15000;
  while (Date.now() < fin && document.querySelector('#raceList .loading')) await new Promise(h => setTimeout(h, 100));
  await new Promise(h => setTimeout(h, 300));
  const limpio = t => (t || '').replace(/\\s+/g, ' ').trim();
  const tarjetas = [...document.querySelectorAll('#raceList .race-card')].map(c => ({
    texto: limpio(c.textContent),
    clases: [...c.classList].sort().join(' '),
    color: c.style.getPropertyValue('--card-color'),
    cursor: c.style.cursor,
    rol: c.getAttribute('role'), tab: c.getAttribute('tabindex'), aria: c.getAttribute('aria-label'), href: c.dataset.href || null,
    aviso: c.dataset.phTooltip || null, nombre: c.dataset.phName || null, bandera: c.dataset.phFlag || null, sub: c.dataset.phSub || null,
    enlaces: [...c.querySelectorAll('a[href]')].map(a => a.className.split(' ').sort().join('.') + '=' + a.getAttribute('href')).join('|'),
    botones: [...c.querySelectorAll('button')].map(b => b.className + ':' + (b.getAttribute('aria-label') || '')).join('|'),
    incrustar: [...c.querySelectorAll('[data-tv-embed]')].length,
    perfil: !!c.querySelector('.race-card__profile svg'),
    imagenes: [...c.querySelectorAll('img')].map(i => i.getAttribute('src')).join('|'),
    titulos: [...c.querySelectorAll('[title]')].map(e => e.getAttribute('title')).join('|'),
  }));
  return {
    url: location.pathname + location.search,
    tarjetas,
    vacio: limpio(document.querySelector('#raceList .empty-state')?.textContent),
    fecha: limpio(document.getElementById('agendaDate')?.textContent),
    barra: [...document.querySelectorAll('#dateBar button')].map(b => [b.className.split(' ').sort().join('.'), b.getAttribute('aria-label'), b.getAttribute('aria-current'), b.dataset.dk, b.dataset.direction, limpio(b.textContent)].join('~')).join('|'),
    filtros: [...document.querySelectorAll('#agendaFilterCats .tcat-btn')].map(b => b.dataset.cat + ':' + b.getAttribute('aria-pressed') + ':' + b.style.display).join('|'),
  };
})()`;

const { hijo, nav } = await abrirChrome(CHROME, join(trabajo, 'chrome-comprobar-hoy'));
const informe = { paridad: { total: 0, iguales: 0, tarjetas: 0, diferencias: [] }, funciones: [] };
const guardar = () => writeFileSync(join(trabajo, `comprobacion-hoy${SOLO ? `-${SOLO}` : ''}.json`), JSON.stringify(informe, null, 1));

const FECHAS = ['2026-03-07', '2026-05-16', '2026-05-18', '2026-06-27', '2026-07-14', '2026-07-20', '2026-08-29', '2026-09-20', '2026-10-03', '2026-10-18', '2026-11-05', '2026-11-20', '2027-01-20', '2027-03-07', '2027-05-20', '2027-07-10'];
const VARIANTES = [['', 'Europe/Madrid'], ['en/', 'Europe/London'], ['', 'America/Bogota'], ['en/', 'Asia/Tokyo']];

async function enParalelo(tareas, accion) {
  const cola = [...tareas];
  await Promise.all(Array.from({ length: HILOS }, async () => {
    while (cola.length) await accion(cola.shift());
  }));
}

function diferencia(a, b) {
  for (const clave of ['url', 'vacio', 'fecha', 'barra', 'filtros']) if (a[clave] !== b[clave]) return { clave, produccion: String(a[clave]).slice(0, 260), nuevo: String(b[clave]).slice(0, 260) };
  if (a.tarjetas.length !== b.tarjetas.length) return { clave: 'tarjetas', produccion: a.tarjetas.length, nuevo: b.tarjetas.length };
  for (let i = 0; i < a.tarjetas.length; i++) {
    for (const campo of Object.keys(a.tarjetas[i])) {
      if (a.tarjetas[i][campo] !== b.tarjetas[i][campo]) return { tarjeta: i, nombre: a.tarjetas[i].texto.slice(0, 50), campo, produccion: String(a.tarjetas[i][campo]).slice(0, 320), nuevo: String(b.tarjetas[i][campo]).slice(0, 320) };
    }
  }
  return null;
}

if (!SOLO || SOLO === 'paridad') {
  const casos = FECHAS.flatMap(fecha => VARIANTES.map(([idioma, zona]) => ({ fecha, idioma, zona })));
  await enParalelo(casos, async ({ fecha, idioma, zona }) => {
    const lecturas = [];
    for (const origen of [A, B]) {
      const tab = await pestaña(nav, RAPIDO, zona);
      await tab.ir(`${origen}/${idioma}?date=${fecha}`, { espera: PAUSA });
      // Una fecha sin documento redirige a la página que lee datos: se espera a que termine.
      let lectura = null;
      for (let intento = 0; !lectura && intento < 5; intento++) {
        lectura = await tab.valor(LEER).catch(() => null);
        if (!lectura) await espera(2000);
      }
      lecturas.push(lectura);
      await tab.cerrar();
    }
    informe.paridad.total++;
    informe.paridad.tarjetas += lecturas[1].tarjetas.length;
    const distinto = diferencia(lecturas[0], lecturas[1]);
    if (!distinto) informe.paridad.iguales++;
    else {
      informe.paridad.diferencias.push({ fecha, idioma, zona, ...distinto });
      console.log('DIFERENCIA', JSON.stringify({ fecha, idioma, zona, ...distinto }).slice(0, 900));
    }
  });
  console.log(`Agenda igual: ${informe.paridad.iguales}/${informe.paridad.total} (${informe.paridad.tarjetas} tarjetas)`);
  guardar();
}

// Una sola disposición desde el primer pintado, sin saltos ni lecturas de Supabase al cargar.
if (!SOLO || SOLO === 'saltos') {
  const POSICION = `(() => { const lista = document.getElementById('raceList'); if (!lista) return null; return { cards: [...lista.querySelectorAll('.race-card')].map(c => Math.round(c.getBoundingClientRect().top + scrollY) + ':' + Math.round(c.getBoundingClientRect().height)).join(), barra: Math.round(document.getElementById('dateBar')?.getBoundingClientRect().height || 0), cargando: !!lista.querySelector('.loading'), oculta: lista.style.visibility === 'hidden', fecha: document.querySelector('.date-pill.active')?.dataset.dk || null, url: location.search }; })()`;
  const VIGIA = `(() => { window.__vistas = []; let ultimo = ''; const leer = () => { const v = ${POSICION}; if (v) { const t = JSON.stringify(v); if (t !== ultimo) { ultimo = t; window.__vistas.push({ t: Math.round(performance.now()), ...v }); } } requestAnimationFrame(leer); }; requestAnimationFrame(leer); })()`;
  const informeSaltos = informe.saltos = { total: 0, limpios: 0, sinDocumento: 0, mayor: 0, fallos: [] };
  const casos = FECHAS.flatMap(fecha => [['', 'Europe/Madrid', MOVIL, 'movil'], ['', 'Europe/Madrid', ESCRITORIO, 'escritorio'], ['en/', 'America/New_York', ESCRITORIO, 'escritorio'], ['', 'Asia/Tokyo', MOVIL, 'movil']].map(([idioma, zona, perfil, nombre]) => ({ fecha, idioma, zona, perfil, nombre })));
  const sinPintar = [];
  const medir = async caso => {
    const { fecha, idioma, zona, perfil, nombre, aParte = false } = caso;
    const tab = await pestaña(nav, perfil, zona);
    if (aParte) await tab.enviar('Page.bringToFront');
    await tab.enviar('Page.addScriptToEvaluateOnNewDocument', { source: VIGIA });
    await tab.ir(`${B}/${idioma}?date=${fecha}`, { espera: perfil === MOVIL ? 4000 : 2600 });
    // Fuera de la ventana o en la semana de Campeonatos no hay documento: la página lee datos.
    if (!await tab.valor(`document.getElementById('raceList')?.hasAttribute('data-sirve')`)) {
      informeSaltos.sinDocumento++;
      await tab.cerrar();
      return;
    }
    const m = await tab.valor('window.__m');
    const vistas = await tab.valor('window.__vistas');
    const fcp = m.fcp ?? 0;
    const pintadas = [vistas.filter(vista => vista.t <= fcp).at(-1), ...vistas.filter(vista => vista.t > fcp)].filter(Boolean);
    if (!pintadas.length && !aParte) {
      sinPintar.push({ ...caso, aParte: true });
      await tab.cerrar();
      return;
    }
    // Tarjetas que entran al final mientras llega el HTML no mueven nada: cuenta lo ya pintado.
    const final = pintadas.at(-1);
    const disposiciones = new Set(pintadas.map(vista => (vista.cards && final && final.cards.startsWith(vista.cards) ? final.cards : vista.cards) + '|' + vista.barra));
    const cargador = vistas.some(vista => vista.cargando);
    const saltos = Number(m.saltos.reduce((total, salto) => total + salto.v, 0).toFixed(4));
    const lecturas = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('supabase.co') || url.includes('/rest/v1/'));
    informeSaltos.total++;
    informeSaltos.mayor = Math.max(informeSaltos.mayor, saltos);
    // Lo que queda es el ancho del texto al llegar la fuente en una primera visita: sin efecto en vertical.
    if (disposiciones.size === 1 && !cargador && saltos <= 0.002 && !lecturas.length && !m.errores.length) informeSaltos.limpios++;
    else informeSaltos.fallos.push({ fecha, idioma, zona, nombre, disposiciones: disposiciones.size, cargador, saltos, fcp: Math.round(fcp), fuentes: m.saltos.flatMap(s => s.fuentes || []).slice(0, 4), recorrido: pintadas.slice(0, 3).map(v => ({ t: v.t, cards: v.cards.slice(0, 70), barra: v.barra, url: v.url })), lecturas: lecturas.slice(0, 2).map(u => u.slice(0, 90)), errores: m.errores.slice(0, 2) });
    await tab.cerrar();
  };
  await enParalelo(casos, medir);
  console.log(`Repetidos al frente: ${sinPintar.length}`);
  for (const caso of sinPintar) await medir(caso);
  console.log(`Sin saltos: ${informeSaltos.limpios}/${informeSaltos.total}, mayor ${informeSaltos.mayor}; sin documento: ${informeSaltos.sinDocumento}`);
  for (const fallo of informeSaltos.fallos.slice(0, 10)) console.log('  FALLO', JSON.stringify(fallo).slice(0, 700));
  guardar();
}

async function funcion(nombre, perfil, ruta, zona, cuerpo, pausa = 2500) {
  const tab = await pestaña(nav, perfil, zona);
  let ok = false;
  let detalle = null;
  try {
    await tab.ir(`${B}/${ruta}`, { espera: pausa });
    ({ ok, detalle } = await cuerpo(tab));
  } catch (error) {
    detalle = error.message;
  }
  // El fundido entre páginas se omite la primera vez que se carga otra hoja: no afecta al contenido.
  const errores = (await tab.valor('window.__m.errores').catch(() => [])).filter(error => !error.includes('ViewTransition opt-in disabled'));
  informe.funciones.push({ nombre, ok: ok && !errores.length, detalle, errores });
  console.log(`${ok && !errores.length ? 'correcto' : 'FALLO'}: ${nombre}${detalle ? ` (${JSON.stringify(detalle).slice(0, 240)})` : ''}${errores.length ? ` errores: ${errores.join(' | ').slice(0, 300)}` : ''}`);
  await tab.cerrar();
}
const clic = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
const estado = `(() => ({ url: location.pathname + location.search, activa: document.querySelector('.date-pill.active')?.dataset.dk, tarjetas: document.querySelectorAll('#raceList .race-card').length, cargando: !!document.querySelector('#raceList .loading') }))()`;
if (!SOLO || SOLO === 'funciones') {
  const D = '?date=2026-07-14';
  await funcion('Flecha al día siguiente con carreras', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    const antes = await tab.valor(estado);
    await tab.valor(clic('.date-week-arrow[data-direction="next"]'));
    await espera(1500);
    const despues = await tab.valor(estado);
    return { ok: despues.activa > antes.activa && despues.url.includes(despues.activa), detalle: { antes: antes.activa, despues: despues.activa } };
  });
  await funcion('Flecha al día anterior', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    const antes = await tab.valor(estado);
    await tab.valor(clic('.date-week-arrow[data-direction="prev"]'));
    await espera(1500);
    const despues = await tab.valor(estado);
    return { ok: despues.activa < antes.activa, detalle: { antes: antes.activa, despues: despues.activa } };
  });
  await funcion('Pastilla de otro día: el anterior sigue hasta que llega', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    await tab.valor(`window.__cargador = 0; new MutationObserver(() => { if (document.querySelector('#raceList .loading')) window.__cargador++; }).observe(document.getElementById('raceList'), { childList: true }); true`);
    await tab.valor(clic('.date-pill:last-child'));
    await espera(1500);
    const despues = await tab.valor(estado);
    return { ok: despues.tarjetas > 0 && await tab.valor('window.__cargador') === 0, detalle: despues };
  });
  await funcion('Botón Hoy', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    await tab.valor(clic('.date-today-btn'));
    await espera(2000);
    const despues = await tab.valor(estado);
    return { ok: despues.activa !== '2026-07-14', detalle: despues };
  });
  await funcion('Tarjeta con página abre su jornada', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    const destino = await tab.valor(`document.querySelector('.race-card[data-href]')?.dataset.href`);
    await tab.valor(clic('.race-card[data-href] .race-card__main'));
    await espera(1500);
    return { ok: !!destino && decodeURI(await tab.valor('location.pathname')).startsWith(destino.split('?')[0]), detalle: destino };
  });
  await funcion('Tarjeta con teclado', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    const destino = await tab.valor(`document.querySelector('.race-card[data-href]')?.dataset.href`);
    await tab.valor(`(() => { const c = document.querySelector('.race-card[data-href]'); c.focus(); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await espera(1500);
    return { ok: decodeURI(await tab.valor('location.pathname')).startsWith(destino.split('?')[0]), detalle: destino };
  });
  await funcion('Resultados abre la página de la etapa', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    const pulsado = await tab.valor(clic('.badge--results'));
    await espera(2000);
    const ruta = decodeURI(await tab.valor('location.pathname'));
    return { ok: pulsado && ruta.startsWith('/resultados/'), detalle: ruta };
  });
  await funcion('Filtro de categoría', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    const antes = await tab.valor(estado);
    await tab.valor(clic('.tcat-btn[data-cat="uwt"]'));
    await espera(1500);
    const despues = await tab.valor(estado);
    return { ok: await tab.valor(`document.querySelector('.tcat-btn[data-cat="uwt"]').getAttribute('aria-pressed') === 'true'`), detalle: { antes: antes.tarjetas, despues: despues.tarjetas, activa: despues.activa } };
  });
  await funcion('Ordenar por Hora TV', ESCRITORIO, D, 'Europe/Madrid', async tab => {
    await tab.valor(`(() => { const s = document.getElementById('agendaSortSelect'); s.value = 'tvtime'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await espera(1500);
    const despues = await tab.valor(estado);
    return { ok: despues.tarjetas > 0, detalle: despues.tarjetas };
  });
  await funcion('Deslizar en móvil no rompe la lista', MOVIL, D, 'Europe/Madrid', async tab => {
    return { ok: (await tab.valor(estado)).tarjetas > 0 };
  }, 4000);
}
guardar();
hijo.kill();
process.exit(0);
