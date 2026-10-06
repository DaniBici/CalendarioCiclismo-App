// ─────────────────────────────────────────────────────────────────
//  Tarjeta de carrera — Hoy, Competición y Ciclocross
// ─────────────────────────────────────────────────────────────────
// Una sola estructura: logo | .race-card__main (nombre, subtítulo, badges) |
// .race-card__meta, con el miniperfil en .race-card__profile como banda
// inferior. Cada página decide el contenido de cada zona; las piezas de
// jornada de carretera (cifras, horario, perfil, resultados, activación)
// están en stage-card.js.

function hexLuminance(hex) {
  if (!hex || !/^#[0-9a-fA-F]{3,6}$/.test(hex)) return null;
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  return { r, g, b, lum: 0.299 * r + 0.587 * g + 0.114 * b };
}

// Color visible como raya/borde en ambos temas: los muy claros se oscurecen.
function safeCardColor(hex) {
  const c = hexLuminance(hex);
  if (!c) return '#888';
  if (c.lum <= 210) return hex;
  const darken = v => Math.round(v * 0.6).toString(16).padStart(2, '0');
  return '#' + darken(c.r) + darken(c.g) + darken(c.b);
}

// Contenedor de la tarjeta con el color de la carrera y el borde mínimo de
// los colores claros o inválidos.
export function createRaceCard(colorHex, extraClass = '', tag = 'div') {
  const card = document.createElement(tag);
  const c = hexLuminance(colorHex);
  card.className = ['race-card', extraClass, !c || c.lum > 210 ? 'race-card--light-color' : ''].filter(Boolean).join(' ');
  card.style.setProperty('--card-color', safeCardColor(colorHex));
  return card;
}

export function cardLogoHtml(logoUrl, flag, hideFlag) {
  if (logoUrl) {
    return `<div class="race-card__logo">
         <img class="race-logo-img" src="${logoUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
         ${hideFlag ? '' : `<span>${flag}</span>`}
       </div>`;
  }
  return hideFlag ? '' : `<div class="race-card__flag">${flag}</div>`;
}

// Acceso a la competición o al torneo junto al nombre.
export function overviewButtonHtml(href, label) {
  return `<a class="race-card__overview-btn" href="${href}" aria-label="${label}" onclick="event.stopPropagation()"><span aria-hidden="true">☰</span></a>`;
}

// Zonas de la tarjeta. Todo es HTML: el llamador escapa lo que proceda.
// `meta` va en .race-card__meta-top; `metaBlock` sustituye la columna entera
// (categorías de ciclocross).
export function raceCardHtml({ logo = '', name, sub = '', badges = '', meta = '', metaBlock = null }) {
  return `${logo}<div class="race-card__main">`
    + `<div class="race-card__name">${name}</div>`
    + (sub ? `<div class="race-card__sub">${sub}</div>` : '')
    + `<div class="race-card__badges">${badges}</div>`
    + `</div>${metaBlock ?? `<div class="race-card__meta"><div class="race-card__meta-top">${meta}</div></div>`}`;
}

// Tarjeta sin página ni modal: tooltip al pasar el ratón y aviso al pulsar en
// móvil (initPhTooltip de shared.js).
export function setInfoTooltip(card, { message, name, flag, sub }) {
  card.style.cursor = 'default';
  card.dataset.phTooltip = message;
  card.dataset.phName = name;
  card.dataset.phFlag = flag;
  if (sub) card.dataset.phSub = sub;
}

