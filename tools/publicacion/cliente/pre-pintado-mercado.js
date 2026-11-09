// Antes del primer pintado del documento de un equipo: el título que repite una sección partida
// entre columnas ya está en su sitio, y se revisa al llegar la fuente.
import { refreshSplitSectionTitles } from '../../../js/fichajes-columnas.js';

refreshSplitSectionTitles();
document.fonts?.ready.then(refreshSplitSectionTitles);
