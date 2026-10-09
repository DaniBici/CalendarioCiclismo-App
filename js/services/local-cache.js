// ─────────────────────────────────────────────────────────────────
//  CACHÉ LOCAL — copias de lecturas pesadas y estables para pintar al
//  instante y revalidar en segundo plano (stale-while-revalidate).
//  La versión de esquema forma parte de la clave: al cambiar la forma de
//  los datos se sube CACHE_VERSION y las copias anteriores dejan de leerse.
// ─────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const PREFIX = 'cc-cache:';
const MAX_BYTES = 1_500_000;

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

const fullKey = key => `${PREFIX}v${CACHE_VERSION}:${key}`;

/**
 * Devuelve `{ data, savedAt, fresh }` o null. `fresh` indica si la copia es
 * más reciente que `maxAgeMs`; una copia caducada solo se descarta pasado
 * `staleLimitMs` (por defecto, 7 días).
 */
export function readCache(key, { maxAgeMs, staleLimitMs = 7 * 86_400_000, now = Date.now(), storage = defaultStorage() } = {}) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(fullKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.savedAt !== 'number' || !('data' in entry)) return null;
    const age = now - entry.savedAt;
    if (age < 0 || age > staleLimitMs) {
      storage.removeItem(fullKey(key));
      return null;
    }
    return { data: entry.data, savedAt: entry.savedAt, fresh: maxAgeMs == null || age <= maxAgeMs };
  } catch {
    return null;
  }
}

/**
 * Retira las copias de otras versiones de esquema y las caducadas; con
 * `dropOldest`, también la mitad más antigua de las propias.
 */
function prune(storage, keepKey, { now = Date.now(), staleLimitMs = 7 * 86_400_000, dropOldest = false } = {}) {
  const own = [];
  for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (!key?.startsWith(PREFIX) || key === keepKey) continue;
    if (!key.startsWith(`${PREFIX}v${CACHE_VERSION}:`)) { storage.removeItem(key); continue; }
    let savedAt = 0;
    try { savedAt = JSON.parse(storage.getItem(key))?.savedAt || 0; } catch { /* entrada corrupta: primera en salir */ }
    if (now - savedAt > staleLimitMs) { storage.removeItem(key); continue; }
    own.push({ key, savedAt });
  }
  if (!dropOldest) return;
  own.sort((a, b) => a.savedAt - b.savedAt);
  own.slice(0, Math.max(1, Math.ceil(own.length / 2))).forEach(({ key }) => storage.removeItem(key));
}

/** Guarda `data`; devuelve false si no cabe o el almacenamiento no está disponible. */
export function writeCache(key, data, { now = Date.now(), maxBytes = MAX_BYTES, staleLimitMs, storage = defaultStorage() } = {}) {
  if (!storage) return false;
  let raw;
  try { raw = JSON.stringify({ savedAt: now, data }); } catch { return false; }
  if (raw.length > maxBytes) return false;
  const target = fullKey(key);
  try { prune(storage, target, { now, staleLimitMs }); } catch { /* almacenamiento inaccesible */ }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      storage.setItem(target, raw);
      return true;
    } catch {
      // Cuota agotada: liberar las copias propias más antiguas y reintentar una vez.
      try { prune(storage, target, { now, staleLimitMs, dropOldest: true }); } catch { return false; }
    }
  }
  return false;
}

/**
 * Pinta desde la copia local (si existe) y revalida contra la red. `onData`
 * recibe `(data, { fromCache })`: una vez con la copia y otra con los datos
 * de red solo si difieren de lo ya pintado. Devuelve la promesa de la lectura
 * de red, que rechaza si falla y no hubo copia que pintar.
 */
export async function staleWhileRevalidate(key, load, onData, options = {}) {
  const cached = readCache(key, options);
  // Se compara contra la copia serializada antes de pintar: `onData` puede
  // mutar los objetos (p. ej. añadir `_days`).
  const cachedRaw = cached ? JSON.stringify(cached.data) : null;
  if (cached) onData(cached.data, { fromCache: true });
  let fresh;
  try {
    fresh = await load();
  } catch (error) {
    if (cached) return cached.data;
    throw error;
  }
  const freshRaw = JSON.stringify(fresh);
  writeCache(key, fresh, options);
  if (cachedRaw !== freshRaw) onData(fresh, { fromCache: false });
  return fresh;
}
