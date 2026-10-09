// ─────────────────────────────────────────────────────────────────
//  INSCRITOS-PDF — genera un PDF con la lista de inscritos
//  Dependencia: jsPDF (cargada dinámicamente)
//  Fuente:      Google Sans (TTF autoalojado en /fonts/pdf/, subconjunto
//               latino) para UTF-8; si falla, Helvetica sin diacríticos.
//
//  Estética: réplica en tema claro de la página /inscritos/ (cabecera de la
//  web, cabecera de carrera y rejilla de equipos). La opción `identity` cambia
//  nombre, logotipo, tipografías, colores y dominio para generar el mismo PDF
//  con la imagen de otra web; sin ella, el PDF es el de Calendario Ciclismo.
//  Maquetación: rejilla de 4 columnas por filas en orden de lectura. Cada fila
//  toma la altura de su equipo más largo y, si no cabe, salta a una página
//  nueva; no se descarta ningún equipo. Un equipo con más corredores de los
//  que caben en una página se reparte en varias celdas.
// ─────────────────────────────────────────────────────────────────

import { getLang, t as i18nT } from './i18n.js';
import { isNoTeamPlaceholderTeam } from './shared.js';
import { flagIconUrl } from './flag-url.js';

let jsPDFPromise = null;
const fontsPromises = new Map();   // URL de los TTF → promesa con su base64

const JSPDF_URLS = [
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
  'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js',
];

// Subconjuntos latinos de Google Sans (OFL 1.1), la tipografía de la web.
// Autoalojados: las URLs versionadas de fonts.gstatic.com caducan.
const FONT_BASE = (typeof CONFIG !== 'undefined' && CONFIG.basePath) || '';
const FONT_WEIGHTS = ['Regular', 'Medium', 'Bold'];
const FONT_STYLES = ['normal', 'medium', 'bold'];

// Identidad por defecto: la de Calendario Ciclismo. Otra web pasa la suya en
// `identity` (mismas claves; `colors` se combina con estos).
//   siteName   nombre en la cabecera de cada página y creador del documento
//   logoUrl    imagen del logotipo de la cabecera; sin ella, los iconos de
//              calendario y bicicleta de la cabecera web
//   logoHeight alto del logotipo en mm
//   fonts      { family, files: [regular, medium, bold] }: TTF (no WOFF2)
//   nameFont   { family, file }: TTF opcional para el nombre de la cabecera
//   colors     tokens del tema claro
//   host       texto del enlace del pie; por defecto, el dominio de la página
//   generatedDate  si la cabecera de la primera página lleva «Generado el …» (por
//              defecto, sí); sin ella, el PDF no cambia de un día a otro
//   headerText texto a la derecha de la cabecera de la web en todas las páginas;
//              por defecto, la fecha en la primera y el nombre de la carrera en las demás
//   raceHeader si va la cabecera de la carrera (logotipo, bandera, nombre,
//              fechas y cifras) bajo la de la web; por defecto, sí
//   pageNumbers si el pie lleva «Página n de m»; por defecto, sí
const CC_IDENTITY = {
  siteName: 'Calendario Ciclismo',
  logoUrl: null,
  logoHeight: 4.4,
  fonts: { family: 'GoogleSans', files: FONT_WEIGHTS.map(w => `${FONT_BASE}/fonts/pdf/GoogleSans-${w}.ttf`) },
  nameFont: null,
  colors: {
    text: '#1f1f1f',
    textMuted: '#5f6368',
    textDim: '#63686d',
    accent: '#1a73e8',
    border: '#d8dee8',
    headerNeutral: '#e9edf3',   // --bg-card-hover
    dorsalBg: '#eeeff2',        // --dorsal-bg-a
    riderText: null,            // nombre del corredor; sin valor, el de text
  },
  host: null,
  generatedDate: true,
  headerText: null,
  raceHeader: true,
  pageNumbers: true,
};

function resolveIdentity(identity) {
  return { ...CC_IDENTITY, ...identity, colors: { ...CC_IDENTITY.colors, ...identity?.colors } };
}

