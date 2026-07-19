#!/bin/bash
# ============================================================
#  generate-sitemap.sh
#  Genera sitemap.xml desde Supabase y lo commitea al repo.
#  Ejecutar cada vez que se añadan jornadas.
#
#  USO: ./generate-sitemap.sh
# ============================================================

set -euo pipefail

SUPABASE_URL="https://bcecwlkynpgovnzhbpah.supabase.co"
ANON_KEY="sb_publishable_4j0S4lUm6dYphrb0DEUYkw_OGAUoCLL"
BASE_URL="https://calendariociclismo.app"

# Ir al directorio del repo
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Generando sitemap.xml..."

# Generar el sitemap con Node.js (disponible en Mac por defecto)
node -e "
const SUPABASE_URL = '${SUPABASE_URL}';
const ANON_KEY     = '${ANON_KEY}';
const BASE_URL     = '${BASE_URL}';

async function supabaseGet(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + ANON_KEY },
  });
  if (!res.ok) throw new Error('Supabase error ' + res.status);
  return res.json();
}

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
}

function urlEntry(loc, lastmod, changefreq, priority) {
  let s = '  <url>\n    <loc>' + escapeXml(loc) + '</loc>\n';
  if (lastmod)    s += '    <lastmod>' + lastmod + '</lastmod>\n';
  if (changefreq) s += '    <changefreq>' + changefreq + '</changefreq>\n';
  if (priority)   s += '    <priority>' + priority + '</priority>\n';
  s += '  </url>';
  return s;
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);

  const [races, raceDays, startlistTeams] = await Promise.all([
    supabaseGet('races?select=id,slug,startDate,endDate,raceFormat&slug=not.is.null&order=startDate.desc'),
    supabaseGet('race_days?select=slug,dateKey,updatedAt&editorialStatus=eq.published&slug=not.is.null&order=dateKey.desc'),
    supabaseGet('startlist_teams?select=raceId&order=raceId'),
  ]);
  const raceIdsWithStartlist = new Set(startlistTeams.map(t => t.raceId).filter(Boolean));

  const entries = [];

  // Páginas estáticas
  const statics = [
    ['/', 'daily', '1.0'],
    ['/calendario.html', 'daily', '0.9'],
    ['/fichajes/', 'daily', '0.8'],
    // /buscar.html: ARCHIVADO 2026-07-17, fuera del sitemap (la página sigue
    // viva por URL directa, pero no se ofrece ni se indexa).
    ['/about.html', 'monthly', '0.4'],
    ['/abierto.html', 'monthly', '0.5'],
    ['/en/open/', 'monthly', '0.5'],
  ];
  for (const [path, freq, prio] of statics) {
    entries.push(urlEntry(BASE_URL + path, today, freq, prio));
  }

  // Competiciones (URLs limpias /competicion/SLUG/)
  // Las de un día se omiten: comparten keyword/slug con su jornada y su
  // /competicion/ apunta canonical a /jornada/ (ver og-pages.yml).
  for (const race of races) {
    if (!race.slug) continue;
    if (race.raceFormat === 'one_day') continue;
    const lastmod = race.endDate || race.startDate || today;
    entries.push(urlEntry(
      BASE_URL + '/competicion/' + encodeURIComponent(race.slug) + '/',
      lastmod, 'weekly', '0.7'
    ));
  }

  // Inscritos (solo carreras con startlist, URLs limpias /inscritos/SLUG/)
  for (const race of races) {
    if (!race.slug || !raceIdsWithStartlist.has(race.id)) continue;
    const lastmod = race.endDate || race.startDate || today;
    entries.push(urlEntry(
      BASE_URL + '/inscritos/' + encodeURIComponent(race.slug) + '/',
      lastmod, 'weekly', '0.6'
    ));
  }

  // Feed de últimos resultados
  entries.push(urlEntry(BASE_URL + '/resultados/', today, 'hourly', '0.8'));

  // Jornadas publicadas (URLs limpias /jornada/SLUG/)
  for (const rd of raceDays) {
    if (!rd.slug) continue;
    const lastmod = rd.updatedAt ? rd.updatedAt.slice(0, 10) : (rd.dateKey || today);
    entries.push(urlEntry(
      BASE_URL + '/jornada/' + encodeURIComponent(rd.slug) + '/',
      lastmod, 'daily', '0.8'
    ));
  }

  const xml = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n' + entries.join('\n') + '\n</urlset>\n';

  const fs = require('fs');
  fs.writeFileSync('sitemap.xml', xml);
  console.log('sitemap.xml generado: ' + races.length + ' carreras, ' + raceDays.length + ' jornadas');
})();
"

# Comprobar si hay cambios
if git diff --quiet sitemap.xml 2>/dev/null; then
  echo "Sin cambios en el sitemap."
else
  git add sitemap.xml
  git commit -m "Actualizar sitemap.xml"
  git push origin main
  echo "sitemap.xml publicado."
fi
