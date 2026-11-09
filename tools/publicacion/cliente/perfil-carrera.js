// Trozo del perfil de las páginas de resultados, perfil y orden de salida, con los datos
// publicados de la jornada.
import { mountStageProfile } from '../../../js/stage/profile.js';
import { getLang, initI18n } from '../../../js/i18n.js';

function etiquetaZona() {
  if (getLang() !== 'en') return null;
  const year = new Date().getFullYear();
  return [0, 6].every(month => !new Date(year, month, 1).getTimezoneOffset()) ? 'GMT' : null;
}

export async function montar(host, { rd, race, assets }, { conZona = false, ...opciones } = { hidePointNames: true }) {
  await initI18n();
  mountStageProfile(host, { day: rd, race: race || {}, assets, ...opciones, ...(conZona ? { timeZoneLabel: etiquetaZona() } : {}) });
}
