// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Editor de jornada: guardar, borrar y duplicar
// ─────────────────────────────────────────────────────────────────

import { readDayTimingChanges } from './race-presentation.js';
import { supabase, extractYouTubeId, checkYouTubeEmbeddable } from '../shared.js';
import { closeDrawer } from '../components/drawer.js?v=20260912cxsavecontext';
import { confirmDialog, alertDialog, promptDialog } from '../components/dialog.js';
import { panelState } from './state.js';
import { setRaceDaySaveInFlight, showToast, toTimestamp, validateSlug } from './helpers.js';
import { loadSidebar } from './agenda.js';
import { openEditor } from './jornada-editor.js';
import { markdownFromEditor } from './jornada-fields.js';
import { _markWebPagesDirtyIfMissing } from './races-view.js';

// ── Guardar jornada ───────────────────────────────────────────────
export async function saveRaceDay(status) {
  if (panelState._raceDaySaveInFlight) return;
  setRaceDaySaveInFlight(true);

  const area    = document.getElementById('editorArea');
  const rdId    = area.dataset.rdId;
  const raceId  = area.dataset.raceId;
  const feedback = document.getElementById('editorFeedback');

  const dateKey = document.getElementById('ed-date').value;

  // Validar slug
  const slugVal = document.getElementById('ed-slug').value.trim();
  const slugErr = validateSlug(slugVal);
  if (slugErr) {
    const el = document.getElementById('ed-slug-error');
    el.textContent = slugErr;
    el.style.display = 'block';
    document.getElementById('ed-slug').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setRaceDaySaveInFlight(false);
    return;
  }

  // Validación básica para publicar: solo fecha y carrera asociada
  if (status === 'published') {
    const required = {
      'Fecha':   dateKey,
      'Carrera': raceId,
    };
    const missing = Object.entries(required).filter(([,v]) => !v).map(([k]) => k);
    if (missing.length) {
      showToast('Faltan campos obligatorios: ' + missing.join(', '));
      setRaceDaySaveInFlight(false);
      return;
    }
  }

  const timingChanges = readDayTimingChanges(panelState._editorCache?.rd || {});
  if (!timingChanges) {
    setRaceDaySaveInFlight(false);
    return;
  }

  // hidden.value is kept in sync by initMdToolbar (input, keydown, blur listeners).

  // Recoger anotaciones del perfil
  const _distanceKm = parseFloat(document.getElementById('ed-km').value) || null;

  // Desnivel manual: edita elevationProfile.elevationGain (lo que muestran web y
  // apps). Tres casos, partiendo SIEMPRE del perfil actual en caché (que ya
  // refleja cualquier GPX subido/borrado en esta sesión, ya que esos flujos
  // escriben directamente en _editorCache.rd.elevationProfile):
  //   1. Hay perfil (GPX) → preservar points/distance/etc. y solo fijar el gain.
  //   2. No hay perfil y hay valor → crear uno mínimo VÁLIDO. iOS exige
  //      `distance` y `points` no-opcionales en su Codable: sin ellos el decode
  //      rompe y la jornada deja de cargar. Por eso distance + points:[].
  //      points:[] hace que la silueta no se pinte (gate >= 2 puntos) → solo
  //      sale el número "+X m", que es justo lo deseado sin GPX.
  //   3. No hay perfil y vacío → null (queda vacío como en la DB).
  const _elevRaw  = document.getElementById('ed-elev')?.value.trim() ?? '';
  const _elevGain = _elevRaw !== '' && Number.isFinite(parseFloat(_elevRaw))
    ? Math.round(parseFloat(_elevRaw))
    : null;
  const _existingProfile = panelState._editorCache?.rd?.elevationProfile ?? null;
  let _elevationProfile;
  if (_existingProfile) {
    _elevationProfile = { ..._existingProfile, elevationGain: _elevGain };
  } else if (_elevGain != null) {
    _elevationProfile = {
      distance:      _distanceKm ?? 0,
      elevationGain: _elevGain,
      elevationLoss: null,
      minElevation:  null,
      maxElevation:  null,
      points:        [],
    };
  } else {
    _elevationProfile = null;
  }

  const profileSummits = [...document.querySelectorAll('#summitsList .ann-row')].reduce((acc, row) => {
    const km    = row.querySelector('.ann-km').value.trim();
    const alt   = row.querySelector('.ann-alt').value.trim();
    const name  = row.querySelector('.ann-name').value.trim();
    const start = row.querySelector('.ann-start')?.value.trim() ?? '';
    // km es obligatorio: una fila sin km rompe el decode de las apps (Swift/Kotlin
    // esperan Double no-opcional). Descartamos también filas totalmente vacías.
    if (km === '' || !Number.isFinite(parseFloat(km))) return acc;
    if (!km && !name) return acc;
    const kmNum    = parseFloat(km);
    const startNum = start !== '' ? parseFloat(start) : null;
    // El startKm sólo tiene sentido si es estrictamente menor que el km de la cima.
    const validStart = (startNum != null && startNum < kmNum) ? startNum : null;
    const timeVal  = row.querySelector('.ann-time')?.value.trim() ?? '';
    const footVal  = row.querySelector('.ann-foot-time')?.value.trim() ?? '';
    acc.push({
      km:        kmNum,
      altitude:  alt !== '' ? parseInt(alt) : null,
      name:      name || null,
      category:  row.querySelector('.ann-cat').value,
      side:      row.querySelector('.ann-side').value,
      ...(validStart != null ? { startKm: validStart } : {}),
      ...(timeVal ? { timeUtc: toTimestamp(dateKey, timeVal) } : {}),
      // footTimeUtc solo tiene sentido si hay startKm (pie del puerto)
      ...(footVal && validStart != null ? { footTimeUtc: toTimestamp(dateKey, footVal) } : {}),
    });
    return acc;
  }, []);

  const profileWaypoints = [...document.querySelectorAll('#waypointsList .ann-row')].reduce((acc, row) => {
    const km   = row.querySelector('.ann-km').value.trim();
    const name = row.querySelector('.ann-name').value.trim();
    // Mismo motivo que en summits: km es obligatorio para que las apps decodifiquen bien.
    if (km === '' || !Number.isFinite(parseFloat(km))) return acc;
    if (!km && !name) return acc;
    const type   = row.querySelector('.ann-type').value;
    const lenRaw = row.querySelector('.ann-len')?.value.trim();
    const timeVal = row.querySelector('.ann-time')?.value.trim() ?? '';
    const obj = {
      km:   parseFloat(km),
      name: name || null,
      type,
    };
    if ((type === 'cobblestone' || type === 'sterrato') && lenRaw) {
      obj.lengthKm = parseFloat(lenRaw);
    }
    if (timeVal) obj.timeUtc = toTimestamp(dateKey, timeVal);
    acc.push(obj);
    return acc;
  }, []);

  const kmSort = (a, b) => (a.km ?? Infinity) - (b.km ?? Infinity);
  profileSummits.sort(kmSort);
  profileWaypoints.sort(kmSort);

  // Validar km dentro de [0, distancia]
  // Usar el máximo entre el campo manual y la distancia real del GPX para evitar
  // falsos positivos cuando el GPX mide ligeramente más que el kilometraje nominal.
  // Tolerancia de 0.1 km (100 m) para absorber redondeos típicos entre el km
  // nominal de las fuentes y la medición real del GPX (p.ej. cima a 12.73 en
  // una etapa de 12.7 km).
  const _gpxDistance = parseFloat(document.getElementById('ed-gpx-summary')?.dataset.distance) || null;
  const _maxKm = (_distanceKm != null && _gpxDistance != null)
    ? Math.max(_distanceKm, _gpxDistance)
    : (_distanceKm ?? _gpxDistance);
  const _kmTolerance = 0.1;
  if (_maxKm != null) {
    const _limit = _maxKm + _kmTolerance;
    const outOfRange = [...profileSummits, ...profileWaypoints].find(
      a => a.km != null && (a.km < -_kmTolerance || a.km > _limit)
    );
    if (outOfRange) {
      showToast(`km ${outOfRange.km} fuera de rango [0, ${_maxKm}] (tolerancia ±${_kmTolerance})`);
      setRaceDaySaveInFlight(false);
      return;
    }
    const startOutOfRange = profileSummits.find(
      s => s.startKm != null && (s.startKm < -_kmTolerance || s.startKm > _limit)
    );
    if (startOutOfRange) {
      showToast(`km inicio ${startOutOfRange.startKm} fuera de rango [0, ${_maxKm}] (tolerancia ±${_kmTolerance})`);
      setRaceDaySaveInFlight(false);
      return;
    }
  }

  // No depender de que el navegador haya emitido `input` al pulsar Enter.
  const descriptionMarkdown = markdownFromEditor('ed-description-wysiwyg', 'ed-description');

  const data = {
    raceId,
    dateKey,
    date: dateKey,
    slug:                 slugVal || null,
    isRestDay:            document.getElementById('ed-isRestDay')?.checked || false,
    isCancelledDay:       document.getElementById('ed-isCancelledDay')?.checked || false,
    stageNumber:          document.getElementById('ed-isRestDay')?.checked ? null : (document.getElementById('ed-stage').value !== '' ? parseInt(document.getElementById('ed-stage').value) : null),
    startLocation:        document.getElementById('ed-start').value.trim(),
    finishLocation:       document.getElementById('ed-finish').value.trim(),
    startLocationEn:      document.getElementById('ed-start-en')?.value.trim() || null,
    finishLocationEn:     document.getElementById('ed-finish-en')?.value.trim() || null,
    slugEn:               document.getElementById('ed-slug-en')?.value.trim() || null,
    countryCode:          document.getElementById('ed-country').value.trim() || null,
    distanceKm:           _distanceKm,
    ...timingChanges.distance,
    elevationProfile:     _elevationProfile,
    primaryType:          document.getElementById('ed-type').value || null,
    secondaryType:        document.getElementById('ed-type2').value || null,
    neutralStartTimeUtc:  toTimestamp(dateKey, document.getElementById('ed-startTime').value),
    realStartTimeUtc:     toTimestamp(dateKey, document.getElementById('ed-realStartTime').value),
    estimatedFinishTimeUtc: toTimestamp(dateKey, document.getElementById('ed-finishTime').value),
    tvStatus:             document.getElementById('ed-tvStatus').value || null,
    description:          descriptionMarkdown.trim(),
    bonuses:              document.getElementById('ed-bonuses').value.trim(),
    notes:                document.getElementById('ed-notes').value.trim(),
    editorialStatus:      status,
    updatedAt:            new Date().toISOString(),
    profileSummits:       profileSummits.length  ? profileSummits  : null,
    profileWaypoints:     profileWaypoints.length ? profileWaypoints : null,
    profileNotViewable:   document.getElementById('ed-profile-not-viewable')?.checked || false,
  };

  try {
    const { error: rdErr } = await supabase.from('race_days').update(data).eq('id', rdId);
    if (rdErr) throw rdErr;

    // Aplicar la verificación después del recálculo que puede invalidar la anterior.
    if (timingChanges.timeLimit) {
      const { error: timingError } = await supabase.from('race_days')
        .update(timingChanges.timeLimit).eq('id', rdId);
      if (timingError) throw timingError;
    }
    const { data: savedTiming, error: timingReadError } = await supabase.from('race_days')
      .select('timingPolicy,competitiveDistanceKm,raceTimeSeconds,averageSpeedKmh,timeLimitSeconds,timeLimitBasis')
      .eq('id', rdId).single();
    if (timingReadError) throw timingReadError;

    // Conservar las IDs existentes: los vínculos privados del sincronizador del
    // VPS referencian estas filas y el bloqueo administrativo pertenece a cada
    // emisión, no a una reconstrucción temporal del formulario.
    const { data: oldBcasts, error: oldBcErr } = await supabase
      .from('broadcasts').select('id,url,embeddable').eq('raceDayId', rdId);
    if (oldBcErr) throw oldBcErr;

    const bcPanels = document.querySelectorAll('.tv-entry-panel');
    const newBroadcasts = [...bcPanels].reduce((acc, panel) => {
      const channel = panel.querySelector('.bc-channel').value.trim();
      const timeVal = panel.querySelector('.bc-time').value;
      const url     = panel.querySelector('.bc-url').value.trim();
      const note    = panel.querySelector('.bc-note').value.trim();
      const country = panel.querySelector('.bc-country')?.value || null;
      // Solo descartar filas completamente vacías (p.ej. "+ Añadir emisión"
      // sin rellenar). Un canal vacío con hora/nota es válido (ej: "Por confirmar").
      if (!channel && !timeVal && !url && !note) return acc;
      acc.push({
        id:           panel.dataset.bid || crypto.randomUUID(),
        raceDayId:    rdId,
        channel:      channel || null,
        startTimeUtc: toTimestamp(dateKey, timeVal),
        url:          url || null,
        note:         note || null,
        country:      country || null,
        sortOrder:    acc.length,
        showInRevive: panel.querySelector('.bc-show-in-revive').checked,
        automationLocked: panel.querySelector('.bc-automation-locked').checked,
        embeddable:   null,
      });
      return acc;
    }, []);
    // Validar URLs de YouTube contra oEmbed. Reusa el valor previo si la URL
    // no cambió para evitar la llamada extra en cada guardado.
    const oldEmbedByUrl = new Map(
      (oldBcasts || []).filter(b => b.url).map(b => [b.url, b.embeddable])
    );
    await Promise.all(newBroadcasts.map(async b => {
      if (!b.url || !extractYouTubeId(b.url)) return;
      if (oldEmbedByUrl.has(b.url)) {
        b.embeddable = oldEmbedByUrl.get(b.url);
        return;
      }
      b.embeddable = await checkYouTubeEmbeddable(b.url);
    }));
    const oldBcIds = new Set((oldBcasts || []).map(b => b.id));
    const broadcastsToInsert = newBroadcasts.filter(b => !oldBcIds.has(b.id));
    const broadcastsToUpdate = newBroadcasts.filter(b => oldBcIds.has(b.id));
    for (const broadcast of broadcastsToUpdate) {
      const { id, raceDayId: _raceDayId, ...fields } = broadcast;
      const { error: upBcErr } = await supabase.from('broadcasts').update(fields).eq('id', id);
      if (upBcErr) throw upBcErr;
    }
    if (broadcastsToInsert.length) {
      const { error: insBcErr } = await supabase.from('broadcasts').insert(broadcastsToInsert);
      if (insBcErr) throw insBcErr;
    }
    const retainedBcIds = new Set(newBroadcasts.map(b => b.id));
    const obsoleteBcIds = [...oldBcIds].filter(id => !retainedBcIds.has(id));
    if (obsoleteBcIds.length) {
      const { error: delBcErr } = await supabase.from('broadcasts').delete().in('id', obsoleteBcIds);
      if (delBcErr) throw delBcErr;
    }

    // Guardar assets — misma estrategia INSERT primero + DELETE por ID
    const { data: oldAssets, error: oldAsErr } = await supabase
      .from('assets').select('id, type, sourceType, url').eq('raceDayId', rdId);
    if (oldAsErr) throw oldAsErr;

    const assetDocTypes = ['roadbook', 'profile', 'ports', 'map', 'startOrder'];
    let hasAssets = false;
    const newAssets = [];
    for (const input of document.querySelectorAll('.asset-url-input')) {
      const url = input.value.trim();
      if (!url) continue;
      newAssets.push({ id: crypto.randomUUID(), raceDayId: rdId, type: input.dataset.type, sourceType: 'external', url });
      if (assetDocTypes.includes(input.dataset.type)) hasAssets = true;
    }
    // El guardado reconstruye los assets DESDE EL DOM: borra todos y reinserta
    // los inputs con valor. Eso es correcto para los documentos que el editor
    // renderiza siempre, pero el asset `startOrder` NO lo crea el editor: lo
    // inserta el importador de orden de salida (attachImportHandler). Si el
    // editor se guarda sin que su fila esté cableada en #assetsList (pestaña no
    // abierta, editor montado antes del import…), el DELETE se lo llevaba y el
    // INSERT no lo reponía → la jornada perdía el badge "Orden salida" en las
    // tres plataformas, que lo gatean por la existencia de este asset, aunque
    // `startOrderImportedAt` y las filas de start_order_entries siguieran ahí.
    // Cazado en el Tour de Francia 2026 etapa 16 (CRI, 166 entries importados).
    // Quitar la fila a mano (botón ✕) SÍ debe borrarlo: ese handler la apunta
    // en `#assetsList[data-removed-types]`, que aquí se respeta. Sin esa marca
    // el borrado explícito y "el editor nunca la renderizó" serían el mismo
    // estado (row.remove() la saca del DOM) y resucitaríamos lo recién borrado.
    const soInDom = document.querySelector('.asset-url-input[data-type="startOrder"]');
    const soRemoved = (document.getElementById('assetsList')?.dataset.removedTypes || '')
      .split(',').includes('startOrder');
    const soOld = (oldAssets || []).find(a => a.type === 'startOrder');
    if (!soInDom && !soRemoved && soOld?.url) {
      newAssets.push({
        id: crypto.randomUUID(), raceDayId: rdId,
        type: 'startOrder', sourceType: soOld.sourceType || 'external', url: soOld.url,
      });
      hasAssets = true;
    }
    // Los assets son únicos por jornada y tipo. Al guardar el editor, conservar
    // la fila existente de cada tipo evita que el trigger anti-duplicados choque
    // con la estrategia anterior de INSERT antes de DELETE. Sin esto, el
    // broadcast sí se insertaba, pero el guardado completo acababa mostrando un
    // error de asset al llegar aquí.
    const oldAssetByType = new Map((oldAssets || []).map(asset => [asset.type, asset]));
    const retainedAssetIds = new Set();
    const assetsToInsert = [];
    for (const asset of newAssets) {
      const oldAsset = oldAssetByType.get(asset.type);
      if (!oldAsset) {
        assetsToInsert.push(asset);
        continue;
      }
      const { error: upAsErr } = await supabase
        .from('assets')
        .update({ sourceType: asset.sourceType, url: asset.url })
        .eq('id', oldAsset.id);
      if (upAsErr) throw upAsErr;
      retainedAssetIds.add(oldAsset.id);
    }
    if (assetsToInsert.length) {
      const { error: insAsErr } = await supabase.from('assets').insert(assetsToInsert);
      if (insAsErr) throw insAsErr;
    }
    const obsoleteAssetIds = (oldAssets || [])
      .filter(asset => !retainedAssetIds.has(asset.id))
      .map(asset => asset.id);
    if (obsoleteAssetIds.length) {
      const { error: delAsErr } = await supabase.from('assets').delete().in('id', obsoleteAssetIds);
      if (delAsErr) throw delAsErr;
    }
    // Denormalizar hasAssets en el documento raíz
    const { error: rdUpErr } = await supabase.from('race_days').update({ hasAssets }).eq('id', rdId);
    if (rdUpErr) throw rdUpErr;

    // Construir estado actualizado en memoria para pasarlo al editor sin releer Supabase.
    // `data` ya incluye el elevationProfile fusionado (desnivel manual + perfil GPX),
    // así que ...data aporta el valor correcto — no reusar el del caché previo.
    const savedRd = { ...data, ...savedTiming, id: rdId, hasAssets };

    // Reutilizar el estado que se acaba de persistir, incluidas sus IDs reales.
    // Si la caché las vacía, openEditor vuelve a montar filas sin data-bid y el
    // siguiente guardado intenta insertarlas de nuevo y borrar las originales.
    const savedBcasts = newBroadcasts.map(({ raceDayId: _raceDayId, ...broadcast }) => broadcast);

    const savedAssets = [...document.querySelectorAll('.asset-url-input')].reduce((acc, input) => {
      const url = input.value.trim();
      if (url) acc.push({ id: '', type: input.dataset.type, sourceType: 'external', url });
      return acc;
    }, []);

    // Guardar traducciones EN — leer estado actual de BD, actualizar solo los campos editados
    const { data: rdForTr } = await supabase.from('race_days').select('translations').eq('id', rdId).single();
    const existingTr = rdForTr?.translations || {};
    const existingEn = existingTr.en || {};
    const descEnVal    = markdownFromEditor('ed-description-en-wysiwyg', 'ed-description-en').trim() || null;
    const bonusesEnVal = document.getElementById('ed-bonuses-en')?.value.trim() || null;
    const notesEnVal   = document.getElementById('ed-notes-en')?.value.trim() || null;
    const updateEnFields = (field, newVal, currentEntry) => {
      if (newVal === null && !currentEntry) return currentEntry;
      // Si el valor difiere del existente y el status no es manual, marcar manual
      const changed = newVal !== (currentEntry?.value ?? null);
      if (!changed) return currentEntry;
      return { ...(currentEntry || {}), value: newVal, status: 'manual', updatedAt: new Date().toISOString() };
    };
    const newEn = { ...existingEn };
    if (descEnVal !== null || existingEn.description) newEn.description = updateEnFields('description', descEnVal, existingEn.description);
    if (bonusesEnVal !== null || existingEn.bonuses)   newEn.bonuses    = updateEnFields('bonuses', bonusesEnVal, existingEn.bonuses);
    if (notesEnVal !== null || existingEn.notes)       newEn.notes      = updateEnFields('notes', notesEnVal, existingEn.notes);
    const newTranslations = { ...existingTr, en: newEn };
    if (JSON.stringify(newTranslations) !== JSON.stringify(existingTr)) {
      const { error: trErr } = await supabase.from('race_days').update({ translations: newTranslations }).eq('id', rdId);
      if (trErr) throw trErr;
    }

    // Actualizar caché del editor
    panelState._editorCache = { rdId, rd: { ...savedRd, translations: newTranslations }, broadcasts: savedBcasts, assets: savedAssets };

    loadSidebar();
    await openEditor(rdId); // usará _editorCache, 0 lecturas Firestore
    showToast(status === 'published' ? 'Publicado correctamente' : 'Borrador guardado', 'success', 3000);

    // Crear las páginas estáticas solo si la URL canónica aún no existe. Las
    // jornadas ya publicadas leen sus cambios en vivo desde Supabase y no deben
    // reconstruir el artifact completo tras cada edición.
    if (status === 'published' && slugVal) {
      _markWebPagesDirtyIfMissing(slugVal);
    }

  } catch (err) {
    console.error(err);
    showToast('Error al guardar: ' + err.message);
  } finally {
    setRaceDaySaveInFlight(false);
  }
}

