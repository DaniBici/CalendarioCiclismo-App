const DEFAULT_TARGET_POINTS = 350;
const ELEVATION_THRESHOLD_M = 3;
const MIN_POINT_SPACING_PX = 1;
const MAGNIFIER_SIZE_PX = 128;
const MAGNIFIER_ZOOM = 4;
const LOOP_ENDPOINT_TOLERANCE = 0.03;
const PDFJS_MODULE_URL = new URL('./vendor/pdfjs/pdf.min.mjs', import.meta.url).href;
const PDFJS_WORKER_URL = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
let pdfJsPromise = null;

/**
 * Genera una URL de descarga distinta para cada perfil servido por el proxy.
 * El nombre también se sigue enviando en la cabecera autenticada; el parámetro
 * solo evita que la caché HTTP trate todos los GET de la Edge Function como el
 * mismo recurso.
 */
export function buildProfileAssetDownloadRequest(proxyUrl, assetUrl) {
  const filename = decodeURIComponent(new URL(assetUrl).pathname.replace(/^\/+/, ''));
  const requestUrl = new URL(proxyUrl);
  requestUrl.searchParams.set('asset', filename);
  return { url: requestUrl.href, filename };
}

function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import(PDFJS_MODULE_URL).then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function isPdfSource(name, mimeType = '') {
  if (mimeType === 'application/pdf') return true;
  try {
    return new URL(name, window.location.href).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return String(name || '').split('?')[0].toLowerCase().endsWith('.pdf');
  }
}

function sourceLabel(source, fallback = 'Perfil oficial') {
  try {
    return decodeURIComponent(new URL(source, window.location.href).pathname.split('/').pop()) || fallback;
  } catch {
    return fallback;
  }
}

function assertFinite(value, message) {
  if (!Number.isFinite(value)) throw new Error(message);
}

function interpolateY(points, x) {
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].x <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const ratio = (x - a.x) / (b.x - a.x);
  return a.y + (b.y - a.y) * ratio;
}

function computeGainLoss(points, threshold = ELEVATION_THRESHOLD_M) {
  let gain = 0;
  let loss = 0;
  let reference = points[0].alt;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].alt - reference;
    if (diff >= threshold) {
      gain += diff;
      reference = points[i].alt;
    } else if (diff <= -threshold) {
      loss += Math.abs(diff);
      reference = points[i].alt;
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

/**
 * Repite un tramo de la línea de control y encaja el resultado entre los
 * extremos originales. `lapCount` incluye la pasada ya dibujada.
 */
export function repeatControlPointRegion({
  controlPoints,
  startPointId,
  endPointId,
  lapCount,
  nextId = 1,
}) {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    throw new Error('Dibuja al menos dos puntos del perfil.');
  }
  const laps = Number(lapCount);
  if (!Number.isInteger(laps) || laps < 2 || laps > 50) {
    throw new Error('El número de vueltas debe ser un entero entre 2 y 50.');
  }

  const points = controlPoints.map(point => ({ ...point })).sort((a, b) => a.x - b.x);
  const startIndex = points.findIndex(point => point.id === startPointId);
  const endIndex = points.findIndex(point => point.id === endPointId);
  if (startIndex < 0 || endIndex < 0 || startIndex >= endIndex) {
    throw new Error('Marca un inicio y un final de vuelta en ese orden.');
  }

  const firstX = points[0].x;
  const lastX = points.at(-1).x;
  const start = points[startIndex];
  const end = points[endIndex];
  const loopLength = end.x - start.x;
  if (loopLength <= 0) throw new Error('El tramo de vuelta no tiene longitud.');
  if (Math.abs(start.y - end.y) > LOOP_ENDPOINT_TOLERANCE) {
    throw new Error('El inicio y el final de la vuelta deben quedar a una altitud similar.');
  }

  const prefixLength = start.x - firstX;
  const suffixLength = lastX - end.x;
  const expandedLength = prefixLength + loopLength * laps + suffixLength;
  const output = [];
  const usedIds = new Set();
  let generatedId = Math.max(nextId, ...points.map(point => Number(point.id) + 1 || 1));
  const append = (point, position, preserveId = false) => {
    let id = preserveId && !usedIds.has(point.id) ? point.id : generatedId++;
    while (usedIds.has(id)) id = generatedId++;
    usedIds.add(id);
    output.push({
      ...point,
      id,
      x: firstX + (position / expandedLength) * (lastX - firstX),
    });
  };

  points.slice(0, startIndex).forEach(point => append(point, point.x - firstX, true));
  const region = points.slice(startIndex, endIndex + 1);
  for (let lap = 0; lap < laps; lap++) {
    region.forEach((point, index) => {
      // La frontera entre vueltas es un único punto. El final de una vuelta
      // actúa como inicio de la siguiente para mantener una curva continua.
      if (lap > 0 && index === 0) return;
      append(point, prefixLength + lap * loopLength + (point.x - start.x), lap === 0);
    });
  }
  points.slice(endIndex + 1).forEach(point => {
    append(point, prefixLength + laps * loopLength + (point.x - end.x), true);
  });

  return { points: output, nextId: generatedId };
}

