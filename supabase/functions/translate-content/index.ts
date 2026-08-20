// ─────────────────────────────────────────────────────────────────
//  Edge Function: translate-content
//  Traduce campos editoriales de race_days, races y broadcasts al
//  inglés usando Claude Sonnet 4.6 (Anthropic API).
//
//  Variables de entorno necesarias:
//    ANTHROPIC_API_KEY — API key de Anthropic
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ── Auth ─────────────────────────────────────────────────────────
async function verifyAuth(req: Request): Promise<boolean> {
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

// ── SHA-256 hash ─────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return 'sha256:' + Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── System prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a professional cycling journalist translator. Translate Spanish cycling editorial content into English.

PRESERVE UNCHANGED (do not translate):
- Race names: Giro d'Italia, Tour de France, La Vuelta, Paris-Roubaix, Strade Bianche, Liège-Bastogne-Liège, Itzulia, Il Lombardia, Tirreno-Adriatico, Milano-Sanremo, Amstel Gold Race, La Flèche Wallonne, Eschborn-Frankfurt, Tour de Romandie, Critérium du Dauphiné, Volta a Catalunya, etc.
- Jersey names: Maglia Rosa, Maglia Ciclamino, Maglia Azzurra, Maillot Jaune, Maillot Vert, Maillot Pois, Maillot Rojo, Maillot de la Montaña
- Local place names in their original language: Bologna, Liège, Roubaix, Firenze, Roma, etc.
- UCI team names exactly as registered
- Technical terms used in English cycling media: ITT (individual time trial), TTT (team time trial), GC (general classification), KOM (King of the Mountains), DNF, DNS, DSQ
- Surface terms: pavé, sterrato (used as-is in English cycling press)
- Numbers, distances, and units

TRANSLATE AND ADAPT:
- etapa N → stage N
- prólogo → prologue
- contrarreloj / CRI → time trial
- contrarreloj por equipos / CRE → team time trial
- puerto de N categoría → category N climb
- final en alto → summit finish
- final en repecho → uphill finish
- cronoescalada → uphill time trial
- fuga / escapada → breakaway
- pelotón → peloton
- bonificaciones → bonus seconds
- día de descanso → rest day
- llegada → finish / arrival
- salida → start / departure
- jornada → stage / day
- kilómetro → kilometre (British spelling)
- metros → metres (British spelling)

STYLE RULES:
- Neutral, journalistic tone matching English cycling press (Cyclingnews, VeloNews, CyclingWeekly style)
- Preserve all Markdown formatting from the original (**, *, _, #, line breaks)
- Do not add information not present in the original
- Do not add explanations or commentary
- Output ONLY the translated text — no quotes, no preamble, no explanation`;

// ── Anthropic API call ────────────────────────────────────────────
async function translateWithClaude(text: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ── Field → DB column mapping ─────────────────────────────────────
const FIELD_MAP: Record<string, Record<string, string>> = {
  race_day: {
    description: 'description',
    bonuses: 'bonuses',
    notes: 'notes',
    startLocation: 'startLocation',
    finishLocation: 'finishLocation',
  },
  race: {
    name: 'name',
  },
  broadcast: {
    note: 'note',
  },
};

const TABLE_MAP: Record<string, string> = {
  race_day: 'race_days',
  race: 'races',
  broadcast: 'broadcasts',
};

// ── Main handler ──────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  if (!await verifyAuth(req)) return jsonRes({ error: 'Unauthorized' }, 401);

  let body: {
    entityType: string;
    entityId: string;
    fields: string[];
    targetLang: string;
    force?: boolean;
  };

  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: 'Invalid JSON body' }, 400);
  }

  const { entityType, entityId, fields, targetLang, force = false } = body;

  if (!entityType || !entityId || !fields?.length || targetLang !== 'en') {
    return jsonRes({ error: 'Missing or invalid parameters' }, 400);
  }

  const table = TABLE_MAP[entityType];
  const allowedFields = FIELD_MAP[entityType];
  if (!table || !allowedFields) {
    return jsonRes({ error: `Unknown entityType: ${entityType}` }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Fetch entity
  const { data: entity, error: fetchErr } = await supabase
    .from(table)
    .select('*')
    .eq('id', entityId)
    .single();

  if (fetchErr || !entity) {
    return jsonRes({ error: `Entity not found: ${fetchErr?.message}` }, 404);
  }

  const currentTranslations: Record<string, unknown> = entity.translations ?? {};
  const enTranslations: Record<string, Record<string, unknown>> =
    (currentTranslations.en as Record<string, Record<string, unknown>>) ?? {};

  const results: Record<string, string> = {};
  const skipped: string[] = [];

  for (const field of fields) {
    const dbCol = allowedFields[field];
    if (!dbCol) { skipped.push(`${field} (unknown)`); continue; }

    const sourceValue: string = entity[dbCol] ?? '';
    if (!sourceValue.trim()) { skipped.push(`${field} (empty)`); continue; }

    const existing = enTranslations[field] as Record<string, unknown> | undefined;

    // Skip manual translations unless force
    if (existing?.status === 'manual' && !force) {
      skipped.push(`${field} (manual)`);
      continue;
    }

    // Skip if hash matches and status is auto
    const currentHash = await sha256(sourceValue);
    if (!force && existing?.status === 'auto' && existing?.hash === currentHash) {
      skipped.push(`${field} (up-to-date)`);
      continue;
    }

    const translated = await translateWithClaude(sourceValue);

    enTranslations[field] = {
      value: translated,
      hash: currentHash,
      status: 'auto',
      updatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
    };

    results[field] = translated;
  }

  if (Object.keys(results).length > 0) {
    const updatedTranslations = { ...currentTranslations, en: enTranslations };
    const { error: updateErr } = await supabase
      .from(table)
      .update({ translations: updatedTranslations })
      .eq('id', entityId);

    if (updateErr) {
      return jsonRes({ error: `Failed to save: ${updateErr.message}` }, 500);
    }
  }

  return jsonRes({
    saved: Object.keys(results).length > 0,
    translated: results,
    skipped,
    translations: { en: enTranslations },
  }, 200);
});
