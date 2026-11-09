#!/usr/bin/env node
// Mide la web actual (producción y copia local) frente al prototipo con Chrome sin
// interfaz: móvil en «Slow 4G» y CPU ×4 (método de
// docs/informes/estudio-prerender-paginas-20261021.md) y escritorio sin limitar.
// Nunca usa el navegador de Dani ni escribe en la base de datos.
//
//   node tools/publicacion/medir.mjs --trabajo <dir> [--tanda humo|completa] [--repeticiones 5] [--chrome <ruta>]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { montar, publicarPortada, simular, todasLasEntradas } from './publicacion.mjs';
import { certificado, crearServidor } from './servidor.mjs';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGEN = 'https://calendariociclismo.app';
const PUERTO_B = 8801;
const PUERTO_ESPEJO = 8802;
const PUERTO_HIBRIDO = 8803;
const SISTEMAS = {
  produccion: ORIGEN,
  espejo: `https://localhost:${PUERTO_ESPEJO}`,
  prototipo: `https://localhost:${PUERTO_B}`,
  hibrido: `https://localhost:${PUERTO_HIBRIDO}`,
};
export const MOVIL = {
  metricas: { width: 412, height: 823, deviceScaleFactor: 2.625, mobile: true },
  agente: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  red: { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 },
  cpu: 4,
};
export const ESCRITORIO = { metricas: { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, agente: null, red: null, cpu: 1 };

const OBSERVADOR = `(() => {
  const m = window.__m = { saltos: [], lcp: [], fcp: null, largas: [], contenido: null, cortina: null, perfil: null, reemplazos: 0, errores: [] };
  addEventListener('error', e => m.errores.push(String(e.message)));
  addEventListener('unhandledrejection', e => m.errores.push(String(e.reason)));
  try { localStorage.setItem('cc-cookie-consent', JSON.stringify({ v: 1, choice: 'rejected', decidedAt: Date.now(), expiresAt: Date.now() + 1e10 })); } catch {}
  const nodo = n => { if (!n || !n.nodeName) return '?'; const c = n.classList && n.classList[0]; return n.nodeName.toLowerCase() + (n.id ? '#' + n.id : '') + (c ? '.' + c : ''); };
  new PerformanceObserver(l => { for (const e of l.getEntries()) m.saltos.push({ t: e.startTime, v: e.value, entrada: e.hadRecentInput, fuentes: (e.sources || []).map(s => nodo(s.node)) }); }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) m.lcp.push({ t: e.startTime, el: nodo(e.element), url: (e.url || '').slice(-40) }); }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) m.largas.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  // Salto visual: la API de CLS solo cuenta nodos que ya existían, y un repintado por
  // innerHTML los sustituye. Aquí cada sección se sigue por su clase, no por su nodo:
  // cuenta lo que ve el visitante aunque el nodo sea otro.
  m.visualEventos = [];
  m.capaFuera = null;
  // El JS terminó de confirmar la página: retira la marca de la huella.
  m.cliente = null;
  let conHuella = false;
  let posiciones = new Map();
  const leerPosiciones = () => {
    const salida = new Map();
    const vistos = {};
    const main = document.querySelector('main');
    const elementos = [...(main ? main.children : []), document.querySelector('footer.site-footer')].filter(Boolean);
    for (const el of elementos) {
      if (el.tagName === 'TEMPLATE' || el.tagName === 'SCRIPT') continue;
      const nombre = el.tagName + '.' + [...el.classList].join('.');
      vistos[nombre] = (vistos[nombre] || 0) + 1;
      const caja = el.getBoundingClientRect();
      salida.set(nombre + '#' + vistos[nombre], { y: caja.top + scrollY, alto: caja.height });
    }
    return salida;
  };
  const vigia = () => {
    const marca = document.querySelector('main')?.hasAttribute('data-prerendered');
    if (marca) conHuella = true;
    else if (conHuella && !m.cliente) m.cliente = performance.now();
    const tapada = document.documentElement.classList.contains('cc-booting') || document.querySelector('.page-loading:not(.page-loading--hide)');
    if (!tapada && document.body) {
      if (!m.capaFuera) m.capaFuera = performance.now();
      const actuales = leerPosiciones();
      for (const [clave, { y }] of actuales) {
        const previa = posiciones.get(clave);
        if (!previa || Math.abs(previa.y - y) <= 1) continue;
        const enPantalla = previa.y < scrollY + innerHeight && previa.y + previa.alto > scrollY;
        if (enPantalla) m.visualEventos.push({ t: performance.now(), clave, px: Math.round(y - previa.y) });
      }
      posiciones = actuales;
    }
    if (performance.now() < 9000) requestAnimationFrame(vigia);
  };
  requestAnimationFrame(vigia);
  const tic = () => {
    const main = document.querySelector('main');
    const capa = document.querySelector('.page-loading:not(.page-loading--hide)');
    const cortina = document.documentElement.classList.contains('cc-booting');
    if (!m.cortina && !cortina && document.body) m.cortina = performance.now();
    if (!m.contenido && main && main.querySelector('.route-grid,.race-header,.stage-nav,.race-card,.feed-row,.t-race,.uci-ranking-row') && !capa && !cortina && getComputedStyle(main.querySelector('.route-grid,.race-header,.stage-nav,.race-card,.feed-row,.t-race,.uci-ranking-row')).visibility === 'visible') m.contenido = performance.now();
    if (!m.perfil && main && main.querySelector('.stage-profile-graphic svg, .stage-profile-graphic img, .stage-profile-graphic iframe')) m.perfil = performance.now();
    if (!m.contenido || (!m.perfil && performance.now() < 15000)) requestAnimationFrame(tic);
  };
  requestAnimationFrame(tic);
  document.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main');
    if (main) new MutationObserver(l => { for (const r of l) m.reemplazos += r.addedNodes.length; }).observe(main, { childList: true });
  });
})();`;

class Navegador {
  constructor(socket) {
    this.socket = socket;
    this.secuencia = 0;
    this.pendientes = new Map();
    this.oyentes = new Set();
    socket.addEventListener('message', ({ data }) => {
      const mensaje = JSON.parse(data);
      if (mensaje.id && this.pendientes.has(mensaje.id)) {
        const { done, fail } = this.pendientes.get(mensaje.id);
        this.pendientes.delete(mensaje.id);
        if (mensaje.error) fail(new Error(`${mensaje.error.message}`));
        else done(mensaje.result);
      } else if (mensaje.method) for (const oyente of this.oyentes) oyente(mensaje);
    });
  }
  enviar(method, params = {}, sessionId) {
    return new Promise((done, fail) => {
      const id = ++this.secuencia;
      this.pendientes.set(id, { done, fail });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

export async function abrirChrome(ruta, perfil) {
  rmSync(perfil, { recursive: true, force: true });
  mkdirSync(perfil, { recursive: true });
  const hijo = spawn(ruta, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`, '--ignore-certificate-errors',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--disable-component-update', 'about:blank'], { stdio: 'ignore' });
  const archivo = join(perfil, 'DevToolsActivePort');
  for (let intento = 0; !existsSync(archivo) || !readFileSync(archivo, 'utf8').includes('\n'); intento++) {
    if (intento > 150) throw new Error('Chrome no abrió el puerto de depuración');
    await new Promise(done => setTimeout(done, 100));
  }
  const [puerto, ruta2] = readFileSync(archivo, 'utf8').split('\n');
  const socket = new WebSocket(`ws://127.0.0.1:${puerto}${ruta2}`);
  await new Promise(done => socket.addEventListener('open', done, { once: true }));
  return { hijo, nav: new Navegador(socket) };
}

function claseCls(saltos) {
  let maximo = 0;
  let ventana = 0;
  let inicio = 0;
  let previo = -Infinity;
  for (const salto of saltos.filter(s => !s.entrada)) {
    if (salto.t - previo > 1000 || salto.t - inicio > 5000) { ventana = 0; inicio = salto.t; }
    ventana += salto.v;
    previo = salto.t;
    maximo = Math.max(maximo, ventana);
  }
  return maximo;
}

// Un corredor más en el equipo del primero, el mismo en el navegador y en el servidor.
export function filasConCorredor(filas) {
  const modelo = filas[0];
  return [{ ...modelo, id: '00-prototipo', dorsal: 0, firstName: 'Corredor', lastName: 'De Prueba', globalRiderId: null }, ...filas];
}

const CAMBIOS_DE_JORNADA = {
  cancelada: { isCancelledDay: true },
  sinperfil: { elevationProfile: null, profileSummits: null, profileWaypoints: null, routeGpxUrl: null, profileNotViewable: true },
};

function inyectarCambio(url, filas, cambio) {
  if (CAMBIOS_DE_JORNADA[cambio]) {
    // La lectura de la jornada, por id y con la carrera embebida; no la de sus hermanas.
    if (!url.includes('/rest/v1/race_days') || !/[?&]id=eq\./.test(url) || !url.includes('race%3Araces') && !url.includes('race:races')) return filas;
    if (Array.isArray(filas)) return filas.map(fila => ({ ...fila, ...CAMBIOS_DE_JORNADA[cambio] }));
    return filas && { ...filas, ...CAMBIOS_DE_JORNADA[cambio] };
  }
  if (!Array.isArray(filas)) return filas;
  if (cambio === 'corredor') return url.includes('/rest/v1/startlist_riders_resolved') ? filasConCorredor(filas) : filas;
  const dia = /raceDayId=eq\.([^&]+)/.exec(url)?.[1];
  if (!dia) return filas;
  if (cambio === 'tv' && url.includes('/rest/v1/broadcasts')) {
    return [{ id: 'zz-prototipo', raceDayId: dia, channel: 'Canal de prueba', country: 'ALL', url: 'https://example.com/directo', startTimeUtc: filas[0]?.startTimeUtc || null, sortOrder: -1, embeddable: false, note: null, showInRevive: true }, ...filas];
  }
  if (cambio === 'documento' && url.includes('/rest/v1/assets') && !url.includes('type=')) {
    return [...filas, { id: 'zz-prototipo', raceDayId: dia, type: 'roadbook', url: 'https://assets.calendariociclismo.app/og/calendario-ciclismo.jpg', filePath: null }];
  }
  return filas;
}

export async function pestaña(nav, perfil, zona, { desfase = null } = {}) {
  const { browserContextId } = await nav.enviar('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await nav.enviar('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await nav.enviar('Target.attachToTarget', { targetId, flatten: true });
  const enviar = (method, params) => nav.enviar(method, params, sessionId);
  for (const dominio of ['Page', 'Runtime', 'Network']) await enviar(`${dominio}.enable`);
  await enviar('Emulation.setDeviceMetricsOverride', perfil.metricas);
  await enviar('Emulation.setTouchEmulationEnabled', { enabled: perfil.metricas.mobile, maxTouchPoints: 5 });
  if (perfil.agente) await enviar('Emulation.setUserAgentOverride', { userAgent: perfil.agente });
  await enviar('Emulation.setTimezoneOverride', { timezoneId: zona });
  await enviar('Emulation.setLocaleOverride', { locale: 'es-ES' });
  if (perfil.red) await enviar('Network.emulateNetworkConditions', perfil.red);
  if (perfil.cpu > 1) await enviar('Emulation.setCPUThrottlingRate', { rate: perfil.cpu });
  await enviar('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVADOR });
  const peticiones = new Map();
  const oyente = mensaje => {
    if (mensaje.sessionId !== sessionId) return;
    const p = mensaje.params;
    if (mensaje.method === 'Network.requestWillBeSent') {
      peticiones.set(p.requestId, { url: p.request.url, tipo: p.type, bytes: 0, fin: false, cacheada: false });
    } else if (mensaje.method === 'Network.requestServedFromCache' && peticiones.has(p.requestId)) {
      peticiones.get(p.requestId).cacheada = true;
    } else if (mensaje.method === 'Network.responseReceived' && peticiones.has(p.requestId)) {
      const r = peticiones.get(p.requestId);
      r.tipo = p.type;
      r.estado = p.response.status;
      r.delCache = p.response.fromDiskCache;
    } else if (mensaje.method === 'Network.loadingFinished' && peticiones.has(p.requestId)) {
      const r = peticiones.get(p.requestId);
      r.bytes = p.encodedDataLength;
      r.fin = true;
    } else if (mensaje.method === 'Network.loadingFailed' && peticiones.has(p.requestId)) {
      peticiones.get(p.requestId).fin = true;
    } else if (mensaje.method === 'Fetch.requestPaused') {
      void (async () => {
        try {
          const { body, base64Encoded } = await enviar('Fetch.getResponseBody', { requestId: p.requestId });
          const texto = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
          const cuerpo = JSON.stringify(inyectarCambio(p.request.url, JSON.parse(texto), desfase));
          await enviar('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode, responseHeaders: p.responseHeaders.filter(h => !/^content-(encoding|length)$/i.test(h.name)), body: Buffer.from(cuerpo).toString('base64') });
        } catch { await enviar('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); }
      })();
    }
  };
  nav.oyentes.add(oyente);
  if (desfase) {
    await enviar('Fetch.enable', { patterns: ['broadcasts', 'assets', 'startlist_riders_resolved', 'race_days'].map(tabla => ({ urlPattern: `*/rest/v1/${tabla}*`, requestStage: 'Response' })) });
  }
  return {
    enviar, peticiones,
    async ir(url, { espera = 3000, maximo = 30000 } = {}) {
      peticiones.clear();
      const carga = new Promise(done => {
        const fin = mensaje => { if (mensaje.sessionId === sessionId && mensaje.method === 'Page.loadEventFired') { nav.oyentes.delete(fin); done(); } };
        nav.oyentes.add(fin);
      });
      await enviar('Page.navigate', { url });
      await Promise.race([carga, new Promise(done => setTimeout(done, maximo))]);
      const inicio = Date.now();
      await new Promise(done => setTimeout(done, espera));
      while (Date.now() - inicio < maximo && [...peticiones.values()].some(r => !r.fin)) await new Promise(done => setTimeout(done, 200));
      await new Promise(done => setTimeout(done, 500));
    },
    async valor(expresion) {
      const { result, exceptionDetails } = await enviar('Runtime.evaluate', { expression: expresion, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.text);
      return result.value;
    },
    async cerrar() {
      nav.oyentes.delete(oyente);
      await nav.enviar('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    },
  };
}

function resumen(medida, peticiones) {
  const filas = [...peticiones.values()];
  const host = url => { try { return new URL(url).hostname; } catch { return '?'; } };
  const bytesDe = filtro => filas.filter(filtro).reduce((sum, r) => sum + (r.bytes || 0), 0);
  const fuentes = {};
  for (const salto of medida.saltos.filter(s => !s.entrada)) for (const fuente of salto.fuentes) fuentes[fuente] = Math.round(((fuentes[fuente] || 0) + salto.v) * 1e4) / 1e4;
  return {
    contenido: medida.contenido ?? medida.capaFuera, cortina: medida.cortina, fcp: medida.fcp, cliente: medida.cliente,
    visualPx: Math.max(0, ...medida.visualEventos.map(evento => Math.abs(evento.px))), visualEventos: medida.visualEventos.length,
    visualMuestra: medida.visualEventos.slice(0, 6), lcp: medida.lcp.at(-1)?.t ?? null, lcpEl: medida.lcp.at(-1)?.el ?? null,
    perfil: medida.perfil, cls: claseCls(medida.saltos), fuentes, tbt: medida.largas.reduce((sum, d) => sum + Math.max(0, d - 50), 0),
    peticiones: filas.length, supabase: filas.filter(r => host(r.url).endsWith('supabase.co')).length,
    bytes: bytesDe(() => true), bytesJs: bytesDe(r => r.tipo === 'Script'), bytesCss: bytesDe(r => r.tipo === 'Stylesheet'), bytesHtml: bytesDe(r => r.tipo === 'Document'),
    bytesSupabase: bytesDe(r => host(r.url).endsWith('supabase.co')), reemplazos: medida.reemplazos, errores: medida.errores,
  };
}

const mediana = valores => {
  const orden = valores.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  return orden.length ? orden[Math.floor(orden.length / 2)] : null;
};

function agregar(corridas) {
  const salida = { n: corridas.length };
  for (const clave of ['cliente', 'visualPx', 'visualEventos', 'contenido', 'cortina', 'fcp', 'lcp', 'perfil', 'cls', 'tbt', 'peticiones', 'supabase', 'bytes', 'bytesJs', 'bytesCss', 'bytesHtml', 'bytesSupabase', 'reemplazos']) {
    salida[clave] = mediana(corridas.map(corrida => corrida[clave]));
  }
  salida.clsMax = Math.max(...corridas.map(corrida => corrida.cls));
  salida.visualMuestra = corridas.reduce((mejor, corrida) => (corrida.visualPx >= (mejor.visualPx ?? -1) ? corrida : mejor), {}).visualMuestra;
  salida.lcpEl = corridas.at(-1)?.lcpEl;
  salida.fuentes = corridas.reduce((mejor, corrida) => (corrida.cls >= (mejor.cls ?? -1) ? corrida : mejor), {}).fuentes;
  salida.errores = [...new Set(corridas.flatMap(corrida => corrida.errores))].slice(0, 5);
  return salida;
}

const P = {
  giro: 'jornada/giro-de-italia-2026-etapa-10/',
  tour: 'jornada/tour-de-francia-2026-etapa-21/',
  mundial: 'jornada/campeonato-del-mundo-linea-masculino-2026/',
  tour27: 'jornada/tour-de-francia-2027-etapa-16/',
  giroEn: 'en/stage/giro-ditalia-2026-stage-10/',
};

function argumentos(argv) {
  const opciones = {};
  for (let at = 0; at < argv.length; at++) if (argv[at].startsWith('--')) opciones[argv[at].slice(2)] = argv[++at];
  return opciones;
}

async function principal() {
  const opciones = argumentos(process.argv.slice(2));
  const trabajo = opciones.trabajo;
  const tanda = opciones.tanda || 'humo';
  const repeticiones = Number(opciones.repeticiones || (tanda === 'humo' ? 1 : 5));
  const { datos, inscritos, portada, publicador, salida: arbol } = await montar(trabajo);
  const hibrido = await montar(trabajo, join(trabajo, 'arbol-hibrido'), { modoJornada: 'hibrido' });
  const entradas = datos.carreras().flatMap(raceId => datos.entradas(raceId));
  const porSlug = new Map(entradas.flatMap(input => [[input.rd.slug, input], [input.rd.slugEn, input]]));
  const publicacion = await publicador.publicar(todasLasEntradas(datos, inscritos), { forzar: true });
  await hibrido.publicador.publicar(todasLasEntradas(datos, inscritos), { forzar: true });
  const fasePortada = await publicarPortada(publicador, portada, { forzar: true });
  if (fasePortada?.errores.length) throw new Error(`Portada: ${fasePortada.errores.join(' | ')}`);
  const tls = certificado(join(trabajo, 'tls'));
  // Fastly responde a 8 ms y el VPS a 45 ms desde aquí (medido el 2026-11-04). El
  // retardo añade la diferencia al prototipo: 37 ms por petición y dos idas y
  // vueltas de 37 ms más en la conexión nueva.
  const servidores = [
    await crearServidor({ puerto: PUERTO_B, tls, raiz: arbol, espejo: { origen: ORIGEN, cache: join(trabajo, 'espejo') }, rtt: 37, tlsMs: 74 }),
    await crearServidor({ puerto: PUERTO_HIBRIDO, tls, raiz: hibrido.salida, espejo: { origen: ORIGEN, cache: join(trabajo, 'espejo') }, rtt: 37, tlsMs: 74 }),
    await crearServidor({ puerto: PUERTO_ESPEJO, tls, espejo: { origen: ORIGEN, cache: join(trabajo, 'espejo') } }),
  ];
  const { hijo, nav } = await abrirChrome(opciones.chrome || CHROME, join(trabajo, 'chrome'));
  const capturas = join(trabajo, 'capturas');
  mkdirSync(capturas, { recursive: true });
  const resultados = { fecha: new Date().toISOString(), publicacion, escenarios: [] };
  const destino = join(trabajo, `medidas-${tanda}${opciones.etiqueta ? `-${opciones.etiqueta}` : ''}.json`);

  async function carga({ id, sistema, ruta, perfil, zona, desfase = null, captura = false, sinComprobar = false }) {
    const corridas = [];
    for (let vez = 0; vez < repeticiones; vez++) {
      const tab = await pestaña(nav, perfil, zona, { desfase: sistema !== 'prototipo' ? desfase : null });
      await tab.ir(`${SISTEMAS[sistema]}/${ruta}`);
      if (!sinComprobar && !await tab.valor(`!!document.querySelector('main .race-header, main .route-grid')`)) throw new Error(`${id}: la página no cargó el contenido`);
      const medida = await tab.valor('window.__m');
      corridas.push(resumen(medida, tab.peticiones));
      if (captura && vez === repeticiones - 1) {
        // Ventana del alto de la página: con captureBeyondViewport, la barra fija
        // de móvil quedaría a media imagen, al pie de la primera pantalla.
        const alto = await tab.valor('document.documentElement.scrollHeight');
        await tab.enviar('Emulation.setDeviceMetricsOverride', { ...perfil.metricas, height: alto });
        await new Promise(done => setTimeout(done, 400));
        const { data } = await tab.enviar('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(capturas, `${id}.png`), Buffer.from(data, 'base64'));
      }
      await tab.cerrar();
    }
    const fila = { id, sistema, ruta, ...agregar(corridas) };
    resultados.escenarios.push(fila);
    writeFileSync(destino, JSON.stringify(resultados, null, 1));
    const f = v => (v == null ? '-' : Math.round(v));
    console.log(`${id.padEnd(44)} contenido ${String(f(fila.contenido)).padStart(5)} lcp ${String(f(fila.lcp)).padStart(5)} perfil ${String(f(fila.perfil)).padStart(5)} cliente ${String(f(fila.cliente)).padStart(5)} cls ${fila.cls.toFixed(4)} (máx ${fila.clsMax.toFixed(4)}) salto ${String(fila.visualPx).padStart(4)}px tbt ${String(f(fila.tbt)).padStart(4)} pet ${String(fila.peticiones).padStart(3)} sb ${String(fila.supabase).padStart(2)} KB ${String(Math.round(fila.bytes / 1024)).padStart(5)} js ${String(Math.round(fila.bytesJs / 1024)).padStart(4)} err ${fila.errores.length}`);
    return fila;
  }

  const desdeSlug = ruta => ruta.split('/').filter(Boolean).at(-1);

  // Pestaña abierta: el cambio llega por la versión y se aplica sin mover nada.
  async function medirVivo() {
    resultados.vivo = [];
    for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour27: P.tour27 })) {
      for (const cambio of ['hora', 'tv', 'documento']) {
        for (let vez = 0; vez < 3; vez++) {
          const input = porSlug.get(desdeSlug(ruta));
          const tab = await pestaña(nav, MOVIL, 'Europe/Madrid');
          await tab.ir(`${SISTEMAS.prototipo}/${ruta}?vivo=2`);
          const saltosAntes = (await tab.valor('window.__m.saltos')).length;
          const version = await tab.valor('document.querySelector(\'meta[name="cc:v"]\').content');
          const t0 = Date.now();
          const fase = await publicador.publicar([input], { transformar: entrada => simular(cambio, entrada) });
          const publicado = Date.now();
          let visto = null;
          while (Date.now() - t0 < 12000) {
            const actual = await tab.valor('document.querySelector(\'meta[name="cc:v"]\').content');
            if (actual !== version) { visto = Date.now(); break; }
            await new Promise(done => setTimeout(done, 100));
          }
          await new Promise(done => setTimeout(done, 1000));
          const pendientes = await tab.valor('window.ccVivo?.pendientes ?? null');
          const saltos = (await tab.valor('window.__m.saltos')).slice(saltosAntes);
          // Con la interacción se aplica lo que esperaba.
          await tab.enviar('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
          await tab.enviar('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
          await new Promise(done => setTimeout(done, 400));
          const tieneCambio = await tab.valor(`document.getElementById('jornadaContent').textContent.includes('Canal de prueba') || !!document.querySelector('.asset-btn[href*="calendario-ciclismo.jpg"]')`);
          const errores = await tab.valor('window.__m.errores');
          resultados.vivo.push({ nombre, cambio, publicarMs: publicado - t0, paginas: fase.paginas, vistoMs: visto ? visto - t0 : null, pendientes, saltos: saltos.filter(s => !s.entrada).length, valor: saltos.filter(s => !s.entrada).reduce((sum, s) => sum + s.v, 0), fuentes: saltos.flatMap(s => s.fuentes), tieneCambio, errores });
          console.log('vivo', JSON.stringify(resultados.vivo.at(-1)));
          writeFileSync(destino, JSON.stringify(resultados, null, 1));
          await tab.cerrar();
          await publicador.publicar([input]);
        }
      }
    }
  }

  if (tanda === 'portada') {
    // Portada y agenda: producción frente al prototipo, con el retardo del VPS emulado.
    if (opciones.vps) SISTEMAS.vps = opciones.vps;
    const sistemas = ['produccion', 'prototipo', ...(opciones.vps ? ['vps'] : [])];
    for (const [nombre, ruta, zona, perfil] of [
      ['movil-portada', '', 'Europe/Madrid', MOVIL], ['escritorio-portada', '', 'Europe/Madrid', ESCRITORIO],
      ['movil-agenda', 'ciclocross/', 'Europe/Madrid', MOVIL], ['movil-portada-en', 'en/', 'Europe/London', MOVIL],
      ['movil-portada-bogota', '', 'America/Bogota', MOVIL], ['movil-portada-tokio', '', 'Asia/Tokyo', MOVIL],
    ]) {
      for (const sistema of sistemas) await carga({ id: `${nombre}-${sistema}`, sistema, ruta, perfil, zona, sinComprobar: true, captura: sistema !== 'produccion' });
    }
  } else if (tanda === 'cabecera') {
    // Páginas de cabecera: producción frente al VPS, varias cargas.
    SISTEMAS.vps = opciones.vps;
    for (let ronda = 1; ronda <= 3; ronda++) {
      for (const [nombre, ruta, zona, perfil] of [
        ['movil-resultados', 'resultados/', 'Europe/Madrid', MOVIL], ['movil-resultados-en', 'en/results/', 'Europe/London', MOVIL],
        ['movil-calendario', 'calendario/', 'Europe/Madrid', MOVIL], ['movil-calendario-en', 'en/calendar/', 'Europe/London', MOVIL],
        ['movil-portada', '', 'Europe/Madrid', MOVIL], ['escritorio-resultados', 'resultados/', 'Europe/Madrid', ESCRITORIO],
        ['escritorio-calendario', 'calendario/', 'Europe/Madrid', ESCRITORIO],
      ]) {
        for (const sistema of ['produccion', 'vps']) await carga({ id: `r${ronda}-${nombre}-${sistema}`, sistema, ruta, perfil, zona, sinComprobar: true });
      }
    }
  } else if (tanda === 'vps') {
    // Prototipo servido de verdad desde el VPS frente a producción, en la misma tanda.
    SISTEMAS.vps = opciones.vps;
    for (let ronda = 1; ronda <= 2; ronda++) {
      for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour: P.tour, tour27: P.tour27, inscritos: 'inscritos/giro-de-italia-2026/' })) {
        for (const sistema of ['produccion', 'vps']) await carga({ id: `vps-r${ronda}-movil-${sistema}-${nombre}`, sistema, ruta, perfil: MOVIL, zona: 'Europe/Madrid' });
      }
    }
    for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour27: P.tour27 })) {
      for (const sistema of ['produccion', 'vps']) await carga({ id: `vps-escritorio-${sistema}-${nombre}`, sistema, ruta, perfil: ESCRITORIO, zona: 'Europe/Madrid' });
    }
  } else if (tanda === 'precargas') {
    // Producción antes y después de cambiar las precargas: --etiqueta las distingue.
    const etiqueta = opciones.etiqueta || 'antes';
    for (const [nombre, ruta] of Object.entries({
      inscritosGiro: 'inscritos/giro-de-italia-2026/', inscritosTour: 'inscritos/tour-de-francia-2026/',
      startlistGiro: 'en/startlist/giro-ditalia-2026/', startlistTour: 'en/startlist/tour-de-france-2026/',
      jornadaGiro: P.giro, jornadaTour: P.tour,
    })) await carga({ id: `precargas-${etiqueta}-${nombre}`, sistema: 'produccion', ruta, perfil: MOVIL, zona: 'Europe/Madrid' });
  } else if (tanda === 'vivo') {
    await medirVivo();
  } else if (tanda === 'atajos') {
    // Mejoras que no exigen migrar: la página y el JS de hoy, sin la cortina o sin las
    // precargas de módulos que compiten con el CSS.
    const base = hibrido.publicador.activos.hibrido;
    const temaSinCortina = publicador.activos.tema;
    const variantes = {
      base: shell => shell,
      sinCortina: shell => ({ ...shell, tema: temaSinCortina }),
      sinPrecargas: shell => ({ ...shell, precargas: '' }),
      sinAmbas: shell => ({ ...shell, tema: temaSinCortina, precargas: '' }),
    };
    const lista = inscritos.entradas(inscritos.carreras().find(raceId => inscritos.entradas(raceId)[0].race.slug === 'giro-de-italia-2026'))[0];
    const entradasAtajo = [porSlug.get(desdeSlug(P.giro)), lista];
    for (const [nombre, variante] of Object.entries(variantes)) {
      hibrido.publicador.activos.hibrido = Object.fromEntries(Object.entries(base).map(([familia, shell]) => [familia, variante(shell)]));
      await hibrido.publicador.publicar(entradasAtajo, { forzar: true });
      await carga({ id: `movil-atajo-${nombre}-giro`, sistema: 'hibrido', ruta: P.giro, perfil: MOVIL, zona: 'Europe/Madrid', captura: nombre === 'sinAmbas' });
      await carga({ id: `movil-atajo-${nombre}-inscritos`, sistema: 'hibrido', ruta: 'inscritos/giro-de-italia-2026/', perfil: MOVIL, zona: 'Europe/Madrid' });
    }
  } else if (tanda === 'panorama') {
    // CLS y contenido visible de la web actual por tipo de página, en producción.
    for (const [nombre, ruta] of Object.entries({
      portada: '', portadaEn: 'en/', calendario: 'calendario/', agendaCx: 'ciclocross/', feedResultados: 'resultados/', fichajes: 'fichajes/',
      competicion: 'competicion/giro-de-italia-2026/', jornada: P.giro, inscritos: 'inscritos/giro-de-italia-2026/',
      resultados: 'resultados/giro-de-italia-2026/etapa-10/', resultadosEn: 'en/results/giro-ditalia-2026/stage-10/',
      perfil: 'perfil/giro-de-italia-2026-etapa-10/', mapa: 'mapa/tour-de-francia-2026-etapa-10/', ordenSalida: 'orden-salida/giro-de-italia-2026-etapa-10/',
      cxCarrera: 'ciclocross/hg-cross-dendermonde-2026/', cxResultados: 'ciclocross/hg-cross-dendermonde-2026/resultados/', cxTorneo: 'ciclocross/torneos/hg-cross-2026-27/',
    })) await carga({ id: `panorama-${nombre}`, sistema: 'produccion', ruta, perfil: MOVIL, zona: 'Europe/Madrid', sinComprobar: true });
  } else if (tanda === 'peor') {
    // Peor caso real: jornada cancelada a última hora y perfil que desaparece.
    for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour27: P.tour27 })) {
      const input = porSlug.get(desdeSlug(ruta));
      await carga({ id: `escritorio-vigente-produccion-${nombre}`, sistema: 'produccion', ruta, perfil: ESCRITORIO, zona: 'Europe/Madrid' });
      for (const [cambio, dispositivos] of [['cancelada', ['movil', 'escritorio']], ['sinperfil', ['movil', 'escritorio']], ['tv', ['movil']], ['documento', ['movil']]]) {
        for (const dispositivo of dispositivos) {
          const perfil = dispositivo === 'movil' ? MOVIL : ESCRITORIO;
          await carga({ id: `${dispositivo}-${cambio}-espejo-${nombre}`, sistema: 'espejo', ruta, perfil, zona: 'Europe/Madrid', desfase: cambio, captura: true });
          await publicador.publicar([input], { transformar: entrada => simular(cambio, entrada) });
          await hibrido.publicador.publicar([input], { transformar: entrada => simular(cambio, entrada) });
          await carga({ id: `${dispositivo}-${cambio}-hibrido-${nombre}`, sistema: 'hibrido', ruta, perfil, zona: 'Europe/Madrid', desfase: cambio, captura: true });
          await carga({ id: `${dispositivo}-${cambio}-prototipo-${nombre}`, sistema: 'prototipo', ruta, perfil, zona: 'Europe/Madrid', captura: true });
          await publicador.publicar([input]);
          await hibrido.publicador.publicar([input]);
        }
      }
    }
    const INSCRITOS = 'inscritos/giro-de-italia-2026/';
    const lista = inscritos.entradas(inscritos.carreras().find(raceId => inscritos.entradas(raceId)[0].race.slug === 'giro-de-italia-2026'))[0];
    await carga({ id: 'movil-corredor-espejo-inscritos', sistema: 'espejo', ruta: INSCRITOS, perfil: MOVIL, zona: 'Europe/Madrid', desfase: 'corredor', captura: true });
    await hibrido.publicador.publicar([lista], { transformar: entrada => ({ ...entrada, rows: { ...entrada.rows, riders: filasConCorredor(entrada.rows.riders) } }) });
    await carga({ id: 'movil-corredor-hibrido-inscritos', sistema: 'hibrido', ruta: INSCRITOS, perfil: MOVIL, zona: 'Europe/Madrid', desfase: 'corredor', captura: true });
    await hibrido.publicador.publicar([lista]);
  } else if (tanda === 'humo') {
    for (const sistema of ['espejo', 'hibrido', 'prototipo']) {
      await carga({ id: `movil-${sistema}-giro`, sistema, ruta: P.giro, perfil: MOVIL, zona: 'Europe/Madrid', captura: true });
      await carga({ id: `escritorio-${sistema}-giro`, sistema, ruta: P.giro, perfil: ESCRITORIO, zona: 'Europe/Madrid', captura: true });
      await carga({ id: `bogota-${sistema}-mundial`, sistema, ruta: P.mundial, perfil: MOVIL, zona: 'America/Bogota', captura: true });
      await carga({ id: `escritorio-${sistema}-en-giro`, sistema, ruta: P.giroEn, perfil: ESCRITORIO, zona: 'Etc/GMT', captura: true });
    }
    for (const sistema of ['espejo', 'hibrido']) await carga({ id: `movil-${sistema}-inscritos`, sistema, ruta: 'inscritos/giro-de-italia-2026/', perfil: MOVIL, zona: 'Europe/Madrid', captura: true });
  } else {
    // 1. Datos vigentes, móvil en Madrid.
    for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour: P.tour, mundial: P.mundial, tour27: P.tour27 })) {
      for (const sistema of ['produccion', 'espejo', 'hibrido', 'prototipo']) await carga({ id: `movil-vigente-${sistema}-${nombre}`, sistema, ruta, perfil: MOVIL, zona: 'Europe/Madrid', captura: sistema !== 'produccion' });
    }
    // 2. Escritorio.
    for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour27: P.tour27 })) {
      for (const sistema of ['espejo', 'hibrido', 'prototipo']) await carga({ id: `escritorio-vigente-${sistema}-${nombre}`, sistema, ruta, perfil: ESCRITORIO, zona: 'Europe/Madrid', captura: true });
    }
    // 3. Otra zona y región.
    for (const [nombre, ruta, zona] of [['giro-bogota', P.giro, 'America/Bogota'], ['mundial-bogota', P.mundial, 'America/Bogota'], ['giro-londres', P.giro, 'Europe/London'], ['giroEn-madrid', P.giroEn, 'Europe/Madrid']]) {
      for (const sistema of ['espejo', 'hibrido', 'prototipo']) await carga({ id: `movil-zona-${sistema}-${nombre}`, sistema, ruta, perfil: MOVIL, zona, captura: true });
    }
    // 4. Dato cambiado después del build. Híbrido y prototipo ya lo tienen publicado.
    for (const [nombre, ruta] of Object.entries({ giro: P.giro, tour27: P.tour27 })) {
      for (const cambio of ['tv', 'documento']) {
        await carga({ id: `movil-desfase-${cambio}-espejo-${nombre}`, sistema: 'espejo', ruta, perfil: MOVIL, zona: 'Europe/Madrid', desfase: cambio, captura: true });
        const input = porSlug.get(desdeSlug(ruta));
        await publicador.publicar([input], { transformar: entrada => simular(cambio, entrada) });
        await hibrido.publicador.publicar([input], { transformar: entrada => simular(cambio, entrada) });
        await carga({ id: `movil-desfase-${cambio}-hibrido-${nombre}`, sistema: 'hibrido', ruta, perfil: MOVIL, zona: 'Europe/Madrid', desfase: cambio, captura: true });
        await carga({ id: `movil-desfase-${cambio}-prototipo-${nombre}`, sistema: 'prototipo', ruta, perfil: MOVIL, zona: 'Europe/Madrid', captura: true });
        await publicador.publicar([input]);
        await hibrido.publicador.publicar([input]);
      }
    }
    // 4 bis. Inscritos: el JS actual confirma el HTML publicado.
    const INSCRITOS = 'inscritos/giro-de-italia-2026/';
    const entradaLista = inscritos.entradas(inscritos.carreras().find(raceId => inscritos.entradas(raceId)[0].race.slug === 'giro-de-italia-2026'))[0];
    for (const sistema of ['produccion', 'espejo', 'hibrido']) await carga({ id: `movil-inscritos-vigente-${sistema}`, sistema, ruta: INSCRITOS, perfil: MOVIL, zona: 'Europe/Madrid', captura: sistema !== 'produccion' });
    await carga({ id: 'movil-inscritos-desfase-espejo', sistema: 'espejo', ruta: INSCRITOS, perfil: MOVIL, zona: 'Europe/Madrid', desfase: 'corredor', captura: true });
    const conCorredor = entrada => ({ ...entrada, rows: { ...entrada.rows, riders: filasConCorredor(entrada.rows.riders) } });
    await hibrido.publicador.publicar([entradaLista], { transformar: conCorredor });
    await carga({ id: 'movil-inscritos-desfase-hibrido', sistema: 'hibrido', ruta: INSCRITOS, perfil: MOVIL, zona: 'Europe/Madrid', desfase: 'corredor', captura: true });
    await hibrido.publicador.publicar([entradaLista]);
    // 5. Segunda visita: mismo contexto, caché llena.
    for (const sistema of ['espejo', 'prototipo']) {
      const corridas = [];
      for (let vez = 0; vez < Math.min(repeticiones, 3); vez++) {
        const tab = await pestaña(nav, MOVIL, 'Europe/Madrid');
        await tab.ir(`${SISTEMAS[sistema]}/${P.giro}`);
        await tab.ir(`${SISTEMAS[sistema]}/${P.tour}`);
        corridas.push(resumen(await tab.valor('window.__m'), tab.peticiones));
        await tab.cerrar();
      }
      const fila = { id: `movil-segunda-${sistema}`, sistema, ruta: `${P.giro} → ${P.tour}`, ...agregar(corridas) };
      resultados.escenarios.push(fila);
      writeFileSync(destino, JSON.stringify(resultados, null, 1));
      console.log(`${fila.id.padEnd(44)} contenido ${Math.round(fila.contenido)} lcp ${Math.round(fila.lcp)} cls ${fila.cls.toFixed(4)} pet ${fila.peticiones} KB ${Math.round(fila.bytes / 1024)} js ${Math.round(fila.bytesJs / 1024)}`);
    }
    await medirVivo();
    // 7. Publicación de una carrera con su cambio, sin red: pintado, Brotli y escritura.
    resultados.publicar = [];
    for (const [nombre, slug] of [['giro-21-etapas', 'giro-de-italia-2026-etapa-10'], ['tour-21-etapas', 'tour-de-francia-2026-etapa-21'], ['mundial-un-dia', 'campeonato-del-mundo-linea-masculino-2026']]) {
      const input = porSlug.get(slug);
      const carrera = datos.entradas(input.rd.raceId);
      for (let vez = 0; vez < 20; vez++) {
        const fase = await publicador.publicar(carrera, { transformar: entrada => (entrada.rd.slug === slug && vez % 2 === 0 ? simular('tv', entrada) : entrada) });
        resultados.publicar.push({ nombre, paginas: fase.paginas, cambiadas: fase.cambiadas, pintadoMs: fase.pintadoMs, escrituraMs: fase.escrituraMs, totalMs: fase.totalMs });
      }
    }
    writeFileSync(destino, JSON.stringify(resultados, null, 1));
  }
  hijo.kill();
  publicador.cerrar();
  hibrido.publicador.cerrar();
  for (const servidor of servidores) servidor.close();
  console.log(`Resultados: ${destino}`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) await principal();
