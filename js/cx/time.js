const PG_BIGINT_MAX = 9223372036854775807n;
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// DataRide CX expresa algunos tiempos inferiores a una hora como MM:SS:ff y
// los que superan una hora como H:MM:SS. El contrato no identifica la escala
// de ff: solo se convierte cuando es 00, que equivale exactamente a segundos.
// Una fracción tras el último bloque («00:37:57.563», Munich 2026) solo puede
// ser de segundos: fija H:MM:SS y se trunca al segundo entero.
export function cxDataRideSeconds(value, { gap = false, format = 'auto' } = {}) {
  const fraction = /^(.*:\d{2})[.,]\d+$/.exec(clean(value));
  const text = fraction ? fraction[1] : clean(value);
  // Dialecto M'SS / MM'SS de los cronometradores franceses (Gernelle 2026,
  // «38'45»): minutos y segundos exactos, sin fracción ni horas.
  const apostrophe = !gap && /^(\d{1,2})'(\d{2})$/.exec(text);
  if (apostrophe) return Number(apostrophe[2]) > 59 ? null : String(Number(apostrophe[1]) * 60 + Number(apostrophe[2]));
  // Mismo dialecto con horas («1h03'25», Gernelle ME 2026): H + h + MM + ' + SS exactos.
  const hourApostrophe = !gap && /^(\d{1,2})h(\d{2})'(\d{2})$/.exec(text);
  if (hourApostrophe) {
    const [hours, minutes, seconds] = hourApostrophe.slice(1).map(Number);
    return minutes > 59 || seconds > 59 ? null : String(hours * 3600 + minutes * 60 + seconds);
  }
  if (fraction) format = 'hms';
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
