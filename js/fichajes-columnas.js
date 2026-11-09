// En escritorio, las secciones del equipo se distribuyen con CSS multicolumna.
// Cuando una sección cruza el salto de columna, el navegador conserva su título
// únicamente en la primera; se añade una copia delante de la primera fila de la
// siguiente columna para que el contexto no se pierda. La copia se recalcula
// después de cada repintado y al cambiar el ancho de la ventana. Sin dependencias:
// también corre antes del primer pintado de una página publicada.
export function refreshSplitSectionTitles() {
  const sections = document.getElementById('trTeamView')?.querySelector('.tr-team-sections');
  if (!sections) return;

  sections.querySelectorAll('.tr-section-title--duplicate').forEach(title => title.remove());
  if (!window.matchMedia('(min-width: 761px)').matches) return;

  sections.querySelectorAll(':scope > section:not([hidden])').forEach(section => {
    const title = section.querySelector(':scope > .tr-section-title');
    const content = title?.nextElementSibling;
    if (!title || !content) return;

    const rows = [...content.children].filter(child => child.matches('.tr-row'));
    if (rows.length < 2) return;

    const firstColumnLeft = rows[0].getBoundingClientRect().left;
    const firstRowInNextColumn = rows.find(row =>
      Math.abs(row.getBoundingClientRect().left - firstColumnLeft) > 1
    );
    if (!firstRowInNextColumn) return;

    const duplicate = title.cloneNode(true);
    duplicate.classList.add('tr-section-title--duplicate');
    duplicate.setAttribute('aria-hidden', 'true');
    content.insertBefore(duplicate, firstRowInNextColumn);
  });
}
