#!/usr/bin/env node
// Carga breve contra la instancia de prueba, desde el propio VPS.
//   node carga.mjs <ruta> [conexiones=16] [segundos=5]
import https from 'node:https';

const [ruta, conexiones = '16', segundos = '5'] = process.argv.slice(2);
const agente = new https.Agent({ keepAlive: true, maxSockets: Number(conexiones) });
const fin = Date.now() + Number(segundos) * 1000;
const tiempos = [];
const estados = {};

function pedir() {
  return new Promise(done => {
    const inicio = performance.now();
    const peticion = https.get({ host: '127.0.0.1', port: 8443, path: ruta, agent: agente, rejectUnauthorized: false, headers: { 'accept-encoding': 'gzip' } }, respuesta => {
      respuesta.resume();
      respuesta.on('end', () => {
        tiempos.push(performance.now() - inicio);
        estados[respuesta.statusCode] = (estados[respuesta.statusCode] || 0) + 1;
        done();
      });
    });
    peticion.on('error', () => { estados.error = (estados.error || 0) + 1; done(); });
  });
}

async function cliente() {
  while (Date.now() < fin) await pedir();
}

await Promise.all(Array.from({ length: Number(conexiones) }, cliente));
tiempos.sort((a, b) => a - b);
console.log(JSON.stringify({
  ruta, conexiones: Number(conexiones), segundos: Number(segundos), estados,
  porSegundo: Math.round(tiempos.length / Number(segundos)),
  medianaMs: Math.round(tiempos[tiempos.length >> 1] * 10) / 10,
  p99Ms: Math.round(tiempos[Math.floor(tiempos.length * 0.99)] * 10) / 10,
}));
process.exit(0);
