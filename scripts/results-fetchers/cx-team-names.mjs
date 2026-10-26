/**
 * Nombres de equipo de cronometradores que publican en mayúsculas (Wiclax).
 *
 * Un nombre que coincide con un único equipo de `cx_teams` (nombre o alias,
 * plegado con `fold_team_name`) toma el nombre canónico de esa ficha. El resto
 * se pasa a grafía de presentación: palabras capitalizadas, partículas en
 * minúscula y siglas en mayúscula. Las tildes ausentes en la fuente no se
 * deducen.
 */

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'i', 'en', 'por', 'un', 'una', 'da', 'do', 'dos', 'das', 'di']);
const ACRONYMS = new Set(['AC', 'AD', 'BH', 'BMX', 'BTT', 'CC', 'CD', 'CDB', 'CDC', 'CDE', 'CX', 'GD', 'KE', 'MTB', 'PC', 'PCM',
  'SC', 'SCD', 'SD', 'SDR', 'TE', 'TKK', 'UC', 'UCI', 'XC', 'XCO']);
const VOWEL = /[AEIOUÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛ]/u;

function wordCase(word, first) {
  if (/\d/u.test(word) || ACRONYMS.has(word)) return word;
  const lower = word.toLowerCase();
  if (!first && PARTICLES.has(lower)) return lower;
  // Sin vocal es una sigla («HYD», «MMR»); la Y cuenta como vocal en palabras de dos letras («BY»).
  if (!VOWEL.test(word) && !(word.length <= 2 && word.includes('Y'))) return word;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Grafía de presentación de un nombre en mayúsculas; un nombre con minúsculas se conserva. */
export function cxTeamDisplayCase(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text !== text.toUpperCase() || text === text.toLowerCase()) return text || null;
  let first = true; let end = 0;
  return text.replace(/[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*\.?/gu, (token, offset) => {
    // Cada tramo separado por guion, barra o coma empieza con mayúscula («Bike Point - La Sede»).
    if (/[-/,]/u.test(text.slice(end, offset))) first = true;
    end = offset + token.length;
    // Iniciales con punto («C.D.», «S.C.D.», «K.T.C») se mantienen en mayúscula.
    const value = /^(?:\p{L}\.)+\p{L}?\.?$/u.test(token) ? token
      : token.split('.').map((part, index) => part && wordCase(part, first && index === 0)).join('.');
    first = false;
    return value;
  });
}

/**
 * Sustituye `teamName` de las filas: nombre canónico si hay un único equipo
 * con el mismo nombre plegado o alias; si no, grafía de presentación.
 */
export async function normalizeCxDocumentTeams(client, document) {
  const names = [...new Set(document.categories.flatMap(c => c.rows.map(row => row.teamName)).filter(Boolean))];
  if (!names.length) return document;
  const { rows } = await client.query(`SELECT s.name, (SELECT CASE WHEN count(*)=1 THEN min(t.name) END FROM public.cx_teams t
      WHERE public.fold_team_name(t.name)=public.fold_team_name(s.name)
         OR EXISTS (SELECT 1 FROM unnest(t."nameAliases") a WHERE public.fold_team_name(a)=public.fold_team_name(s.name))) AS canonical
    FROM unnest($1::text[]) AS s(name)`, [names]);
  const canonical = new Map(rows.map(row => [row.name, row.canonical]));
  for (const manga of document.categories) for (const row of manga.rows) {
    if (row.teamName) row.teamName = canonical.get(row.teamName) || cxTeamDisplayCase(row.teamName);
  }
  return document;
}
