// ─────────────────────────────────────────────────────────────────
//  PANEL DE ADMINISTRACIÓN — Editor de jornada: Markdown/WYSIWYG, waypoints y emisiones
// ─────────────────────────────────────────────────────────────────

import { formatTimeHHMM } from './helpers.js';

// ── Markdown → HTML (para cargar contenido inicial en el WYSIWYG) ──
function markdownToHtml(md) {
  if (!md) return '';
  const escHtml = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline  = s => s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g,         '<u>$1</u>')
    .replace(/\*(.+?)\*/g,       '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  const lines = md.split('\n');
  const out   = [];
  let inUl = false, inBq = false;
  const closeUl = () => { if (inUl) { out.push('</ul>'); inUl = false; } };
  const closeBq = () => { if (inBq) { out.push('</blockquote>'); inBq = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^---+$/.test(line))       { closeUl(); closeBq(); out.push('<hr>'); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { closeUl(); closeBq(); out.push(`<h2>${inline(escHtml(h2[1]))}</h2>`); continue; }
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { closeUl(); closeBq(); out.push(`<h3>${inline(escHtml(h3[1]))}</h3>`); continue; }
    const bq = line.match(/^>\s?(.*)/);
    if (bq) { closeUl(); if (!inBq) { out.push('<blockquote>'); inBq = true; } out.push(`<p>${inline(escHtml(bq[1]))}</p>`); continue; }
    closeBq();
    const li = line.match(/^-\s+(.*)/);
    if (li) { if (!inUl) { out.push('<ul>'); inUl = true; } out.push(`<li>${inline(escHtml(li[1]))}</li>`); continue; }
    closeUl();
    // En Markdown una línea vacía separa párrafos; no es un párrafo editable
    // adicional. Los <p> reales se volverán a serializar con \n\n al guardar.
    if (line.trim() === '') continue;
    out.push(`<p>${inline(escHtml(line))}</p>`);
  }
  closeUl(); closeBq();
  return out.join('');
}

// ── HTML → Markdown (serializa el contenido del WYSIWYG al guardar) ─
function htmlToMarkdown(html) {
  const div = document.createElement('div');
  div.innerHTML = html;

  function markdownWrap(marker, value) { const a=value.match(/^[\s\u00A0]+/)?.[0]||'', z=value.match(/[\s\u00A0]+$/)?.[0]||'', c=value.slice(a.length,value.length-z.length); return c ? `${a}${marker}${c}${marker}${z}` : value; }

  function walk(nodes) {
    let out = '';
    for (const n of nodes) {
      if (n.nodeType === 3) { out += n.textContent; continue; }
      if (n.nodeType !== 1) continue;
      const tag   = n.tagName.toLowerCase();
      const inner = walk(n.childNodes);
      switch (tag) {
        case 'strong': case 'b': out += markdownWrap('**', inner); break;
        case 'em':     case 'i': out += markdownWrap('*', inner);   break;
        case 'u':                  out += markdownWrap('__', inner); break;
        case 'a':      out += `[${inner}](${n.getAttribute('href') || ''})`; break;
        case 'h2':     out += `\n## ${inner}\n`; break;
        case 'h3':     out += `\n### ${inner}\n`; break;
        case 'p':      out += inner.replace(/[\u00A0\s]/g, '') === '' ? '\n\n' : `${inner}\n\n`; break;
        case 'br':     out += '\n'; break;
        case 'hr':     out += '\n---\n'; break;
        case 'ul': case 'ol': out += walk(n.childNodes); break;
        case 'li':     out += `- ${inner}\n`; break;
        case 'blockquote': {
          const bqLines = inner.trim().split('\n').map(l => `> ${l}`);
          out += bqLines.join('\n') + '\n';
          break;
        }
        // Aunque pedimos <p> como separador por defecto, Safari y Chrome pueden
        // crear un <div> al pulsar Enter en un contenteditable nuevo. Es también
        // un bloque: serializarlo como párrafo evita que el salto se convierta
        // en una única nueva línea, que el renderizador público colapsa.
        case 'div':    out += inner ? `\n\n${inner}\n\n` : '\n\n'; break;
        default:       out += inner;
      }
    }
    return out;
  }

  return walk(div.childNodes).replace(/\n{3,}/g, '\n\n').trim();
}

// La fuente de verdad durante la edición es el contenteditable. Algunos
// navegadores no emiten `input` para todos los Enter, así que antes de guardar
// se serializa siempre desde él en vez de confiar solo en el textarea oculto.
export function markdownFromEditor(wysiwygId, textareaId) {
  const wysiwyg = document.getElementById(wysiwygId);
  const textarea = document.getElementById(textareaId);
  if (!textarea) return '';
  if (wysiwyg) textarea.value = htmlToMarkdown(wysiwyg.innerHTML);
  return textarea.value;
}

// Markup de la barra de herramientas markdown. Idéntica para ES y EN salvo
// el id y los `title` localizados → un solo sitio para los SVG (antes
// duplicados literalmente). `initMdToolbar` (abajo) cablea los data-action.
export function mdToolbarHtml(toolbarId, t = {}) {
  const SVG = {
    bold: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>',
    italic: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
    ul: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    blockquote: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/></svg>',
  };
  return `<div class="md-toolbar" id="${toolbarId}">
    <button type="button" class="md-toolbar__btn" data-action="bold" title="${t.bold || 'Negrita (Cmd+B)'}">${SVG.bold}</button>
    <button type="button" class="md-toolbar__btn" data-action="italic" title="${t.italic || 'Cursiva (Cmd+I)'}">${SVG.italic}</button>
    <div class="md-toolbar__sep"></div>
    <button type="button" class="md-toolbar__btn" data-action="h2" title="${t.h2 || 'Encabezado H2'}">H2</button>
    <button type="button" class="md-toolbar__btn" data-action="h3" title="${t.h3 || 'Encabezado H3'}">H3</button>
    <div class="md-toolbar__sep"></div>
    <button type="button" class="md-toolbar__btn" data-action="ul" title="${t.ul || 'Lista'}">${SVG.ul}</button>
    <button type="button" class="md-toolbar__btn" data-action="blockquote" title="${t.blockquote || 'Cita'}">${SVG.blockquote}</button>
    <div class="md-toolbar__sep"></div>
    <button type="button" class="md-toolbar__btn" data-action="hr" title="${t.hr || 'Separador horizontal'}">—</button>
  </div>`;
}

// ── Editor WYSIWYG ────────────────────────────────────────────────
export function initMdToolbar(toolbarId, textareaId, wysiwygId) {
  const toolbar  = document.getElementById(toolbarId);
  const hidden   = document.getElementById(textareaId);          // textarea oculto (fuente markdown)
  const wysiwyg  = document.getElementById(wysiwygId || 'ed-description-wysiwyg');
  if (!toolbar || !hidden || !wysiwyg) return;

  // Cargar contenido inicial convertido a HTML
  wysiwyg.innerHTML = markdownToHtml(hidden.value);

  // Sincronizar WYSIWYG → markdown oculto en cada cambio
  wysiwyg.addEventListener('input', syncMarkdown);

  // Fallback: sincronizar al perder el foco (cubre casos donde input no dispara,
  // e.g. corrección ortográfica del SO, drag-and-drop, o IME composition)
  wysiwyg.addEventListener('blur', syncMarkdown);

  function syncMarkdown() { markdownFromEditor(wysiwyg.id, hidden.id); }
  function applyInlineFormat(tag) { const sel=window.getSelection(), r=sel?.rangeCount?sel.getRangeAt(0):null; if(!r||r.collapsed||!wysiwyg.contains(r.commonAncestorContainer)) return false; const w=document.createElement(tag); try { r.surroundContents(w); } catch (_) { const c=r.extractContents(); w.append(c); r.insertNode(w); } sel.removeAllRanges(); const n=document.createRange(); n.selectNodeContents(w); sel.addRange(n); return true; }
  function applyFormat(action) { wysiwyg.focus(); const tags={bold:'strong',italic:'em',underline:'u'}; if(tags[action]) { if(applyInlineFormat(tags[action])) syncMarkdown(); return; } switch(action) { case 'h2': document.execCommand('formatBlock',false,'h2'); break; case 'h3': document.execCommand('formatBlock',false,'h3'); break; case 'ul': document.execCommand('insertUnorderedList'); break; case 'blockquote': document.execCommand('formatBlock',false,'blockquote'); break; case 'hr': document.execCommand('insertHTML',false,'<hr>'); break; } syncMarkdown(); }

  // Listeners de la toolbar
  toolbar.querySelectorAll('.md-toolbar__btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); // evita que el WYSIWYG pierda el foco/selección
      applyFormat(btn.dataset.action);
    });
  });

  // Párrafo por defecto: <p> en lugar de <div> o <br>.
  document.execCommand('defaultParagraphSeparator', false, 'p');

  // Atajos de teclado. El Enter queda en manos del navegador: así conserva
  // correctamente la selección y el historial de deshacer; el serializador
  // admite tanto <p> como el <div> que algunos navegadores puedan crear.
  wysiwyg.addEventListener('keydown', e => {
    const mod = navigator.platform.toUpperCase().includes('MAC') ? e.metaKey : e.ctrlKey;

    if (!mod) return;
    const map = { b: 'bold', i: 'italic', u: 'underline' };
    const action = map[e.key];
    if (!action) return;
    e.preventDefault();
    applyFormat(action);
  });
}

