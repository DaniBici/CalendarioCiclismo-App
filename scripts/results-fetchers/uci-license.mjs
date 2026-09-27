// Normalización estricta del código UCI de licencia.
// El identificador de perfil /rider-details/<id> no pasa nunca por esta función como licencia.
// Este módulo valida payloads externos; las fichas de Supabase ya no almacenan este campo.

export function normalizeUciLicense(value) {
  if (value == null) return null;
  const compact = String(value).replace(/\s+/g, '').trim();
  return /^\d{11}$/.test(compact) ? compact : null;
}

function profileId(value) {
  const id = String(value ?? '').trim();
  return /^\d+$/.test(id) ? id : null;
}

function licenseValue(value) {
  if (value && typeof value === 'object') {
    return value.uciId ?? value.UciId ?? value.UCIId ?? value.uciID ?? value.uciLicenseId
      ?? value.license ?? value.licenseId ?? value['UCI ID'] ?? value['UCI_ID'] ?? null;
  }
  return value;
}

// Acepta un array de {uciProfileId, uciId} o un objeto {"profileId": "licenseId"}.
// El mapa debe ser completo y unívoco: un valor inválido o repetido aborta la ingesta.
export function loadUciLicenseMap(raw) {
  const entries = Array.isArray(raw)
    ? raw.map((record) => [
      record?.uciProfileId ?? record?.uciRiderId ?? record?.profileId
        ?? record?.userId ?? record?.UserId ?? record?.['User ID'] ?? record?.['USER ID']
        ?? record?.uciUserId ?? record?.id,
      record,
    ])
    : Object.entries(raw && typeof raw === 'object' ? raw : {});
  const byProfile = new Map();
  const byLicense = new Map();

  for (const [rawProfile, rawRecord] of entries) {
    const profile = profileId(rawProfile);
    const rawLicense = licenseValue(rawRecord);
    const license = normalizeUciLicense(rawLicense);
    if (!profile) throw new Error(`Mapa UCI inválido: perfil "${rawProfile ?? ''}"`);
    if (!license) throw new Error(`Mapa UCI inválido: licencia para perfil ${profile} no tiene 11 cifras`);
    if (byProfile.has(profile) && byProfile.get(profile) !== license) {
      throw new Error(`Mapa UCI ambiguo: perfil ${profile} tiene varias licencias`);
    }
    if (byLicense.has(license) && byLicense.get(license) !== profile) {
      throw new Error(`Mapa UCI ambiguo: licencia ${license} asignada a varios perfiles`);
    }
    byProfile.set(profile, license);
    byLicense.set(license, profile);
  }
  return byProfile;
}
