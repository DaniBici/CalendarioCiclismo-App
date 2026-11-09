// Isla de la jornada: lo interactivo sobre el HTML ya completo. No lee Supabase
// ni vuelve a pintar la página. El perfil y los diálogos van en trozos aparte.
import { patchHtml } from '../../../js/dom-patch.js';
import { getBroadcastEmbed } from '../../../js/broadcast-embed.js';
import { isNearToday } from '../../../js/services/refresh-window.js';
import { writeCalendarParams } from '../../../js/calendario-query.js';

const doc = document;
const raiz = doc.documentElement;
const main = doc.getElementById('jornadaContent');
const en = raiz.lang === 'en';
const clave = doc.querySelector('meta[name="cc:clave"]').content;
const metaVersion = doc.querySelector('meta[name="cc:v"]');
const parametros = new URLSearchParams(location.search);
const anchoEscritorio = matchMedia('(min-width: 761px)');

let datosPromesa = null;
const datosPagina = (refrescar = false) => {
  if (!datosPromesa || refrescar) datosPromesa = fetch(`/d/${clave}.json`, { cache: 'no-cache' }).then(respuesta => respuesta.json());
  return datosPromesa;
};

// ── Cabecera ─────────────────────────────────────────────────────
const cabecera = doc.getElementById('siteHeader');
new ResizeObserver(() => {
  const fija = getComputedStyle(cabecera).position === 'sticky';
  raiz.style.setProperty('--site-header-h', `${fija ? cabecera.getBoundingClientRect().height : 0}px`);
}).observe(cabecera);
doc.getElementById('navAppsBtn')?.addEventListener('click', event => window.openAppsModal?.(event));

// Enlace «volver», como render() de js/jornada.js.
function enlaceVolver() {
  const boton = doc.getElementById('backBtn');
  if (!boton) return;
  let estado = {};
  try { estado = JSON.parse(sessionStorage.getItem('cc_nav') || '{}'); } catch { /* Sin estado guardado. */ }
  const origen = parametros.get('from') || estado.from;
  const base = en ? '/en' : '';
  const calendario = en ? '/calendar/' : '/calendario/';
  const lang = en ? 'en' : 'es';
  if (origen === 'temporada') {
    const qs = new URLSearchParams();
    writeCalendarParams(qs, lang, { view: 'temporada' });
    const year = parametros.get('year') || estado.year || '';
    const cat = parametros.get('cat') || estado.cat || '';
    if (year) qs.set('year', year);
    if (cat) qs.set('cat', cat);
    boton.href = `${base}${calendario}?${qs}`;
  } else if (origen === 'mes') {
    const mesCrudo = parametros.get('month') || estado.month;
    const añoCrudo = parametros.get('year') || estado.year;
    const month = mesCrudo != null && añoCrudo != null ? `${Number(añoCrudo)}-${String(Number(mesCrudo) + 1).padStart(2, '0')}` : null;
    boton.href = `${base}${calendario}?${writeCalendarParams(new URLSearchParams(), lang, { view: 'mes', month })}`;
  } else {
    const fecha = main.dataset.dateKey;
    boton.href = fecha ? `${base}/?date=${fecha}` : `${base}/`;
  }
}
enlaceVolver();

// ── Televisión, notas y sugerencias, delegados ───────────────────
function anchoTv() {
  main.querySelectorAll('.tv-panel').forEach(panel => {
    const filas = [...panel.querySelectorAll('.tv-panel__list>:is(.tv-entry,.info-row)')].filter(el => el.style.display !== 'none');
    panel.classList.toggle('tv-panel--single', filas.length <= 1);
  });
}

function sugerencia() {
  let tip = doc.getElementById('ph-tooltip');
  if (!tip) { tip = doc.createElement('div'); tip.id = 'ph-tooltip'; doc.body.appendChild(tip); }
  return tip;
}

