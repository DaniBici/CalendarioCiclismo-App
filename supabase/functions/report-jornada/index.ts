// ─────────────────────────────────────────────────────────────────
//  Edge Function: report-jornada
//  Guarda el reporte en la tabla `reports` y envía un email al admin.
//
//  Variables de entorno necesarias (Supabase Dashboard → Settings → Edge Functions):
//    RESEND_API_KEY   — API key de Resend (https://resend.com)
//    NOTIFY_EMAIL     — Dirección de email del administrador
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_TYPES = new Set(['horario', 'tv', 'recorrido', 'cancelacion', 'otro']);

const TYPE_LABELS: Record<string, string> = {
  horario:     'Horario incorrecto',
  tv:          'Televisión / streaming',
  recorrido:   'Recorrido / perfil',
  cancelacion: 'Cancelación o aplazamiento',
  otro:        'Otro',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ── Configuración antifraude ─────────────────────────────────────
const RATE_LIMIT_MAX      = 5;    // máx. reportes por IP
const RATE_LIMIT_WINDOW_S = 3600; // ventana en segundos (1 hora)

Deno.serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Extraer IP del cliente ───────────────────────────────────────
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  const userAgent = req.headers.get('user-agent') ?? '';

  // ── Parsear body ────────────────────────────────────────────────
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { raceDayId, raceDayName, reportType, message, reporterName, reporterEmail, _hp } = body;

  // ── Honeypot: los bots suelen rellenar campos ocultos ───────────
  if (_hp) {
    // Devolvemos 200 para no revelar que el envío fue descartado
    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Validar campos ──────────────────────────────────────────────
  if (!raceDayId || !raceDayName || !reportType || !message || !reporterName || !reporterEmail) {
    return new Response(JSON.stringify({ error: 'Faltan campos obligatorios' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (!ALLOWED_TYPES.has(reportType)) {
    return new Response(JSON.stringify({ error: 'Tipo de reporte no válido' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (message.trim().length < 5 || message.length > 2000) {
    return new Response(JSON.stringify({ error: 'Mensaje fuera de rango' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  if (reporterName.trim().length < 2 || reporterName.length > 120) {
    return new Response(JSON.stringify({ error: 'Nombre fuera de rango' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(reporterEmail) || reporterEmail.length > 254) {
    return new Response(JSON.stringify({ error: 'Email no válido' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Cliente Supabase (service role) ─────────────────────────────
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Rate limiting por IP ─────────────────────────────────────────
  if (ip !== 'unknown') {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_S * 1000).toISOString();
    const { count, error: countError } = await supabase
      .from('reports')
      .select('id', { count: 'exact', head: true })
      .eq('ip_address', ip)
      .gte('created_at', windowStart);

    if (!countError && count !== null && count >= RATE_LIMIT_MAX) {
      return new Response(
        JSON.stringify({ error: 'Demasiados reportes. Inténtalo más tarde.' }),
        { status: 429, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': String(RATE_LIMIT_WINDOW_S) } },
      );
    }
  }

  // ── Guardar en Supabase ─────────────────────────────────────────
  const { error: dbError } = await supabase.from('reports').insert({
    race_day_id:    raceDayId,
    race_day_name:  raceDayName,
    report_type:    reportType,
    message:        message.trim(),
    reporter_name:  reporterName.trim(),
    reporter_email: reporterEmail.trim().toLowerCase(),
    ip_address:     ip,
    user_agent:     userAgent,
  });

  if (dbError) {
    console.error('DB insert error:', dbError);
    return new Response(JSON.stringify({ error: 'Error al guardar el reporte' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  // ── Enviar email de notificación (Resend) ───────────────────────
  const resendKey   = Deno.env.get('RESEND_API_KEY');
  const notifyEmail = Deno.env.get('NOTIFY_EMAIL');

  if (resendKey && notifyEmail) {
    const typeLabel  = TYPE_LABELS[reportType] ?? reportType;
    const emailBody  = `
<h2 style="margin:0 0 16px">Nuevo reporte en Calendario Ciclismo</h2>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap"><strong>Remitente</strong></td><td>${escHtml(reporterName.trim())} &lt;<a href="mailto:${escHtml(reporterEmail.trim())}">${escHtml(reporterEmail.trim())}</a>&gt;</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap"><strong>Jornada</strong></td><td>${escHtml(raceDayName)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap"><strong>ID</strong></td><td><code>${escHtml(raceDayId)}</code></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap"><strong>Tipo</strong></td><td>${escHtml(typeLabel)}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top"><strong>Mensaje</strong></td><td style="white-space:pre-wrap">${escHtml(message.trim())}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap"><strong>IP</strong></td><td><code>${escHtml(ip)}</code></td></tr>
</table>
    `.trim();

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    Deno.env.get('RESEND_FROM') ?? 'onboarding@resend.dev',
          to:      [notifyEmail],
          subject: `[Reporte] ${typeLabel} — ${raceDayName} (${reporterName.trim()})`,
          html:    emailBody,
        }),
      });
      if (!res.ok) {
        const detail = await res.text();
        console.error('Resend error:', res.status, detail);
      }
    } catch (emailErr) {
      // El email es best-effort; no fallamos la petición si falla el envío
      console.error('Email send exception:', emailErr);
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
