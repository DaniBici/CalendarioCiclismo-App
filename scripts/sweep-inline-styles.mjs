#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Barrido de estilos inline repetidos → clases utilitarias u-* del panel.
// ────────────────────────────────────────────────────────────────────
// Conservador y reversible: solo toca strings EXACTOS de `style="…"` que
// estén en el MAP de abajo. Por cada tag que contenga ese style:
//   - si ya tiene class="…", AÑADE las clases (merge, sin duplicar);
//   - si no, inserta class="…".
//   - elimina el atributo style.
// El regex de tag usa [^<>] → no cruza fronteras de tag; un tag con `>`
// dentro de un ${…} simplemente no casa y se deja intacto (seguro).
//
// NUNCA se incluye en el MAP nada con display:none / display:flex que el
// JS togglee por .style.display (rompería el toggle). Ver regla u-hidden.
//
// Uso: node scripts/sweep-inline-styles.mjs <archivo> [--dry]
// ════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';

// style exacto (sin el `style="`/`"`) → clases a aplicar. Se componen
// utilidades atómicas (font-size + color + …) en vez de crear una clase
// bespoke por combinación, para no cambiar una forma de basura por otra.
const MAP = {
  // — flex / layout puro —
  'flex:1': 'u-grow',
  'flex-shrink:0': 'u-shrink-0',
  'flex:1;min-width:0': 'u-grow u-min0',
  'display:flex;align-items:center;gap:0.5rem': 'u-row',
  'display:flex;gap:0.5rem;align-items:center': 'u-row',
  'display:flex;flex-direction:column;gap:0.25rem': 'u-stack u-stack--xs',
  // — texto (compuesto: tamaño + color EXACTO). OJO: --text-dim ≠
  //   --text-muted (colores distintos) → clases separadas u-c-dim/u-c-muted. —
  'text-transform:uppercase': 'u-upper',
  'opacity:0.6': 'u-o60',
  'font-size:0.8rem;color:var(--text-dim)': 'u-fs-md u-c-dim',
  'font-size:0.72rem;color:var(--text-dim)': 'u-fs-xs u-c-dim',
  'font-size:0.75rem;color:var(--text-dim)': 'u-fs-sm u-c-dim',
  'font-size:0.8rem;color:var(--text-muted)': 'u-fs-md u-c-muted',
  'color:var(--text-dim);font-size:0.85rem': 'u-fs-085 u-c-dim',
  'color:var(--text-dim);padding:1rem;text-align:center': 'u-empty-note',
  // — lote 2 —
  'font-weight:400;opacity:0.55;font-size:0.78rem': 'u-field-hint',     // 6× hint "— explicación"
  'flex:1;font-family:monospace;text-transform:uppercase': 'u-grow u-mono u-upper', // 6× input hex
  'color:var(--text-dim);font-size:0.72rem;padding:0.3rem': 'u-c-dim u-fs-xs u-p-xs', // 6×
  'font-size:0.82rem': 'u-fs-082',                                       // 4×
  'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap': 'u-grow u-min0 u-truncate', // 3×
  'flex:1;height:1px;background:var(--border)': 'u-grow u-hr-line',      // 3× línea divisoria
  'font-size:0.72rem;color:var(--text-dim);flex:1': 'u-fs-xs u-c-dim u-grow', // 3×
  // — lote 3 —
  'color:var(--accent)': 'u-c-accent',                                   // 3×
  'width:4.5rem;font-size:0.72rem;color:var(--text-muted)': 'u-w-time u-fs-xs u-c-muted', // 5× input hora anotación
  'width:15px;height:15px;accent-color:var(--accent);cursor:pointer;flex-shrink:0;position:relative;z-index:1': 'u-checkbox', // 4×
  'font-size:0.74rem;padding:0.15rem 0.3rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text)': 'u-chip-input', // 4×
  // — lote 4 (componentes recurrentes) —
  'flex:1;min-width:4rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:0.82rem;padding:0.2rem 0.4rem;outline:none': 'u-input-sm', // 4×
  'font-family:var(--font-display);font-size:0.7rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);cursor:pointer;user-select:none': 'u-collapse-header', // 4×
  'width:32px;height:32px;padding:1px;border:1px solid #444;border-radius:50%;cursor:pointer;background:none;flex-shrink:0': 'u-color-dot', // 3×
  // — lote 6 —
  'display:inline-flex;align-items:center;justify-content:center;width:1.6em': 'u-icon-box', // 3×
  'color:var(--text-dim);font-size:0.7rem': 'u-c-dim u-fs-070',          // 3×
  'font-size:0.68rem;color:var(--text-dim);display:flex;align-items:center;gap:0.2rem': 'u-row u-row--gap-xs u-fs-068 u-c-dim', // 4×
  'display:flex;align-items:center;justify-content:space-between;gap:0.5rem': 'u-between u-gap-sm', // 3×
  'display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:0.3rem': 'u-sublabel', // 3×
  // — lote 7 (inputs/botones pequeños recurrentes) —
  'width:100%;box-sizing:border-box;font-size:0.85rem;padding:0.35rem 0.5rem': 'u-input-block', // 3×
  'padding:0.35rem 0.5rem;font-size:0.8rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text)': 'u-input-bordered', // 3×
  'padding:0.2rem 0.5rem;font-size:0.72rem': 'u-btn-xs',                 // 3×
  'font-size:0.72rem;padding:0.3rem 0.6rem;white-space:nowrap': 'u-fs-xs u-btn-sm', // 3×
  // — lote 5 (app.html: componentes de vista ya previstos en el CSS) —
  'font-weight:400;opacity:0.6': 'u-hint',                               // 7× (u-hint = exacto)
  'padding:1.25rem;border-bottom:1px solid var(--border)': 'panel-section-divider', // 6×
  'font-family:var(--font-display);font-weight:700;font-size:1.1rem;text-transform:uppercase;letter-spacing:0.02em;flex:1': 'panel-view-title', // 6× (incluye flex:1)
  'background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:1.5rem;display:flex;flex-direction:column;gap:1rem': 'panel-card', // 4×
  'display:flex;align-items:center;gap:1rem;max-width:900px;margin:0 auto;width:100%;': 'panel-view-row', // 5×
  'font-family:var(--font-display);font-weight:600;font-size:0.9rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-dim)': 'panel-view-label', // 4×
  'display:flex;flex-direction:column;gap:0.75rem': 'u-stack',           // 3× (u-stack = exacto)
};

