// Isla de inscritos: la lista ya está completa. Avisos de corredor y PDF al primer uso.
import { patchHtml } from '../../../js/dom-patch.js';
import { cabeceraFija, seguirVersion, visorDocumentos, volver, vistaDePagina } from './comun.js';

cabeceraFija();
visorDocumentos();
const main = document.querySelector('main[data-clave]');
volver(main.dataset.volver);

// Aviso de corredor: el código completo al primer paso por una fila.
let avisos = null;
const cargarAvisos = evento => {
  const fila = evento.target.closest?.('.startlist-rider');
  if (!fila) return;
  main.removeEventListener('pointerover', cargarAvisos);
  avisos ||= import('../../../js/rider-tooltip.js').then(({ setupRiderTooltips }) => {
    setupRiderTooltips(main);
    fila.dispatchEvent(new MouseEvent(evento.pointerType === 'mouse' ? 'mouseover' : 'click', { bubbles: true }));
  });
};
main.addEventListener('pointerover', cargarAvisos);

// PDF: código y datos publicados al primer uso.
const boton = document.getElementById('btnDescargarPdf');
const trozo = () => import('./inscritos-pdf.js');
if (boton) {
  boton.addEventListener('pointerenter', () => trozo(), { once: true });
  boton.addEventListener('click', async () => {
    const original = boton.innerHTML;
    boton.disabled = true;
    try {
      const { generar } = await trozo();
      await generar(boton, `/d/${main.dataset.clave}.json`);
    } catch (error) {
      console.error('Error generando PDF:', error);
    } finally {
      boton.disabled = false;
      boton.innerHTML = original;
    }
  });
}

seguirVersion(main.dataset.clave, () => main.dataset.sondeo === '1', nuevo => {
  const nuevoMain = nuevo.querySelector('main[data-clave]');
  patchHtml(main, nuevoMain.innerHTML);
  main.dataset.sondeo = nuevoMain.dataset.sondeo;
});
vistaDePagina();
