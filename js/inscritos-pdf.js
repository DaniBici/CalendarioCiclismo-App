// ─────────────────────────────────────────────────────────────────
//  INSCRITOS-PDF — genera un PDF con la lista de inscritos
//  Dependencia: jsPDF (cargada dinámicamente)
//  Fuente:      Roboto (TTF, cargada desde Google Fonts para UTF-8)
// ─────────────────────────────────────────────────────────────────

import { getLang, t as i18nT } from './i18n.js';
import { isIndividualPlaceholderTeam } from './shared.js';

let jsPDFPromise = null;
let fontsPromise = null;

const JSPDF_URLS = [
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js',
];

const FONT_URLS = {
  regular: 'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmEU9fBBc4.ttf',
  bold:    'https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlfBBc4.ttf',
};

function loadJsPDF() {
  if (jsPDFPromise) return jsPDFPromise;
  jsPDFPromise = (async () => {
    for (const url of JSPDF_URLS) {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = url;
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
      } catch { /* try next CDN */ }
    }
    jsPDFPromise = null;
    throw new Error('No se pudo cargar jsPDF');
  })();
  return jsPDFPromise;
}

// Fetch TTF as base64 string for jsPDF addFileToVFS
async function fetchFontBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Preload fonts into memory (cached, retries on failure)
function preloadFonts() {
  if (fontsPromise) return fontsPromise;
  fontsPromise = Promise.all([
    fetchFontBase64(FONT_URLS.regular),
    fetchFontBase64(FONT_URLS.bold),
  ]).catch((err) => {
    console.warn('Font preload failed, will retry:', err);
    fontsPromise = null;
    return null;
  });
  return fontsPromise;
}

// Register fonts into a jsPDF doc. Returns the font family name to use.
async function registerFonts(doc) {
  const fonts = await preloadFonts();
  if (!fonts || !fonts[0] || !fonts[1]) return 'helvetica';
  try {
    doc.addFileToVFS('Roboto-Regular.ttf', fonts[0]);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', fonts[1]);
    doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
    return 'Roboto';
  } catch {
    return 'helvetica';
  }
}

/**
 * Preload jsPDF + fonts so click-time generation is instant.
 * Call on mouseenter / touchstart of the button.
 */
export function preload() {
  loadJsPDF();
  preloadFonts();
}

