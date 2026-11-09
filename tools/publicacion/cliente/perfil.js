// Trozo del perfil interactivo: el mismo montaje que js/jornada.js, con los datos
// servidos junto a la página en lugar de leídos de Supabase. Importar shared.js
// activa también el visor de documentos.
import { mountStageProfile } from '../../../js/stage/profile.js';
import { getLang, initI18n } from '../../../js/i18n.js';

function etiquetaZona() {
  if (getLang() !== 'en') return null;
  const year = new Date().getFullYear();
  return [0, 6].every(month => !new Date(year, month, 1).getTimezoneOffset()) ? 'GMT' : null;
}

export async function montar(host, { rd, race, assets, hasActualResults }) {
  await initI18n();
  mountStageProfile(host, { day: { ...rd, _hasInhouse: hasActualResults }, race, assets, points: true, temporal: true, timeZoneLabel: etiquetaZona() });
}
