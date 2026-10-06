import { esc } from '../shared.js';
import { classificationLabel, formatDurationSeconds, loadFeaturedRaces, parseDurationText } from '../services/race-presentation.js';

function mountBefore(anchor, id) {
  document.getElementById(id)?.remove();
  const host = document.createElement('section');
  host.id = id; host.className = 'panel-presentation'; anchor.before(host);
  return host;
}
function status(host, message) { host.querySelector('[role=status]').textContent = message; }

export async function mountFeaturedEditor(client, anchor, dateKey) {
  const token = Symbol('featured');
  anchor._featuredMount = token;
  const items = [...anchor.querySelectorAll('.sidebar-item[data-race-id]')];
  if (!items.length) return;
  const ids = [...new Set(items.map(item => item.dataset.raceId))];
  const message = document.createElement('p');
  message.className = 'sidebar-featured-status';
  message.setAttribute('role','status');
  message.hidden = true;
  anchor.prepend(message);
  const current = () => anchor.isConnected && anchor._featuredMount === token;
  const report = text => { message.textContent = text; message.hidden = !text; };
  let selected = new Set(), busy = true;
  const buttons = items.map(item => {
    item.classList.add('sidebar-item--feature-selectable');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'sidebar-featured-crown'; button.disabled = true;
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z"/><path d="M5 22h14"/></svg>';
    item.prepend(button);
    button.addEventListener('click',async event => {
      event.stopPropagation();
      if (busy || !current()) return;
      const raceId = item.dataset.raceId, isFeatured = !selected.has(raceId);
      if (isFeatured && selected.size >= 2) {
        report('Ya hay dos carreras destacadas. Desmarca una corona antes de añadir otra.');
        return;
      }
      busy = true; paint(); report('');
      let saved = false;
      try {
        const {error} = await client.from('race_featured_overrides').upsert({raceId,isFeatured,updatedAt:new Date().toISOString()});
        if (error) throw error;
        saved = true;
        if (isFeatured) selected.add(raceId); else selected.delete(raceId);
        await refresh();
      } catch (error) {
        if (current()) report(saved
          ? `Selección guardada. No se pudo actualizar la vista: ${error.message}`
          : `No se pudo guardar: ${error.message}`);
      } finally {
        busy = false;
        if (current()) paint();
      }
    });
    return {item,button};
  });
  function paint() {
    for (const {item,button} of buttons) {
      const active = selected.has(item.dataset.raceId);
      const action = active ? 'Quitar destacada' : 'Destacar toda la carrera';
      button.setAttribute('aria-pressed',String(active));
      button.setAttribute('aria-label',`${action}: ${item.dataset.raceName}`);
      button.title = `${action} · ${item.dataset.raceName}`;
      button.disabled = busy;
    }
  }
  async function refresh() {
    const [effective,saved] = await Promise.all([
      loadFeaturedRaces(client,[dateKey]),
      client.from('race_featured_overrides').select('raceId,isFeatured').in('raceId',ids),
    ]);
    if (saved.error) throw saved.error;
    if (!current()) return;
    const overrides = new Map((saved.data || []).map(row => [row.raceId,row.isFeatured]));
    selected = new Set([...overrides].filter(([,active]) => active).map(([id]) => id));
    for (const id of effective.get(dateKey) || []) {
      if (selected.size < 2 && overrides.get(id) !== false) selected.add(id);
    }
  }
  paint();
  try { await refresh(); busy = false; if (current()) paint(); }
  catch (error) { if (current()) report(`No se pudieron cargar las coronas: ${error.message}`); }
}

