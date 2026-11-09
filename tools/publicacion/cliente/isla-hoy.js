// Isla de Hoy de carretera: la agenda ya está pintada. El JS llega al quedar libre la página y
// atiende filtros, días y ventanas; hasta entonces, una tarjeta con página ya navega.
import { alReposar, cabeceraFija } from './comun.js';
import { headerBack } from '../../../js/header-back.js';

window.ccHeaderBack = headerBack;
cabeceraFija();
document.getElementById('navAppsBtn');

let listo = false;
let modulo = null;
const cargar = () => (modulo ||= import('../../../js/app.js').then(() => { listo = true; }));
const lista = document.getElementById('raceList');
lista.addEventListener('click', evento => {
  if (listo) return;
  const tarjeta = evento.target.closest('.race-card[data-href]');
  if (tarjeta) location.href = tarjeta.dataset.href;
  else if (evento.target.closest('.badge--results, .race-card[data-modal]')) cargar();
});

// Con un filtro fijado, la lista espera a este JS (cliente/pre-pintado-hoy.js).
if (lista.style.visibility === 'hidden') cargar();
else alReposar(cargar);
