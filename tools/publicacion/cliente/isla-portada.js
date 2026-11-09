// Isla de la portada y de la agenda: el HTML ya está completo y el JS de la agenda, el de hoy con
// datos publicados, se incorpora sin repintar cuando la página queda libre. Lo pulsado antes se
// atiende al llegar.
import { alReposar, cabeceraFija } from './comun.js';

cabeceraFija();
let modulo = null;
let listo = false;
const cargar = () => (modulo ||= import('./agenda.js').then(() => { listo = true; }));
document.getElementById('cxAgendaContent')?.addEventListener('click', evento => {
  const objetivo = evento.target.closest('button, select, [data-cat]');
  if (objetivo && !listo) cargar().then(() => setTimeout(() => objetivo.click(), 300));
});
alReposar(cargar);
