// ─────────────────────────────────────────────────────────────────
//  Edge Function: trigger-workflows
//  Dispara build-site.yml bajo petición explícita para creación inicial de
//  páginas o recuperación operativa. Las ediciones de jornadas ya publicadas
//  no deben llamar a esta función.
//
//  Secrets (Supabase Dashboard → Edge Functions → Secrets):
//    GITHUB_TOKEN — PAT con scope `workflow` (actions: read+write)
//    GH_REPO      — "DaniBici/calendario-ciclismo"
//
//  Auth: cabecera X-Internal-Token = INTERNAL_TRIGGER_TOKEN (invocación de
//  Postgres por pg_net, trigger trigger_workflows_for_start_order) o sesión
//  de administrador (private.admin_users, vía RPC public.is_admin).
//
//  Request body (JSON, opcional):
//    { workflows?: string[] }   — lista de workflows a disparar.
//      Por defecto: ["build-site.yml"]
//
//  Respuesta:
//    200 { dispatched: { workflow, status }[] }
//    401 { error: "Unauthorized" }
//    403 { error: "La operación requiere permisos de administración" }
//    502 { error: "GitHub API …", detail: … }
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Internal-Token',
};

// build-site.yml compone el sitio entero (páginas OG + sitemap + feeds + EN) y
// lo publica como artifact de Pages. Sustituye a og-pages.yml + sitemap.yml, que
// commiteaban su salida a main. Una llamada sin body usa este default.
const DEFAULT_WORKFLOWS = ['build-site.yml'];

// Anti-thundering-herd (BEST-EFFORT, NO fiable bajo concurrencia): coalesce
// de dispatches del MISMO worker dentro de la ventana. OJO: las edge functions
// de Supabase son serverless/sin estado compartido → este Map NO sobrevive a
// invocaciones concurrentes en workers distintos. No confiar en él para evitar
// avalanchas; sirve solo para suavizar repeticiones de un worker.
const COALESCE_WINDOW_MS = 30_000;
const lastDispatchByWorkflow = new Map<string, number>();

function shouldDispatch(workflow: string): boolean {
  const now = Date.now();
  const last = lastDispatchByWorkflow.get(workflow) ?? 0;
  if (now - last < COALESCE_WINDOW_MS) return false;
  lastDispatchByWorkflow.set(workflow, now);
  return true;
}

// Devuelve null si la petición está autorizada, o el código HTTP de rechazo.
// Una sesión válida no basta: public.is_admin() se consulta con el JWT del
// propio usuario y por GET (el pre-request de PostgREST solo bloquea
// escrituras). Cualquier error o respuesta distinta de true se trata como no
// admin.
async function verifyAuth(req: Request): Promise<401 | 403 | null> {
  // Invocación interna de Postgres con pg_net (trigger de orden de salida).
  const internal = req.headers.get('X-Internal-Token');
  const expected = Deno.env.get('INTERNAL_TRIGGER_TOKEN');
  if (internal && expected && internal === expected) return null;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return 401;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 401;
  const { data: isAdmin, error } = await supabase.rpc('is_admin', undefined, { get: true });
  return !error && isAdmin === true ? null : 403;
}

function jsonRes(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST')    return jsonRes({ error: 'Method not allowed' }, 405);

  const authStatus = await verifyAuth(req);
  if (authStatus === 401) return jsonRes({ error: 'Unauthorized' }, 401);
  if (authStatus === 403) return jsonRes({ error: 'La operación requiere permisos de administración' }, 403);

  const token = Deno.env.get('GITHUB_TOKEN');
  const repo  = Deno.env.get('GH_REPO');
  if (!token || !repo) {
    return jsonRes({ error: 'Server misconfigured: missing GITHUB_TOKEN or GH_REPO' }, 500);
  }

  let workflows = DEFAULT_WORKFLOWS;
  try {
    const body = await req.json();
    if (Array.isArray(body.workflows) && body.workflows.length > 0) {
      workflows = body.workflows.filter((w: unknown) => typeof w === 'string');
    }
  } catch { /* body opcional */ }

  const results = await Promise.all(
    workflows.map(async (workflow) => {
      if (!shouldDispatch(workflow)) {
        return { workflow, status: 200, ok: true, coalesced: true };
      }
      const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Accept:        'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent':  'calendariociclismo-panel',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      });
      return { workflow, status: res.status, ok: res.ok };
    }),
  );

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    return jsonRes({ error: 'One or more dispatches failed', dispatched: results }, 502);
  }

  return jsonRes({ dispatched: results }, 200);
});