const IMAGE_TIMEOUT_MS = 5000;

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

// Preload fonts into memory (cached per URL list, retries on failure)
function preloadFonts(files) {
  const key = files.join('|');
  if (fontsPromises.has(key)) return fontsPromises.get(key);
  const promise = Promise.all(files.map(fetchFontBase64)).catch((err) => {
    console.warn('Font preload failed, will retry:', err);
    fontsPromises.delete(key);
    return null;
  });
  fontsPromises.set(key, promise);
  return promise;
}

// Registra las tipografías de la identidad en el documento. Devuelve la
// familia a usar, el estilo equivalente al peso 500 de la web ('medium' o
// 'bold' en Helvetica) y la familia del nombre de la cabecera.
async function registerFonts(doc, identity) {
  const { family, files } = identity.fonts;
  const [fonts, nameFont] = await Promise.all([
    preloadFonts(files),
    identity.nameFont ? preloadFonts([identity.nameFont.file]) : null,
  ]);
  let result = { family: 'helvetica', medium: 'bold', nameFamily: null };
  if (fonts && !fonts.some(f => !f)) {
    try {
      files.forEach((file, i) => {
        doc.addFileToVFS(`${family}-${FONT_WEIGHTS[i]}.ttf`, fonts[i]);
        doc.addFont(`${family}-${FONT_WEIGHTS[i]}.ttf`, family, FONT_STYLES[i]);
      });
      result = { family, medium: 'medium', nameFamily: null };
    } catch { /* Helvetica */ }
  }
  if (nameFont?.[0] && result.family !== 'helvetica') {
    try {
      const name = identity.nameFont.family;
      doc.addFileToVFS(`${name}.ttf`, nameFont[0]);
      doc.addFont(`${name}.ttf`, name, 'normal');
      result.nameFamily = name;
    } catch { /* el nombre va en la familia general */ }
  }
  return result;
}

/**
 * Preload jsPDF + fonts so click-time generation is instant.
 * Call on mouseenter / touchstart of the button.
 */
export function preload(identity) {
  const id = resolveIdentity(identity);
  loadJsPDF();
  preloadFonts(id.fonts.files);
  if (id.nameFont) preloadFonts([id.nameFont.file]);
}

// ── Imágenes ─────────────────────────────────────────────────────
// Toda imagen se rasteriza a PNG mediante canvas: jsPDF no admite SVG (banderas
// de flag-icons, logotipos vectoriales) y así se unifica el formato.

function loadHtmlImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), IMAGE_TIMEOUT_MS);
    img.crossOrigin = 'anonymous';
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}

// Devuelve { dataUrl, width, height } o null. `maxPx` limita el lado mayor.
async function rasterize(url, maxPx, forcedRatio = null) {
  if (!url) return null;
  const img = await loadHtmlImage(url);
  if (!img) return null;
  const w = img.naturalWidth || 300;
  const h = forcedRatio ? w / forcedRatio : (img.naturalHeight || 150);
  const scale = Math.min(1, maxPx / Math.max(w, h)) || 1;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
    return { dataUrl: canvas.toDataURL('image/png'), width: cw, height: ch };
  } catch {
    return null; // canvas contaminado (sin CORS)
  }
}

async function loadFlags(codes) {
  const unique = [...new Set(codes.filter(Boolean).map(c => String(c).toLowerCase()))];
  const entries = await Promise.all(unique.map(async (code) => {
    const img = await rasterize(flagIconUrl(code), 96, 4 / 3);
    return [code, img];
  }));
  return new Map(entries.filter(([, img]) => img));
}

const isHex = value => typeof value === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value.trim());

// ── Logotipo de la web ───────────────────────────────────────────
// Reproduce LOGO_SVG de header.js: iconos Lucide de calendario y bicicleta
// (viewBox 24×24, trazo 2, extremos redondeados) seguidos del nombre.

