// Lecturas al cargar de competición, fichas CX y mercado, desde los archivos publicados.
import { buildInhouseResultsMatcher } from '../../../js/services/races.js';
import { versionDe } from './comun.js';

const memoria = new Map();
const leer = ruta => {
  if (!memoria.has(ruta)) {
    memoria.set(ruta, fetch(ruta, { cache: 'no-cache' }).then(respuesta => {
      if (!respuesta.ok) throw new Error(`${ruta}: ${respuesta.status}`);
      return respuesta.json();
    }).catch(error => { memoria.delete(ruta); throw error; }));
  }
  return memoria.get(ruta);
};

export const competicionPublicada = id => leer(`/d/competicion/${id}.json`).then(({ fila }) => fila);
export async function trofeosPublicados(id) {
  const { clasificaciones } = await leer(`/d/competicion/${id}.json`);
  const matcher = buildInhouseResultsMatcher(clasificaciones);
  return { has: rd => !rd?.isCancelledDay && matcher.has(rd) };
}
export const cxPublicada = id => leer(`/d/cx/carrera/${id}.json`);
export const cxEquipos = () => leer('/d/cx/equipos.json');

// Mercado: cada lectura es nueva (la pestaña abierta vuelve a pedirlo). La versión de lo leído es la
// referencia de la pestaña abierta frente a v/mercado.txt.
let versionMercado;
export async function mercadoPublicado() {
  const respuesta = await fetch('/d/fichajes.json', { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`Fichajes: ${respuesta.status}`);
  const bytes = await respuesta.arrayBuffer();
  versionMercado = await versionDe(bytes).catch(() => undefined);
  return JSON.parse(new TextDecoder().decode(bytes));
}
export const versionMercadoLeida = () => versionMercado;
