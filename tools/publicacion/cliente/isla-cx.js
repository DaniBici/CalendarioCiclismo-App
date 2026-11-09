// Isla de las fichas de ciclocross: la página ya está pintada; secciones y categorías son
// enlaces. El JS de la ficha llega al quedar libre la página, con los datos publicados.
import { alReposar, cabeceraFija, visorDocumentos } from './comun.js';

cabeceraFija();
visorDocumentos();
const boton = document.getElementById('backBtn');
if (boton) boton.href = document.documentElement.lang === 'en' ? '/en/cyclocross/' : '/ciclocross/';
alReposar(() => import('../../../js/cx-race.js'));
