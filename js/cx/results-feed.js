// Pestaña Ciclocross de Resultados: pruebas con resultados publicados, por día
// y en orden cronológico inverso, con el ganador de cada categoría. Espejo de
// la lógica del feed CX de las apps.
import {cxCategories,cxDayRaces} from './presentation.js';
import {cxRaceDays} from './today.js';

const CX_RESULTS_STATUSES=['official','provisional'];
const hasWinner=c=>CX_RESULTS_STATUSES.includes(c.resultsStatus)&&!!c.winnerName;

// Una entrada por prueba y día con sus categorías con ganador, en el orden de
// categorías de la agenda (ME, WE, MU, WU, MJ, WJ).
export function cxResultEntries(races) {
  const days=cxRaceDays(races).reverse();
  return days.flatMap(date=>cxDayRaces(races,date)
    .map(race=>({date,race,categories:cxCategories(race,date).filter(hasWinner)}))
    .filter(entry=>entry.categories.length));
}
