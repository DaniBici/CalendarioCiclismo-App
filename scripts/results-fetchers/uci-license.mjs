// Normalización estricta del código UCI de licencia.
// El identificador de perfil /rider-details/<id> no pasa nunca por esta función como licencia.
// Este módulo valida payloads externos; las fichas de Supabase ya no almacenan este campo.

export function normalizeUciLicense(value) {
  if (value == null) return null;
  const compact = String(value).replace(/\s+/g, '').trim();
  return /^\d{11}$/.test(compact) ? compact : null;
}
