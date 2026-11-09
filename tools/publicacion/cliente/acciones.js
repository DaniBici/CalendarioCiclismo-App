// Trozo de los diálogos de aviso y calendario: el código de js/jornada.js, que
// construir.mjs expone sin su arranque. Se carga al primer uso.
import { setupIcalModal, setupReportModal } from '../../../js/jornada.js';
import { raceName, stageLabel } from '../../../js/shared.js';
import { initI18n, t } from '../../../js/i18n.js';

export async function preparar({ rd, race }) {
  await initI18n();
  const nombre = raceName(race) || t('stage.unknownRace') || '';
  setupReportModal(rd.id, nombre, stageLabel(rd.stageNumber, rd._stageSuffix));
  setupIcalModal(rd, race);
}
