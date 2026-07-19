// ─────────────────────────────────────────────────────────────────
//  Cloudflare Worker: cyclocal.app — PUENTE DE REDIRECCIÓN
//
//  cyclocal.app dejó de ser el dominio del sitio inglés. El sitio EN
//  vive ahora en calendariociclismo.app/en/. Este Worker existe solo
//  para no romper enlaces externos ya compartidos: redirige 301 cada
//  ruta de cyclocal.app a su equivalente bajo /en/.
//
//  Rules:
//    cyclocal.app/                → 301 → calendariociclismo.app/en/
//    cyclocal.app/season/         → 301 → calendariociclismo.app/en/season/
//    cyclocal.app/race/<slug>/    → 301 → calendariociclismo.app/en/race/<slug>/
//    cyclocal.app/js/*            → 301 → calendariociclismo.app/js/*  (assets raíz)
//
//  Deploy:
//    cd workers/cyclocal && npm install && npx wrangler@3 deploy
// ─────────────────────────────────────────────────────────────────

const ORIGIN = 'https://calendariociclismo.app';

// Paths que viven en la raíz del origen (compartidos, sin prefijo /en/).
// El resto de rutas de cyclocal mapean a su equivalente bajo /en/.
const ROOT_PREFIXES = [
  '/js/',
  '/css/',
  '/favicon',
  '/apple-touch-icon',
  '/i18n/',
  '/sitemap',
  '/atom.xml',
  '/robots.txt',
  '/llms.txt',
];

// Rutas limpias del antiguo cyclocal → su carpeta /en/ equivalente.
const STATIC_MAP = {
  '/':              '/en/',
  '/index.html':    '/en/',
  '/season/':       '/en/season/',
  '/month/':        '/en/month/',
  '/about/':        '/en/about/',
  '/search/':       '/en/search/',
  '/privacy/':      '/en/privacy/',
  '/subscription/': '/en/subscription/',
  '/beta/':         '/en/beta/',
};

// Prefijos de rutas SPA por slug del antiguo cyclocal → su prefijo /en/.
const SLUG_PREFIX_MAP = {
  '/stage/':       '/en/stage/',
  '/race/':        '/en/race/',
  '/startlist/':   '/en/startlist/',
  '/profile/':     '/en/profile/',
  '/start-order/': '/en/start-order/',
};

// Traduce una ruta de cyclocal.app a la ruta destino en calendariociclismo.app.
function targetPath(path) {
  // Cualquier /en/ residual: servir desde la raíz canónica tal cual.
  if (path === '/en' || path.startsWith('/en/')) return path;

  // Assets compartidos: misma ruta en el origen.
  if (ROOT_PREFIXES.some(p => path.startsWith(p))) return path;

  // Rutas estáticas conocidas.
  if (STATIC_MAP[path] !== undefined) return STATIC_MAP[path];

  // Rutas SPA por slug.
  for (const [clean, en] of Object.entries(SLUG_PREFIX_MAP)) {
    if (path.startsWith(clean)) return en + path.slice(clean.length);
  }

  // Desconocida: cae a la raíz EN.
  return '/en/';
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const dest = ORIGIN + targetPath(url.pathname) + url.search + url.hash;
    return Response.redirect(dest, 301);
  },
};
