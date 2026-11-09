// Isla de Campeonatos Nacionales: la rejilla ya está pintada; el JS llega al quedar libre la página
// y atiende filtros y celdas. Lo pulsado antes se atiende al llegar.
import { alReposar, cabeceraFija } from './comun.js';

cabeceraFija();
let modulo = null;
let listo = false;
const cargar = () => (modulo ||= import('../../../js/campeonatos.js').then(mercado => mercado.campeonatosListos).then(() => { listo = true; }));
document.getElementById('campeonatosContent')?.addEventListener('click', evento => {
  const objetivo = evento.target.closest('[data-camp-filter], .camp-cell[data-nav]:not([data-nav=""]), .camp-inhouse-trophy');
  if (objetivo && !listo) cargar().then(() => objetivo.click());
});
alReposar(cargar);
