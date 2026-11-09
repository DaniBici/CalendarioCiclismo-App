// Filtro por equipo de una clasificación: muestra u oculta filas y recalcula la columna de
// tiempo sobre las visibles. El 1º visible de cada grupo de tiempo muestra su diferencia real
// (data-gap) y los siguientes con la misma, m.t.: filtrar puede dejar a un corredor como
// primero de su grupo. Sin filtro, el HTML ya trae ese cálculo: solo se escribe lo que cambia.
export function applyTeamFilter(tableWrap, teamFilter, { isEn, onClear }) {
  const sameTimeLbl = isEn ? 's.t.' : 'm.t.';
  let visibleCount = 0;
  let prevGap = null;
  tableWrap.querySelectorAll('tr.so-row[data-team]').forEach((tr) => {
    const visible = (!teamFilter || tr.dataset.team === teamFilter);
    const display = visible ? '' : 'none';
    if (tr.style.display !== display) tr.style.display = display;
    if (visible) visibleCount++;
    const cell = tr.querySelector('.res-gap-dyn');
    if (cell && tr.dataset.gap != null && tr.dataset.gap !== '' && visible) {
      const g = tr.dataset.gap;
      const same = prevGap != null && g === prevGap;
      const text = same ? sameTimeLbl : g;
      const className = same ? 'res-gap res-gap--same res-gap-dyn' : 'res-gap res-gap-dyn';
      if (cell.textContent !== text) cell.textContent = text;
      if (cell.className !== className) cell.className = className;
      prevGap = g;
    }
  });
  tableWrap.querySelector('.res-filter-empty')?.remove();
  if (teamFilter && !visibleCount) {
    const empty = document.createElement('div');
    empty.className = 'res-filter-empty';
    empty.innerHTML = `<p>${isEn ? 'No riders from this team in this classification.' : 'No hay corredores de este equipo en esta clasificación.'}</p><button type="button" class="btn btn--ghost">${isEn ? 'Show all teams' : 'Mostrar todos los equipos'}</button>`;
    empty.querySelector('button').onclick = onClear;
    tableWrap.append(empty);
  }
}

// CRE: despliegue por equipo, con clic o con Intro/espacio en la fila.
function toggleTttGroup(tableWrap, groupEl) {
  const idx = groupEl.dataset.tttGroup;
  const open = groupEl.getAttribute('aria-expanded') === 'true';
  groupEl.setAttribute('aria-expanded', String(!open));
  groupEl.classList.toggle('res-team-row--open', !open);
  tableWrap.querySelectorAll(`tr.res-ttt-rider[data-ttt-member="${idx}"]`).forEach((row) => {
    row.hidden = open;
  });
}

export function bindTttGroups(tableWrap) {
  tableWrap.addEventListener('click', (event) => {
    const row = event.target.closest('tr.res-team-row');
    if (row) toggleTttGroup(tableWrap, row);
  });
  tableWrap.addEventListener('keydown', (event) => {
    const row = event.target.closest('tr.res-team-row');
    if (row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); toggleTttGroup(tableWrap, row); }
  });
}