/**
 * Convierte puntos normalizados sobre una imagen en el elevationProfile nativo.
 * El primer/último punto son km 0/meta. Dos puntos de la curva calibran la Y.
 */
export function buildDigitizedElevationProfile({
  controlPoints,
  distanceKm,
  lowReference,
  highReference,
  targetPointCount = DEFAULT_TARGET_POINTS,
}) {
  assertFinite(distanceKm, 'Introduce una distancia válida.');
  if (distanceKm <= 0) throw new Error('La distancia debe ser mayor que 0 km.');
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) {
    throw new Error('Dibuja al menos dos puntos del perfil.');
  }

  const points = controlPoints
    .map(p => ({ id: p.id, x: Number(p.x), y: Number(p.y) }))
    .sort((a, b) => a.x - b.x);
  points.forEach(p => {
    assertFinite(p.x, 'Hay un punto con posición horizontal inválida.');
    assertFinite(p.y, 'Hay un punto con posición vertical inválida.');
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
      throw new Error('Todos los puntos deben quedar dentro de la imagen.');
    }
  });
  for (let i = 1; i < points.length; i++) {
    if (points[i].x - points[i - 1].x < 1e-6) {
      throw new Error('Dos puntos ocupan el mismo kilómetro; sepáralos horizontalmente.');
    }
  }

  const lowPoint = points.find(p => p.id === lowReference?.pointId);
  const highPoint = points.find(p => p.id === highReference?.pointId);
  if (!lowPoint || !highPoint) throw new Error('Marca los puntos de menor y mayor altitud.');
  const lowAltitude = Number(lowReference.altitude);
  const highAltitude = Number(highReference.altitude);
  assertFinite(lowAltitude, 'Introduce la altitud del punto más bajo.');
  assertFinite(highAltitude, 'Introduce la altitud del punto más alto.');
  if (lowAltitude >= highAltitude) {
    throw new Error('La altitud máxima debe ser mayor que la mínima.');
  }
  if (lowPoint.y <= highPoint.y) {
    throw new Error('El punto de menor altitud debe quedar visualmente por debajo del de mayor altitud.');
  }

  const firstX = points[0].x;
  const lastX = points[points.length - 1].x;
  if (lastX - firstX < 0.01) throw new Error('El perfil dibujado es demasiado estrecho.');

  const altitudeAtY = y => highAltitude
    + ((y - highPoint.y) / (lowPoint.y - highPoint.y)) * (lowAltitude - highAltitude);

  const requestedCount = Math.max(points.length, Math.round(targetPointCount));
  const xValues = points.map(p => p.x);
  const extraCount = requestedCount - points.length;
  for (let i = 1; i <= extraCount; i++) {
    xValues.push(firstX + ((lastX - firstX) * i) / (extraCount + 1));
  }
  xValues.sort((a, b) => a - b);

  const sampled = [];
  for (const x of xValues) {
    const km = Math.round((((x - firstX) / (lastX - firstX)) * distanceKm) * 100) / 100;
    const alt = Math.round(altitudeAtY(interpolateY(points, x)));
    const previous = sampled[sampled.length - 1];
    if (previous?.km === km) {
      previous.alt = alt;
    } else {
      sampled.push({ km, alt });
    }
  }
  sampled[0].km = 0;
  sampled[sampled.length - 1].km = Math.round(distanceKm * 10) / 10;

  const altitudes = sampled.map(p => p.alt);
  const { gain, loss } = computeGainLoss(sampled);
  return {
    distance: Math.round(distanceKm * 10) / 10,
    elevationGain: gain,
    elevationLoss: loss,
    minElevation: Math.min(...altitudes),
    maxElevation: Math.max(...altitudes),
    points: sampled,
  };
}

