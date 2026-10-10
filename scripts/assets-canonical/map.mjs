// Convierte asset-canonicals.json (tools/site/gen_asset_canonicals.py) en un
// fichero `map` de nginx: ruta decodificada del PDF → valor de la cabecera
// `Link: <página>; rel="canonical"`. Lógica pura; la aplicación en el VPS está
// en sync-map.mjs.

export const MAP_URL = 'https://calendariociclismo.app/asset-canonicals.json';
export const CANONICAL_PREFIX = 'https://calendariociclismo.app/';
export const MIN_ENTRIES = 100;

// Caracteres que rompen una cadena entre comillas de nginx o expanden variables.
const UNSAFE = /["\\$;{}\u0000-\u001f\u007f]/;

function decodePath(key) {
  try {
    return decodeURIComponent(key);
  } catch {
    return null;
  }
}

function validEntry(key, value) {
  if (typeof key !== 'string' || typeof value !== 'string') return null;
  if (!key.startsWith('/') || !key.toLowerCase().endsWith('.pdf')) return null;
  if (!value.startsWith(CANONICAL_PREFIX) || UNSAFE.test(value) || /\s/.test(value)) return null;
  const path = decodePath(key);
  if (path === null || UNSAFE.test(path)) return null;
  return { path, value };
}

// `$uri` de nginx es la ruta decodificada y normalizada, por eso las claves se
// decodifican. Entradas no válidas se descartan y se cuentan; un mapa con menos
// de MIN_ENTRIES entradas se rechaza para no sustituir uno bueno por uno vacío.
export function buildNginxMap(json, { minEntries = MIN_ENTRIES } = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('asset-canonicals.json no es un objeto');
  }
  const rows = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(json)) {
    const entry = validEntry(key, value);
    if (entry) rows.push(entry);
    else skipped += 1;
  }
  if (rows.length < minEntries) {
    throw new Error(`Solo ${rows.length} entradas válidas (mínimo ${minEntries})`);
  }
  rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines = rows.map(({ path, value }) => `"${path}" "<${value}>; rel=\\"canonical\\"";`);
  const text = `# Generado por scripts/assets-canonical/sync-map.mjs; no editar.\n${lines.join('\n')}\n`;
  return { text, count: rows.length, skipped };
}
