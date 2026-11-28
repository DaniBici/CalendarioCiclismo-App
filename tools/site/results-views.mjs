#!/usr/bin/env node
// Páginas de Últimos resultados del sitio base (js/results/feed-pages.js):
// copia /resultados/ y /en/results/ a la ruta de cada vista con su <head>
// (título, descripción, canonical, hreflang y Open Graph). js/resultados.js
// pinta la vista que corresponde a la ruta. El publicador del VPS usa
// feedPageHead() con el <head> de su página.
//
//   node tools/site/results-views.mjs <_site>
//
// Sin datos: la temporada del ránking y la de ciclocross salen de la fecha. Va
// tras el prerender de resultados, que recorre /resultados/<slug>/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEED_PAGES, feedPageMeta, feedPagePath } from '../../js/results/feed-pages.js';
import { cxSeason } from '../../js/cx/season.js';
import { seasonCalendarYear } from '../../js/services/today-season.js';

const ORIGIN = 'https://calendariociclismo.app';
const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const text = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function replaceTag(head, pattern, tag) {
  if (!pattern.test(head)) throw new Error(`Sin ${pattern} en el <head> de resultados`);
  return head.replace(pattern, () => tag);
}

/** <head> de la página `page` en `lang` a partir del de /resultados/ o /en/results/. */
export function feedPageHead(head, page, lang, seasons) {
  const meta = feedPageMeta(page, lang, seasons);
  const url = ORIGIN + feedPagePath(page, lang);
  const es = ORIGIN + feedPagePath(page, 'es');
  const en = ORIGIN + feedPagePath(page, 'en');
  let out = replaceTag(head, /<title>[^<]*<\/title>/, `<title>${text(meta.title)}</title>`);
  out = replaceTag(out, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${attr(meta.description)}">`);
  out = replaceTag(out, /<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`);
  out = replaceTag(out, /<link rel="alternate" hreflang="es" href="[^"]*">/, `<link rel="alternate" hreflang="es" href="${es}">`);
  out = replaceTag(out, /<link rel="alternate" hreflang="en" href="[^"]*">/, `<link rel="alternate" hreflang="en" href="${en}">`);
  out = replaceTag(out, /<link rel="alternate" hreflang="x-default" href="[^"]*">/, `<link rel="alternate" hreflang="x-default" href="${es}">`);
  for (const property of ['og:title', 'twitter:title']) {
    const key = property.startsWith('og:') ? 'property' : 'name';
    out = replaceTag(out, new RegExp(`<meta ${key}="${property}" content="[^"]*">`), `<meta ${key}="${property}" content="${attr(meta.title)}">`);
  }
  for (const property of ['og:description', 'twitter:description']) {
    const key = property.startsWith('og:') ? 'property' : 'name';
    out = replaceTag(out, new RegExp(`<meta ${key}="${property}" content="[^"]*">`), `<meta ${key}="${property}" content="${attr(meta.description)}">`);
  }
  const ogUrl = `<meta property="og:url" content="${url}">`;
  const previous = /<meta property="og:url" content="[^"]*">/.exec(out)?.[0];
  if (previous) return out.replace(previous, () => ogUrl);
  const ogType = /<meta property="og:type" content="[^"]*">/.exec(out)?.[0];
  if (!ogType) throw new Error('Sin og:type en el <head> de resultados');
  return out.replace(ogType, () => `${ogType}\n  ${ogUrl}`);
}

/** Temporadas por fecha, para el sitio base. */
export function seasonsForDate(date = new Date()) {
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { cxSeason: cxSeason(date), rankingSeason: seasonCalendarYear(key) };
}

function main(site) {
  const seasons = seasonsForDate();
  let written = 0;
  for (const lang of ['es', 'en']) {
    const source = join(site, feedPagePath('latest', lang), 'index.html');
    const html = readFileSync(source, 'utf8');
    const end = html.indexOf('</head>');
    if (end < 0) throw new Error(`${source}: sin </head>`);
    for (const page of FEED_PAGES) {
      const file = join(site, feedPagePath(page, lang), 'index.html');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, feedPageHead(html.slice(0, end), page, lang, seasons) + html.slice(end));
      written++;
    }
  }
  console.log(`Páginas de Últimos resultados: ${written}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Uso: node tools/site/results-views.mjs <_site>');
    process.exit(1);
  }
  main(resolve(process.argv[2]));
}
