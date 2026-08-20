#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
//  migrate-header.mjs — reemplaza el <header class="site-header">…</header>
//  estático de cada página por el placeholder común + carga de /js/header.js.
//  El header pasa a montarse en runtime desde js/header.js (fuente única).
//  Idempotente: si la página ya tiene id="siteHeader", la salta.
//  Uso: node scripts/migrate-header.mjs
// ─────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'archive', 'ios-app', 'android-app', '.github']);

// Bloque de header estático (cualquier variante ES/EN, con o sin botón volver).
const HEADER_RE = /<header class="site-header"[^>]*>[\s\S]*?<\/header>/;

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      yield path.join(dir, entry.name);
    }
  }
}

let changed = 0, skipped = 0, untouched = 0;

for await (const file of walk(ROOT)) {
  const html = await fs.readFile(file, 'utf8');
  if (!HEADER_RE.test(html)) { untouched++; continue; }
  if (html.includes('id="siteHeader"')) { skipped++; continue; } // ya migrada

  const block = html.match(HEADER_RE)[0];
  const hasBack = /class="back-btn"|id="backBtn"/.test(block);
  const placeholder =
    `<header class="site-header" id="siteHeader"${hasBack ? ' data-back' : ''}></header>` +
    `\n<script type="module" src="/js/header.js"></script>`;

  await fs.writeFile(file, html.replace(HEADER_RE, placeholder), 'utf8');
  changed++;
}

console.log(`Migradas: ${changed} · ya migradas: ${skipped} · sin header: ${untouched}`);
