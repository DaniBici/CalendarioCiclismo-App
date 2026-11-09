#!/usr/bin/env node
// Comprueba inscritos frente a producción. Solo local.
//   node tools/publicacion/comprobar-inscritos.mjs --trabajo <dir>
import { join } from 'node:path';
import { comprobar, espera, clic, ESCRITORIO, MOVIL, sinLecturas, selectorIdioma } from './comprobar-comun.mjs';
import { montar, todasLasEntradas } from './publicacion.mjs';

const argumentos = process.argv.slice(2);
const trabajo = argumentos[argumentos.indexOf('--trabajo') + 1];
const { inscritos, publicador, salida, activos } = await montar(trabajo, join(trabajo, 'arbol-comprobar-inscritos'));
const entradas = inscritos.carreras().flatMap(raceId => inscritos.entradas(raceId));
const inicio = performance.now();
const fase = await publicador.publicar(entradas, { forzar: true });
console.log(JSON.stringify({ total: Math.round(performance.now() - inicio), paginas: fase.paginas, errores: fase.errores.length, primeros: fase.errores.slice(0, 3), mb: Math.round(fase.bytes / 1048576), isla: activos.pesos[activos.inscritos.isla.split('/').pop()] }));
const GIRO = 'inscritos/giro-de-italia-2026/';
const informe = await comprobar({
  nombre: 'inscritos', trabajo, salida, puerto: 8830, raiz: 'main', capturaRuta: GIRO,
  casos: [[GIRO, 'Europe/Madrid', ESCRITORIO], [GIRO, 'America/Bogota', MOVIL], ['en/startlist/giro-ditalia-2026/', 'Europe/London', MOVIL], ['inscritos/tour-de-francia-2027/', 'Europe/Madrid', MOVIL], ['inscritos/strade-bianche-2026/', 'Europe/Madrid', ESCRITORIO]],
  funciones: [
    sinLecturas(GIRO),
    selectorIdioma(GIRO, '/en/startlist/giro-ditalia-2026/'),
    ['Aviso de corredor retirado', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
      const hay = await tab.valor(`(() => { const f = document.querySelector('[data-rider-dnf]') || document.querySelector('.startlist-rider'); f.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); return f.className; })()`);
      await espera(1500);
      const visible = await tab.valor(`(() => { const n = document.querySelector('.rider-tip'); return !!n && n.textContent.trim().length > 0 && getComputedStyle(n).display !== 'none'; })()`);
      return { ok: visible, detalle: { hay, visible } };
    }],
    ['PDF', ESCRITORIO, GIRO, 'Europe/Madrid', async tab => {
      const antes = await tab.valor(`document.getElementById('btnDescargarPdf').innerHTML`);
      await tab.valor(clic('#btnDescargarPdf'));
      await espera(9000);
      const despues = await tab.valor(`document.getElementById('btnDescargarPdf').innerHTML`);
      const pedido = [...tab.peticiones.values()].map(r => r.url).filter(url => url.includes('/d/inscritos-es/'));
      return { ok: antes === despues && pedido.length === 1, detalle: { pedido: pedido.length, restaurado: antes === despues } };
    }],
  ],
});
publicador.cerrar();
process.exit(0);
