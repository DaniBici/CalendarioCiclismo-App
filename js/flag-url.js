// URL de la bandera para un código ISO. Las comunidades autónomas de España
// que no existen en flag-icons se sirven autoalojadas desde /flags/; el resto
// sale del CDN de flag-icons. Módulo sin dependencias para poder probarlo.

const LOCAL_FLAG_CODES = new Set([
  'es-an', 'es-ar', 'es-as', 'es-cb', 'es-ce', 'es-cl', 'es-cm', 'es-cn',
  'es-ex', 'es-ib', 'es-mc', 'es-md', 'es-ml', 'es-nc', 'es-ri', 'es-vc',
]);

export function flagIconUrl(code) {
  const c = String(code || '').toLowerCase();
  if (!c) return '';
  const base = (typeof CONFIG !== 'undefined' && CONFIG.basePath) || '';
  return LOCAL_FLAG_CODES.has(c)
    ? `${base}/flags/${c}.svg`
    : `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${c}.svg`;
}
