// Último día de la temporada de carretera, por año natural. Desde el día
// siguiente y hasta el 31 de diciembre de ese año, la home de la web es
// Ciclocross: `/` (o `/en/`) sin fecha pinta la agenda de Ciclocross sin
// cambiar de URL, título ni texto estático, y el menú muestra Hoy en lugar de
// Ciclocross. Las URLs de días de carretera (`/?date=`) siguen abriendo Hoy, sin
// límite de navegación, y las dos vistas Hoy llevan el conmutador CX / Ruta
// (components/discipline-switch.js). En ese mismo periodo, Temporada
// (Calendario) abre por defecto en el año siguiente (Agenda sigue en el mes
// real) y Resultados muestra primero la pestaña Ciclocross. Desde el 1 de enero
// todo vuelve a la configuración anterior al cierre. Un año sin entrada no cede
// la home. En las apps, Hoy de carretera queda fuera de la barra hasta el 1 de
// enero (RoadTodayAvailability): la pestaña Ciclocross se rotula Hoy y lo abre
// desde ese conmutador.
// En la web, la chincheta de Carretera de los conmutadores de Hoy y de
// Resultados (una sola preferencia, persistida en localStorage) devuelve `/` a
// Hoy de carretera y Resultados a su pestaña Carretera para ese navegador;
// Ciclocross pasa entonces a `/ciclocross/` (o `/en/cyclocross/`). Menú y
// Temporada no cambian.
const ROAD_SEASON_LAST_DAY = Object.freeze({
  2026: '2026-10-18',
});
const ROAD_PIN_KEY = 'cc_default_discipline';

/** True si, en la fecha local `todayKey`, la home de la web es Ciclocross. */
export function cyclocrossHome(todayKey) {
  const lastDay = ROAD_SEASON_LAST_DAY[Number(String(todayKey).slice(0, 4))];
  return !!lastDay && todayKey > lastDay;
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

/** Año por defecto de Temporada: el siguiente tras el cierre de la temporada de carretera. */
export function seasonCalendarYear(todayKey) {
  const year = Number(String(todayKey).slice(0, 4));
  return cyclocrossHome(todayKey) ? year + 1 : year;
}
