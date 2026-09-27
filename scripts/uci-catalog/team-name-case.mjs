const lowerWords = new Set([
  'A', 'AN', 'AND', 'AT', 'BY', 'DA', 'DAS', 'DE', 'DEL', 'DELLA', 'DES', 'DI', 'DO', 'DOS',
  'DU', 'E', 'EL', 'ET', 'FOR', 'IN', 'LA', 'LE', 'OF', 'ON', 'P/B', 'PARA', 'THE', 'VAN',
  'VON', 'Y', 'X',
]);

const displayWords = new Map(Object.entries({
  ACADEMY: 'Academy', BIKE: 'Bike', BIKES: 'Bikes', CLUB: 'Club', CONTINENTAL: 'Continental',
  CYCLING: 'Cycling', DEVELOPMENT: 'Development', EQUIPE: 'Equipe', FEMININ: 'Feminin',
  LADIES: 'Ladies', PRO: 'Pro', PROTOUCH: 'ProTouch', RACING: 'Racing', SPORT: 'Sport', TEAM: 'Team', WOMEN: 'Women',
  WOMENS: "Women's", BEPINK: 'BePink', INEOS: 'Ineos', LIDL: 'Lidl', LIV: 'Liv', UNO: 'Uno',
  ALPECIN: 'Alpecin', FENIX: 'Fenix', JUMBO: 'Jumbo', VISMA: 'Visma',
  SUEZCANALDISCOVERY: 'SuezCanalDiscovery',
}));

const upperWords = new Set([
  'AC', 'AG2R', 'AI', 'ARBO', 'ARBÖ', 'B&B', 'BHS', 'BTC', 'CCC', 'CC', 'CT', 'DSM', 'EF',
  'EFAPEL', 'FDJ', 'GW', 'HKSI', 'HPH', 'IBCT', 'KSPO', 'KTM', 'LKT', 'MAT', 'MTB', 'NEXETIS',
  'NTT', 'P&S', 'PHI', 'RSC', 'TIBCO',
  'SRAM', 'TJV', 'U23', 'UAE', 'UCI', 'UK', 'USA', 'VC', 'VICC', 'WB', 'WCC', 'WT', 'XDS',
]);

const exactNames = new Map(Object.entries({
  "ALE' BTC LJUBLJANA": 'Alé BTC Ljubljana',
  'CANYON / /SRAM RACING': 'Canyon//SRAM Racing',
  'CCC - LIV': 'CCC - Liv',
  'B&B HOTELS - VITAL CONCEPT': 'B&B Hotels - Vital Concept',
  "BARDIANI CSF FAIZANE'": 'Bardiani CSF Faizanè',
  'CCACHE X PAR KÜP': 'CCACHE x Par Küp',
  'REMBE | RAD-NET': 'REMBE | rad-net',
}));

const letters = /\p{L}/u;
const wordPattern = /[\p{L}\p{N}]+(?:[.'&+][\p{L}\p{N}]+)*/gu;
const upperKey = value => value.normalize('NFC').toLocaleUpperCase('und');
const capitalized = value => {
  const chars = [...value.toLocaleLowerCase('und')];
  return chars.length ? chars[0].toLocaleUpperCase('und') + chars.slice(1).join('') : value;
};

export function isAllCapsTeamName(value) {
  const clean = String(value || '').normalize('NFC').trim();
  return letters.test(clean) && clean === clean.toLocaleUpperCase('und');
}

export function buildPreferredTeamWordCase(names) {
  const observed = new Map();
  for (const name of names) {
    if (isAllCapsTeamName(name)) continue;
    for (const token of String(name || '').match(wordPattern) || []) {
      const key = upperKey(token), forms = observed.get(key) || new Map();
      forms.set(token, (forms.get(token) || 0) + 1); observed.set(key, forms);
    }
  }
  return new Map([...observed].flatMap(([key, forms]) => {
    const ranked = [...forms].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return ranked.length === 1 || ranked[0][1] > ranked[1][1] ? [[key, ranked[0][0]]] : [];
  }));
}

export function normalizeTeamDisplayName(value, { preferredCase = new Map() } = {}) {
  const clean = String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!isAllCapsTeamName(clean)) return clean;
  if (exactNames.has(clean)) return exactNames.get(clean);
  let wordIndex = 0;
  const normalized = clean.replace(wordPattern, token => {
    const key = upperKey(token), first = wordIndex++ === 0;
    if (displayWords.has(key)) return displayWords.get(key);
    if (!first && lowerWords.has(key)) return key.toLocaleLowerCase('und');
    if (preferredCase.has(key)) return preferredCase.get(key);
    if (upperWords.has(key) || (/^[A-ZÀ-ÖØ-Þ0-9]{2,3}$/u.test(token) && !lowerWords.has(key))) return key;
    return capitalized(token);
  });
  return normalized.replace(/\s*\/\s*\/\s*/g, '//').replace(/\bP\/B\b/g, 'p/b')
    .replace(/\s+([,;)])/g, '$1');
}