function drawSiteLogoIcons(doc, x, y, size, color) {
  const p = v => v * size / 24;
  doc.setDrawColor(color);
  doc.setLineWidth(p(2));
  doc.setLineCap('round');
  doc.setLineJoin('round');

  // Calendario: rect x=3 y=4 18×18 rx=2 · líneas x=16 y x=8 (2→6) · y=10
  doc.roundedRect(x + p(3), y + p(4), p(18), p(18), p(2), p(2), 'S');
  doc.line(x + p(16), y + p(2), x + p(16), y + p(6));
  doc.line(x + p(8), y + p(2), x + p(8), y + p(6));
  doc.line(x + p(3), y + p(10), x + p(21), y + p(10));

  // Bicicleta (desplazada un icono + margen de 0.25em, como en la web)
  const bx = x + size * 1.25;
  doc.circle(bx + p(18.5), y + p(17.5), p(3.5), 'S');
  doc.circle(bx + p(5.5), y + p(17.5), p(3.5), 'S');
  doc.circle(bx + p(15), y + p(5), p(1), 'S');
  // M12 17.5V14l-3-3 4-3 2 3h2
  doc.lines([[0, p(-3.5)], [p(-3), p(-3)], [p(4), p(-3)], [p(2), p(3)], [p(2), 0]],
    bx + p(12), y + p(17.5), [1, 1], 'S', false);

  doc.setLineCap('butt');
  doc.setLineJoin('miter');
  return size * 2.25 + size * 0.35; // ancho de ambos iconos + margen final
}

// Strip diacritics and replace non-ASCII with closest equivalent.
// Used as fallback when Google Sans fails to load and helvetica is used.
function asciify(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip combining diacritical marks
    .replace(/đ/g, 'd')          // đ → d
    .replace(/Đ/g, 'D')          // Đ → D
    .replace(/ł/g, 'l')          // ł → l
    .replace(/Ł/g, 'L')          // Ł → L
    .replace(/ø/g, 'o')          // ø → o
    .replace(/Ø/g, 'O')          // Ø → O
    .replace(/æ/g, 'ae')         // æ → ae
    .replace(/Æ/g, 'AE')         // Æ → AE
    .replace(/ß/g, 'ss')         // ß → ss
    .replace(/[^\x00-\x7F]/g, '');    // drop remaining non-ASCII
}

/**
 * Genera y descarga el PDF de inscritos. Con `deliver({ blob, fileName })`
 * entrega el documento en lugar de descargarlo (página de las apps); con
 * `pageUrl` fija el enlace del pie.
 */
