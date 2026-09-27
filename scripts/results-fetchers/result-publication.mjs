export const LIVE_RESULT_SOURCES = Object.freeze([
  'tissot', 'matsport', 'raceresult', 'sts', 'livetiming', 'sportsoft',
  'timing.ee', 'evodata', 'infocity', 'ASO', 'manual_timing', 'chronohr', 'maneffic',
]);
export const COVERED_STAGE_REFRESH_SOURCES = Object.freeze([...LIVE_RESULT_SOURCES, 'domtel']);
// Fuentes de volcado manual: el cron no las selecciona nunca y su upsert del
// enlace no debe sobrescribir un enlace automático existente.
export const MANUAL_RESULT_SOURCES = Object.freeze(['pdf', 'sportstiming']);
// Proveedores con que resultObservation registra un volcado manual: un
// placeholder sin --source queda como 'unknown'.
export const MANUAL_OBSERVATION_PROVIDERS = Object.freeze([...MANUAL_RESULT_SOURCES, 'unknown']);
export function isProgressiveResultSource(provider) {
  return COVERED_STAGE_REFRESH_SOURCES.some(source => source.toLowerCase() === String(provider).toLowerCase());
}
// These importers parse an actual official PDF. Hybrid importers annotate each
// classification where it is parsed, rather than inheriting a stage PDF link.
const PDF = new Set(['pdf','burgos','belgiancycling','colombia','istanbul','southbohemia','bornan','atresults']);

export function resultObservation(data, stage, classification, sourceOverride) {
  const evidence = classification.publication || {};
  const provider = evidence.provider || data.source || sourceOverride || 'unknown';
  const format = evidence.format || (provider === 'uci' ? 'uci' : PDF.has(provider) ? 'pdf' : isProgressiveResultSource(provider) ? 'progressive' : 'unknown');
  return { ...evidence, provider, format, observedAt:data.fetchedAt || null };
}