function digitizerMarkup(hasOfficialAsset) {
  return `
    <div class="profile-digitizer__topbar">
      <label class="btn btn--ghost profile-digitizer__file-label">
        Elegir archivo
        <input type="file" accept="image/*,application/pdf,.pdf" data-digitizer="file">
      </label>
      <button type="button" class="btn btn--ghost" data-digitizer="official"${hasOfficialAsset ? '' : ' hidden'}>Usar perfil oficial</button>
      <span class="profile-digitizer__filename" data-digitizer="filename">Sin imagen</span>
      <div class="profile-digitizer__pdf-nav" data-digitizer="pdf-nav" hidden>
        <button type="button" class="btn btn--ghost" data-digitizer="pdf-prev" aria-label="Página anterior">‹</button>
        <span data-digitizer="pdf-page">Página 1 de 1</span>
        <button type="button" class="btn btn--ghost" data-digitizer="pdf-next" aria-label="Página siguiente">›</button>
      </div>
      <span class="profile-digitizer__counter" data-digitizer="counter">0 puntos</span>
    </div>
    <p class="profile-digitizer__help">Pulsa sobre la silueta para añadir puntos. El primero será el km 0 y el último, la meta. Puedes arrastrarlos para corregirlos; la lupa marca la posición exacta del cursor.</p>
    <div class="profile-digitizer__canvas-wrap" data-digitizer="canvas-wrap">
      <canvas data-digitizer="canvas" aria-label="Digitalizador de perfil"></canvas>
      <canvas class="profile-digitizer__magnifier" data-digitizer="magnifier" width="${MAGNIFIER_SIZE_PX}" height="${MAGNIFIER_SIZE_PX}" aria-hidden="true" hidden></canvas>
      <div class="profile-digitizer__empty" data-digitizer="empty">Carga una imagen de perfil para empezar</div>
    </div>
    <div class="profile-digitizer__toolbar">
      <button type="button" class="btn btn--ghost" data-digitizer="undo" disabled>Deshacer</button>
      <button type="button" class="btn btn--ghost" data-digitizer="delete" disabled>Borrar punto</button>
      <button type="button" class="btn btn--ghost" data-digitizer="clear" disabled>Limpiar línea</button>
    </div>
    <div class="profile-digitizer__laps">
      <strong>Vueltas</strong>
      <button type="button" class="btn btn--ghost" data-digitizer="lap-start" disabled>Marcar inicio</button>
      <button type="button" class="btn btn--ghost" data-digitizer="lap-end" disabled>Marcar final</button>
      <span data-digitizer="lap-region">Perfil completo</span>
      <label>N.º total <input type="number" min="2" max="50" step="1" value="2" data-digitizer="lap-count"></label>
      <button type="button" class="btn btn--ghost" data-digitizer="repeat-laps" disabled>Aplicar vueltas</button>
      <button type="button" class="btn btn--ghost" data-digitizer="lap-reset">Usar perfil completo</button>
    </div>
    <div class="profile-digitizer__calibration">
      <div class="profile-digitizer__reference profile-digitizer__reference--low">
        <strong>Punto más bajo</strong>
        <span data-digitizer="low-label">Sin marcar</span>
        <input type="number" step="1" placeholder="Altitud (m)" aria-label="Altitud del punto más bajo" data-digitizer="low-alt">
        <button type="button" class="btn btn--ghost" data-digitizer="set-low" disabled>Usar punto seleccionado</button>
      </div>
      <div class="profile-digitizer__reference profile-digitizer__reference--high">
        <strong>Punto más alto</strong>
        <span data-digitizer="high-label">Sin marcar</span>
        <input type="number" step="1" placeholder="Altitud (m)" aria-label="Altitud del punto más alto" data-digitizer="high-alt">
        <button type="button" class="btn btn--ghost" data-digitizer="set-high" disabled>Usar punto seleccionado</button>
      </div>
    </div>
    <div class="profile-digitizer__footer">
      <span class="profile-digitizer__status" data-digitizer="status"></span>
      <button type="button" class="btn btn--primary" data-digitizer="save" disabled>Guardar perfil digitalizado</button>
    </div>`;
}

