// Activa, solo en el navegador, la fila «Clasificación general final» de la
// lista lateral de etapas. Las páginas que no saben si la general final ya
// existe (jornada, perfil, mapa, inscritos, orden de salida, competición) la
// pintan desactivada y marcada con data-gc-final-check (ver
// raceSideStageList); aquí se consulta una vez y, si existe, el span se
// sustituye por el enlace (mismas clases y contenido: sin salto de maquetación).
import { supabase } from './shared.js';

export async function enableGcFinalRow(root, race) {
  const row = root?.querySelector?.('[data-gc-final-check]');
  const raceId = race?.id ?? row?.dataset.raceId;
  if (!row || raceId == null || raceId === '') return;
  try {
    // La general final es la clasificación sin número de etapa (clave 'final').
    const { data, error } = await supabase.from('race_uci_stages').select('id')
      .eq('raceId', raceId).is('stageNumber', null).eq('keepForWeb', true).gt('rowCount', 0).limit(1);
    if (error || !data?.length || !row.isConnected) return;
    const a = document.createElement('a');
    a.className = row.className.replace(/\s*stage-list__item--disabled/, '');
    a.href = row.dataset.gcHref;
    a.innerHTML = row.innerHTML;
    row.replaceWith(a);
  } catch { /* sin red: la fila sigue desactivada */ }
}
