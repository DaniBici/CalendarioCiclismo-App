// Isla de los torneos de ciclocross: la página ya está pintada; el JS de la agenda llega al
// quedar libre la página, con la temporada publicada.
import { alReposar, cabeceraFija, visorDocumentos } from './comun.js';

cabeceraFija();
visorDocumentos();
alReposar(() => import('../../../js/ciclocross.js'));