// Convierte URL de imagen a base64 dataURL
async function imgToBase64(url) {
  const res = await fetch(url, { mode: 'cors' });
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Calcula dimensiones manteniendo aspect ratio
function fitImage(imgW, imgH, maxW, maxH) {
  const ratio = Math.min(maxW / imgW, maxH / imgH);
  return { w: imgW * ratio, h: imgH * ratio };
}

// Carga una imagen y devuelve { dataUrl, width, height } o null
async function loadImage(url) {
  if (!url) return null;
  try {
    const dataUrl = await imgToBase64(url);
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch { return null; }
}

// ── Draw site logo icons (calendar + bicycle) with jsPDF primitives ──

function drawCalendarIcon(doc, x, y, size) {
  const s = size;
  const lw = s * 0.09;
  const r = s * 0.1;
  doc.setDrawColor('#1a73e8');
  doc.setLineWidth(lw);
  doc.setLineCap('round');
  // Body rounded rect
  doc.roundedRect(x, y + s * 0.15, s * 0.85, s * 0.85, r, r);
  // Top pins
  const pin1x = x + s * 0.27;
  const pin2x = x + s * 0.58;
  doc.line(pin1x, y, pin1x, y + s * 0.25);
  doc.line(pin2x, y, pin2x, y + s * 0.25);
  // Horizontal divider
  const divY = y + s * 0.42;
  doc.line(x, divY, x + s * 0.85, divY);
}

function drawBicycleIcon(doc, x, y, size) {
  // Faithfully reproduces the SVG: viewBox 0 0 24 24
  // <circle cx="5.5" cy="17.5" r="3.5"/>
  // <circle cx="18.5" cy="17.5" r="3.5"/>
  // <circle cx="15" cy="5" r="1"/>
  // <path d="M12 17.5V14l-3-3 4-3 2 3h2"/>
  const s = size;
  const lw = s * 0.09;
  const p = (v) => v * s / 24; // scale from SVG coords to mm
  doc.setDrawColor('#1a73e8');
  doc.setLineWidth(lw);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  // Wheels
  doc.circle(x + p(5.5), y + p(17.5), p(3.5));
  doc.circle(x + p(18.5), y + p(17.5), p(3.5));
  // Rider head
  doc.setFillColor('#1a73e8');
  doc.circle(x + p(15), y + p(5), p(1), 'F');
  // Frame path: M12,17.5 → V14 → l-3,-3 → l4,-3 → l2,3 → h2
  doc.line(x + p(12), y + p(17.5), x + p(12), y + p(14));   // seat post
  doc.line(x + p(12), y + p(14), x + p(9), y + p(11));       // down-tube
  doc.line(x + p(9), y + p(11), x + p(13), y + p(8));        // top-tube
  doc.line(x + p(13), y + p(8), x + p(15), y + p(11));       // fork
  doc.line(x + p(15), y + p(11), x + p(17), y + p(11));      // handlebar
}

// Strip diacritics and replace non-ASCII with closest equivalent.
// Used as fallback when Roboto fails to load and helvetica is used.
function asciify(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip combining diacritical marks
    .replace(/\u0111/g, 'd')          // đ → d
    .replace(/\u0110/g, 'D')          // Đ → D
    .replace(/\u0142/g, 'l')          // ł → l
    .replace(/\u0141/g, 'L')          // Ł → L
    .replace(/\u00f8/g, 'o')          // ø → o
    .replace(/\u00d8/g, 'O')          // Ø → O
    .replace(/\u00e6/g, 'ae')         // æ → ae
    .replace(/\u00c6/g, 'AE')         // Æ → AE
    .replace(/\u00df/g, 'ss')         // ß → ss
    .replace(/[^\x00-\x7F]/g, '');    // drop remaining non-ASCII
}

/**
 * Genera y descarga el PDF de inscritos.
 */
export async function generateStartlistPDF(opts) {
  const { race, teams, ridersByTeam, heroSubline, totalTeams, totalRiders } = opts;

  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Register Roboto for full UTF-8 support (falls back to helvetica)
  const fontFamily = await registerFonts(doc);
  const enc = fontFamily === 'Roboto' ? (s) => s : asciify;

  // A4 portrait: 210 x 297
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  const usableW = pageW - margin * 2;

  // ── Colors ──
  const colorHex = race.colorHex || '#1a73e8';
  const black = '#1f1f1f';
  const muted = '#5f6368';
  const dim = '#9aa0a6';
  const headerBg = '#f1f3f4';
  const border = '#e0e0e0';
  const accent = '#1a73e8';

  // ── SITE LOGO (calendar icon + bicycle icon + text) ──
  let y = margin;
  const iconSize = 5;

  drawCalendarIcon(doc, margin, y - 0.5, iconSize);
  drawBicycleIcon(doc, margin + iconSize + 1, y - 0.5, iconSize);

  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(accent);
  doc.text(i18nT('seo.siteName'), margin + iconSize * 2 + 3, y + 3.5);

  const logoLineY = y + 6;
  doc.setDrawColor(border);
  doc.setLineWidth(0.3);
  doc.line(margin, logoLineY, pageW - margin, logoLineY);
  y = logoLineY + 4;

  // ── RACE HEADER ──
  let raceLogoImg = null;
  if (race.logoUrl) {
    raceLogoImg = await loadImage(race.logoUrl);
  }

  const headerStartY = y;
  let textX = margin;

  if (raceLogoImg) {
    const fit = fitImage(raceLogoImg.width, raceLogoImg.height, 14, 14);
    doc.addImage(raceLogoImg.dataUrl, textX, y, fit.w, fit.h);
    textX = margin + fit.w + 3;
  }

  // Race name
  doc.setFont(fontFamily, 'bold');
  doc.setFontSize(14);
  doc.setTextColor(black);
  const isEn = getLang() === 'en';
  const raceName = (isEn && race.nameEn) ? race.nameEn : (race.name || i18nT('race.unknown'));
  doc.text(enc(raceName.toUpperCase()), textX, y + 5);

  // Subtitle — strip HTML tags and leading label (works for both ES and EN)
  const subtitleClean = heroSubline.replace(/<[^>]+>/g, '').replace(/^(Dorsales|Lista provisional|Startlist|Provisional Startlist)\s*·\s*/, '');
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(muted);
  doc.text(enc(subtitleClean), textX, y + 9.5);

  // Stats (sin equipos reales no se imprime "0 equipos", como en la web)
  const teamsWord = isEn ? 'teams' : 'equipos';
  const genderWord = isEn ? 'riders' : (race.gender === 'female' ? 'corredoras' : 'corredores');
  const statsText = totalTeams > 0
    ? `${totalTeams} ${teamsWord} · ${totalRiders} ${genderWord}`
    : `${totalRiders} ${genderWord}`;
  doc.setFontSize(6.5);
  doc.setTextColor(dim);
  doc.text(enc(statsText), textX, y + 13);

  y = headerStartY + 17;

  // Separator line
  doc.setDrawColor(border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 3;

  // ── TEAMS GRID ──
  const cols = 4;
  const colW = usableW / cols;
  const gridStartY = y;
  const gridAvailH = pageH - margin - gridStartY;
  const maxRows = 7;

  const totalRows = Math.ceil(teams.length / cols);
  const rows = Math.min(totalRows, maxRows);

  // Size rows to fit 9 riders max, regardless of actual rider count
  const riderSlots = 9;
  const teamHeaderH = 5;
  const riderLineH = 3.2;
  const rowH = teamHeaderH + 1.5 + riderLineH * riderSlots;
  const riderFontSize = Math.min(6.5, riderLineH * 2.2);
  const teamNameFontSize = Math.min(7, riderFontSize + 0.5);

  teams.forEach((team, i) => {
    if (i >= cols * maxRows) return;

    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * colW;
    const cellY = gridStartY + row * rowH;

    // Ficticio "Individual" → celda sin cabecera (los corredores se listan igual).
    if (!isIndividualPlaceholderTeam(team)) {
      // Team header background
      doc.setFillColor(headerBg);
      doc.rect(x, cellY, colW, teamHeaderH, 'F');

      // Team name
      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(teamNameFontSize);
      doc.setTextColor(black);
      const nameMaxW = colW - 4;
      const teamName = team.displayName || team.teamName || '';
      let displayName = enc(teamName.toUpperCase());
      while (doc.getTextWidth(displayName) > nameMaxW && displayName.length > 3) {
        displayName = displayName.slice(0, -1);
      }
      if (displayName.length < enc(teamName.toUpperCase()).length) displayName += '...';
      doc.text(displayName, x + 2.5, cellY + teamHeaderH - 1.3);
    }

    // Riders
    const teamRiders = ridersByTeam[team.id] || [];
    let riderY = cellY + teamHeaderH + riderLineH;

    teamRiders.forEach(r => {
      // Dorsal
      doc.setFont(fontFamily, 'bold');
      doc.setFontSize(riderFontSize - 0.3);
      doc.setTextColor(dim);
      const dorsalStr = r.dorsal ? String(r.dorsal) : '';
      const dorsalW = doc.getTextWidth(dorsalStr);
      if (dorsalStr) doc.text(dorsalStr, x + 6 - dorsalW, riderY);

      // Name
      doc.setFont(fontFamily, 'normal');
      doc.setFontSize(riderFontSize);
      doc.setTextColor(black);
      const fullName = enc(`${r.firstName} ${r.lastName}`);
      const nameMax = colW - 10;
      let riderName = fullName;
      while (doc.getTextWidth(riderName) > nameMax && riderName.length > 3) {
        riderName = riderName.slice(0, -1);
      }
      if (riderName.length < fullName.length) riderName += '...';
      doc.text(riderName, x + 7.5, riderY);

      riderY += riderLineH;
    });

    // Cell borders
    doc.setDrawColor(border);
    doc.setLineWidth(0.2);
    doc.line(x, cellY + rowH, x + colW, cellY + rowH);
    if (col < cols - 1) {
      doc.line(x + colW, cellY, x + colW, cellY + rowH);
    }
  });

  // ── Footer ──
  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(5);
  doc.setTextColor(dim);
  doc.text(window.location.hostname, pageW - margin, pageH - 3, { align: 'right' });

  // ── Download via Blob + <a> click (avoids Chrome popup-blocker) ──
  const safeName = (race.slug || race.name || 'inscritos').replace(/[^a-z0-9-]/gi, '-');
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inscritos-${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
