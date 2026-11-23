// Periodo en que la home de la web es Ciclocross: cada año, desde el día
// siguiente a la Chrono des Nations (el tercer domingo de octubre: 18-10-2026,
// 17-10-2027) hasta el domingo anterior al primer lunes del año siguiente
// (el primer lunes de 2027 es el 4 de enero). Empieza en 2026 y no se edita
// cada año. Las apps aplican la misma regla (RoadTodayAvailability).
// En ese periodo `/` (o `/en/`) sin fecha pinta la agenda de Ciclocross sin
// cambiar de URL, título ni texto estático, y el menú muestra Hoy en lugar de
// Ciclocross. Las URLs de días de carretera (`/?date=`) siguen abriendo Hoy,
// sin límite de navegación, y las dos vistas Hoy llevan el conmutador CX / Ruta
// (components/discipline-switch.js). También en ese periodo, Temporada
// (Calendario) abre por defecto en el año siguiente hasta el 31 de diciembre
// (Agenda sigue en el mes real) y Resultados y Vídeos muestran primero la
// pestaña Ciclocross.
// En la web, la chincheta de Carretera de los conmutadores de Hoy y de
// Resultados (una sola preferencia, persistida en localStorage) devuelve `/` a
// Hoy de carretera y Resultados a su pestaña Carretera para ese navegador;
// Ciclocross pasa entonces a `/ciclocross/` (o `/en/cyclocross/`). Menú y
// Temporada no cambian.
const FIRST_CX_HOME_DAY = '2026-10-19';

const dayKey = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Tercer domingo de octubre de `year`: día de la Chrono des Nations. */
function chronoDesNationsDay(year) {
  const weekday = new Date(Date.UTC(year, 9, 1)).getUTCDay(); // 0 = domingo
  return dayKey(year, 10, 1 + ((7 - weekday) % 7) + 14);
}

/** Primer lunes de enero de `year`: día en que se vuelve a Ruta. */
function firstMondayOfYear(year) {
  const weekday = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  return dayKey(year, 1, 1 + ((8 - weekday) % 7));
}
const ROAD_PIN_KEY = 'cc_default_discipline';

/** True si, en la fecha local `todayKey`, la home de la web es Ciclocross. */
export function cyclocrossHome(todayKey) {
  if (todayKey < FIRST_CX_HOME_DAY) return false;
  const year = Number(String(todayKey).slice(0, 4));
  return Number(String(todayKey).slice(5, 7)) >= 7
    ? todayKey > chronoDesNationsDay(year)
    : todayKey < firstMondayOfYear(year);
}

/** True si el usuario ha fijado Carretera como disciplina predeterminada. */
export function roadPinned() {
  try { return globalThis.localStorage?.getItem(ROAD_PIN_KEY) === 'road'; } catch { return false; }
}

export function setRoadPinned(pinned) {
  try {
    if (pinned) localStorage.setItem(ROAD_PIN_KEY, 'road');
    else localStorage.removeItem(ROAD_PIN_KEY);
  } catch { /* storage no disponible */ }
}

/** True si `/` (o `/en/`) sin fecha pinta la agenda de Ciclocross. */
export function cyclocrossLanding(todayKey) {
  return cyclocrossHome(todayKey) && !roadPinned();
}

/** Año por defecto de Temporada: el siguiente tras el cierre de la temporada de carretera, antes del 1 de enero. */
export function seasonCalendarYear(todayKey) {
  const year = Number(String(todayKey).slice(0, 4));
  // Solo de octubre a diciembre: del 1 al 4 de enero el año civil ya es el de la temporada.
  return cyclocrossHome(todayKey) && Number(String(todayKey).slice(5, 7)) >= 7 ? year + 1 : year;
}
