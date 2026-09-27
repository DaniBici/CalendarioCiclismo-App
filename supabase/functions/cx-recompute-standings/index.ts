import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { recomputeCxStandings } from '../../../js/cx-standings.js';

const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info', 'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply({ error: 'Método no permitido' }, 405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return reply({ error: 'Sesión requerida' }, 401);
  // Conserva la identidad del editor y sus políticas; no utiliza service_role.
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return reply({ error: 'Sesión inválida' }, 401);
  const { error: adminError } = await client.rpc('cx_require_admin');
  if (adminError) return reply({ error: 'Se requiere administración CC-CX' }, 403);
  try {
    const body = await req.json();
    if (typeof body.tournamentId !== 'string' || !body.tournamentId.trim() || !['ME', 'WE', 'MU', 'WU', 'MJ', 'WJ'].includes(body.category)
      || body.replaceManual != null && typeof body.replaceManual !== 'boolean'
      || body.dryRun != null && typeof body.dryRun !== 'boolean') return reply({ error: 'Destino, previsualización u override inválidos' }, 422);
    const { data: snapshot, error: inputError } = await client.rpc('cx_standings_snapshot', {
      p_tournament_id: body.tournamentId, p_category: body.category,
    });
    if (inputError) return reply({ error: inputError.message }, 422);
    const calculation = recomputeCxStandings(snapshot.input);
    if (body.dryRun === true) return reply({ digest: snapshot.digest, calculation, published: null });
    const { data: published, error: publishError } = await client.rpc('cx_publish_standings', {
      p_tournament_id: body.tournamentId, p_category: body.category, p_expected_digest: snapshot.digest,
      p_calculation: calculation, p_replace_manual: body.replaceManual === true,
    });
    if (publishError) return reply({ error: publishError.message, calculation }, publishError.code === '40001' ? 409 : 422);
    return reply({ digest: snapshot.digest, calculation, published });
  } catch (error) { return reply({ error: (error as Error).message }, 422); }
});