const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file) { console.error('falta archivo'); process.exit(1); }

let src = readFileSync(file, 'utf8');
const counts = {};

for (const [style, classes] of Object.entries(MAP)) {
  // Escape regex metachars en el valor del style.
  const styleEsc = style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Casar un tag completo (sin cruzar < >) que contenga este style EXACTO.
  const tagRe = new RegExp(`<[^<>]*\\sstyle="${styleEsc}"[^<>]*>`, 'g');
  src = src.replace(tagRe, (tag) => {
    // Quitar el atributo style exacto.
    let out = tag.replace(new RegExp(`\\sstyle="${styleEsc}"`), '');
    // Merge en class= existente, o insertar uno nuevo.
    if (/\sclass="/.test(out)) {
      out = out.replace(/(\sclass=")([^"]*)(")/, (m, p1, existing, p3) => {
        const set = new Set(existing.split(/\s+/).filter(Boolean));
        classes.split(/\s+/).forEach(c => set.add(c));
        return p1 + [...set].join(' ') + p3;
      });
    } else {
      // insertar class= justo tras el nombre de tag
      out = out.replace(/^(<[a-zA-Z][a-zA-Z0-9]*)/, `$1 class="${classes}"`);
    }
    counts[style] = (counts[style] || 0) + 1;
    return out;
  });
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`[sweep] ${file}: ${total} sustituciones`);
for (const [s, n] of Object.entries(counts)) console.log(`  ${n}×  ${s}`);

if (!dry) writeFileSync(file, src);
else console.log('(dry-run, sin escribir)');
