const PG_BIGINT_MAX = 9223372036854775807n;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// DataRide CX expresa algunos tiempos inferiores a una hora como MM:SS:ff y
// los que superan una hora como H:MM:SS. El contrato no identifica la escala
// de ff: solo se convierte cuando es 00, que equivale exactamente a segundos.
export function cxDataRideSeconds(value, { gap = false, format = 'auto' } = {}) {
  const text = clean(value);
  const underHour = !gap && format !== 'hms' && /^(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (underHour && Number(underHour[1]) > 0) {
    const minutes = Number(underHour[1]);
    const seconds = Number(underHour[2]);
    if (minutes > 59 || seconds > 59 || underHour[3] !== '00') return null;
    return String(minutes * 60 + seconds);
  }

  const pattern = gap ? /^\+?(?:\d+|\d+:\d{2}|\d+:\d{2}:\d{2})$/ : /^(?:\d+:\d{2}:\d{2}|\d+:\d{2})$/;
  if (!pattern.test(text)) return null;
  const parts = text.replace(/^\+/, '').split(':');
  if (parts.slice(1).some(part => Number(part) > 59) || (parts.length === 1 && Number(parts[0]) > 59 && !gap)) return null;
  const result = parts.reduce((sum, part) => sum * 60n + BigInt(part), 0n);
  return result <= PG_BIGINT_MAX ? result.toString() : null;
}

export function isCxSubhourDataRideTime(value) {
  const match = /^(\d{2}):\d{2}:\d{2}$/.exec(clean(value));
  return !!match && Number(match[1]) > 0;
}

export function isCxExactSubhourDataRideTime(value) {
  return /^(?:0[1-9]|[1-5]\d):[0-5]\d:00$/.test(clean(value));
}