export async function generateStartlistPDF(opts) {
  const {
    race, teams, ridersByTeam, heroLabel, heroSubline, totalTeams, totalRiders,
    teamColors = {}, riderOutMap = null, deliver = null,
  } = opts;
  const identity = resolveIdentity(opts.identity);

  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  // Carga en paralelo: fuentes, logotipo de la carrera y banderas.
  const allRiders = teams.flatMap(team => ridersByTeam[team.id] || []);
  const [font, raceLogoImg, siteLogoImg, flags] = await Promise.all([
    registerFonts(doc, identity),
    rasterize(race.logoUrl, 480),
    rasterize(identity.logoUrl, 600),
    loadFlags([race.countryCode, ...allRiders.map(r => r.countryCode)]),
  ]);
  const fontFamily = font.family;
  const hasUnicodeFont = fontFamily !== 'helvetica';
  const enc = hasUnicodeFont ? (s) => s : asciify;
  const ellipsis = hasUnicodeFont ? '…' : '...';
  const isEn = getLang() === 'en';

  // ── Medidas (A4 vertical, mm) ──
  const pageW = 210;
  const pageH = 297;
  const margin = 10;
  const usableW = pageW - margin * 2;
  const contentBottom = pageH - 13;

  // ── Tokens del tema claro de la web (css/app.css, o los de la identidad) ──
  const { text, textMuted, textDim, accent, border, headerNeutral, dorsalBg } = identity.colors;
  const riderText = identity.colors.riderText || text;

  // ── Texto ──
  const raceName = (isEn && race.nameEn) ? race.nameEn : (race.name || i18nT('race.unknown'));
  const label = heroLabel || (isEn ? 'Startlist' : 'Dorsales');
  const detail = (heroSubline || '').replace(/<[^>]+>/g, '')
    .replace(/^(Dorsales|Lista provisional|Startlist|Provisional Startlist)\s*·\s*/, '');
  const teamsWord = isEn ? 'teams' : 'equipos';
  const ridersWord = isEn ? 'riders' : (race.gender === 'female' ? 'corredoras' : 'corredores');
  // Sin equipos reales no se imprime "0 equipos", como en la web.
  const statsText = totalTeams > 0
    ? `${totalTeams} ${teamsWord} · ${totalRiders} ${ridersWord}`
    : `${totalRiders} ${ridersWord}`;
  const siteName = identity.siteName || '';
  const host = identity.host || window.location.hostname;
  const pageUrl = opts.pageUrl || (window.location.origin + window.location.pathname);
  const generatedText = (isEn ? 'Generated on ' : 'Generado el ')
    + new Date().toLocaleDateString(isEn ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

  doc.setProperties({
    title: `${raceName} · ${label}`,
    subject: statsText,
    creator: siteName,
  });

  // Recorta `str` con puntos suspensivos hasta `maxW` con la fuente activa.
  const fit = (str, maxW) => {
    if (doc.getTextWidth(str) <= maxW) return str;
    let out = str;
    while (out.length > 1 && doc.getTextWidth(out + ellipsis) > maxW) out = out.slice(0, -1);
    return out.trimEnd() + ellipsis;
  };

  const drawFlag = (code, x, y, w) => {
    const key = code && String(code).toLowerCase();
    const img = key && flags.get(key);
    if (!img) return false;
    // El alias reutiliza el mismo objeto de imagen en todo el documento.
    doc.addImage(img.dataUrl, 'PNG', x, y, w, w * 0.75, `flag-${key}`);
    return true;
  };

  // ── Cabecera de la web (todas las páginas) ──
  // Logotipo a la izquierda; a la derecha, `rightText`. Filete inferior.
  const siteHeaderH = 9;
  const drawSiteHeader = (rightText, rightStyle) => {
    const iconSize = 4.4;
    let iconsW;
    if (siteLogoImg) {
      // Logotipo de la identidad, centrado en la línea de los iconos.
      const lh = identity.logoHeight;
      const lw = siteLogoImg.width * lh / siteLogoImg.height;
      doc.addImage(siteLogoImg.dataUrl, 'PNG', margin, margin + iconSize / 2 - lh / 2, lw, lh, 'site-logo');
      iconsW = lw + (siteName ? 2.2 : 0);
    } else {
      iconsW = drawSiteLogoIcons(doc, margin, margin, iconSize, accent);
    }
    if (font.nameFamily) doc.setFont(font.nameFamily, 'normal');
    else doc.setFont(fontFamily, font.medium);
    doc.setFontSize(12);
    doc.setTextColor(text);
    if (siteName) doc.text(enc(siteName), margin + iconsW, margin + iconSize * 0.84);
    const nameEnd = margin + iconsW + (siteName ? doc.getTextWidth(enc(siteName)) : 0);

    doc.setFont(fontFamily, rightStyle);
    doc.setFontSize(7.5);
    doc.setTextColor(textMuted);
    doc.text(fit(enc(rightText), pageW - margin - nameEnd - 8), pageW - margin, margin + iconSize * 0.84, { align: 'right' });

    doc.setDrawColor(border);
    doc.setLineWidth(0.25);
    doc.line(margin, margin + siteHeaderH - 1, pageW - margin, margin + siteHeaderH - 1);
  };

  // ── Página 1: cabecera de la web + cabecera de la carrera ──
  drawSiteHeader(identity.headerText ?? (identity.generatedDate ? generatedText : ''), 'normal');
  let y = margin + siteHeaderH + 5;
  if (!identity.raceHeader) y = margin + siteHeaderH + 4;
  else {

    // Columna izquierda: logotipo de la carrera y bandera debajo (como la web).
    const logoMaxH = 14;
    const logoMaxW = 18;
    let leftW = 0;
    let leftH = 0;
    if (raceLogoImg) {
      const ratio = Math.min(logoMaxW / raceLogoImg.width, logoMaxH / raceLogoImg.height);
      const lw = raceLogoImg.width * ratio;
      const lh = raceLogoImg.height * ratio;
      leftW = Math.max(lw, 6);
      doc.addImage(raceLogoImg.dataUrl, 'PNG', margin + (leftW - lw) / 2, y, lw, lh, 'race-logo');
      leftH = lh;
    }
    const flagW = raceLogoImg ? 5.6 : 8;
    if (race.countryCode && flags.has(String(race.countryCode).toLowerCase())) {
      const colW = Math.max(leftW, flagW);
      const flagY = leftH ? y + leftH + 1.4 : y + 1;
      drawFlag(race.countryCode, margin + (colW - flagW) / 2, flagY, flagW);
      leftW = colW;
      leftH = flagY - y + flagW * 0.75;
    }
    const textX = leftW ? margin + leftW + 4.5 : margin;
    const textMaxW = pageW - margin - textX;

    // Nombre de la carrera: reduce el cuerpo hasta que quepa (mínimo 14 pt).
    doc.setFont(fontFamily, 'bold');
    let nameSize = 22;
    const nameText = enc(raceName);
    doc.setFontSize(nameSize);
    while (nameSize > 14 && doc.getTextWidth(nameText) > textMaxW) {
      nameSize -= 0.5;
      doc.setFontSize(nameSize);
    }
    doc.setTextColor(text);
    doc.text(fit(nameText, textMaxW), textX, y + nameSize * 0.3);

    // Subtítulo: etiqueta en color de texto + detalle atenuado.
    let lineY = y + nameSize * 0.3 + 6;
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(text);
    const labelText = enc(label);
    doc.text(labelText, textX, lineY);
    if (detail) {
      const labelW = doc.getTextWidth(labelText);
      doc.setTextColor(textMuted);
      doc.text(fit(enc(` · ${detail}`), textMaxW - labelW), textX + labelW, lineY);
    }

    lineY += 4.6;
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(textDim);
    doc.text(enc(statsText), textX, lineY);

    y = Math.max(y + leftH, lineY + 1.5) + 4;
  }

  if (race.startlistProvisional) {
    const noteLead = isEn ? 'Provisional Startlist' : 'Lista provisional';
    const noteRest = isEn
      ? '; not considered final until the team managers meeting.'
      : '; no se considera definitiva hasta la reunión de directores.';
    doc.setFontSize(7.5);
    doc.setFont(fontFamily, 'bold');
    doc.setTextColor(text);
    doc.text(enc(noteLead), margin, y + 2.5);
    const leadW = doc.getTextWidth(enc(noteLead));
    doc.setFont(fontFamily, 'normal');
    doc.setTextColor(textMuted);
    doc.text(enc(noteRest), margin + leadW, y + 2.5);
    y += 6;
  }

  const firstGridTop = y;
  const contGridTop = margin + siteHeaderH + 4;

  // ── Rejilla de equipos ──
  const cols = 4;
  const gapX = 3;
  const gapY = 3;
  const colW = (usableW - gapX * (cols - 1)) / cols;
  const dorsalW = 5.4;
  const flagWRider = 3.1;

  // Medidas verticales a escala `k` y bloques resultantes: un equipo puede
  // ocupar varias celdas si no cabe en una página.
  let teamHeaderH, lineH, padY, riderFont, dorsalH, blocks;
  const blockHeight = (b) => {
    const headerH = isNoTeamPlaceholderTeam(b.team) ? 0 : teamHeaderH;
    return headerH + padY * 2 + Math.max(1, b.riders.length) * lineH;
  };
  const planGrid = (k) => {
    teamHeaderH = 5.6 * k;
    lineH = 3.35 * k;
    padY = 0.9 * k;
    riderFont = 6.8 * k;
    dorsalH = 2.6 * k;
    const maxLines = Math.floor((contentBottom - firstGridTop - teamHeaderH - padY * 2) / lineH);
    blocks = [];
    teams.forEach(team => {
      const riders = ridersByTeam[team.id] || [];
      if (!riders.length) { blocks.push({ team, riders, startIndex: 0 }); return; }
      for (let i = 0; i < riders.length; i += maxLines) {
        blocks.push({ team, riders: riders.slice(i, i + maxLines), startIndex: i });
      }
    });
    // Páginas que ocupa la rejilla con el mismo salto de fila que el dibujo.
    let pages = 1;
    let rowY = firstGridTop;
    for (let i = 0; i < blocks.length; i += cols) {
      const rowH = Math.max(...blocks.slice(i, i + cols).map(blockHeight));
      if (rowY + rowH > contentBottom) { pages++; rowY = contGridTop; }
      rowY += rowH + gapY;
    }
    return pages;
  };
  // Si comprimir la rejilla hasta un 12 % ahorra una página (p. ej., la
  // última fila sola en una hoja nueva), se usa la mayor escala que lo logra.
  const basePages = planGrid(1);
  const scale = [0.97, 0.94, 0.91, 0.88].find(k => planGrid(k) < basePages) ?? 1;
  planGrid(scale);

  const drawTeamHeader = (team, x, cellY, continued) => {
    const colors = teamColors[team.id];
    const enriched = colors && isHex(colors.background) && isHex(colors.text);
    doc.setFillColor(enriched ? colors.background : headerNeutral);
    doc.rect(x, cellY, colW, teamHeaderH, 'F');
    // Lista provisional: marca de confirmación a la derecha, como en la web
    // (cuadrado de 18 px, radio 4, ✓ azul confirmado / ✕ gris pendiente).
    const badgeW = race.startlistProvisional ? drawConfirmBadge(team.isConfirmed, x + colW - 1.4, cellY) + 1.2 : 0;
    doc.setFont(fontFamily, 'bold');
    doc.setFontSize(7.4);
    doc.setTextColor(enriched ? colors.text : text);
    const suffix = continued ? ' (cont.)' : '';
    const name = enc(team.displayName || team.teamName || '');
    const suffixW = suffix ? doc.getTextWidth(suffix) : 0;
    doc.text(fit(name, colW - 4 - suffixW - badgeW) + suffix, x + 2, cellY + teamHeaderH / 2 + 1.2);
    return enriched && /^#?(fff|ffffff)$/i.test(colors.background.trim());
  };

  // Dibuja la marca con su borde derecho en `right`; devuelve su ancho.
  const drawConfirmBadge = (confirmed, right, cellY) => {
    const size = 3.4;
    const u = size / 18;                       // unidades del SVG de la web
    const bx = right - size;
    const by = cellY + (teamHeaderH - size) / 2;
    doc.setFillColor(confirmed ? accent : '#6b7280');
    doc.roundedRect(bx, by, size, size, 4 * u, 4 * u, 'F');
    doc.setDrawColor('#ffffff');
    doc.setLineWidth(1.8 * u);
    doc.setLineCap('round');
    doc.setLineJoin('round');
    if (confirmed) {
      doc.lines([[2.5 * u, 2.5 * u], [5.5 * u, -5.5 * u]], bx + 5 * u, by + 9.5 * u, [1, 1], 'S', false);
    } else {
      doc.line(bx + 6 * u, by + 6 * u, bx + 12 * u, by + 12 * u);
      doc.line(bx + 12 * u, by + 6 * u, bx + 6 * u, by + 12 * u);
    }
    doc.setLineCap('butt');
    doc.setLineJoin('miter');
    return size;
  };

  const drawRiderName = (r, x, baseY, maxW, out) => {
    const first = enc((r.firstName || '').trim());
    const last = enc((r.lastName || '').trim());
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(riderFont);
    doc.setTextColor(riderText);
    let full = [first, last].filter(Boolean).join(' ');
    // Si no cabe, el nombre de pila pasa a inicial antes de recortar.
    if (first && doc.getTextWidth(full) > maxW) full = `${first[0]}. ${last}`;
    const shown = fit(full, maxW);
    doc.text(shown, x, baseY);
    if (out) {
      doc.setDrawColor(riderText);
      doc.setLineWidth(0.15);
      doc.line(x, baseY - 0.8, x + doc.getTextWidth(shown), baseY - 0.8);
    }
  };

  const drawBlock = (b, x, cellY, rowH) => {
    const hideHeader = isNoTeamPlaceholderTeam(b.team);
    const headerH = hideHeader ? 0 : teamHeaderH;
    const whiteHeader = !hideHeader && drawTeamHeader(b.team, x, cellY, b.startIndex > 0);

    const teamHasFlags = b.riders.some(r => r.countryCode && flags.has(String(r.countryCode).toLowerCase()));
    const flagX = x + 1 + dorsalW + 1.6;
    const nameX = teamHasFlags ? flagX + flagWRider + 1.6 : flagX;
    const nameMaxW = x + colW - 1 - nameX;

    let rowY = cellY + headerH + padY;
    b.riders.forEach(r => {
      const midY = rowY + lineH / 2;
      const baseY = midY + 0.95;
      const out = !!(riderOutMap && r.globalRiderId && riderOutMap.get(r.globalRiderId));

      doc.setFillColor(dorsalBg);
      doc.roundedRect(x + 1, midY - dorsalH / 2, dorsalW, dorsalH, 0.4, 0.4, 'F');
      if (r.dorsal) {
        doc.setFont(fontFamily, 'bold');
        doc.setFontSize(riderFont - 0.6);
        doc.setTextColor(out ? '#9aa0a6' : textMuted);
        doc.text(String(r.dorsal), x + 1 + dorsalW / 2, baseY - 0.05, { align: 'center' });
      }
      if (teamHasFlags) drawFlag(r.countryCode, flagX, midY - flagWRider * 0.375, flagWRider);
      drawRiderName(r, nameX, baseY, nameMaxW, out);
      rowY += lineH;
    });

    doc.setDrawColor(border);
    doc.setLineWidth(0.25);
    if (whiteHeader) doc.rect(x, cellY, colW, rowH, 'S');
    else doc.line(x, cellY + rowH, x + colW, cellY + rowH);
  };

  y = firstGridTop;
  for (let i = 0; i < blocks.length; i += cols) {
    const row = blocks.slice(i, i + cols);
    const rowH = Math.max(...row.map(blockHeight));
    if (y + rowH > contentBottom) {
      doc.addPage();
      drawSiteHeader(identity.headerText ?? raceName, font.medium);
      y = contGridTop;
    }
    row.forEach((b, col) => drawBlock(b, margin + col * (colW + gapX), y, rowH));
    y += rowH + gapY;
  }

  // ── Pie en todas las páginas: dominio + paginación ──
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    const footerY = pageH - 7;
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(textDim);
    doc.textWithLink(host, margin, footerY, { url: pageUrl });
    if (identity.pageNumbers) {
      const pageText = isEn ? `Page ${p} of ${totalPages}` : `Página ${p} de ${totalPages}`;
      doc.text(pageText, pageW - margin, footerY, { align: 'right' });
    }
  }

  const safeName = (race.slug || race.name || 'inscritos').replace(/[^a-z0-9-]/gi, '-');
  const fileName = `inscritos-${safeName}.pdf`;
  const blob = doc.output('blob');

  // Página de las apps: entrega el PDF al puente nativo en lugar de descargarlo.
  if (deliver) {
    await deliver({ blob, fileName });
    return;
  }

  // ── Download via Blob + <a> click (avoids Chrome popup-blocker) ──
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
