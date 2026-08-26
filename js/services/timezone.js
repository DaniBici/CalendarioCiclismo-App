// Convierte una hora civil de una zona IANA al instante UTC correspondiente.
// No aplica convenciones editoriales de "pasada medianoche": la fecha recibida
// es siempre la fecha civil exacta que se conserva.
export function zonedTimeToTimestamp(dateKey, timeStr, timeZone) {
  if (!dateKey || !timeStr || !timeZone) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute, second = 0] = timeStr.split(':').map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;

  const wantedMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(wantedMs));
  const get = type => Number(parts.find(p => p.type === type)?.value);
  const projectedMs = Date.UTC(get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'));
  return new Date(wantedMs - (projectedMs - wantedMs)).toISOString();
}

export function madridTimeToTimestamp(dateKey, timeStr) {
  return zonedTimeToTimestamp(dateKey, timeStr, 'Europe/Madrid');
}

export function dateKeyInTimeZone(timestamp, timeZone) {
  if (!timestamp || !timeZone) return null;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function madridDateKey(timestamp) {
  return dateKeyInTimeZone(timestamp, 'Europe/Madrid');
}
