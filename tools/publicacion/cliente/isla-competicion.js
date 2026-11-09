// Isla de competición: la página ya está pintada. Las tarjetas enlazan desde el primer momento;
// el JS que adapta hora y región y abre los diálogos llega al quedar libre la página.
import { alReposar, cabeceraFija, visorDocumentos } from './comun.js';

cabeceraFija();
visorDocumentos();
document.querySelector('main')?.addEventListener('click', evento => {
  const tarjeta = evento.target.closest('.race-card[data-href]');
  if (tarjeta && !evento.target.closest('a, button')) location.href = tarjeta.dataset.href;
});
alReposar(() => import('../../../js/competicion.js'));
