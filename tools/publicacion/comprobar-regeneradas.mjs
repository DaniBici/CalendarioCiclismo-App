#!/usr/bin/env node
// Comprueba competición, fichas CX y torneos frente a producción. Solo local. El mercado de
// fichajes tiene su comprobación: comprobar-mercado.mjs.
//   CC_BASE=<sitio base> node tools/publicacion/comprobar-regeneradas.mjs --trabajo <dir> --jornadas <volcado> --cx <volcado>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { comprobar, espera, clic, ESCRITORIO, MOVIL, sinLecturas, selectorIdioma } from './comprobar-comun.mjs';
import { montar, publicarRegeneradas } from './publicacion.mjs';

const argumentos = process.argv.slice(2);
const dato = nombre => argumentos[argumentos.indexOf(`--${nombre}`) + 1];
const leer = nombre => { const valor = JSON.parse(readFileSync(dato(nombre), 'utf8')); return Array.isArray(valor) ? valor[0] : valor; };
const trabajo = dato('trabajo');
const volcados = { jornadas: leer('jornadas'), cx: leer('cx') };
const { publicador, salida, activos, portada } = await montar(trabajo, join(trabajo, 'arbol-comprobar-regeneradas'));
const inicio = performance.now();
const fase = await publicarRegeneradas(publicador, activos, volcados);
const { archivosPortada } = await import('./datos.mjs');
for (const [ruta, texto] of Object.entries(archivosPortada(portada))) publicador.publicarRuta(ruta, texto);
console.log(JSON.stringify({ total: Math.round(performance.now() - inicio), ...fase, islas: Object.fromEntries(Object.entries(activos.regeneradas).map(([k, v]) => [k, activos.pesos[v.isla.split('/').pop()]])) }));
const COMP = 'competicion/giro-de-italia-2026/';
// Una ficha de la temporada con torneo y resultados: la que más lee.
const conResultados = new Set(volcados.cx.results.map(fila => fila.raceId || fila.cxRaceId));
const CX = volcados.cx.races.filter(race => race.slug && race.slugEn && race.seasonKey === '2026-27' && race.tournamentId && conResultados.has(race.id)).at(-1);
const TORNEO = 'ciclocross/torneos/trek-uscx-2026-27/';
console.log('cx', CX.slug);
await comprobar({
  nombre: 'regeneradas', trabajo, salida, puerto: 8833, raiz: 'main', capturaRuta: COMP,
  excluir: ['.race-card__mini-profile', '.elevation-mini'],
  casos: [
    [COMP, 'Europe/Madrid', ESCRITORIO], [COMP, 'America/Bogota', MOVIL], ['en/race/giro-ditalia-2026/', 'Europe/London', MOVIL],
    [`ciclocross/${CX.slug}/`, 'Europe/Madrid', ESCRITORIO], [`ciclocross/${CX.slug}/resultados/`, 'Europe/Madrid', MOVIL], [`en/cyclocross/${CX.slugEn}/`, 'Europe/London', MOVIL],
    [TORNEO, 'Europe/Madrid', ESCRITORIO], ['en/cyclocross/series/trek-uscx-2026-27/', 'Europe/London', MOVIL],
  ],
  funciones: [
    sinLecturas(COMP), sinLecturas(`ciclocross/${CX.slug}/`),
    selectorIdioma(COMP, '/en/race/giro-ditalia-2026/'),
    ['Tarjeta de competición enlaza', ESCRITORIO, COMP, 'Europe/Madrid', async tab => {
      const destino = await tab.valor(`document.querySelector('.race-card[data-href]')?.dataset.href`);
      await tab.valor(clic('.race-card[data-href]'));
      await espera(1800);
      return { ok: decodeURI(await tab.valor('location.pathname')) === destino, detalle: destino };
    }],
    ['Ficha CX: lee los datos publicados', ESCRITORIO, `ciclocross/${CX.slug}/`, 'Europe/Madrid', async tab => {
      await espera(2500);
      const urls = [...tab.peticiones.values()].map(r => r.url).filter(url => /\/d\/cx\//.test(url));
      return { ok: urls.length >= 2, detalle: urls.map(url => url.split('/d/')[1]).slice(0, 4) };
    }],
  ],
});
publicador.cerrar();
process.exit(0);
