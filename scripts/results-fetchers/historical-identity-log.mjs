import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function sameIdentity(row, rider) {
  if (rider.eventIds?.length && !rider.eventIds.includes(Number(row.eventId))) return false;
  if (clean(row.bib) !== clean(rider.bib)) return false;
  const rowDisplay = clean(row.riderDisplay)?.toLocaleLowerCase('es') || null;
  const riderDisplay = clean(rider.display)?.toLocaleLowerCase('es') || null;
  return !rowDisplay || !riderDisplay || rowDisplay === riderDisplay;
}

export function pendingIdentityDetails(unresolvedRows, riders) {
  const pending = new Map();
  for (const row of unresolvedRows) {
    const rider = riders.find((candidate) => sameIdentity(row, candidate)) || {};
    const detail = {
      display: clean(row.riderDisplay) || clean(rider.display),
      firstName: clean(rider.firstName),
      lastName: clean(rider.lastName),
      birthDate: clean(rider.birthDate),
      countryCode: clean(rider.countryCode)?.toUpperCase() || null,
      teamName: clean(row.sourceTeamName) || clean(rider.teamName),
      bib: clean(row.bib) || clean(rider.bib),
      eventIds: [...new Set([Number(row.eventId), ...(rider.eventIds || [])]
        .filter(Number.isInteger))].sort((a, b) => a - b),
      uciProfileId: clean(row.sourceUciProfileId) || clean(rider.uciProfileId),
      uciLicenseId: clean(row.sourceUciLicense) || clean(rider.uciLicenseId),
    };
    detail.reason = !detail.display || !detail.firstName || !detail.lastName
      || !detail.birthDate || !detail.countryCode
      ? 'incomplete_source_identity'
      : 'no_unique_safe_match';
    const key = [detail.uciProfileId, detail.uciLicenseId, detail.display,
      detail.birthDate, detail.countryCode, detail.bib].join('|');
    const previous = pending.get(key);
    if (previous) {
      previous.eventIds = [...new Set([...previous.eventIds, ...detail.eventIds])].sort((a, b) => a - b);
    } else {
      pending.set(key, detail);
    }
  }
  return [...pending.values()];
}

export function appendHistoricalIdentityLog(file, record) {
  if (!file) throw new Error('Falta la ruta del registro de identidades históricas');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify({ schemaVersion: 1, ...record })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export function pendingHistoricalRaceIds(file) {
  const state = new Map();
  if (!file || !existsSync(file)) return new Set();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (!record.raceId) continue;
      if (record.type === 'identity_pending') state.set(record.raceId, true);
      if (record.type === 'identity_resolved') state.delete(record.raceId);
    } catch {
      // Una línea dañada no invalida el resto del registro append-only.
    }
  }
  return new Set(state.keys());
}
