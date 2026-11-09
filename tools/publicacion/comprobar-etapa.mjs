#!/usr/bin/env node
// Comprueba perfil, mapa y orden de salida frente a producción. Solo local.
//   CC_BASE=<sitio base> node tools/publicacion/comprobar-etapa.mjs --trabajo <dir> --tablas <volcado>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobar, espera, clic, ESCRITORIO, MOVIL, sinLecturas, selectorIdioma } from './comprobar-comun.mjs';
import { montar, publicarEtapas } from './publicacion.mjs';

const argumentos = process.argv.slice(2);
const dato = nombre => argumentos[argumentos.indexOf(`--${nombre}`) + 1];
const trabajo = dato('trabajo');
let tablas = JSON.parse(readFileSync(dato('tablas'), 'utf8'));
if (Array.isArray(tablas)) tablas = tablas[0];
const { publicador, salida, activos } = await montar(trabajo, join(trabajo, 'arbol-comprobar-etapa'));
const inicio = performance.now();
const fase = await publicarEtapas(publicador, tablas, { forzar: true });
console.log(JSON.stringify({ total: Math.round(performance.now() - inicio), paginas: fase.paginas, errores: fase.errores.length, primeros: fase.errores.slice(0, 3), mb: Math.round(fase.bytes / 1048576), isla: activos.pesos[activos.etapa.isla.split('/').pop()] }));
const PERFIL = 'perfil/giro-de-italia-2026-etapa-10/';
const conMapa = tablas.days.find(dia => dia.routeGpxUrl && dia.slug && dia.slugEn);
const MAPA = `mapa/${conMapa.slug}/`;
const MAPA_EN = `en/route-map/${conMapa.slugEn}/`;
const conFiltros = tablas.days.find(dia => dia.startOrderImportedAt && dia.slug && ((dia.startOrderTtDorsals || []).length || (dia.startOrderGcDorsals || []).length));
const ORDEN = tablas.days.filter(dia => dia.startOrderImportedAt && dia.slug && String(dia.slug).includes('2026')).map(dia => dia.slug).find(slug => slug.includes('giro')) || tablas.days.find(dia => dia.startOrderImportedAt && dia.slug).slug;
const ORDEN_EN = tablas.days.find(dia => dia.slug === ORDEN).slugEn || ORDEN;
console.log('orden', ORDEN, ORDEN_EN, 'mapa', MAPA, 'con filtros', conFiltros?.slug);
const informe = await comprobar({
  nombre: 'etapa', trabajo, salida, puerto: 8831, raiz: 'main', capturaRuta: `orden-salida/${ORDEN}/`,
  excluir: ['#pfeProfile', '#soProfile', '#ccRouteMapWrap', '.stage-profile'],
  casos: [
    [PERFIL, 'Europe/Madrid', ESCRITORIO], [PERFIL, 'America/Bogota', MOVIL], ['en/profile/giro-ditalia-2026-stage-10/', 'Europe/London', MOVIL], ['en/profile/giro-ditalia-2026-stage-10/', 'America/New_York', ESCRITORIO],
    [MAPA, 'Europe/Madrid', MOVIL], [MAPA_EN, 'Europe/London', ESCRITORIO],
    [`orden-salida/${ORDEN}/`, 'Europe/Madrid', ESCRITORIO], [`orden-salida/${ORDEN}/`, 'America/New_York', MOVIL], [`en/start-order/${ORDEN_EN}/`, 'Europe/London', ESCRITORIO], [`en/start-order/${ORDEN_EN}/`, 'Asia/Tokyo', MOVIL],
  ],
  funciones: [
    sinLecturas(PERFIL), sinLecturas(`orden-salida/${ORDEN}/`),
    selectorIdioma(PERFIL, '/en/profile/giro-ditalia-2026-stage-10/'),
    ['Perfil dibujado', ESCRITORIO, PERFIL, 'Europe/Madrid', async tab => {
      await espera(1500);
      const dibujado = await tab.valor(`!!document.querySelector('#pfeProfile svg, #pfeProfile canvas, #pfeProfile img')`);
      return { ok: dibujado, detalle: dibujado };
    }],
    ['Mapa montado', ESCRITORIO, MAPA, 'Europe/Madrid', async tab => {
      await espera(3500);
      const mapa = await tab.valor(`document.querySelector('#ccRouteMapWrap')?.children.length || 0`);
      const global = await tab.valor(`typeof maplibregl`);
      return { ok: mapa > 0, detalle: { mapa, global } };
    }],
    ['Filtro del orden de salida', ESCRITORIO, `orden-salida/${(conFiltros || { slug: ORDEN }).slug}/`, 'Europe/Madrid', async tab => {
      const hay = await tab.valor(`document.querySelectorAll('#soFilters .tcat-btn').length`);
      if (!hay) return { ok: true, detalle: 'sin filtros' };
      await tab.valor(clic('#soFilters .tcat-btn[data-filter="gc"], #soFilters .tcat-btn[data-filter="tt"]'));
      const clase = await tab.valor(`document.querySelector('.so-table-wrap').className`);
      return { ok: /so-filter--/.test(clase), detalle: clase };
    }],
    ['Horas en la zona del visitante', ESCRITORIO, `orden-salida/${ORDEN}/`, 'Asia/Tokyo', async tab => {
      const nota = await tab.valor(`document.querySelector('.so-tz-note')?.innerText || ''`);
      return { ok: nota.length > 10, detalle: nota.slice(0, 80) };
    }],
  ],
});
publicador.cerrar();
process.exit(0);