export async function mountClassificationEditor(client, anchor, race) {
  const host = mountBefore(anchor,'classificationEditor');
  host.innerHTML = '<p role="status">Cargando clasificaciones…</p>';
  try {
    const { data, error } = await client.from('race_classifications').select('*').eq('raceId',race.id);
    if (error) throw error;
    if (!host.isConnected) return;
    const kinds = ['gc', 'points', 'kom', 'youth', 'teams'];
    const saved = new Map((data || []).map(row => [row.classKind, row]));
    const colors = new Map(kinds.map(kind => [kind, saved.get(kind)?.colorHex || null]));
    host.innerHTML = `<h3>Colores de clasificaciones</h3>
      <div class="classification-editor-rows">${kinds.map(kind => `<div data-kind="${kind}" class="classification-editor-row">
        <label for="classification-color-${kind}">${esc(classificationLabel({classKind:kind}))}</label>
        <input id="classification-color-${kind}" type="color" value="${esc(colors.get(kind) || '#888888')}" aria-label="Color de ${esc(classificationLabel({classKind:kind}))}">
        <span data-color-label>${colors.get(kind) ? esc(colors.get(kind)) : 'Sin color'}</span>
        <button type="button" data-reset-color ${colors.get(kind) ? '' : 'disabled'}>Quitar</button>
      </div>`).join('')}</div>
      <button type="button" data-save-classifications class="btn btn--ghost">Guardar colores</button><p role="status"></p>`;
    const paint = (row, color) => {
      colors.set(row.dataset.kind, color);
      row.querySelector('[data-color-label]').textContent = color || 'Sin color';
      row.querySelector('[data-reset-color]').disabled = !color;
    };
    host.querySelectorAll('[data-kind]').forEach(row => {
      row.querySelector('input').addEventListener('input', event => paint(row, event.target.value));
      row.querySelector('[data-reset-color]').onclick = () => paint(row, null);
    });
    host.querySelector('[data-save-classifications]').onclick = async () => {
      const updated = kinds.filter(kind => colors.get(kind) !== (saved.get(kind)?.colorHex || null)).map(kind => ({
        ...(saved.get(kind) || {position: kinds.indexOf(kind) + 1}),
        raceId: race.id,
        classKind: kind,
        colorHex: colors.get(kind),
        colorSource: {kind:'editorial', editedAt:new Date().toISOString()},
        updatedAt: new Date().toISOString(),
      }));
      if (!updated.length) { status(host, 'Sin cambios de color.'); return; }
      const button = host.querySelector('[data-save-classifications]');
      button.disabled = true;
      try {
        const {error} = await client.from('race_classifications').upsert(updated);
        if (error) throw error;
        for (const row of updated) saved.set(row.classKind, row);
        status(host, 'Colores guardados.');
      } catch (error) {
        status(host, `No se pudo guardar: ${error.message}`);
      } finally {
        button.disabled = false;
      }
    };
  } catch (error) { status(host,`No se pudo cargar: ${error.message}`); }
}

