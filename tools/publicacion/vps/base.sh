#!/bin/bash
# Sitio base en el VPS, con los mismos pasos que .github/workflows/build-site.yml y sin
# GitHub: todas las URL, <head>, sitemap, feeds, EN, JS y CSS. Lo publicado por página se
# sirve por encima de este árbol. Lee los datos por la API con la clave pública.
#   base.sh <checkout> <destino>
set -euo pipefail
REPO="$1"
DESTINO="$2"
cd "$REPO"
ORIGEN=https://calendariociclismo.app
# Configuración pública: la del sitio ya generado. Tras el corte el dominio es esta máquina y en una
# máquina nueva no responde: ahí vienen del entorno (publicador.env).
if [ -f "$DESTINO/js/config.js" ]; then CONFIG_PUBLICA=$(cat "$DESTINO/js/config.js")
elif [ -n "${SUPABASE_ANON_KEY:-}" ]; then CONFIG_PUBLICA=''
else CONFIG_PUBLICA=$(curl -fsS "$ORIGEN/js/config.js"); fi
valor() { printf '%s\n' "$CONFIG_PUBLICA" | sed -nE "s/.*$1[[:space:]]*[:=][[:space:]]*'([^']*)'.*/\1/p" | head -1 || true; }
# La URL va dentro de la condición del panel en el config.js que escribe este script.
SUPABASE_URL=${SUPABASE_URL:-$(printf '%s\n' "$CONFIG_PUBLICA" | grep -oE 'https://[a-z0-9]+\.supabase\.co' | head -1 || true)}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY:-$(valor SUPABASE_ANON_KEY)}
GA_MEASUREMENT_ID=${GA_MEASUREMENT_ID:-$(valor gaId)}
[ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_ANON_KEY" ] || { echo 'Sin configuración pública: docs/runbooks/publicador-vps.md' >&2; exit 1; }
export SUPABASE_ANON_KEY
export PAGES_DATA="$REPO/.pages-data"
export RESULTADOS_CACHE="$REPO/.pages-prerender/resultados"
export EN_BASE_URL="$ORIGEN/en"
export PRERENDER_JORNADAS=all PRERENDER_INSCRITOS=listas PRERENDER_RESULTADOS=all PRERENDER_AUXILIARES=all
export PRERENDER_FICHAJES=all PRERENDER_CX=all PRERENDER_COMPETICION=all
inicio=$(date +%s)
paso() { echo "[$(($(date +%s) - inicio)) s] $1"; }

rm -rf _site .pages-data .pages-generated .pages-build-state.json
mkdir -p .pages-prerender/resultados
paso 'Plan'
python3 tools/site/build_generated.py prepare

paso 'Fuentes'
shopt -s nullglob dotglob
SITE=( *.html *.txt CNAME .nojekyll favicon* apple-touch-icon.png manifest.json sw.js LICENSE THIRD-PARTY-NOTICES.md .well-known
       css js flags fonts i18n abierto about apoyar apps calendario fichajes panel resultados suscripcion en )
mkdir -p _site
rsync -a --relative "${SITE[@]}" _site/ \
  --exclude '__tests__' --exclude '__pycache__' \
  --include '/resultados/index.html' --exclude '/resultados/*' \
  --exclude '/en/cyclocross/' --exclude '/en/race/' --exclude '/en/stage/' --exclude '/en/startlist/' --exclude '/en/profile/' \
  --include '/en/results/index.html' --exclude '/en/results/*' --exclude '/en/route-map/' --exclude '/en/start-order/' --exclude '/en/feed/'
shopt -u dotglob
cp docs/cc-cx-points-schemes.json _site/panel/cx-points-schemes.json
mkdir -p _site/ciclocross
cp ciclocross.html _site/ciclocross/index.html
python3 tools/site/redirects.py --out _site

# Las páginas públicas leen por el mismo origen; el panel, directo.
cat > _site/js/config.js <<CONFIG
const CONFIG = {
  basePath: '',
  gaId: '${GA_MEASUREMENT_ID}',
  webOrigin: '${ORIGEN}',
  enDomain: '',
};
var EN_DOMAIN = '';
const SUPABASE_URL      = location.pathname.startsWith('/panel') ? '${SUPABASE_URL}' : location.origin;
const SUPABASE_ANON_KEY = '${SUPABASE_ANON_KEY}';
CONFIG

paso 'Páginas EN'
python3 tools/build-i18n-html.py --out _site
for bloque in og-races og-stages og-results og-extras og-cx sitemap feeds; do
  paso "Bloque $bloque"
  python3 tools/site/build_generated.py run "$bloque"
done
for paso_node in prerender-jornadas prerender-inscritos prerender-resultados prerender-auxiliares prerender-fichajes prerender-cx prerender-competicion; do
  paso "$paso_node"
  node "tools/site/$paso_node.mjs" _site
done
paso 'Verificación'
python3 tools/site/build_generated.py verify
python3 tools/site/check_hreflang.py _site
paso 'Empaquetado'
node tools/site/bundle_assets.mjs _site --preload-map .module-preload.json
python3 tools/site/version_assets.py _site --preload-map .module-preload.json
paso 'Publicación del árbol'
mkdir -p "$DESTINO"
# Los trozos de JS y CSS anteriores se conservan: una pestaña abierta aún puede pedirlos.
rsync -a --delete --delay-updates --exclude '/js/' --exclude '/css/' _site/ "$DESTINO/"
rsync -a --delay-updates _site/js _site/css "$DESTINO/"
paso "Terminado: $(find "$DESTINO" -type f | wc -l) archivos, $(du -sh "$DESTINO" | cut -f1)"
