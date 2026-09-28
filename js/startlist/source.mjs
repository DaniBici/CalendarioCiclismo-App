// Contrato completo compartido por el panel y la importación vía MCP.
const clean = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
function titleSegment(segment) {
  if (!segment) return segment;
  if (/[a-záéíóúüñøłßæœ]/u.test(segment) && /[A-ZÁÉÍÓÚÜÑØŁẞÆŒ]/u.test(segment)) return segment;
  const chars = [...segment.toLocaleLowerCase('es')];
  if (!chars.length) return segment;
  return chars[0].toLocaleUpperCase('es') + chars.slice(1).join('');
}

export function normalizePersonName(value) {
  return clean(value)
    .split(' ')
    .map((token) => token.split(/([-'])/).map((part) => part === '-' || part === "'" ? part : titleSegment(part)).join(''))
    .join(' ');
}


export function normalizeStartlistSource(source) {
  if (!source || !Array.isArray(source.teams) || !source.teams.length) throw new Error('Faltan equipos.');
  if (!clean(source.raceId)) throw new Error('Falta raceId.');
  const seenBibs = new Set();
  const seenRowKeys = new Set();
  const seenTeams = new Set();
  let riderCount = 0;
  const teams = source.teams.map((team, teamIndex) => {
    const teamName = clean(team?.teamName ?? team?.name);
    const key = teamName.toLocaleLowerCase('es');
    if (!teamName || seenTeams.has(key)) throw new Error(`Equipo vacío o duplicado en posición ${teamIndex}.`);
    seenTeams.add(key);
    if (!Array.isArray(team.riders)) throw new Error(`${teamName}: faltan corredores.`);
    const riders = team.riders.map((rider, riderIndex) => {
      const rawDorsal = clean(rider?.dorsal).replace(/^0+(?=\d)/, '');
      const dorsal = rawDorsal || '0';
      if (!/^(0|[1-9]\d{0,8})$/.test(dorsal)) throw new Error(`Dorsal inválido: ${dorsal}.`);
      if (dorsal !== '0' && seenBibs.has(dorsal)) throw new Error(`Dorsal duplicado: ${dorsal}.`);
      if (dorsal !== '0') seenBibs.add(dorsal);
      const rowKey = clean(rider?.rowKey) || `${teamIndex}:${riderIndex}`;
      if (seenRowKeys.has(rowKey)) throw new Error(`Identificador de fila duplicado: ${rowKey}.`);
      seenRowKeys.add(rowKey);
      riderCount += 1;
      const firstName = normalizePersonName(rider.firstName ?? rider.givenName);
      const lastName = normalizePersonName(rider.lastName ?? rider.familyName);
      const riderLabel = dorsal === '0' ? 'Corredor sin dorsal' : `Dorsal ${dorsal}`;
      if (!firstName || !lastName) throw new Error(`${riderLabel}: faltan nombre y apellidos separados según la fuente.`);
      const row = { rowKey, dorsal: Number(dorsal), firstName, lastName };
      for (const field of ['startlistRiderId', 'globalRiderId', 'birthDate', 'otherNames', 'uciProfileId', 'sourceUrl']) {
        if (clean(rider[field])) row[field] = clean(rider[field]);
      }
      if (rider.riderGender != null) {
        if (!['male', 'female'].includes(rider.riderGender)) throw new Error(`${riderLabel}: riderGender debe ser male|female.`);
        row.riderGender = rider.riderGender;
      }
      if (clean(rider.countryCode ?? rider.nationality)) row.countryCode = clean(rider.countryCode ?? rider.nationality).toLowerCase();
      if (rider.rejectedCandidateIds != null) {
        if (!Array.isArray(rider.rejectedCandidateIds) || rider.rejectedCandidateIds.some(id => !clean(id))) throw new Error(`${riderLabel}: candidatos descartados inválidos.`);
        row.rejectedCandidateIds = [...new Set(rider.rejectedCandidateIds.map(clean))];
      }
      return row;
    });
    return { teamName, ...(clean(team.teamId ?? team.teamIdRef) ? { teamId: clean(team.teamId ?? team.teamIdRef) } : {}),
      isConfirmed: team.isConfirmed === true, riders };
  });
  const expectedRiderCount = Number(source.expectedRiderCount);
  if (!Number.isInteger(expectedRiderCount) || expectedRiderCount < 1 || expectedRiderCount !== riderCount) {
    throw new Error(`Recuento oficial ${source.expectedRiderCount}; extraídos ${riderCount}.`);
  }
  return { raceId: clean(source.raceId), expectedRiderCount, ...(clean(source.sourceUrl) ? { sourceUrl: clean(source.sourceUrl) } : {}), teams };
}
