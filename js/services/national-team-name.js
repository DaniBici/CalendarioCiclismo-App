// Selecciones nacionales: el catálogo guarda el nombre UCI en inglés
// («France»). En castellano se muestra el país en castellano a partir del
// código de la ficha («Francia»); en inglés, el nombre sin cambio. Solo afecta
// a fichas con teamKind 'selection' y selectionScope 'national'. Espejo de
// `Team.localizedName` (iOS) y `TeamNames.localized` (Android).

// Denominaciones fijas: las que difieren del nombre del sistema y las que
// cambiaron entre versiones de CLDR. Clave: countryCode o, sin país,
// selectionCode.
const NAMES_ES = {
  ain: 'Deportistas Individuales Neutrales',
  ci: 'Costa de Marfil',
  cz: 'República Checa',
  gb: 'Gran Bretaña',
  hk: 'Hong Kong',
  mk: 'Macedonia del Norte',
  mo: 'Macao',
};

let regionNamesEs = null;

function isNationalSelection(team) {
  return team?.teamKind === 'selection' && team?.selectionScope === 'national';
}

// `name` es el texto que se mostraría sin traducir; de él se conserva la
// categoría de edad («Canada U23» → «Canadá sub23»).
export function localizedTeamName(name, team, isEn) {
  if (isEn || !isNationalSelection(team)) return name;
  const code = String(team.countryCode || team.selectionCode || '').toLowerCase();
  let country = NAMES_ES[code] || null;
  if (!country && /^[a-z]{2}$/.test(code) && typeof Intl.DisplayNames === 'function') {
    regionNamesEs ||= new Intl.DisplayNames(['es'], { type: 'region' });
    const label = regionNamesEs.of(code.toUpperCase());
    if (label && label !== code.toUpperCase()) country = label;
  }
  if (!country) return name;
  const age = /\bU(\d{2})\b/i.exec(name || '');
  return age ? `${country} sub${age[1]}` : country;
}