main.addEventListener('click', event => {
  const filtro = event.target.closest('[data-tv-filter]');
  if (filtro) {
    const enMias = filtro.dataset.tvFilter === 'mine';
    main.querySelectorAll('.tv-entry--regional-hidden').forEach(el => { el.style.display = enMias ? '' : 'none'; });
    main.querySelectorAll('.tv-region-badge').forEach(el => { el.style.display = enMias ? 'inline-flex' : 'none'; });
    main.querySelectorAll('.tv-no-region-msg').forEach(el => { el.style.display = enMias ? 'none' : ''; });
    filtro.dataset.tvFilter = enMias ? 'all' : 'mine';
    filtro.textContent = enMias ? main.dataset.tvMias : main.dataset.tvTodas;
    filtro.classList.toggle('tv-filter-btn--active', enMias);
    anchoTv();
    return;
  }
  const nota = event.target.closest('.tv-entry__note-btn');
  if (nota) {
    event.stopPropagation();
    const tip = sugerencia();
    if (tip.style.display === 'block' && tip.dataset.owner === nota.dataset.tooltip) { tip.style.display = 'none'; return; }
    const caja = nota.getBoundingClientRect();
    tip.textContent = nota.dataset.tooltip;
    tip.dataset.owner = nota.dataset.tooltip;
    tip.style.display = 'block';
    tip.style.left = `${Math.max(8, Math.min(caja.left, innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${caja.bottom + 6}px`;
    return;
  }
  const emision = event.target.closest('a.tv-link-btn--embed[data-tv-embed]');
  if (emision && innerWidth >= 768) {
    const embed = getBroadcastEmbed(emision.href);
    if (!embed) return;
    event.preventDefault();
    const fila = emision.closest('.tv-entry');
    const siguiente = fila.nextElementSibling;
    if (siguiente?.classList.contains('tv-embed-block')) {
      siguiente.remove();
      emision.innerHTML = `${main.dataset.ver} ↗&#xFE0E;`;
    } else {
      const bloque = doc.createElement('div');
      bloque.className = 'tv-embed-block';
      const externo = en ? `Open on ${embed.externalLabel}` : `Abrir en ${embed.externalLabel}`;
      const marco = doc.createElement('div');
      marco.className = 'tv-embed-wrap';
      const iframe = doc.createElement('iframe');
      Object.assign(iframe, { src: embed.src, title: embed.externalLabel, allowFullscreen: true });
      iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      marco.append(iframe);
      const acciones = doc.createElement('div');
      acciones.className = 'tv-embed-actions';
      const enlace = doc.createElement('a');
      Object.assign(enlace, { className: 'tv-link-btn', href: embed.externalUrl, target: '_blank', rel: 'noopener', textContent: `${externo} ↗︎` });
      acciones.append(enlace);
      bloque.append(marco, acciones);
      fila.insertAdjacentElement('afterend', bloque);
      emision.innerHTML = `${main.dataset.cerrar} &nbsp;✕`;
    }
  }
});

if (innerWidth >= 600) {
  main.addEventListener('mouseover', event => {
    const el = event.target.closest('[data-tooltip]');
    if (!el) return;
    const tip = sugerencia();
    tip.textContent = el.dataset.tooltip;
    tip.style.display = 'block';
  });
  main.addEventListener('mousemove', event => {
    const tip = doc.getElementById('ph-tooltip');
    if (tip?.style.display === 'block') { tip.style.left = `${event.clientX + 14}px`; tip.style.top = `${event.clientY + 14}px`; }
  });
  main.addEventListener('mouseout', event => {
    if (event.target.closest('[data-tooltip]')) { const tip = doc.getElementById('ph-tooltip'); if (tip) tip.style.display = 'none'; }
  });
}

// ── Perfil: se monta al acercarse a la pantalla ──────────────────
const perfil = main.querySelector('[data-integrated-profile]');
let perfilPrístino = perfil?.innerHTML ?? null;
let perfilMontado = false;
const barra = doc.getElementById('icalBar');

function colocarBarra() {
  if (!barra) return;
  const hueco = doc.querySelector('.stage-side__actions');
  const pie = doc.querySelector('footer.site-footer');
  if (hueco && anchoEscritorio.matches) { if (barra.parentElement !== hueco) hueco.append(barra); }
  else if (pie && barra.nextElementSibling !== pie) pie.before(barra);
}
anchoEscritorio.addEventListener('change', colocarBarra);

async function montarPerfil() {
  if (!perfil || perfil.hidden) return;
  const [{ montar }, datos] = await Promise.all([import('./perfil.js'), datosPagina()]);
  // El montaje rehace el interior del hueco: la barra sale y vuelve a su sitio.
  if (barra?.isConnected && perfil.contains(barra)) barra.remove();
  await montar(perfil, datos);
  perfilMontado = true;
  colocarBarra();
}

if (perfil && !perfil.hidden) {
  const vigia = new IntersectionObserver(entradas => {
    if (entradas.some(entrada => entrada.isIntersecting)) { vigia.disconnect(); montarPerfil(); }
  }, { rootMargin: '1200px' });
  vigia.observe(perfil);
} else {
  // Sin perfil, el mismo trozo activa el visor de documentos y las flechas de la barra.
  (window.requestIdleCallback || setTimeout)(() => import('./perfil.js'));
}

// ── Diálogos: al primer uso ──────────────────────────────────────
let accionesListas = false;
barra?.addEventListener('click', async event => {
  const boton = event.target.closest('#icalOpenBtn,#reportBarBtn');
  if (!boton || accionesListas) return;
  accionesListas = true;
  const [{ preparar }, datos] = await Promise.all([import('./acciones.js'), datosPagina()]);
  await preparar(datos);
  colocarBarra();
  doc.getElementById(boton.id)?.click();
});

// ── Cambios con la pestaña abierta ───────────────────────────────
const claveDe = el => `${el.tagName}.${el.classList[0] || ''}`;
const pendientes = new Map();

