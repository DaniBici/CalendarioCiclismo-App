// Horas del orden de salida en la zona del visitante, sin dependencias: lo usan el HTML de la
// página y el script previo al primer pintado de la versión publicada.
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Formateadores por zona, creados una vez por página: una CRI pasa por ellos
// en cada fila.
function zoneFormatters() {
  const cache = new Map();
  return (key, options) => {
    if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(options.locale, options.format));
    return cache.get(key);
  };
}

// Construye un Date que representa el instante en el que los relojes locales
// de `tz` marcan `dateStr` (YYYY-MM-DD) + `timeStr` (HH:MM[:SS]).
function raceLocalToInstant(dateStr, timeStr, tz, formatter) {
  if (!dateStr || !timeStr || !tz) return null;
  const [Y, M, D] = dateStr.split('-').map(Number);
  const [h, m, s = 0] = timeStr.split(':').map(Number);
  if (![Y, M, D, h, m].every(Number.isFinite)) return null;
  const wantedMs = Date.UTC(Y, M - 1, D, h, m, s);
  const parts = formatter(`parts|${tz}`, { locale: 'en-US', format: {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  } }).formatToParts(new Date(wantedMs));
  const get = type => Number(parts.find(p => p.type === type).value);
  const projectedMs = Date.UTC(get('year'), get('month') - 1, get('day'),
                               get('hour'), get('minute'), get('second'));
  return new Date(wantedMs - (projectedMs - wantedMs));
}

// "GMT+9", "GMT-5:30" para una TZ IANA en una fecha concreta (DST-correct).
function tzOffsetLabel(tz, atDate) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(atDate);
    const raw = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return raw.replace(/^GMT([+-])0?(\d+):00$/, 'GMT$1$2').replace(/^GMT([+-])0?(\d+):(\d{2})$/, 'GMT$1$2:$3');
  } catch { return ''; }
}

/**
 * Conversión de las horas de una jornada a `userTz`, o null si coinciden con las de la
 * jornada. `firstTime`: la primera hora, para decidirlo; `place`: el lugar de la hora oficial.
 */
export function startOrderConversion({ rdDate, raceTz, userTz, firstTime, place, isEn }) {
  if (!raceTz || !userTz || raceTz === userTz || !firstTime) return null;
  const formatter = zoneFormatters();
  const probe = raceLocalToInstant(rdDate, firstTime, raceTz, formatter);
  if (!probe) return null;
  const raceStr = probe.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: raceTz });
  const userStr = probe.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: userTz });
  if (raceStr === userStr) return null;
  return {
    noteHtml() {
      const userOffset = tzOffsetLabel(userTz, new Date(`${rdDate}T12:00:00Z`));
      const raceOffset = tzOffsetLabel(raceTz, new Date(`${rdDate}T12:00:00Z`));
      return `
    <div class="so-tz-note">
      ${isEn
        ? `Times shown in your local time${userOffset ? ` (${userOffset})` : ''}. Race-local time in ${escape(place)}${raceOffset ? ` (${raceOffset})` : ''} is shown on hover.`
        : `Horarios en tu hora local${userOffset ? ` (${userOffset})` : ''}. Pasa el ratón para ver la hora oficial en ${escape(place)}${raceOffset ? ` (${raceOffset})` : ''}.`}
    </div>`;
    },
    cellHtml(startTime) {
      const inst = raceLocalToInstant(rdDate, startTime, raceTz, formatter);
      if (!inst) return escape(startTime);
      // Como toLocaleTimeString('en-GB', …) con esas opciones.
      const time = formatter('time', { locale: 'en-GB', format: {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: userTz,
      } }).format(inst);
      // Si la fecha-en-zona-del-usuario difiere de la fecha de la carrera, anotar +1d / -1d
      const userDate = formatter('date', { locale: 'en-CA', format: { timeZone: userTz, year: 'numeric', month: '2-digit', day: '2-digit' } }).format(inst);
      let dayHint = '';
      if (userDate !== rdDate) {
        const diff = Math.round((Date.parse(userDate) - Date.parse(rdDate)) / 86400000);
        dayHint = diff > 0 ? `+${diff}d ` : `${diff}d `;
      }
      const tip = isEn ? `${startTime} local time in ${place}` : `${startTime} hora local en ${place}`;
      return `<span title="${escape(tip)}">${dayHint ? `<span class="so-day-shift">${dayHint}</span>` : ''}${escape(time)}</span>`;
    },
  };
}
