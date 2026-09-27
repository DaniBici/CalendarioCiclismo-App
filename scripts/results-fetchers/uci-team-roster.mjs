// El panel UCI es la evidencia del tipo de vínculo, no los enlaces de la página.
const normalizedExternalUrl = value => {
  const raw = String(value || '').trim().replace(/^https:\/\/(?=https?:\/\/)/i, '');
  if (!raw) return null;
  try { return new URL(raw).href; } catch { return raw; }
};

export function parseUciTeamRoster(html) {
  const match = String(html).match(/data-component="TeamDetailsModule"[^>]*data-props="([^"]*)"/);
  if (!match) throw new Error('Falta TeamDetailsModule en la fuente UCI');
  const decoded = match[1]
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const data = JSON.parse(decoded);
  if (!Array.isArray(data.riders?.panels)) throw new Error('Faltan los paneles UCI');
  const regular = [], trainees = [], seen = new Map();
  for (const panel of data.riders.panels) {
    if (panel.label === 'Management') continue;
    if (!['Riders', 'Neo', 'Specialists', 'Trainees'].includes(panel.label) || !Array.isArray(panel.riders)) {
      throw new Error('Panel UCI no reconocido: ' + panel.label);
    }
    for (const rider of panel.riders) {
      const uciProfileId = rider.url?.match(/^\/rider-details\/(\d+)$/)?.[1];
      if (!uciProfileId || !rider.givenName || !rider.familyName) throw new Error('Ficha UCI incompleta');
      const affiliationType = panel.label === 'Trainees' ? 'trainee' : 'regular';
      const seenKey = `${uciProfileId}:${affiliationType}`;
      const previous = seen.get(seenKey);
      if (previous) {
        if (!previous.sourcePanels.includes(panel.label)) previous.sourcePanels.push(panel.label);
        continue;
      }
      const parsed = { ...rider, uciProfileId, affiliationType,
        sourcePanel: panel.label, sourcePanels: [panel.label] };
      seen.set(seenKey, parsed);
      (affiliationType === 'trainee' ? trainees : regular).push(parsed);
    }
  }
  const details = data.details ? structuredClone(data.details) : data.details;
  if (details?.website?.url) details.website.url = normalizedExternalUrl(details.website.url);
  if (details?.pictureTeamJersey) details.pictureTeamJersey = normalizedExternalUrl(details.pictureTeamJersey);
  return { details, regular, trainees };
}
