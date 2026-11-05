/**
 * Bonos por ronda de una general por tiempo desde el informe de Chronorace (X2O Badkamers Trofee).
 *
 * El informe vive en el contexto `AAAAMMDD_<sufijo>` y publica por categoría:
 *
 *   RESnn   columna Bonif (celda vacía si el corredor no suma bonos) y, en cada paso por meta,
 *           el tiempo de la vuelta y el acumulado, cada uno con su puesto entre paréntesis
 *   BESTnn  mejor vuelta de cada corredor, con su puesto
 *
 * Bonif solo se acepta si equivale a los seis premios del reglamento: 15/10/5 segundos del sprint
 * por el acumulado al terminar la primera vuelta y 15/10/5 de las tres mejores vueltas. Identificados
 * los seis, una celda vacía y una fila sin correspondencia en el informe valen 0. Los bonos no se
 * deducen del puesto de meta ni de la general.
 */
import { acnSeconds, clean } from './acn-cx-fetch.mjs';

const PRIZES = [15, 10, 5];
const ROUND_TOTAL = 60;

export const chronoraceContext = (dateKey, suffix) => `${String(dateKey).replaceAll('-', '')}_${suffix}`;
export const chronoraceTableUrl = (ctx, key) => `https://results.chronorace.be/api/results/table/search/${encodeURIComponent(ctx)}/${encodeURIComponent(key)}?srch=&fromRecord=0&pageSize=1000`;

/** Claves de las tablas Results y Best lap de una categoría, a partir de `acnCategories` del árbol del informe. */
export function chronoraceReportKeys(found, category) {
  const keys = found.filter(item => item.category === category).map(item => item.key);
  const results = keys.find(key => /^RES\d+$/.test(key));
  const bestLap = keys.find(key => /^BEST\d+$/.test(key));
  return results && bestLap ? { results, bestLap } : null;
}

const fieldOf = (table, name) => {
  const column = table?.TableDefinition?.Columns?.find(item => item.Name === name);
  if (!column) throw new Error(`Columna de Chronorace ausente: ${name}`);
  return column.FieldIdx;
};
const rowsOf = table => {
  const rows = table?.Groups?.[0]?.SlaveRows;
  if (!Array.isArray(rows)) throw new Error('Tabla de Chronorace sin filas');
  return rows;
};
const positionOf = value => Number(/^(\d+)\.?$/.exec(clean(value))?.[1]) || null;
const riderOf = value => {
  const display = String(value ?? '');
  return { name: clean(/<b>([\s\S]*?)<\/b>/i.exec(display)?.[1]), license: /<font[^>]*>\s*(\d{11})\s*-/i.exec(display)?.[1] || null };
};

/**
 * `complete=false` mientras Bonif no reparte los 60 segundos de la ronda. Un total mayor o un reparto
 * que no coincide con los seis premios es un error: la ronda queda sin bonos hasta revisarla.
 */
export function parseChronoraceBonuses({ results, bestLap }) {
  const field = { position: fieldOf(results, 'sR_Pos'), bib: fieldOf(results, 'sR_Nr'), rider: fieldOf(results, 'Name / Team'),
    laps: fieldOf(results, 'sC_Laps'), bonus: fieldOf(results, 'sR_Bonif') };
  const sections = results.TableDefinition.Columns.filter(item => /_gSections_\d+$/.test(item.Name)).map(item => item.FieldIdx);
  const rows = rowsOf(results).map(raw => {
    const text = clean(raw[field.bonus]);
    const bonus = text ? acnSeconds(text) : 0;
    if (bonus == null) throw new Error(`Bonif no reconocido: «${text}»`);
    return { raw, position: positionOf(raw[field.position]), bib: clean(raw[field.bib]) || null, ...riderOf(raw[field.rider]), bonus };
  });
  const winner = rows.find(row => row.position === 1);
  if (!winner) throw new Error('El informe de Chronorace no tiene ganador');
  const plain = ({ bib, name, license }) => ({ bib, name, license });
  const total = rows.reduce((sum, row) => sum + row.bonus, 0);
  if (total < ROUND_TOTAL) return { complete: false, total, winner: plain(winner), awards: [] };
  if (total > ROUND_TOTAL) throw new Error(`Bonif suma ${total} segundos en una ronda de ${ROUND_TOTAL}`);

  // Con bucle de salida la primera vuelta es la segunda sección; sin él, la primera.
  const passes = sections.filter(index => clean(winner.raw[index])).length;
  const firstLap = passes - (Number(clean(winner.raw[field.laps])) || 0);
  if (firstLap !== 0 && firstLap !== 1) throw new Error(`Secciones (${passes}) y vueltas del ganador no identifican la primera vuelta`);
  const cumulativeRank = row => Number(/\((\d+)\)$/.exec(clean(row.raw[sections[firstLap]]))?.[1]) || null;
  const earned = new Map();
  const prize = (row, seconds, kind, rank) => {
    const entry = earned.get(row) || { ...plain(row), seconds: 0 };
    earned.set(row, { ...entry, seconds: entry.seconds + seconds, [kind]: rank });
  };
  PRIZES.forEach((seconds, index) => {
    const found = rows.filter(row => cumulativeRank(row) === index + 1);
    if (found.length !== 1) throw new Error(`Sprint sin un único corredor en el puesto ${index + 1}`);
    prize(found[0], seconds, 'sprint', index + 1);
  });
  const bestField = { position: fieldOf(bestLap, 'sR_Pos'), bib: fieldOf(bestLap, 'sI_Nr') };
  PRIZES.forEach((seconds, index) => {
    const best = rowsOf(bestLap).filter(raw => positionOf(raw[bestField.position]) === index + 1);
    const found = best.length === 1 ? rows.filter(row => row.bib === clean(best[0][bestField.bib])) : [];
    if (found.length !== 1) throw new Error(`Mejor vuelta sin un único corredor en el puesto ${index + 1}`);
    prize(found[0], seconds, 'lap', index + 1);
  });
  const differing = rows.filter(row => (earned.get(row)?.seconds || 0) !== row.bonus);
  if (differing.length) throw new Error(`Bonif no coincide con los premios: ${differing.map(row => `${row.name} ${row.bonus}`).join(', ')}`);
  return { complete: true, total, winner: plain(winner), awards: [...earned.values()] };
}

const foldedName = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').sort().join(' ');
function rowOfRider(rider, rows) {
  const byLicense = rider.license ? rows.filter(row => row.uciLicenseId === rider.license
    || (row.uciProfileId != null && Number(row.uciProfileId) === Number(rider.license.slice(2, 9)))) : [];
  if (byLicense.length === 1) return byLicense[0];
  const byName = rows.filter(row => foldedName(row.riderDisplay) === foldedName(rider.name));
  return byName.length === 1 ? byName[0] : null;
}

/** Bono de cada fila vigente de la manga: `{id de cx_results: segundos}`. */
export function chronoraceBonusMap(parsed, rows) {
  if (rowOfRider(parsed.winner, rows)?.rank !== 1) throw new Error(`El ganador del informe (${parsed.winner.name}) no es el de la clasificación cargada`);
  const bonuses = Object.fromEntries(rows.map(row => [row.id, 0]));
  for (const award of parsed.awards) {
    const row = rowOfRider(award, rows);
    if (!row) throw new Error(`Premiado sin fila en la clasificación cargada: ${award.name}`);
    bonuses[row.id] += award.seconds;
  }
  return bonuses;
}
