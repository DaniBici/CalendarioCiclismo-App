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
//  Auth: cualquier usuario autenticado de Supabase (el panel ya
//  requiere login). No hace falta allowlist adicional.
//
//  Request body (JSON, opcional):
//    { workflows?: string[] }   — lista de workflows a disparar.
//      Por defecto: ["build-site.yml"]
//
//  Respuesta:
//    200 { dispatched: { workflow, status }[] }
//    401 { error: "Unauthorized" }
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

async function verifyAuth(req: Request): Promise<boolean> {
  // Bypass interno legado para llamadas operativas de Postgres con pg_net.
  const internal = req.headers.get('X-Internal-Token');
  const expected = Deno.env.get('INTERNAL_TRIGGER_TOKEN');
  if (internal && expected && internal === expected) return true;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return false;
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
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

  if (!await verifyAuth(req)) return jsonRes({ error: 'Unauthorized' }, 401);

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