export function summitRowHTML(s = {}) {
  const esc = v => String(v ?? '').replace(/"/g, '&quot;');
  // 'M' = puerto sin categorización oficial (se renderiza con icono de
  // montaña en el SVG, sin número).
  const catOpts = ['HC','1','2','3','4','M'].map(c =>
    `<option value="${c}"${(s.category ?? 'HC') === c ? ' selected' : ''}>${c}</option>`
  ).join('');
  return `<div class="ann-row">
    <input type="number" class="ann-km"  placeholder="km"  min="0" step="0.1" value="${esc(s.km  ?? '')}">
    <input type="number" class="ann-alt" placeholder="alt" min="0" step="1"   value="${esc(s.altitude ?? '')}">
    <input type="text"   class="ann-name ann-name--wide" placeholder="Nombre del puerto" value="${esc(s.name ?? '')}">
    <select class="ann-cat">${catOpts}</select>
    <select class="ann-side">
      <option value="left" ${(!s.side || s.side === 'left')  ? 'selected' : ''}>Izda</option>
      <option value="right"${s.side === 'right'              ? ' selected' : ''}>Dcha</option>
    </select>
    <input type="number" class="ann-start" placeholder="auto" min="0" step="0.1" value="${esc(s.startKm ?? '')}"
           title="km de inicio del puerto (vacío = sin pintar tramo)">
    <input type="time" class="ann-foot-time" value="${esc(s.footTimeUtc ? formatTimeHHMM(s.footTimeUtc) : '')}"
           title="Hora de paso por el PIE del puerto (rutómetro). Vacío = se estima.">
    <input type="time" class="ann-time" value="${esc(s.timeUtc ? formatTimeHHMM(s.timeUtc) : '')}"
           title="Hora de paso por la CIMA (rutómetro). Vacío = se estima.">
    <button type="button" class="btn btn--ghost ann-detect-btn"
            title="Detectar inicio del puerto a partir del km de la cima">⌖</button>
    <span class="ann-stats"></span>
    <button type="button" class="btn btn--danger ann-del-btn">✕</button>
  </div>`;
}

export function waypointRowHTML(w = {}) {
  const esc = v => String(v ?? '').replace(/"/g, '&quot;');
  const typeOpts = [
    ['town',                'Localidad'],
    ['intermediate_sprint', 'Sprint Intermedio'],
    ['bonus_sprint',        'Sprint Bonificación'],
    ['intermediate_split',  'Punto intermedio'],
    ['cobblestone',         'Pavé / Adoquín'],
    ['sterrato',            'Sterrato'],
  ].map(([v, l]) => `<option value="${v}"${(w.type ?? 'town') === v ? ' selected' : ''}>${l}</option>`).join('');
  const isCobSter = w.type === 'cobblestone' || w.type === 'sterrato';
  return `<div class="ann-row">
    <input type="number" class="ann-km"  placeholder="km" min="0" step="0.1" value="${esc(w.km ?? '')}">
    <input type="number" class="ann-len" placeholder="long.km" min="0.1" step="0.1"
           ${isCobSter ? '' : 'style="display:none"'} value="${esc(w.lengthKm ?? '')}">
    <input type="text"   class="ann-name ann-name--wide" placeholder="Nombre" value="${esc(w.name ?? '')}">
    <select class="ann-type u-shrink-0">${typeOpts}</select>
    <input type="time" class="ann-time" value="${esc(w.timeUtc ? formatTimeHHMM(w.timeUtc) : '')}"
           title="Hora de paso (rutómetro). Vacío = se estima.">
    <button type="button" class="btn btn--danger ann-del-btn">✕</button>
  </div>`;
}

export function broadcastHTML(b, i) {
  return `<div class="tv-entry-panel" data-bid="${b.id || ''}">
    <div class="tv-entry-panel__header">
      <span class="tv-entry-panel__label">Emisión ${i + 1}</span>
      <div class="tv-entry-panel__actions">
        <button class="btn btn--ghost move-broadcast-up-btn btn--icon-xs" title="Subir">↑</button>
        <button class="btn btn--ghost move-broadcast-down-btn btn--icon-xs" title="Bajar">↓</button>
        <button class="btn btn--danger remove-broadcast-btn btn--mini">✕ Eliminar</button>
      </div>
    </div>
    <div class="field">
      <label>Canal</label>
      <input type="text" class="bc-channel" value="${b.channel || b.platform || ''}" placeholder="Movistar LaLiga, DAZN 1…">
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Hora (opcional)</label>
        <input type="time" class="bc-time" value="${b.startTimeUtc ? formatTimeHHMM(b.startTimeUtc) : ''}">
      </div>
      <div class="field">
        <label>URL (opcional)</label>
        <input type="url" class="bc-url" value="${b.url || ''}" placeholder="https://…">
        ${b.embeddable === false ? `<div class="field-hint u-c-caution u-fs-075 u-mt-025">⚠ Embed deshabilitado en YouTube — se abrirá en una pestaña nueva.</div>` : ''}
      </div>
    </div>
    <div class="field-row field-row--2">
      <div class="field">
        <label>Nota (opcional)</label>
        <input type="text" class="bc-note" value="${b.note || ''}" placeholder="—">
      </div>
      <div class="field">
        <label>Grupo de país</label>
        <select class="bc-country">
          <option value="">— Sin asignar</option>
          <option value="ALL"${b.country === 'ALL' ? ' selected' : ''}>ALL — Mundial (YouTube oficial)</option>
          <optgroup label="Europa">
            <option value="EUROPA"${b.country === 'EUROPA' ? ' selected' : ''}>EUROPA — Pan-europeo (Eurosport / HBO Max)</option>
            <option value="ES"${b.country === 'ES' ? ' selected' : ''}>ES — España</option>
            <option value="PT"${b.country === 'PT' ? ' selected' : ''}>PT — Portugal</option>
            <option value="FR"${b.country === 'FR' ? ' selected' : ''}>FR — Francia</option>
            <option value="BE"${b.country === 'BE' ? ' selected' : ''}>BE — Bélgica</option>
            <option value="NL"${b.country === 'NL' ? ' selected' : ''}>NL — Países Bajos</option>
            <option value="IT"${b.country === 'IT' ? ' selected' : ''}>IT — Italia</option>
            <option value="DE_AT_CH"${b.country === 'DE_AT_CH' ? ' selected' : ''}>DE_AT_CH — Alemania / Austria / Suiza</option>
            <option value="UK_IE"${b.country === 'UK_IE' ? ' selected' : ''}>GB / IRL — Reino Unido / Irlanda</option>
            <option value="SCANDI"${b.country === 'SCANDI' ? ' selected' : ''}>ESCANDI — Nórdicos</option>
            <option value="EE"${b.country === 'EE' ? ' selected' : ''}>EE — Europa del Este</option>
          </optgroup>
          <optgroup label="Resto del mundo">
            <option value="LATAM"${b.country === 'LATAM' ? ' selected' : ''}>LATAM — América Latina</option>
            <option value="NORTEAM"${b.country === 'NORTEAM' ? ' selected' : ''}>NORTEAM — EE.UU. / Canadá</option>
            <option value="ASIAPAC"${b.country === 'ASIAPAC' ? ' selected' : ''}>ASIAPAC — Asia / Pacífico</option>
            <option value="AFRICA"${b.country === 'AFRICA' ? ' selected' : ''}>AFRICA — África subsahariana</option>
            <option value="MENA"${b.country === 'MENA' ? ' selected' : ''}>MENA — Oriente Medio / Norte de África</option>
          </optgroup>
        </select>
      </div>
    </div>
    <div class="field tv-entry-panel__toggles">
      <span class="u-row">
        <input type="checkbox" class="bc-show-in-revive" id="bc-revive-${b.id || i}"${b.showInRevive ? ' checked' : ''}>
        <label for="bc-revive-${b.id || i}">Mostrar en "Revive"</label>
      </span>
      <span class="u-row">
        <input type="checkbox" class="bc-automation-locked" id="bc-automation-locked-${b.id || i}"${b.automationLocked ? ' checked' : ''}>
        <label for="bc-automation-locked-${b.id || i}" title="Impide que el sincronizador del VPS modifique esta emisión">Bloquear automatización</label>
      </span>
    </div>
  </div>`;
}

export function addBroadcastRow() {
  const list = document.getElementById('broadcastsList');
  const count = list.querySelectorAll('.tv-entry-panel').length;
  const tmp = document.createElement('div');
  tmp.innerHTML = broadcastHTML({}, count);
  list.appendChild(tmp.firstElementChild);
}

export function moveBroadcastRow(el, direction) {
  const list = el.parentElement;
  if (direction === 'up' && el.previousElementSibling) {
    list.insertBefore(el, el.previousElementSibling);
  } else if (direction === 'down' && el.nextElementSibling) {
    list.insertBefore(el.nextElementSibling, el);
  }
  updateBroadcastLabels();
}

export function updateBroadcastLabels() {
  document.querySelectorAll('.tv-entry-panel').forEach((panel, i) => {
    const label = panel.querySelector('.tv-entry-panel__label');
    if (label) label.textContent = `Emisión ${i + 1}`;
  });
}
