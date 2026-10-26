// Conmutador Ciclocross / Carretera de Hoy, al final de la franja de filtros.
// Solo existe mientras la home es Ciclocross (services/today-season.js): CX
// abre la agenda de Ciclocross de la home y Ruta, Hoy de carretera del día
// (`?date=`). Etiqueta completa en escritorio y corta en móvil, como los
// chips. Espejo de `HomeDisciplineSwitch` en iOS y Android.
// Carretera lleva la chincheta de los filtros: activa en Hoy de carretera,
// fija o quita Carretera como disciplina predeterminada (la misma de
// Resultados); fijada, CX enlaza a la página de Ciclocross y Ruta a `/`, y en
// la agenda de Ciclocross la chincheta llena solo indica el estado.
import { t, getLang } from '../i18n.js';
import { roadPinned, setRoadPinned } from '../services/today-season.js';
import { PIN_SVG_FILLED, PIN_SVG_OUTLINE } from '../shared.js';

export function disciplineSwitchHtml(active, todayKey) {
  const en = getLang() === 'en';
  const home = en ? '/en/' : '/';
  const pinned = roadPinned();
  const options = [
    ['cyclocross', pinned ? (en ? '/en/cyclocross/' : '/ciclocross/') : home],
    ['road', pinned ? home : `${home}?date=${todayKey}`],
  ];
  return `<nav class="discipline-switch" aria-label="${t('today.discipline')}">${options.map(([key, href]) => {
    const label = `<span class="btn-label-full">${t(`today.${key}`)}</span><span class="btn-label-short">${t(`today.${key}Short`)}</span>`;
    if (key !== active) {
      const pin = key === 'road' && pinned ? `<span class="discipline-switch__pin" aria-hidden="true">${PIN_SVG_FILLED}</span>` : '';
      return `<a class="discipline-switch__option" href="${href}">${label}${pin}</a>`;
    }
    const pin = key === 'road' ? roadPinButtonHtml(pinned) : '';
    return `<span class="discipline-switch__option discipline-switch__option--active" aria-current="page">${label}${pin}</span>`;
  }).join('')}</nav>`;
}

/** Chincheta de Carretera: contorno para fijarla, llena para quitarla. */
export function roadPinButtonHtml(pinned) {
  const text = t(pinned ? 'filter.unpinDefault' : 'filter.pinDefault', { cat: t('today.road') });
  return `<button type="button" class="tcat-pin tcat-pin--${pinned ? 'filled' : 'outline'} discipline-switch__pin" aria-label="${text}" title="${text}">${pinned ? PIN_SVG_FILLED : PIN_SVG_OUTLINE}</button>`;
}

/** Inserta el conmutador al principio de `container` y alterna la chincheta
 *  de Carretera; `onPin` recibe el estado nuevo. */
export function mountDisciplineSwitch(container, active, todayKey, onPin) {
  if (!container) return;
  container.insertAdjacentHTML('afterbegin', disciplineSwitchHtml(active, todayKey));
  container.addEventListener('click', event => {
    if (!event.target.closest('button.discipline-switch__pin')) return;
    const pinned = !roadPinned();
    setRoadPinned(pinned);
    container.querySelector('.discipline-switch').outerHTML = disciplineSwitchHtml(active, todayKey);
    container.querySelector('button.discipline-switch__pin')?.focus();
    onPin?.(pinned);
  });
}
