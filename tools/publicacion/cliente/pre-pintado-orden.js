// Antes del primer pintado: horas del orden de salida en la zona del visitante. Publicada en
// la zona de la jornada, solo se reescribe si la del visitante es otra.
import { startOrderConversion } from '../../../js/orden-salida-zona.js';

const main = document.querySelector('main[data-clave]');
const celdas = [...main.querySelectorAll('td.so-td--time')];
let zona = null;
try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* Sin zona. */ }
const conversion = startOrderConversion({
  rdDate: main.dataset.dateKey, raceTz: main.dataset.raceTz, userTz: zona, firstTime: celdas[0]?.textContent,
  place: main.dataset.lugar, isEn: document.documentElement.lang === 'en',
});
if (conversion) {
  for (const celda of celdas) celda.innerHTML = conversion.cellHtml(celda.textContent);
  main.querySelector('.so-table-wrap')?.insertAdjacentHTML('beforebegin', conversion.noteHtml());
}
const filtros = main.querySelector('#soFilters');
if (filtros) document.documentElement.style.setProperty('--res-tabs-h', `${Math.ceil(filtros.getBoundingClientRect().height)}px`);