export function mountProfileDigitizer({
  root,
  distanceInput,
  initialAssetUrl = null,
  loadAssetData = null,
  onSave,
}) {
  if (!root) return () => {};
  root.innerHTML = digitizerMarkup(!!initialAssetUrl);

  const get = name => root.querySelector(`[data-digitizer="${name}"]`);
  const canvas = get('canvas');
  const ctx = canvas.getContext('2d');
  const magnifier = get('magnifier');
  const magnifierCtx = magnifier.getContext('2d');
  const state = {
    image: null,
    imageUrl: null,
    pdfDocument: null,
    pdfPageNumber: 1,
    pdfLabel: '',
    loadToken: 0,
    points: [],
    selectedId: null,
    lowId: null,
    highId: null,
    lapStartId: null,
    lapEndId: null,
    nextId: 1,
    history: [],
    dragging: false,
  };

  const snapshot = () => ({
    points: state.points.map(p => ({ ...p })),
    selectedId: state.selectedId,
    lowId: state.lowId,
    highId: state.highId,
    lapStartId: state.lapStartId,
    lapEndId: state.lapEndId,
    nextId: state.nextId,
  });
  const remember = () => {
    state.history.push(snapshot());
    if (state.history.length > 80) state.history.shift();
  };

  function pointById(id) {
    return state.points.find(p => p.id === id);
  }

  function resetTrace() {
    state.points = [];
    state.selectedId = state.lowId = state.highId = null;
    state.lapStartId = state.lapEndId = null;
    state.history = [];
    get('status').textContent = '';
  }

  function updateControls() {
    const count = state.points.length;
    get('counter').textContent = `${count} punto${count === 1 ? '' : 's'}`;
    get('undo').disabled = state.history.length === 0;
    get('delete').disabled = state.selectedId == null;
    get('clear').disabled = count === 0;
    get('set-low').disabled = state.selectedId == null;
    get('set-high').disabled = state.selectedId == null;
    get('lap-start').disabled = state.selectedId == null;
    get('lap-end').disabled = state.selectedId == null;
    get('repeat-laps').disabled = count < 2;
    get('save').disabled = !state.image || count < 2 || state.lowId == null || state.highId == null;
    const low = pointById(state.lowId);
    const high = pointById(state.highId);
    get('low-label').textContent = low ? `Punto ${state.points.indexOf(low) + 1}` : 'Sin marcar';
    get('high-label').textContent = high ? `Punto ${state.points.indexOf(high) + 1}` : 'Sin marcar';
    const lapStart = pointById(state.lapStartId);
    const lapEnd = pointById(state.lapEndId);
    if (lapStart || lapEnd) {
      const startLabel = lapStart ? `punto ${state.points.indexOf(lapStart) + 1}` : 'inicio';
      const endLabel = lapEnd ? `punto ${state.points.indexOf(lapEnd) + 1}` : 'meta';
      get('lap-region').textContent = `${startLabel}–${endLabel}`;
    } else {
      get('lap-region').textContent = 'Perfil completo';
    }
  }

  function drawMarker(point) {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    const selected = point.id === state.selectedId;
    const low = point.id === state.lowId;
    const high = point.id === state.highId;
    const radius = Math.max(2, canvas.width / 900);
    ctx.beginPath();
    ctx.arc(x, y, selected ? radius * 1.5 : radius, 0, Math.PI * 2);
    ctx.fillStyle = low ? '#188038' : high ? '#e8710a' : selected ? '#1a73e8' : '#fff';
    ctx.fill();
    ctx.lineWidth = Math.max(1, canvas.width / 1800);
    ctx.strokeStyle = '#111';
    ctx.stroke();
    if (low || high) {
      ctx.font = `700 ${Math.max(12, canvas.width / 85)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = Math.max(3, canvas.width / 400);
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.strokeText(low ? 'BAJO' : 'ALTO', x, y - radius * 1.5);
      ctx.fillStyle = low ? '#188038' : '#e8710a';
      ctx.fillText(low ? 'BAJO' : 'ALTO', x, y - radius * 1.5);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state.image) return;
    ctx.drawImage(state.image, 0, 0, canvas.width, canvas.height);
    if (state.points.length > 1) {
      ctx.beginPath();
      state.points.forEach((p, i) => {
        const x = p.x * canvas.width;
        const y = p.y * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(5, canvas.width / 220);
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.stroke();
      ctx.lineWidth = Math.max(2, canvas.width / 500);
      ctx.strokeStyle = '#d93025';
      ctx.stroke();
    }
    state.points.forEach(drawMarker);
  }

  function refresh() {
    state.points.sort((a, b) => a.x - b.x);
    updateControls();
    draw();
  }

  function setImageSource(image, width, height, label) {
    state.image = image;
    const targetWidth = Math.min(1800, width || 1200);
    canvas.width = targetWidth;
    canvas.height = Math.max(1, Math.round(targetWidth * height / width));
    get('empty').hidden = true;
    get('filename').textContent = label;
    resetTrace();
    refresh();
  }

  function closePdf() {
    const oldDocument = state.pdfDocument;
    state.pdfDocument = null;
    state.pdfPageNumber = 1;
    state.pdfLabel = '';
    get('pdf-nav').hidden = true;
    // PDF.js puede resolver una carga abortada con un objeto parcial sin
    // `destroy()`. El cierre del digitalizador no debe impedir montar el
    // editor de la siguiente jornada.
    if (typeof oldDocument?.destroy === 'function') {
      Promise.resolve(oldDocument.destroy()).catch(() => {});
    }
  }

  async function renderPdfPage(pageNumber, token = state.loadToken) {
    const pdf = state.pdfDocument;
    if (!pdf || token !== state.loadToken) return;
    const boundedPage = Math.min(pdf.numPages, Math.max(1, pageNumber));
    get('status').textContent = `Renderizando página ${boundedPage}…`;
    const page = await pdf.getPage(boundedPage);
    if (token !== state.loadToken) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1.5, 1800 / baseViewport.width));
    const viewport = page.getViewport({ scale });
    const rendered = document.createElement('canvas');
    rendered.width = Math.ceil(viewport.width);
    rendered.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: rendered.getContext('2d'), viewport }).promise;
    if (token !== state.loadToken) return;
    state.pdfPageNumber = boundedPage;
    get('pdf-nav').hidden = pdf.numPages <= 1;
    get('pdf-page').textContent = `Página ${boundedPage} de ${pdf.numPages}`;
    get('pdf-prev').disabled = boundedPage <= 1;
    get('pdf-next').disabled = boundedPage >= pdf.numPages;
    setImageSource(rendered, rendered.width, rendered.height, `${state.pdfLabel} · pág. ${boundedPage}`);
    get('status').textContent = '';
  }

  async function loadPdf(source, label) {
    const token = ++state.loadToken;
    closePdf();
    get('status').textContent = 'Cargando PDF…';
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument(typeof source === 'string'
      ? { url: source }
      : { data: new Uint8Array(source) });
    const pdf = await loadingTask.promise;
    if (token !== state.loadToken) {
      await pdf.destroy();
      return;
    }
    state.pdfDocument = pdf;
    state.pdfLabel = label;
    await renderPdfPage(1, token);
  }

  function loadImageUrl(url, label, { preservePdf = false } = {}) {
    const token = ++state.loadToken;
    if (!preservePdf) closePdf();
    get('status').textContent = 'Cargando imagen…';
    const image = new Image();
    image.onload = () => {
      if (token !== state.loadToken) return;
      setImageSource(image, image.naturalWidth, image.naturalHeight, label);
    };
    image.onerror = () => {
      if (token === state.loadToken) get('status').textContent = 'No se ha podido abrir la imagen del perfil.';
    };
    image.src = url;
  }

  async function loadOfficialAsset() {
    if (!initialAssetUrl) return;
    const label = `Perfil oficial · ${sourceLabel(initialAssetUrl)}`;
    try {
      if (isPdfSource(initialAssetUrl)) {
        const source = loadAssetData ? await loadAssetData(initialAssetUrl) : initialAssetUrl;
        await loadPdf(source, label);
      }
      else loadImageUrl(initialAssetUrl, label);
    } catch (error) {
      get('status').textContent = `No se ha podido abrir el perfil oficial: ${error.message}`;
    }
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      hitRadius: MIN_POINT_SPACING_PX / rect.width,
      xTolerance: MIN_POINT_SPACING_PX / rect.width,
      minXGap: MIN_POINT_SPACING_PX / rect.width,
    };
  }

  function hideMagnifier() {
    magnifier.hidden = true;
  }

  function updateMagnifier(event, pos = canvasPoint(event)) {
    if (!state.image || event.pointerType === 'touch') {
      hideMagnifier();
      return;
    }

    const sourceX = pos.x * canvas.width;
    const sourceY = pos.y * canvas.height;
    const canvasScale = canvas.width / canvas.clientWidth;
    const destinationScale = MAGNIFIER_ZOOM / canvasScale;
    const sourceSize = (MAGNIFIER_SIZE_PX / MAGNIFIER_ZOOM) * canvasScale;
    const sourceLeft = sourceX - sourceSize / 2;
    const sourceTop = sourceY - sourceSize / 2;
    const clippedLeft = Math.max(0, sourceLeft);
    const clippedTop = Math.max(0, sourceTop);
    const clippedRight = Math.min(canvas.width, sourceLeft + sourceSize);
    const clippedBottom = Math.min(canvas.height, sourceTop + sourceSize);
    const clippedWidth = Math.max(0, clippedRight - clippedLeft);
    const clippedHeight = Math.max(0, clippedBottom - clippedTop);

    magnifierCtx.clearRect(0, 0, MAGNIFIER_SIZE_PX, MAGNIFIER_SIZE_PX);
    magnifierCtx.fillStyle = '#fff';
    magnifierCtx.fillRect(0, 0, MAGNIFIER_SIZE_PX, MAGNIFIER_SIZE_PX);
    if (clippedWidth && clippedHeight) {
      magnifierCtx.imageSmoothingEnabled = false;
      magnifierCtx.drawImage(
        canvas,
        clippedLeft,
        clippedTop,
        clippedWidth,
        clippedHeight,
        (clippedLeft - sourceLeft) * destinationScale,
        (clippedTop - sourceTop) * destinationScale,
        clippedWidth * destinationScale,
        clippedHeight * destinationScale,
      );
    }

    const center = MAGNIFIER_SIZE_PX / 2;
    magnifierCtx.imageSmoothingEnabled = true;
    magnifierCtx.strokeStyle = 'rgba(0,0,0,.9)';
    magnifierCtx.lineWidth = 1;
    magnifierCtx.beginPath();
    magnifierCtx.moveTo(center, 0);
    magnifierCtx.lineTo(center, MAGNIFIER_SIZE_PX);
    magnifierCtx.moveTo(0, center);
    magnifierCtx.lineTo(MAGNIFIER_SIZE_PX, center);
    magnifierCtx.stroke();
    magnifierCtx.fillStyle = '#d93025';
    magnifierCtx.fillRect(center - 1, center - 1, 3, 3);

    const pointerX = canvas.offsetLeft + pos.x * canvas.clientWidth;
    const pointerY = canvas.offsetTop + pos.y * canvas.clientHeight;
    const offset = 18;
    const placeLeft = pointerX + offset + MAGNIFIER_SIZE_PX <= canvas.offsetLeft + canvas.clientWidth;
    const placeAbove = pointerY + offset + MAGNIFIER_SIZE_PX > canvas.offsetTop + canvas.clientHeight;
    magnifier.style.left = `${placeLeft ? pointerX + offset : pointerX - MAGNIFIER_SIZE_PX - offset}px`;
    magnifier.style.top = `${placeAbove ? pointerY - MAGNIFIER_SIZE_PX - offset : pointerY + offset}px`;
    magnifier.hidden = false;
  }

  function nearestPoint(pos) {
    let best = null;
    let bestDistance = Infinity;
    for (const point of state.points) {
      const dx = point.x - pos.x;
      const dy = (point.y - pos.y) * (canvas.height / canvas.width);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        best = point;
        bestDistance = distance;
      }
    }
    return bestDistance < pos.hitRadius ? best : null;
  }

  get('file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    try {
      if (isPdfSource(file.name, file.type)) {
        await loadPdf(await file.arrayBuffer(), file.name);
      } else {
        if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
        state.imageUrl = URL.createObjectURL(file);
        loadImageUrl(state.imageUrl, file.name);
      }
    } catch (error) {
      get('status').textContent = `No se ha podido abrir el archivo: ${error.message}`;
    }
  });

  get('official').addEventListener('click', loadOfficialAsset);
  get('pdf-prev').addEventListener('click', () => renderPdfPage(state.pdfPageNumber - 1));
  get('pdf-next').addEventListener('click', () => renderPdfPage(state.pdfPageNumber + 1));

  canvas.addEventListener('pointerdown', event => {
    if (!state.image) return;
    const pos = canvasPoint(event);
    // Una curva no puede tener dos altitudes en el mismo km. Si el clic cae en
    // la misma vertical que un punto existente, seleccionarlo aunque la Y se
    // haya desviado ligeramente en lugar de crear un duplicado imposible.
    const nearest = nearestPoint(pos)
      || state.points.find(point => Math.abs(point.x - pos.x) < pos.xTolerance);
    remember();
    if (nearest) {
      state.selectedId = nearest.id;
      state.dragging = true;
      canvas.setPointerCapture(event.pointerId);
    } else {
      const point = { id: state.nextId++, x: pos.x, y: pos.y };
      state.points.push(point);
      state.selectedId = point.id;
    }
    get('status').textContent = '';
    refresh();
    updateMagnifier(event, pos);
  });

  canvas.addEventListener('pointermove', event => {
    const pos = canvasPoint(event);
    if (state.dragging && state.selectedId != null) {
      const point = pointById(state.selectedId);
      const index = state.points.indexOf(point);
      const minX = index > 0 ? state.points[index - 1].x + pos.minXGap : 0;
      const maxX = index < state.points.length - 1 ? state.points[index + 1].x - pos.minXGap : 1;
      point.x = Math.min(maxX, Math.max(minX, pos.x));
      point.y = pos.y;
      refresh();
    }
    updateMagnifier(event, pos);
  });
  const stopDragging = () => { state.dragging = false; };
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('pointerleave', hideMagnifier);

  get('undo').addEventListener('click', () => {
    const previous = state.history.pop();
    if (!previous) return;
    Object.assign(state, previous);
    refresh();
  });
  get('delete').addEventListener('click', () => {
    if (state.selectedId == null) return;
    remember();
    state.points = state.points.filter(p => p.id !== state.selectedId);
    if (state.lowId === state.selectedId) state.lowId = null;
    if (state.highId === state.selectedId) state.highId = null;
    if (state.lapStartId === state.selectedId) state.lapStartId = null;
    if (state.lapEndId === state.selectedId) state.lapEndId = null;
    state.selectedId = null;
    refresh();
  });
  get('clear').addEventListener('click', () => {
    remember();
    state.points = [];
    state.selectedId = state.lowId = state.highId = null;
    state.lapStartId = state.lapEndId = null;
    refresh();
  });
  get('set-low').addEventListener('click', () => {
    state.lowId = state.selectedId;
    if (state.highId === state.lowId) state.highId = null;
    refresh();
  });
  get('set-high').addEventListener('click', () => {
    state.highId = state.selectedId;
    if (state.lowId === state.highId) state.lowId = null;
    refresh();
  });
  get('lap-start').addEventListener('click', () => {
    state.lapStartId = state.selectedId;
    if (state.lapEndId != null && state.points.indexOf(pointById(state.lapEndId)) <= state.points.indexOf(pointById(state.lapStartId))) {
      state.lapEndId = null;
    }
    refresh();
  });
  get('lap-end').addEventListener('click', () => {
    const selectedIndex = state.points.indexOf(pointById(state.selectedId));
    const startIndex = state.points.indexOf(pointById(state.lapStartId));
    if (state.lapStartId != null && selectedIndex <= startIndex) {
      get('status').textContent = 'El final de la vuelta debe estar después del inicio.';
      return;
    }
    state.lapEndId = state.selectedId;
    refresh();
  });
  get('lap-reset').addEventListener('click', () => {
    state.lapStartId = state.lapEndId = null;
    refresh();
  });
  get('repeat-laps').addEventListener('click', () => {
    try {
      const sorted = [...state.points].sort((a, b) => a.x - b.x);
      const startPointId = state.lapStartId ?? sorted[0]?.id;
      const endPointId = state.lapEndId ?? sorted.at(-1)?.id;
      remember();
      const repeated = repeatControlPointRegion({
        controlPoints: state.points,
        startPointId,
        endPointId,
        lapCount: Number(get('lap-count').value),
        nextId: state.nextId,
      });
      state.points = repeated.points;
      state.nextId = repeated.nextId;
      state.selectedId = null;
      state.lapStartId = state.lapEndId = null;
      get('status').textContent = 'Vueltas aplicadas a la línea. Usa Deshacer para revertirlas.';
      refresh();
    } catch (error) {
      // No se añade una entrada de historial si la operación no llega a aplicarse.
      state.history.pop();
      get('status').textContent = error.message;
      updateControls();
    }
  });

  get('save').addEventListener('click', async () => {
    const button = get('save');
    try {
      const profile = buildDigitizedElevationProfile({
        controlPoints: state.points,
        distanceKm: Number(distanceInput?.value),
        lowReference: {
          pointId: state.lowId,
          altitude: get('low-alt').value.trim() === '' ? NaN : Number(get('low-alt').value),
        },
        highReference: {
          pointId: state.highId,
          altitude: get('high-alt').value.trim() === '' ? NaN : Number(get('high-alt').value),
        },
      });
      button.disabled = true;
      get('status').textContent = 'Guardando…';
      await onSave(profile);
      get('status').textContent = `Guardado: ${profile.points.length} puntos · +${profile.elevationGain} m`;
    } catch (error) {
      get('status').textContent = error.message || 'No se ha podido guardar el perfil.';
    } finally {
      updateControls();
    }
  });

  refresh();
  if (initialAssetUrl) loadOfficialAsset();
  return () => {
    state.loadToken++;
    hideMagnifier();
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    closePdf();
  };
}
