import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { collectUciCxCalendar } from '../_shared/cx-uci-calendar.mjs';
import { countryCode } from '../../../scripts/uci-catalog/countries.mjs';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (req.method !== 'POST') return reply({error:'Método no permitido'},405);
  const authorization = req.headers.get('Authorization');
  if (!authorization) return reply({error:'Sesión requerida'},401);
  // Usa la identidad del editor. No emplea service_role ni escribe en la BD.
  const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
    global:{headers:{Authorization:authorization}},auth:{persistSession:false},
  });
  const {data:{user},error:authError} = await client.auth.getUser();
  if (authError || !user) return reply({error:'Sesión inválida'},401);
  const {error:adminError} = await client.rpc('cx_require_admin');
  if (adminError) return reply({error:'Se requiere administración CC-CX'},403);
  try {
    const body = await req.json();
    const manifest = await collectUciCxCalendar({seasonKey:body.seasonKey,countryCode});
    return reply(manifest);
  } catch(error) {
    return reply({error:(error as Error).message},422);
  }
});
