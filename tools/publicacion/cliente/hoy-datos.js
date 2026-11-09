// Lo que Hoy de carretera lee al cargar y al cambiar de día, desde los archivos publicados. Un día
// fuera de la ventana publicada se abre como página: la resuelve el sitio base, leyendo datos. Nunca
// se navega al día que ya se está viendo: sería un bucle si faltaran sus datos.
import { versionDe } from './comun.js';

const dias = new Map();
// Versión de los datos leídos de cada día: la de v/hoy/<día>.txt (versionDe).
const versiones = new Map();
// Versión que pidió el último repintado de cada día; una lectura fallida la libera.
const pedidas = new Map();

async function diaPublicado(dia, { fresco = false } = {}) {
  if (!fresco && dias.has(dia)) return dias.get(dia);
  const pedido = fetch(`/d/hoy/${dia}.json`, { cache: 'no-cache' }).then(async respuesta => {
    if (respuesta.status === 404) {
      if (dia !== document.getElementById('raceList').dataset.dia) {
        location.assign(`${document.documentElement.lang === 'en' ? '/en' : ''}/index-ruta.html?date=${dia}`);
      }
      // Se queda lo que hay pintado.
      return new Promise(() => {});
    }
    if (!respuesta.ok) throw new Error(`Hoy: ${respuesta.status}`);
    const bytes = await respuesta.arrayBuffer();
    const version = await versionDe(bytes).catch(() => undefined);
    if (version) versiones.set(dia, version);
    return JSON.parse(new TextDecoder().decode(bytes));
  });
  dias.set(dia, pedido);
  pedido.catch(() => { dias.delete(dia); pedidas.delete(dia); });
  return pedido;
}

/** Filas de la lectura de loadDay(), para prepareAgendaDays(). Vuelve a pedirlas: pueden haber cambiado. */
export async function hoyDia(dia) {
  try {
    return { data: (await diaPublicado(dia, { fresco: true })).rows, error: null };
  } catch (error) {
    return { data: null, error };
  }
}

export const hoyActivas = async dia => ({ data: (await diaPublicado(dia)).activas });

export const hoyDestacadas = async dia => new Map([[dia, new Set((await diaPublicado(dia)).featured)]]);

export async function hoyAnio(anio) {
  const respuesta = await fetch(`/d/hoy/anio-${anio}.json`, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`Hoy, año ${anio}: ${respuesta.status}`);
  return respuesta.json();
}

// Una pestaña abierta detecta los cambios del día con su archivo de versión, frente a los datos que
// pintó: un cambio publicado antes de la primera comprobación o con la pestaña oculta también cuenta.
// El servidor escribe los datos antes que la versión; una versión que ya pidió repintar y no coincide
// con lo leído no vuelve a pedirlo.
export async function hoyCambio(dia) {
  const respuesta = await fetch(`/v/hoy/${dia}.txt`, { cache: 'no-cache' });
  if (!respuesta.ok) return false;
  const version = (await respuesta.text()).trim();
  const anterior = versiones.get(dia);
  if (anterior === undefined) {
    versiones.set(dia, version);
    return false;
  }
  if (version === anterior || version === pedidas.get(dia)) return false;
  pedidas.set(dia, version);
  return true;
}
