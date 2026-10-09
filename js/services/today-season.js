// Último día de la temporada de carretera, por año natural. Desde el día
// siguiente y hasta el 31 de diciembre de ese año, la home de la web es
// Ciclocross: el menú lo sitúa primero y oculta Hoy, y `/` (o `/en/`) sin
// fecha pinta la agenda de Ciclocross sin cambiar de URL, título ni texto
// estático. Las URLs de días de carretera (`/?date=`) siguen abriendo Hoy, sin
// límite de navegación. En ese mismo periodo, Temporada (Calendario) abre por
// defecto en el año siguiente (Agenda sigue en el mes real) y Resultados
// muestra primero la pestaña Ciclocross. Desde el 1 de enero todo vuelve a la
// configuración anterior al cierre. Un año sin entrada
// no cede la home. En las apps, Hoy queda oculta hasta el 1 de enero
// (RoadTodayAvailability).
const ROAD_SEASON_LAST_DAY = Object.freeze({
  2026: '2026-10-18',
});

/** True si, en la fecha local `todayKey`, la home de la web es Ciclocross. */
export function cyclocrossHome(todayKey) {
  const lastDay = ROAD_SEASON_LAST_DAY[Number(String(todayKey).slice(0, 4))];
  return !!lastDay && todayKey > lastDay;
}

/** Año por defecto de Temporada: el siguiente tras el cierre de la temporada de carretera. */
export function seasonCalendarYear(todayKey) {
  const year = Number(String(todayKey).slice(0, 4));
  return cyclocrossHome(todayKey) ? year + 1 : year;
}
