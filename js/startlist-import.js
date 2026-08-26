// Contrato local de importación de inscritos v1. No resuelve identidades: el
// resultado solo alimenta el editor para que la asignación se revise a mano.

function clean(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function issue(errors, path, message) {
  errors.push({ path, message });
}

function splitRiderName(value) {
  const riderName = clean(value);
  const comma = riderName.indexOf(',');
  if (comma >= 0) {
    return {
      firstName: clean(riderName.slice(comma + 1)),
      lastName: clean(riderName.slice(0, comma)),
    };
  }
  const [firstName = '', ...lastName] = riderName.split(' ');
  return { firstName, lastName: lastName.join(' ') };
}

/**
 * Valida el archivo reducido que se carga en el editor de inscritos.
 *
 * Formato emitido: { raceId, expectedRiderCount, teams:[{ teamName,
 * riders:[{ dorsal, riderName }] }] }. Se aceptan name y firstName/lastName
 * como aliases de entrada para mantener compatibilidad con los manifiestos
 * anteriores. El resultado no transporta ni genera globalRiderId.
 */
export function parseStartlistImportDocument(document) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { ok: false, errors: [{ path: '$', message: 'El archivo debe contener un objeto JSON.' }] };
  }
  if (!Array.isArray(document.teams) || document.teams.length === 0) {
    return { ok: false, errors: [{ path: '$.teams', message: 'Falta una lista de equipos.' }] };
  }

  const seenBibs = new Set();
  const teams = document.teams.map((team, teamIndex) => {
    const teamPath = `$.teams[${teamIndex}]`;
    const name = clean(team?.teamName ?? team?.name);
    if (!name) issue(errors, `${teamPath}.teamName`, 'Falta el nombre del equipo.');
    if (!Array.isArray(team?.riders) || team.riders.length === 0) {
      issue(errors, `${teamPath}.riders`, 'El equipo debe incluir al menos un corredor.');
    }

    const riders = (team?.riders || []).map((rider, riderIndex) => {
      const riderPath = `${teamPath}.riders[${riderIndex}]`;
      const dorsal = clean(rider?.dorsal);
      if (!/^[1-9]\d*$/.test(dorsal)) {
        issue(errors, `${riderPath}.dorsal`, 'El dorsal debe ser un decimal positivo sin ceros a la izquierda.');
      } else if (seenBibs.has(dorsal)) {
        issue(errors, `${riderPath}.dorsal`, `Dorsal duplicado: ${dorsal}.`);
      } else {
        seenBibs.add(dorsal);
      }

      const riderName = clean(rider?.riderName ?? rider?.name);
      const explicitFirstName = clean(rider?.firstName);
      const explicitLastName = clean(rider?.lastName);
      if (!riderName && (!explicitFirstName || !explicitLastName)) {
        issue(errors, riderPath, 'Incluye riderName o firstName y lastName.');
      }
      const parsedName = riderName ? splitRiderName(riderName) : {
        firstName: explicitFirstName,
        lastName: explicitLastName,
      };
      return { dorsal, ...parsedName };
    });
    return { name, riders };
  });

  const riderCount = teams.reduce((total, team) => total + team.riders.length, 0);
  if (document.expectedRiderCount != null && Number(document.expectedRiderCount) !== riderCount) {
    issue(errors, '$.expectedRiderCount', `Declara ${document.expectedRiderCount} corredores, pero el archivo contiene ${riderCount}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    raceId: clean(document.raceId) || null,
    teams,
    summary: { teams: teams.length, riders: riderCount },
  };
}

/**
 * Comprueba que el destino elegido en el panel coincide con el destino
 * declarado por el JSON. raceId es opcional en el contrato, pero la carrera
 * elegida en el panel siempre es obligatoria.
 */
export function validateStartlistImportTarget(selectedRaceId, documentRaceId) {
  const selected = clean(selectedRaceId);
  const declared = clean(documentRaceId);
  if (!selected) {
    return { ok: false, error: 'Selecciona la carrera de destino.' };
  }
  if (declared && declared !== selected) {
    return {
      ok: false,
      error: `El JSON corresponde a ${declared}, no a la carrera seleccionada.`,
    };
  }
  return { ok: true, raceId: selected };
}

/**
 * Carreras disponibles para crear una lista desde el panel. El día se recibe
 * ya resuelto en la zona horaria de producto para que el filtro sea estable.
 */
export function selectUpcomingStartlistRaces(races, today, query = '', limit = 250) {
  const dateKey = clean(today);
  const normalizedQuery = clean(query).toLocaleLowerCase('es');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];

  return [...(Array.isArray(races) ? races : [])]
    .filter(race => {
      const startDate = clean(race?.startDate);
      if (!startDate || startDate < dateKey) return false;
      if (!normalizedQuery) return true;
      return `${race?.name || ''} ${race?.id || ''} ${startDate}`
        .toLocaleLowerCase('es')
        .includes(normalizedQuery);
    })
    .sort((a, b) => clean(a.startDate).localeCompare(clean(b.startDate))
      || clean(a.name).localeCompare(clean(b.name), 'es'))
    .slice(0, limit);
}

// La RPC puede informar más de un candidato si una clave directa y un alias
// curado apuntan a fichas distintas. Solo un único id permite el enlace.
export function uniqueExistingRiderMatchId(match) {
  return Number(match?.match_count) === 1 && clean(match?.matched_id)
    ? clean(match.matched_id)
    : null;
}
