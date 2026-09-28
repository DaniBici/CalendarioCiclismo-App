// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Subidas a Cloudflare R2, claves canónicas de assets y subida inline de logos
// ─────────────────────────────────────────────────────────────────

import { supabase } from '../shared.js';
import { showToast } from './helpers.js';

// ── Cloudflare R2 — subida vía Edge Function (proxy server-side) ─
export const R2_PUBLIC_BASE       = 'https://assets.calendariociclismo.app';
export const R2_UPLOAD_FN         = `${SUPABASE_URL}/functions/v1/r2-upload`;

// ── Helpers para subir/borrar/listar archivos vía Edge Function ──
export async function getAuthHeaders() {
  let { data: { session } } = await supabase.auth.getSession();
  if (!session || isTokenExpiringSoon(session)) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) {
      await supabase.auth.signOut();
      throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
    }
    session = data.session;
  }
  if (!session) throw new Error('Sesión expirada. Vuelve a iniciar sesión.');
  return {
    'Authorization': `Bearer ${session.access_token}`,
    'apikey':        SUPABASE_ANON_KEY,
  };
}

function isTokenExpiringSoon(session) {
  if (!session.expires_at) return false;
  // Refresh if token expires within 60 seconds
  return session.expires_at * 1000 - Date.now() < 60_000;
}

export async function r2PutObject(filename, fileBuffer, contentType) {
  const auth = await getAuthHeaders();
  const res = await fetch(R2_UPLOAD_FN, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': contentType,
      'x-action':     'upload',
      'x-filename':   encodeURIComponent(filename),
    },
    body: fileBuffer,
  });
  return res;
}

// Las guías técnicas grandes van directamente al endpoint S3 de R2 mediante
// una URL PUT temporal. La Edge Function solo firma: no recibe el PDF.
export async function r2PutTechnicalGuide(filename, file, contentType) {
  const auth = await getAuthHeaders();
  const signRes = await fetch(R2_UPLOAD_FN, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': contentType, 'x-action': 'sign-upload', 'x-filename': encodeURIComponent(filename) },
  });
  if (!signRes.ok) throw new Error(`No se pudo preparar la subida (${signRes.status})`);
  const { url } = await signRes.json();
  const putRes = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!putRes.ok) throw new Error(`R2 ${putRes.status}`);
  return putRes;
}

async function r2ListObjects() {
  const auth = await getAuthHeaders();
  const res = await fetch(R2_UPLOAD_FN, {
    headers: auth,
  });
  const data = await res.json();
  return data.files || [];
}

// ── Claves canónicas de assets de jornada ────────────────────────
// No usar el nombre que trae el archivo ni una marca temporal: ambos hacen que
// una misma carrera termine con rutas imposibles de descubrir. La edición vive
// en el segmento de año y el tipo es el nombre estable del objeto.
function stableRaceAssetSlug(slug, year) {
  const suffix = `-${year}`;
  return slug?.endsWith(suffix) ? slug.slice(0, -suffix.length) : (slug || 'race');
}

function stageAssetDirectory(stageNumber, raceDaySlug = '') {
  if (stageNumber === null || stageNumber === undefined || stageNumber === '') return '';
  // Jornadas partidas: el slug canónico acaba en etapa-3a / stage-3a. El
  // sufijo evita que 3 y 3a compartan objeto sin imponer convenciones nuevas.
  const match = String(raceDaySlug).match(new RegExp(`(?:etapa|stage)-${stageNumber}([a-z]+)$`, 'i'));
  const suffix = match ? match[1].toLowerCase() : '';
  return `stage-${stageNumber}${suffix}/`;
}

function canonicalStageAssetKey({ raceSlug, year, stageNumber, raceDaySlug, type, ext }) {
  if (!raceSlug || !year || !['technicalGuide', 'roadbook', 'profile', 'ports', 'map'].includes(type)) {
    throw new Error('No se puede construir la ruta canónica de este asset.');
  }
  // La guía técnica es única para toda la carrera, nunca para una etapa.
  const stageDir = type === 'technicalGuide' ? '' : stageAssetDirectory(stageNumber, raceDaySlug);
  return `races/${stableRaceAssetSlug(raceSlug, year)}/${year}/${stageDir}${type}.${ext}`;
}

