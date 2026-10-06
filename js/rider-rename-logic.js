// Lógica pura del renombrado de slug de ficha de corredor (panel carretera y CX).
// La mantiene separada el panel para poder testearla sin DOM ni Supabase.

// Patrón de slug de ficha: minúsculas, dígitos y guiones (mismo que el RPC).
const RIDER_SLUG_PATTERN = /^[a-z0-9-]+$/;

export function isValidRiderSlug(slug) {
  return typeof slug === 'string' && RIDER_SLUG_PATTERN.test(slug);
}

// Clave de homónimo declarado: clave base del nombre nuevo + año de nacimiento
// PROPIO. El trigger de identity_key (migración 075) respeta una clave ya
// sufijada con el año de la fecha de nacimiento de la propia fila.
export function homonymIdentityKey(baseIdentityKey, birthDate) {
  if (!baseIdentityKey) return null;
  const year = typeof birthDate === 'string' ? birthDate.slice(0, 4) : '';
  return /^\d{4}$/.test(year) ? `${baseIdentityKey}-${year}` : null;
}

// Decisión ante un choque de identityKey al renombrar la ficha editada:
//  - misma persona → fusionar la ficha que choca en la editada (no se toca la clave).
//  - personas distintas → declarar homónimo fijando identityKey = base-añoPropio
//    y reintentar el update; bloqueado si falta fecha o la clave ya está ocupada.
export function planRenameIdentityKeyClash({ samePerson, baseIdentityKey, birthDate, homonymTaken }) {
  if (samePerson) return { action: 'merge' };
  const identityKey = homonymIdentityKey(baseIdentityKey, birthDate);
  if (!identityKey) {
    return { action: 'blocked', reason: 'no se pudo derivar la clave de homónimo (falta la fecha de nacimiento o el nombre)' };
  }
  if (homonymTaken) {
    return { action: 'blocked', reason: `la clave de homónimo ${identityKey} ya está ocupada por otra ficha`, identityKey };
  }
  return { action: 'homonym', identityKey };
}
