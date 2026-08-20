// ─────────────────────────────────────────────────────────────────
//  CONFIGURACIÓN GLOBAL — TEMPLATE
//  Copia este fichero como config.js y rellena los valores reales.
//  En producción, config.js se genera automáticamente en CI desde
//  GitHub Secrets, DENTRO del build del sitio: paso "Inyectar
//  js/config.js desde secrets" de .github/workflows/build-site.yml.
//
//  IMPORTANTE: config.js NO se versiona (está en .gitignore y ya no
//  se trackea). Sólo existe en el artifact que se publica en Pages y
//  en tu copia local. Si añades una clave nueva aquí, hay que añadirla
//  también al heredoc de build-site.yml o no llegará a producción.
// ─────────────────────────────────────────────────────────────────

const CONFIG = {
  basePath: '',  // ← única línea que cambia al migrar
  gaId: 'G-XXXXXXXXXX',  // ← ID de medición de Google Analytics
  webOrigin: 'https://calendariociclismo.app',  // ← dominio canónico (para OG/SEO)
  enDomain: '',  // ← dominio inglés dedicado; vacío = EN se sirve en /en/ del dominio canónico
};

// ── Dominio inglés ────────────────────────────────────────────────
// Vacío → isEnHost() siempre false y enBase() devuelve '/en'. El sitio EN
// vive en calendariociclismo.app/en/ (sin dominio alias).
var EN_DOMAIN = '';

// ── Supabase ─────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'your_anon_key_here';