export function mountDayTimingEditor(resultsAnchor, day) {
  document.getElementById('dayTimingEditor')?.remove();
  const host = document.createElement('details');
  host.id = 'dayTimingEditor';
  host.className = 'editor-section editor-section--advanced day-timing-editor';
  host.dataset.tab = 'resultados';
  const hasDistanceOverride = Number(day.competitiveDistanceKm) > 0;
  const hasTimeLimit = Number(day.timeLimitSeconds) > 0;
  host.innerHTML = `<summary class="editor-section__header editor-advanced__summary">
      <span class="editor-section__title">Distancia y fuera de control</span>
    </summary>
    <div class="editor-section__body">
      <label class="day-timing-toggle"><input type="checkbox" data-toggle="competitive-distance" ${hasDistanceOverride?'checked':''}> Usar una distancia competitiva distinta</label>
      <div class="field day-timing-conditional" data-fields="competitive-distance" ${hasDistanceOverride?'':'hidden'}>
        <label>Distancia competitiva (km)</label>
        <input type="number" min="0.001" step="any" data-field="competitiveDistanceKm" value="${day.competitiveDistanceKm || ''}" placeholder="${day.distanceKm || '0'}">
        <span class="u-field-hint">Sustituye la distancia publicada únicamente para calcular la media.</span>
      </div>
      <label class="day-timing-toggle"><input type="checkbox" data-toggle="time-limit" ${hasTimeLimit?'checked':''}> Publicar un fuera de control verificado</label>
      <div class="day-timing-conditional" data-fields="time-limit" ${hasTimeLimit?'':'hidden'}>
        <div class="field-row field-row--2">
          <div class="field">
            <label>Duración máxima (h:mm:ss)</label>
            <input type="text" inputmode="decimal" data-field="timeLimitText" value="${formatDurationSeconds(day.timeLimitSeconds)}" placeholder="5:15:00">
          </div>
          <div class="field">
            <label>Fuente oficial (URL)</label>
            <input type="url" data-field="sourceUrl" value="${esc(day.timeLimitBasis?.sourceUrl || '')}" placeholder="https://…">
          </div>
        </div>
      </div>
      <p class="day-editor-note">Cambiar la base de cálculo invalida el fuera de control anterior.</p>
      <p class="day-editor-note">Se guarda con el resto de la ficha.</p><p role="status"></p>
    </div>`;
  resultsAnchor.after(host);

  const distanceToggle = host.querySelector('[data-toggle=competitive-distance]');
  const limitToggle = host.querySelector('[data-toggle=time-limit]');
  const distanceInput = host.querySelector('[data-field=competitiveDistanceKm]');
  const limitTime = host.querySelector('[data-field=timeLimitText]');
  const sourceUrl = host.querySelector('[data-field=sourceUrl]');
  const conditional = (name, visible) => {
    host.querySelector(`[data-fields=${name}]`).hidden = !visible;
    host.querySelectorAll(`[data-fields=${name}] input`).forEach(input => { input.disabled = !visible; });
  };
  const clearTimeLimit = () => {
    host.dataset.timingBasisChanged = 'true';
    if (limitToggle.checked) status(host, 'Base modificada. Revisa el fuera de control antes de volver a publicarlo.');
    limitToggle.checked = false;
    limitTime.value = '';
    sourceUrl.value = '';
    conditional('time-limit', false);
  };
  conditional('competitive-distance', distanceToggle.checked);
  conditional('time-limit', limitToggle.checked);
  distanceToggle.addEventListener('change', () => {
    conditional('competitive-distance', distanceToggle.checked);
    if (!distanceToggle.checked) distanceInput.value = '';
    clearTimeLimit();
  });
  limitToggle.addEventListener('change', () => conditional('time-limit', limitToggle.checked));
  distanceInput.addEventListener('input', clearTimeLimit);
  for (const id of ['ed-km', 'ed-type', 'ed-isCancelledDay', 'ed-isRestDay']) {
    document.getElementById(id)?.addEventListener('input', clearTimeLimit);
  }
}

export function readDayTimingChanges(day) {
  const host = document.getElementById('dayTimingEditor');
  if (!host) return { distance: {}, timeLimit: null };
  const distanceEnabled = host.querySelector('[data-toggle=competitive-distance]').checked;
  const limitEnabled = host.querySelector('[data-toggle=time-limit]').checked;
  const distanceInput = host.querySelector('[data-field=competitiveDistanceKm]');
  const limitInput = host.querySelector('[data-field=timeLimitText]');
  const sourceInput = host.querySelector('[data-field=sourceUrl]');
  const seconds = parseDurationText(limitInput.value);
  distanceInput.setCustomValidity(distanceEnabled && !(Number(distanceInput.value) > 0) ? 'Indica una distancia positiva.' : '');
  limitInput.setCustomValidity(limitEnabled && seconds == null ? 'Usa el formato h:mm:ss.' : '');
  let validSource = false;
  try { validSource = ['http:', 'https:'].includes(new URL(sourceInput.value.trim()).protocol); } catch {}
  sourceInput.setCustomValidity(limitEnabled && !validSource ? 'Indica una URL http o https válida.' : '');
  const invalid = [...host.querySelectorAll('input')].find(input => !input.disabled && !input.checkValidity());
  if (invalid) {
    document.querySelector('#editorTabs .editor-tab[data-target="resultados"]')?.click();
    host.open = true;
    invalid.reportValidity();
    invalid.focus();
    return null;
  }
  const timeLimitSeconds = limitEnabled ? seconds : null;
  const sourceUrl = limitEnabled ? sourceInput.value.trim() : null;
  const changed = (limitEnabled && host.dataset.timingBasisChanged === 'true')
    || timeLimitSeconds !== (day.timeLimitSeconds ?? null)
    || sourceUrl !== (day.timeLimitBasis?.sourceUrl ?? null);
  return {
    distance: { competitiveDistanceKm: distanceEnabled ? Number(distanceInput.value) : null },
    timeLimit: changed ? {
      timeLimitSeconds,
      timeLimitBasis: limitEnabled ? { ...day.timeLimitBasis, sourceUrl, verifiedAt: new Date().toISOString() } : null,
    } : null,
  };
}
