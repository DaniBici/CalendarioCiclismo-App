// ─────────────────────────────────────────────────────────────────
//  Edge Function: detect-team-colors
//  Recibe una foto de un ciclista con maillot y culotte y devuelve
//  los colores del equipamiento mapeados a los campos de la chapa.
//  Usa Gemini Flash (visión) para la extracción.
//
//  Variables de entorno necesarias:
//    GEMINI_API_KEY — API key de Google AI Studio
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ── Verify Supabase JWT ──────────────────────────────────────────
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

// ── Prompt para Gemini ───────────────────────────────────────────
const EXTRACTION_PROMPT = `Analiza esta fotografía de un ciclista con maillot y culotte.
Extrae los colores predominantes del equipamiento y devuelve ÚNICAMENTE un JSON válido con esta estructura exacta, sin texto adicional:

{
  "headerBg": "#rrggbb",
  "headerText": "#rrggbb",
  "badgeTorsoCenter": "#rrggbb",
  "badgeTorsoSides": "#rrggbb",
  "badgeInnerCircle": "#rrggbb o null",
  "badgeShorts": "#rrggbb"
}

Definición de cada campo:
- headerBg: color dominante del maillot (torso), el más representativo del equipo. Si hay varios colores, elige el más visible o asociado al equipo.
- headerText: #ffffff si headerBg es oscuro, #000000 si headerBg es claro. Elige el que garantice mejor legibilidad.
- badgeTorsoCenter: color de la franja central vertical del maillot en el torso. Si el maillot es uniforme, igual que headerBg.
- badgeTorsoSides: color de los flancos laterales del maillot en el torso. Si es uniforme, igual que badgeTorsoCenter.
- badgeInnerCircle: color de un elemento circular destacado, logo circular o detalle en el pecho del maillot, si existe claramente. Si no hay ninguno visible, devuelve null (sin comillas).
- badgeShorts: color predominante del culotte o pantalón corto.

Reglas:
- Todos los colores en formato hex minúscula exactamente #rrggbb (6 dígitos).
- badgeInnerCircle debe ser null (valor JSON, no string "null") si no hay elemento circular claro.
- Ajusta los colores para que sean representativos del equipo, no de la iluminación o sombras.
- Devuelve SOLO el JSON, sin markdown, sin \`\`\`, sin explicación.`;

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonRes({ error: 'Método no soportado' }, 405);
  }

  if (!(await verifyAuth(req))) {
    return jsonRes({ error: 'No autorizado' }, 401);
  }

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    return jsonRes({ error: 'GEMINI_API_KEY no configurada' }, 500);
  }

  try {
    const contentType = req.headers.get('content-type') || '';

    let fileBytes: Uint8Array;
    let mimeType: string;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return jsonRes({ error: 'No se encontró el archivo en el formulario' }, 400);
      }
      if (file.size > MAX_FILE_SIZE) {
        return jsonRes({ error: 'Imagen demasiado grande (máx 10 MB)' }, 413);
      }
      fileBytes = new Uint8Array(await file.arrayBuffer());
      mimeType = file.type || 'image/jpeg';
    } else if (contentType.includes('application/json')) {
      const body = await req.json() as { imageUrl?: string };
      const { imageUrl } = body;
      if (!imageUrl || typeof imageUrl !== 'string') {
        return jsonRes({ error: 'Campo imageUrl requerido en el body JSON' }, 400);
      }
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
      if (!imgRes.ok) {
        return jsonRes({ error: `No se pudo obtener la imagen (${imgRes.status})` }, 502);
      }
      const imgBuf = await imgRes.arrayBuffer();
      if (imgBuf.byteLength > MAX_FILE_SIZE) {
        return jsonRes({ error: 'Imagen demasiado grande (máx 10 MB)' }, 413);
      }
      fileBytes = new Uint8Array(imgBuf);
      mimeType = imgRes.headers.get('content-type')?.split(';')[0].trim() || 'image/jpeg';
    } else {
      const body = await req.arrayBuffer();
      if (body.byteLength > MAX_FILE_SIZE) {
        return jsonRes({ error: 'Imagen demasiado grande (máx 10 MB)' }, 413);
      }
      fileBytes = new Uint8Array(body);
      mimeType = contentType || 'image/jpeg';
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.some(t => mimeType.startsWith(t))) {
      return jsonRes({ error: `Tipo no soportado: ${mimeType}. Usa PNG, JPG o WEBP.` }, 400);
    }

    // Convert to base64 (chunked to avoid stack overflow)
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < fileBytes.length; i += chunkSize) {
      const chunk = fileBytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64Data = btoa(binary);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        contents: [{
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: EXTRACTION_PROMPT },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[detect-team-colors] Gemini error:', errText);
      return jsonRes({ error: `Error de Gemini (${geminiRes.status}): ${errText.slice(0, 300)}` }, 502);
    }

    const geminiData = await geminiRes.json();

    const parts: Array<{ text?: string; thought?: boolean }> =
      geminiData?.candidates?.[0]?.content?.parts ?? [];
    const textPart =
      [...parts].reverse().find((p) => p.text && !p.thought)?.text;

    if (!textPart) {
      console.error('[detect-team-colors] No text in response:', JSON.stringify(geminiData).slice(0, 500));
      return jsonRes({ error: 'Gemini no devolvió texto. ¿Es una foto de un ciclista?' }, 502);
    }

    let jsonStr = textPart.trim();
    // Strip markdown fences
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    // Fallback: extract first JSON object via regex
    if (!jsonStr.startsWith('{')) {
      const match = jsonStr.match(/\{[\s\S]*\}/);
      if (match) jsonStr = match[0];
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (_e) {
      console.error('[detect-team-colors] JSON parse failed. Raw:', jsonStr.slice(0, 800));
      return jsonRes({ error: 'No se pudo interpretar la respuesta como JSON.', rawText: jsonStr.slice(0, 800) }, 422);
    }

    // Validate required hex fields
    const HEX_RE = /^#[0-9a-f]{6}$/;
    const required = ['headerBg', 'headerText', 'badgeTorsoCenter', 'badgeTorsoSides', 'badgeShorts'];
    for (const field of required) {
      const val = parsed[field];
      if (typeof val !== 'string' || !HEX_RE.test(val)) {
        return jsonRes({ error: `Campo "${field}" inválido: ${JSON.stringify(val)}` }, 422);
      }
    }
    // badgeInnerCircle can be null or a hex string
    if (parsed.badgeInnerCircle !== null && parsed.badgeInnerCircle !== undefined) {
      if (typeof parsed.badgeInnerCircle !== 'string' || !HEX_RE.test(parsed.badgeInnerCircle as string)) {
        parsed.badgeInnerCircle = null;
      }
    }

    return jsonRes({
      ok: true,
      colors: {
        headerBg:         parsed.headerBg,
        headerText:       parsed.headerText,
        badgeTorsoCenter: parsed.badgeTorsoCenter,
        badgeTorsoSides:  parsed.badgeTorsoSides,
        badgeInnerCircle: parsed.badgeInnerCircle ?? null,
        badgeShorts:      parsed.badgeShorts,
      },
    }, 200);

  } catch (err) {
    console.error('[detect-team-colors] Unexpected error:', err);
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      return jsonRes({ error: 'Gemini tardó demasiado. Intenta con una imagen más pequeña.' }, 504);
    }
    return jsonRes({ error: 'Error interno: ' + (err as Error).message }, 500);
  }
});
