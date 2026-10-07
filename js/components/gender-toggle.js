// ════════════════════════════════════════════════════════════════════
// Toggle masc/fem reutilizable — un par de botones que alternan género.
// ────────────────────────────────────────────────────────────────────
// Antes había dos copias idénticas (buscador de roster + escáner de
// duplicados): mismo markup, mismo `_update*GenderToggle` y mismo cableado.
// Este módulo unifica las tres piezas. El estado (qué género está activo)
// sigue viviendo en el consumidor (p.ej. `_rosterAddGender`), que lo pasa
// como `value`; el componente solo pinta y avisa por `onSelect`.
//
// API:
//   genderToggleHtml({ idMale, idFemale, value='male', labels, wrapId, wrapStyle })
//       → string con el markup (dos botones .btn--ghost dentro de un wrap).
//         labels = { male, female } (def. 'Masc'/'Fem').
//         wrapId/wrapStyle: id y estilo extra del contenedor (p.ej. para
//         mostrar/ocultar el toggle según si el equipo tiene género).
//   setGenderToggleActive(idMale, idFemale, value)
//       → marca el botón activo (.is-active, en acento) y apaga el otro.
//         Sustituye a los viejos `_update*GenderToggle`.
//   wireGenderToggle(idMale, idFemale, onSelect)
//       → cablea los clicks; cada uno llama onSelect('male'|'female').
//         Cablear POR APERTURA (el markup se recrea en cada render del drawer).
// ════════════════════════════════════════════════════════════════════


export function genderToggleHtml({ idMale, idFemale, value = 'male', labels = {}, wrapId, wrapStyle } = {}) {
  const m = labels.male   || 'Masc';
  const f = labels.female || 'Fem';
  const idAttr = wrapId ? ` id="${wrapId}"` : '';
  const style = wrapStyle != null ? ` style="${wrapStyle}"` : '';
  return `<div class="gender-toggle"${idAttr}${style}>
    <button type="button" id="${idMale}" class="btn btn--ghost">${m}</button>
    <button type="button" id="${idFemale}" class="btn btn--ghost">${f}</button>
  </div>`;
}

export function setGenderToggleActive(idMale, idFemale, value) {
  const m = document.getElementById(idMale);
  const f = document.getElementById(idFemale);
  m?.classList.toggle('is-active', value === 'male');
  f?.classList.toggle('is-active', value === 'female');
}

export function wireGenderToggle(idMale, idFemale, onSelect) {
  document.getElementById(idMale)?.addEventListener('click', () => onSelect('male'));
  document.getElementById(idFemale)?.addEventListener('click', () => onSelect('female'));
}
