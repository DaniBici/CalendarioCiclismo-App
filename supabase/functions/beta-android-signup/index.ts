// ─────────────────────────────────────────────────────────────────
//  Edge Function: beta-android-signup
//  Guarda el email en `beta_android_signups`, envía confirmación al
//  registrado y añade el tester a Google Play.
//
//  Variables de entorno (Supabase Dashboard → Settings → Edge Functions):
//    RESEND_API_KEY                   — API key de Resend (https://resend.com)
//    RESEND_FROM                      — Remitente (e.g. "noreply@calendariociclismo.app")
//    GOOGLE_PLAY_SERVICE_ACCOUNT_JSON — Contenido JSON de la service account de GCP
//    GOOGLE_PLAY_TRACK                — Track de pruebas (default: "alpha")
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const RATE_LIMIT_MAX      = 5;
const RATE_LIMIT_WINDOW_S = 3600;
const PACKAGE_NAME        = 'app.calendariociclismo.android';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Beta cerrada — la app está publicada en Google Play
  return new Response(JSON.stringify({ error: 'beta_closed' }), {
    status: 410, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { email, _hp } = body;

  // Honeypot
  if (_hp) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Validar email
  if (!email || typeof email !== 'string') {
    return new Response(JSON.stringify({ error: 'Falta el email' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    return new Response(JSON.stringify({ error: 'Email no válido' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Rate limiting por IP
  if (ip !== 'unknown') {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_S * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('beta_android_signups')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', windowStart);

    if (!countError && count !== null && count >= RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({ error: 'Demasiados intentos. Inténtalo más tarde.' }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': String(RATE_LIMIT_WINDOW_S) } },
      );
    }
  }

  // Comprobar si el email ya existe
  const { count: existing } = await supabase
    .from('beta_android_signups')
    .select('id', { count: 'exact', head: true })
    .eq('email', normalizedEmail);

  if (existing && existing > 0) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 409, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // Guardar en Supabase
  const { error: dbError } = await supabase.from('beta_android_signups').insert({
    email:      normalizedEmail,
    ip_address: ip,
    user_agent: req.headers.get('user-agent') ?? '',
  });

  if (dbError) {
    if (dbError.code === '23505') {
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 409, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    console.error('DB insert error:', dbError);
    return new Response(JSON.stringify({ error: 'Error al guardar el registro' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const resendKey  = Deno.env.get('RESEND_API_KEY');
  const resendFrom = Deno.env.get('RESEND_FROM') ?? 'onboarding@resend.dev';

  // Confirmación al registrado
  if (resendKey) {
    await sendConfirmationEmail(resendKey, resendFrom, normalizedEmail);
  }

  // Añadir a Google Play Closed Testing (best-effort, no bloquea la respuesta)
  const serviceAccountJson = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON');
  if (serviceAccountJson) {
    addGooglePlayTester(
      serviceAccountJson,
      PACKAGE_NAME,
      Deno.env.get('GOOGLE_PLAY_TRACK') ?? 'alpha',
      normalizedEmail,
    ).catch(err => console.error('Google Play tester error:', err));
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});

// ── Email de confirmación al registrado ───────────────────────────

async function sendConfirmationEmail(
  apiKey: string,
  from: string,
  to: string,
): Promise<void> {
  const testingUrl = 'https://play.google.com/apps/testing/app.calendariociclismo.android';
  const storeUrl   = 'https://play.google.com/store/apps/details?id=app.calendariociclismo.android';

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;font-size:15px;line-height:1.7;color:#111;max-width:560px;margin:0 auto;padding:24px 16px">
  <p>Hola,</p>
  <p>Muy agradecido por tu interés por la app. Te mando la info de acceso.</p>
  <p>Tu incorporación al grupo de tests puede tardar unos minutos u horas. Una vez añadido, acepta el testeo en el primero de los links y luego baja la aplicación en cualquiera de los dos.</p>
  <p>Recuerda que debes estar inscrito con el mismo correo con el que usas tu móvil Android; si no, no te funcionará.</p>
  <p>
    <a href="${testingUrl}">${testingUrl}</a><br><br>
    <a href="${storeUrl}">${storeUrl}</a>
  </p>
  <p>Un saludo.</p>
</body>
</html>`;

  const text = `Hola,

Muy agradecido por tu interés por la app. Te mando la info de acceso.

Tu incorporación al grupo de tests puede tardar unos minutos u horas. Una vez añadido, acepta el testeo en el primero de los links y luego baja la aplicación en cualquiera de los dos.

Recuerda que debes estar inscrito con el mismo correo con el que usas tu móvil Android; si no, no te funcionará.

${testingUrl}

${storeUrl}

Un saludo.`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: 'Calendario Ciclismo App - Beta Android', html, text }),
    });
    if (!res.ok) console.error('Resend confirmation error:', res.status, await res.text());
  } catch (err) {
    console.error('Confirmation email exception:', err);
  }
}

// ── Google Play Closed Testing ────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key:  string;
}

async function addGooglePlayTester(
  serviceAccountJson: string,
  packageName: string,
  track: string,
  email: string,
): Promise<void> {
  const sa: ServiceAccount = JSON.parse(serviceAccountJson);
  const token = await getGoogleAccessToken(sa);

  const base    = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Crear edit
  const editRes = await fetch(`${base}/edits`, { method: 'POST', headers, body: '{}' });
  if (!editRes.ok) throw new Error(`Create edit: ${editRes.status} ${await editRes.text()}`);
  const { id: editId } = await editRes.json();

  try {
    // 2. Leer lista actual de testers del track
    const getRes = await fetch(`${base}/edits/${editId}/testers/${track}`, { headers });
    let testers: string[] = [];
    if (getRes.ok) {
      const data = await getRes.json();
      testers = data.testers ?? [];
    }
    // 404 = track sin testers aún → lista vacía, continuar igualmente

    // 3. Si ya estaba, limpiar edit y salir
    if (testers.includes(email)) {
      await fetch(`${base}/edits/${editId}`, { method: 'DELETE', headers });
      return;
    }

    // 4. Actualizar lista
    const putRes = await fetch(`${base}/edits/${editId}/testers/${track}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ testers: [...testers, email] }),
    });
    if (!putRes.ok) throw new Error(`Update testers: ${putRes.status} ${await putRes.text()}`);

    // 5. Commit
    const commitRes = await fetch(`${base}/edits/${editId}:commit`, {
      method: 'POST',
      headers,
      body: '{}',
    });
    if (!commitRes.ok) throw new Error(`Commit edit: ${commitRes.status} ${await commitRes.text()}`);
  } catch (err) {
    // Limpiar el edit huérfano antes de relanzar
    await fetch(`${base}/edits/${editId}`, { method: 'DELETE', headers }).catch(() => {});
    throw err;
  }
}

async function getGoogleAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));

  const signingInput = `${header}.${payload}`;

  const pemBody  = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64urlBytes(new Uint8Array(sig))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });

  if (!tokenRes.ok) throw new Error(`Token exchange: ${tokenRes.status} ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json();
  return access_token;
}

function b64url(str: string): string {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlBytes(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
