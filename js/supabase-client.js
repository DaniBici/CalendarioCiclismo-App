// ─────────────────────────────────────────────────────────────────
//  CLIENTE DE DATOS — punto único de creación del cliente de Supabase.
//
//  Las páginas públicas solo leen: PostgREST (`from`, `rpc`) con la clave
//  pública. Usan el cliente ligero de postgrest-js (js/vendor/postgrest-js),
//  autoalojado, en lugar de supabase-js completo, que arrastraba auth,
//  realtime y storage (≈230 KB sin comprimir y ocho peticiones a jsDelivr)
//  sin que ninguna página pública los use.
//
//  El panel y el login necesitan sesión, storage y funciones: sus HTML
//  declaran <meta name="cc-supabase-client" content="full"> y reciben el
//  cliente completo, cargado bajo demanda desde el CDN. La elección depende
//  del HTML y no del orden de los imports, que el empaquetado con división de
//  código no conserva entre chunks. En una página pública mal marcada,
//  `supabase.auth` no existe y el fallo es visible.
//
//  SUPABASE_URL y SUPABASE_ANON_KEY son globals de js/config.js.
// ─────────────────────────────────────────────────────────────────
import { PostgrestClient } from './vendor/postgrest-js/index.mjs';

const FULL_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

const wantsFullClient = typeof document !== 'undefined'
  && document.querySelector('meta[name="cc-supabase-client"][content="full"]') !== null;

let client;
if (wantsFullClient) {
  const { createClient } = await import(FULL_CLIENT_URL);
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  client = new PostgrestClient(`${SUPABASE_URL}/rest/v1`, { headers: { apikey: SUPABASE_ANON_KEY } });
}

export function getSupabaseClient() {
  return client;
}
