// Isla de las fichas de ciclocross: la página ya está pintada; secciones y categorías son
// enlaces. El JS de la ficha llega al quedar libre la página, con los datos publicados.
import { alReposar, cabeceraFija, visorDocumentos } from './comun.js';

cabeceraFija();
visorDocumentos();
const boton = document.getElementById('backBtn');
if (boton) boton.href = document.documentElement.lang === 'en' ? '/en/cyclocross/' : '/ciclocross/';
// Con una vista (?view=) cuya sección no viene en el HTML, la página muestra un marcador de carga
// (tools/site/prerender-cx.mjs): el JS se pide ya, sin esperar al reposo.
const cargar = () => import('../../../js/cx-race.js');
if (document.querySelector('[data-cx-view-loading]')) cargar();
else alReposar(cargar);