function nextCanonicalStageAssetKey(context, currentUrl = '') {
  const baseKey = canonicalStageAssetKey(context);
  // Reemplazar un documento no pisa su URL cacheada: conserva la carpeta y el
  // tipo, incrementando únicamente la revisión (`profile-2.png`, etc.).
  const currentName = String(currentUrl).split('/').pop()?.split('?')[0] || '';
  const match = currentName.match(new RegExp(`^${context.type}-(\\d+)\\.${context.ext}$`, 'i'));
  return match
    ? baseKey.replace(`.${context.ext}`, `-${Number(match[1]) + 1}.${context.ext}`)
    : currentName === `${context.type}.${context.ext}`
      ? baseKey.replace(`.${context.ext}`, `-2.${context.ext}`)
      : baseKey;
}

// ─────────────────────────────────────────────────────────────────
//  UPLOAD INLINE — para logos y roadbooks desde el editor
// ─────────────────────────────────────────────────────────────────
async function inlineUpload(file, targetInput, tipo) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowed.includes(file.type)) { showToast('Formato no permitido. Solo JPG, PNG, WebP o PDF.'); return; }
  const maxBytes = tipo === 'technicalGuide' ? 150 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxBytes) { showToast(`El archivo supera los ${tipo === 'technicalGuide' ? '150' : '10'} MB.`); return; }

  const btn = targetInput.parentElement.querySelector('.inline-upload-btn');
  const origText = btn ? btn.textContent : '';
  if (btn) btn.textContent = '…';

  let uploadBlob, uploadExt, uploadMime;

  // Si es logo, procesar: redimensionar a 128×128 y convertir a WebP
  if (tipo === 'logo') {
    try {
      uploadBlob = await processLogoImage(file);
      uploadExt  = 'webp';
      uploadMime = 'image/webp';
    } catch (e) {
      showToast('Error al procesar logo: ' + e.message);
      if (btn) btn.textContent = origText;
      return;
    }
  } else {
    uploadBlob = file;
    uploadExt  = file.name.split('.').pop().toLowerCase();
    uploadMime = file.type;
  }

  const editorArea = document.getElementById('editorArea');
  let filename;
  if (['technicalGuide', 'roadbook', 'profile', 'ports', 'map'].includes(tipo)) {
    filename = nextCanonicalStageAssetKey({
      raceSlug: editorArea?.dataset.raceSlug,
      year: editorArea?.dataset.raceYear,
      stageNumber: editorArea?.dataset.stageNumber === '' ? null : Number(editorArea?.dataset.stageNumber),
      raceDaySlug: editorArea?.dataset.raceDaySlug,
      type: tipo,
      ext: uploadExt,
    }, targetInput.value);
  } else {
    filename = `${Date.now()}-${tipo}.${uploadExt}`;
  }
  const publicUrl = `${R2_PUBLIC_BASE}/${filename}`;

  try {
    const res = tipo === 'technicalGuide'
      ? await r2PutTechnicalGuide(filename, uploadBlob, uploadMime)
      : await r2PutObject(filename, await uploadBlob.arrayBuffer(), uploadMime);
    if (!res.ok) throw new Error(`R2 ${res.status}`);
    targetInput.value = publicUrl;
    targetInput.dispatchEvent(new Event('input'));
    if (btn) { btn.textContent = '✓'; setTimeout(() => { btn.textContent = origText; }, 2000); }
    // Si es logo, intentar extraer color dominante y rellenar colorHex si está vacío
    if (tipo === 'logo') {
      // Deducir el prefijo del id del input de logo (nr-, er-, cg-)
      const prefix = (targetInput.id || '').replace(/-logo$/, '-');
      const colorInput  = document.getElementById(prefix + 'color');
      const colorPicker = document.getElementById(prefix + 'colorPicker');
      if (colorInput && !colorInput.value.trim()) {
        extractDominantColor(publicUrl).then(hex => {
          if (hex) {
            colorInput.value = hex;
            if (colorPicker) colorPicker.value = hex;
            showToast('Color extraído del logo: ' + hex, 'success', 3000);
          }
        });
      }
    }
  } catch (err) {
    showToast('Error al subir: ' + err.message);
    if (btn) btn.textContent = origText;
  }
}

// ── Procesar logo: redimensionar a 128×128 y convertir a WebP ───
const LOGO_SIZE    = 128;  // px (cubre 48px@2x retina)
const LOGO_QUALITY = 0.82; // calidad WebP (buen balance peso/calidad)

async function processLogoImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = LOGO_SIZE;
        const ctx = canvas.getContext('2d');

        // Fondo transparente (WebP soporta alpha)
        ctx.clearRect(0, 0, LOGO_SIZE, LOGO_SIZE);

        // Escalar manteniendo proporción (contain)
        const scale = Math.min(LOGO_SIZE / img.width, LOGO_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (LOGO_SIZE - w) / 2;
        const y = (LOGO_SIZE - h) / 2;
        ctx.drawImage(img, x, y, w, h);

        canvas.toBlob(
          blob => {
            if (!blob) { reject(new Error('Error al procesar imagen')); return; }
            resolve(blob);
          },
          'image/webp',
          LOGO_QUALITY
        );
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); reject(new Error('No se pudo cargar la imagen')); };
    img.src = objUrl;
  });
}