function aplicarPar(viejo, nuevo) {
  if (!viejo) return;
  for (const nombre of viejo.getAttributeNames()) if (!nuevo.hasAttribute(nombre)) viejo.removeAttribute(nombre);
  for (const nombre of nuevo.getAttributeNames()) viejo.setAttribute(nombre, nuevo.getAttribute(nombre));
  patchHtml(viejo, nuevo.innerHTML);
}

function enPantalla(el) {
  const caja = el.getBoundingClientRect();
  return caja.bottom > 0 && caja.top < innerHeight;
}

function vaciarPendientes(forzar) {
  for (const [viejo, nuevo] of [...pendientes]) {
    if (!forzar && enPantalla(viejo)) continue;
    pendientes.delete(viejo);
    aplicarPar(viejo, nuevo);
  }
  anchoTv();
  window.ccVivo = { ...window.ccVivo, pendientes: pendientes.size, aplicado: performance.now() };
}

// Un cambio que altera el alto de lo que se está viendo espera a que salga de
// la pantalla o a la siguiente interacción: nunca mueve la lectura.
['pointerdown', 'keydown'].forEach(tipo => addEventListener(tipo, () => { if (pendientes.size) vaciarPendientes(true); }, { passive: true }));
addEventListener('scroll', () => { if (pendientes.size) vaciarPendientes(false); }, { passive: true });
doc.addEventListener('visibilitychange', () => { if (doc.hidden && pendientes.size) vaciarPendientes(true); });

function aplicarFragmento(html) {
  const plantilla = doc.createElement('template');
  plantilla.innerHTML = html;
  window.ccVisitante(plantilla.content);
  const nuevos = [...plantilla.content.children].filter(el => el.tagName !== 'TEMPLATE');
  const viejos = [...main.children];
  // Sonda oculta con el ancho real para medir el alto antes de tocar nada.
  const sonda = main.cloneNode(false);
  sonda.removeAttribute('id');
  sonda.setAttribute('aria-hidden', 'true');
  sonda.style.cssText += `;position:absolute;left:-9999px;top:0;width:${main.clientWidth}px;visibility:hidden`;
  doc.body.append(sonda);
  let cursor = 0;
  for (const nuevo of nuevos) {
    const clon = nuevo.cloneNode(true);
    sonda.append(clon);
    const at = viejos.findIndex((viejo, indice) => indice >= cursor && claveDe(viejo) === claveDe(nuevo));
    if (at < 0) {
      // Sección nueva: se inserta si queda fuera de la pantalla.
      const siguiente = viejos[cursor];
      if (!siguiente || !enPantalla(siguiente)) (siguiente ? siguiente.before(nuevo) : main.append(nuevo));
      continue;
    }
    for (let indice = cursor; indice < at; indice++) viejos[indice].remove();
    const viejo = viejos[at];
    cursor = at + 1;
    if (viejo === perfil) {
      if (nuevo.innerHTML !== perfilPrístino) {
        perfilPrístino = nuevo.innerHTML;
        if (perfilMontado) datosPagina(true).then(() => montarPerfil());
        else aplicarPar(viejo, nuevo);
      }
      continue;
    }
    if (viejo.isEqualNode(nuevo)) continue;
    // Mismo alto y mismos elementos: solo cambia texto. Un elemento más puede mover
    // a sus vecinos sin alterar el alto, como un botón en una barra horizontal.
    const mismaForma = clon.offsetHeight === viejo.offsetHeight && clon.querySelectorAll('*').length === viejo.querySelectorAll('*').length;
    if (mismaForma || !enPantalla(viejo)) aplicarPar(viejo, nuevo);
    else pendientes.set(viejo, nuevo);
  }
  for (let indice = cursor; indice < viejos.length; indice++) viejos[indice].remove();
  sonda.remove();
  for (const anterior of doc.querySelectorAll('body > template[data-tv]')) anterior.remove();
  anchoTv();
  window.ccVivo = { ...window.ccVivo, recibido: performance.now(), pendientes: pendientes.size };
}

async function comprobarVersion() {
  if (doc.hidden) return;
  const respuesta = await fetch(`/v/${clave}.txt`, { cache: 'no-cache' }).catch(() => null);
  if (!respuesta?.ok) return;
  const version = (await respuesta.text()).trim();
  if (version === metaVersion.content) return;
  // La jornada cambió de slug: la página nueva sustituye a esta en el historial.
  if (version.startsWith('→')) { location.replace(version.slice(1)); return; }
  const fragmento = await fetch(`/f/${clave}.html`, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : null)).catch(() => null);
  if (!fragmento) return;
  metaVersion.content = version;
  aplicarFragmento(fragmento);
  window.ccVivo = { ...window.ccVivo, version };
}

const intervalo = Number(parametros.get('vivo'));
if (intervalo || isNearToday(main.dataset.dateKey)) {
  setInterval(comprobarVersion, (intervalo || 15) * 1000);
  doc.addEventListener('visibilitychange', comprobarVersion);
}