// ── Borrar jornada ───────────────────────────────────────────────
export async function deleteRaceDay() {
  const rdId = document.getElementById('editorArea').dataset.rdId;
  if (!await confirmDialog('¿Seguro que quieres borrar esta jornada? Esta acción no se puede deshacer.', { danger: true })) return;

  try {
    // Borrar broadcasts y assets (ON DELETE CASCADE los borra automáticamente,
    // pero lo hacemos explícito por seguridad)
    await Promise.all([
      supabase.from('broadcasts').delete().eq('raceDayId', rdId),
      supabase.from('assets').delete().eq('raceDayId', rdId),
    ]);
    await supabase.from('race_days').delete().eq('id', rdId);

    // Cerrar el drawer y recargar la lista de jornadas del día
    panelState.currentRaceDayId = null;
    closeDrawer(1);
    loadSidebar();
    showToast('Jornada eliminada', 'success', 2500);
  } catch (err) {
    console.error(err);
    alertDialog('Error al borrar la jornada.', { title: 'Error' });
  }
}

// ── Duplicar jornada ──────────────────────────────────────────────
export async function duplicateRaceDay() {
  const newDate = await promptDialog('Fecha para la jornada duplicada:', {
    title: 'Duplicar jornada',
    inputType: 'date',
    value: document.getElementById('ed-date')?.value || panelState.currentDateKey || '',
    confirmText: 'Duplicar',
  });
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;

  const rdId = document.getElementById('editorArea').dataset.rdId;
  const { data: rdData } = await supabase.from('race_days').select('*').eq('id', rdId).single();
  if (!rdData) return;

  const { id: _origId, ...rdFields } = rdData;
  const data = { ...rdFields, dateKey: newDate, date: newDate,
    editorialStatus: 'draft', updatedAt: new Date().toISOString() };
  const newId = crypto.randomUUID();

  const { data: newRef, error: newRefErr } = await supabase
    .from('race_days')
    .insert({ ...data, id: newId })
    .select()
    .single();
  if (newRefErr) { alertDialog('Error al duplicar.', { title: 'Error' }); return; }

  // Copiar broadcasts y assets
  const [bcastRes, assetsRes] = await Promise.all([
    supabase.from('broadcasts').select('*').eq('raceDayId', rdId),
    supabase.from('assets').select('*').eq('raceDayId', rdId),
  ]);
  const copiedBcasts = (bcastRes.data || []).map(({ id: _bid, raceDayId: _rid, ...b }) => ({
    ...b, id: crypto.randomUUID(), raceDayId: newId
  }));
  const copiedAssets = (assetsRes.data || []).map(({ id: _aid, raceDayId: _rid, ...a }) => ({
    ...a, id: crypto.randomUUID(), raceDayId: newId
  }));
  await Promise.all([
    copiedBcasts.length ? supabase.from('broadcasts').insert(copiedBcasts) : Promise.resolve(),
    copiedAssets.length ? supabase.from('assets').insert(copiedAssets)     : Promise.resolve(),
  ]);

  // Actualizar el picker si el nuevo día coincide con el seleccionado
  if (newDate === panelState.currentDateKey) loadSidebar();

  alertDialog(`Jornada duplicada. Puedes encontrarla el ${newDate}.`, { title: 'Hecho' });
}
