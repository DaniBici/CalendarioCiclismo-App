// Isla del mercado: portada y equipos ya pintados, cada equipo en su documento. El JS del
// mercado llega al quedar libre la página: atiende filtros y cambios de vista sin recargar y
// actualiza sobre lo pintado los movimientos que entran con la pestaña abierta.
import { headerBack } from '../../../js/header-back.js';
import { alReposar, cabeceraFija } from './comun.js';
import { versionMercadoLeida } from './datos-publicados.js';

window.ccHeaderBack = headerBack;
cabeceraFija();

let modulo = null;
let listo = false;
const cargar = () => (modulo ||= import('../../../js/fichajes.js').then(async mercado => {
  await mercado.marketReady;
  listo = true;
  seguirMercado(mercado.refreshMarket);
  return mercado;
}));

// La referencia es la versión de los datos pintados, no la de la primera comprobación: un movimiento
// publicado entre la lectura y esa comprobación, o con la pestaña oculta, también cuenta. El servidor
// escribe los datos antes que la versión; una versión que ya pidió repintar no vuelve a pedirlo.
function seguirMercado(actualizar) {
  let primera;
  let pedida = null;
  let ocupado = false;
  const comprobar = async () => {
    if (document.hidden || ocupado) return;
    ocupado = true;
    try {
      const respuesta = await fetch('/v/mercado.txt', { cache: 'no-cache' });
      if (!respuesta.ok) return;
      const version = (await respuesta.text()).trim();
      // Sin crypto.subtle no hay versión de lo leído: vale la de la primera comprobación.
      const pintada = versionMercadoLeida() ?? (primera ??= version);
      if (version === pintada || version === pedida) return;
      pedida = version;
      await actualizar();
    } catch {
      // Sin red: se conserva lo visible y se vuelve a intentar en la siguiente comprobación.
      pedida = null;
    } finally {
      ocupado = false;
    }
  };
  comprobar();
  // Cada 10 s, como Hoy: el movimiento se publica unos segundos después de escribirse.
  setInterval(comprobar, 10_000);
  document.addEventListener('visibilitychange', comprobar);
}

// Los filtros pulsados antes de que llegue el JS se atienden al llegar. Los equipos y las filas
// son enlaces a su documento: funcionan sin él.
document.getElementById('transfersContent')?.addEventListener('click', evento => {
  const boton = evento.target.closest('[data-feed],[data-div]');
  if (boton && !listo) cargar().then(() => boton.click());
});

// Un enlace a un equipo sin documento propio (id antiguo) espera a este JS con la portada oculta.
if (document.getElementById('trStaticLoading')) cargar();
else alReposar(cargar);