// ── Extraer color dominante de una imagen via canvas ─────────────
async function extractDominantColor(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const SIZE = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

        // Contar píxeles por color (cubos de 24 para más precisión)
        const buckets = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a < 80) continue; // transparente
          const key = `${Math.round(r/24)*24},${Math.round(g/24)*24},${Math.round(b/24)*24}`;
          buckets[key] = (buckets[key] || 0) + 1;
        }

        if (!Object.keys(buckets).length) { resolve(null); return; }

        // Ordenar por frecuencia (más píxeles primero)
        const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);

        // Tomar el más frecuente que no sea blanco/casi blanco ni negro/casi negro
        const isWhitish = key => {
          const [r, g, b] = key.split(',').map(Number);
          return (r + g + b) / 3 > 220;
        };
        const isBlackish = key => {
          const [r, g, b] = key.split(',').map(Number);
          return (r + g + b) / 3 < 35;
        };

        const winner = sorted.find(([key]) => !isWhitish(key) && !isBlackish(key));
        if (!winner) { resolve(null); return; }

        const [r, g, b] = winner[0].split(',').map(Number);
        const hex = '#' + [r, g, b].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch(e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function attachInlineUpload(input, tipo) {
  // Evitar duplicados
  if (input.parentElement.querySelector('.inline-upload-btn')) return;
  // Crear input file oculto y botón visible
  const fileIn = document.createElement('input');
  fileIn.type   = 'file';
  fileIn.accept = tipo === 'logo' ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf';
  fileIn.style.display = 'none';
  fileIn.addEventListener('change', () => { if (fileIn.files[0]) inlineUpload(fileIn.files[0], input, tipo); fileIn.value = ''; });

  const btn = document.createElement('button');
  btn.type      = 'button';
  btn.className = 'inline-upload-btn';
  btn.textContent = '↑';
  btn.title     = 'Subir archivo';
  btn.addEventListener('click', () => fileIn.click());

  input.parentElement.style.display  = 'flex';
  input.parentElement.style.gap      = '0.4rem';
  input.parentElement.style.alignItems = 'center';
  input.style.flex = '1';
  input.after(btn);
  input.after(fileIn);
}

async function handleUpload(file) {
  const allowed  = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const errDiv   = document.getElementById('uploadError');
  const progress = document.getElementById('uploadProgress');
  const result   = document.getElementById('uploadResult');

  errDiv.style.display   = 'none';
  result.style.display   = 'none';
  progress.style.display = 'none';

  if (!allowed.includes(file.type)) {
    errDiv.textContent   = 'Formato no permitido. Solo JPG, PNG, WebP o PDF.';
    errDiv.style.display = 'block';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    errDiv.textContent   = 'El archivo supera los 10 MB.';
    errDiv.style.display = 'block';
    return;
  }

  const uploadBlob = file;
  const uploadExt  = file.name.split('.').pop().toLowerCase();
  const uploadMime = file.type;

  const slug     = file.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '-');
  const ts       = Date.now();
  const filename = `${ts}-${slug}.${uploadExt}`;
  const publicUrl = `${R2_PUBLIC_BASE}/${filename}`;

  progress.style.display = 'flex';
  document.getElementById('uploadProgressBar').style.width = '0%';
  document.getElementById('uploadProgressLabel').textContent = 'Subiendo…';

  try {
    const fileBuffer = await uploadBlob.arrayBuffer();

    document.getElementById('uploadProgressBar').style.width = '50%';
    document.getElementById('uploadProgressLabel').textContent = 'Subiendo… 50%';

    const res = await r2PutObject(filename, fileBuffer, uploadMime);

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`R2 ${res.status}: ${txt.slice(0, 120)}`);
    }

    document.getElementById('uploadProgressBar').style.width = '100%';
    document.getElementById('uploadProgressLabel').textContent = 'Subido ✓';
    setTimeout(() => { progress.style.display = 'none'; }, 800);

    document.getElementById('uploadResultUrl').value = publicUrl;
    result.style.display = 'flex';
    document.getElementById('fileInput').value  = '';

  } catch (err) {
    progress.style.display  = 'none';
    errDiv.textContent       = 'Error al subir: ' + err.message;
    errDiv.style.display     = 'block';
  }
}
