// ─────────────────────────────────────────────────────────────────
//  Edge Function: send-push
//  Modos de operación (campo en el body del POST):
//
//  1. Envío inmediato (comportamiento original):
//       { title, subtitle?, imageUrl?, deepLink?, category?, targetRegions?, targetPlatforms? }
//     → Requiere sesión de usuario autenticado (admin).
//     → Modo debug: si se pasa `targetToken` (deviceToken concreto), la
//       notificación se entrega SOLO a ese dispositivo, ignorando filtros
//       de región/plataforma/categoría/idioma. No se persiste en el
//       historial. Pensado para probar APNs/FCM/Web Push desde el panel.
//
//  2. Programar para más tarde:
//       { title, subtitle?, imageUrl?, deepLink?, category?, targetRegions?, targetPlatforms?, scheduledAt: "<ISO>" }
//     → Guarda en scheduled_push_notifications (status=pending) y retorna.
//     → Requiere sesión de usuario autenticado (admin).
//
//  3. Procesar programadas (invocado por pg_cron cada 5 min):
//       { processScheduled: true }
//     → Busca notificaciones pending con scheduledAt <= now() y las envía.
//     → Requiere Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> o <CRON_SECRET>.
//
//  Categorías (Fase 3 del plan 2.0): el campo `category` filtra el público
//  objetivo. Default 'general' (notificaciones gratuitas que reciben todos
//  los devices). Valores Premium: 'race_start', 'tv_start', 'results' —
//  solo se entregan a devices que las hayan activado en Ajustes.
//
//  Regiones (Fase 2 del plan 2.0, completado en Fase 3+): el campo
//  opcional `targetRegions` restringe el envío a un subset de regiones
//  (SPAIN, EUROPE, AMERICAS, ASIA, AFRICA). Si se omite o es array
//  vacío, no hay filtro de región.
//
//  Plataformas: el campo opcional `targetPlatforms` restringe el envío
//  a un subset de plataformas ('ios', 'android', 'web'). Mismo
//  semántico que targetRegions. Caso de uso típico: avisar SOLO a
//  Android cuando hay una versión nueva incompatible.
//
//  Nota: verify_jwt = false en config.toml — la función valida auth
//  internamente. Necesario para que pg_cron pueda invocar con sb_secret_*
//  keys (formato nuevo de Supabase, no son JWTs).
//
//  Variables de entorno (Supabase Dashboard → Edge Functions → send-push):
//    APNs (iOS):  APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID
//    FCM (Android): FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON
//    Web Push: VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY
// ─────────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ['general', 'race_start', 'tv_start', 'results'] as const;
type PushCategory = typeof VALID_CATEGORIES[number];
const DEFAULT_CATEGORY: PushCategory = 'general';

// Regiones válidas para targeting (Fase 2 + Fase 3+). Coincide con el
// universo de RegionPreference iOS / RegionPreference.kt Android. La
// región 'ALL' del enum cliente NO está aquí — representa "Premium full
// unlock" y se traduce a targetRegions=undefined (sin filtro).
const VALID_REGIONS = ['SPAIN', 'EUROPE', 'AMERICAS', 'ASIA', 'AFRICA'] as const;
type PushRegion = typeof VALID_REGIONS[number];

// Plataformas válidas para targeting. Coincide con el CHECK constraint
// de push_subscriptions.platform. Caso de uso típico: avisar SOLO a
// usuarios Android cuando hay una versión nueva incompatible.
const VALID_PLATFORMS = ['ios', 'android', 'web'] as const;
type PushPlatform = typeof VALID_PLATFORMS[number];

// Grupos finos `broadcasts.country` válidos para targeting. Coincide
// con el CHECK constraint de push_subscriptions.countryGroup. Caso de
// uso: cron `tv_start` envía una notificación por jornada × grupo fino
// con el horario del primer canal visible para ESE grupo.
const VALID_COUNTRY_GROUPS = [
  'ES', 'PT', 'FR', 'BE', 'NL', 'IT',
  'DE_AT_CH', 'UK_IE', 'SCANDI', 'EE',
  'NORTEAM', 'LATAM',
  'ASIAPAC', 'MENA',
  'AFRICA',
] as const;
type PushCountryGroup = typeof VALID_COUNTRY_GROUPS[number];

// Idiomas válidos para targeting. Coincide con el CHECK constraint de
// push_subscriptions.language. Caso de uso: cron emite race_start /
// tv_start / results con textos en ES y EN, y filtra por idioma del
// device para que cada usuario reciba solo la versión que entiende.
const VALID_LANGUAGES = ['es', 'en'] as const;
type PushLanguage = typeof VALID_LANGUAGES[number];

function normalizeCategory(value: unknown): PushCategory {
  if (typeof value === 'string' && (VALID_CATEGORIES as readonly string[]).includes(value)) {
    return value as PushCategory;
  }
  return DEFAULT_CATEGORY;
}

/**
 * Normaliza targetRegions del body: array de strings válidos o undefined
 * para "sin filtro". Devuelve `null` cuando el caller debe rechazar el
 * request por payload inválido. La distinción entre `undefined`
 * (= sin filtro) y `null` (= error) es deliberada y se propaga al handler.
 */
function normalizeTargetRegions(value: unknown): PushRegion[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  const out: PushRegion[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !(VALID_REGIONS as readonly string[]).includes(v)) {
      return null;
    }
    out.push(v as PushRegion);
  }
  return out;
}

/**
 * Normaliza targetPlatforms del body con la misma semántica que
 * targetRegions: array no vacío de plataformas válidas, undefined
 * (sin filtro) o null (rechazo explícito por payload inválido).
 */
function normalizeTargetPlatforms(value: unknown): PushPlatform[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  const out: PushPlatform[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !(VALID_PLATFORMS as readonly string[]).includes(v)) {
      return null;
    }
    out.push(v as PushPlatform);
  }
  return out;
}

/**
 * Normaliza targetCountryGroups del body con la misma semántica que
 * targetRegions: array no vacío de grupos finos válidos, undefined
 * (sin filtro) o null (rechazo explícito por payload inválido).
 */
function normalizeTargetCountryGroups(value: unknown): PushCountryGroup[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  const out: PushCountryGroup[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !(VALID_COUNTRY_GROUPS as readonly string[]).includes(v)) {
      return null;
    }
    out.push(v as PushCountryGroup);
  }
  return out;
}

/**
 * Normaliza targetLanguages del body con la misma semántica que los
 * otros normalizers: array no vacío de idiomas válidos, undefined
 * (sin filtro = enviar a todos los idiomas) o null (payload inválido).
 */
function normalizeTargetLanguages(value: unknown): PushLanguage[] | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return undefined;
  const out: PushLanguage[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !(VALID_LANGUAGES as readonly string[]).includes(v)) {
      return null;
    }
    out.push(v as PushLanguage);
  }
  return out;
}

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ── Helpers base64 ───────────────────────────────────────────────

/**
 * Ejecuta `task(item)` para cada elemento con un límite de concurrencia.
 * Imprescindible para que el envío a N suscriptores no degenere en un bucle
 * secuencial de N fetches que supere el timeout del cliente (Safari iOS
 * aborta con "Load failed" sobre los ~60 s). APNs (HTTP/2 multiplexado) y
 * FCM HTTP v1 soportan sin problema decenas de peticiones paralelas.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= items.length) return;
        results[i] = await task(items[i]);
      }
    }),
  );
  return results;
}

function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

// ── APNs (iOS) ───────────────────────────────────────────────────

/** Convierte la clave privada .p8 (PEM/base64 crudo) a CryptoKey ES256 */
async function importAPNsKey(pemContent: string): Promise<CryptoKey> {
  const cleaned = pemContent
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/** Genera un JWT para autenticarse con APNs */
async function createAPNsJWT(keyId: string, teamId: string, privateKey: CryptoKey): Promise<string> {
  const header = base64urlEncode(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const payload = base64urlEncode(JSON.stringify({
    iss: teamId,
    iat: Math.floor(Date.now() / 1000),
  }));
  const toSign = new TextEncoder().encode(`${header}.${payload}`);
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, toSign),
  );
  // DER → raw r||s (64 bytes)
  const rawSig = derToRaw(signature);
  return `${header}.${payload}.${base64url(rawSig)}`;
}

/** Convierte firma DER de ECDSA a formato raw (r||s, 64 bytes) */
function derToRaw(der: Uint8Array): Uint8Array {
  if (der.length === 64) return der;
  const raw = new Uint8Array(64);
  let offset = 2; // skip 0x30 + total length
  offset += 1; // skip 0x02
  const rLen = der[offset]; offset += 1;
  const rStart = offset + Math.max(0, rLen - 32);
  const rCopy = Math.min(32, rLen);
  raw.set(der.subarray(rStart, rStart + rCopy), 32 - rCopy);
  offset += rLen;
  offset += 1; // skip 0x02
  const sLen = der[offset]; offset += 1;
  const sStart = offset + Math.max(0, sLen - 32);
  const sCopy = Math.min(32, sLen);
  raw.set(der.subarray(sStart, sStart + sCopy), 64 - sCopy);
  return raw;
}

interface PushMessage {
  title: string;
  subtitle?: string;
  imageUrl?: string;
  deepLink?: string;
}

interface SendResult {
  sent: number;
  failed: number;
  invalidTokens: string[];
  softFailedTokens: string[];
  successTokens: string[];
  details: Array<{ token: string; status: string; channel: string; reason?: string }>;
}

/** Envía un mensaje a un conjunto de tokens iOS via APNs. */
async function sendApns(tokens: string[], msg: PushMessage): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, invalidTokens: [], softFailedTokens: [], successTokens: [], details: [] };
  if (tokens.length === 0) return result;

  const keyId         = Deno.env.get('APNS_KEY_ID');
  const teamId        = Deno.env.get('APNS_TEAM_ID');
  const privateKeyPem = Deno.env.get('APNS_PRIVATE_KEY');
  const bundleId      = Deno.env.get('APNS_BUNDLE_ID');

  console.log('[send-push][apns] Config — keyId:', keyId ? `${keyId.slice(0, 4)}…` : 'MISSING',
    '| teamId:', teamId ?? 'MISSING',
    '| privateKey:', privateKeyPem ? `${privateKeyPem.length} chars` : 'MISSING',
    '| bundleId:', bundleId ?? 'MISSING');

  if (!keyId || !teamId || !privateKeyPem || !bundleId) {
    console.warn('[send-push][apns] Configuración incompleta — se omiten', tokens.length, 'tokens iOS');
    result.failed = tokens.length;
    tokens.forEach(t => result.details.push({
      token: `${t.slice(0, 8)}…`, status: 'skipped_no_config', channel: 'apns',
    }));
    return result;
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await importAPNsKey(privateKeyPem);
  } catch (keyErr) {
    console.error('[send-push][apns] Error importando clave privada:', String(keyErr));
    result.failed = tokens.length;
    tokens.forEach(t => result.details.push({
      token: `${t.slice(0, 8)}…`, status: 'key_import_error', channel: 'apns', reason: String(keyErr),
    }));
    return result;
  }

  const jwt = await createAPNsJWT(keyId, teamId, privateKey);
  console.log('[send-push][apns] JWT generado (longitud:', jwt.length, ')');

  const apnsHosts = [
    'https://api.push.apple.com',          // production (TestFlight/App Store)
    'https://api.sandbox.push.apple.com',  // development (Xcode builds)
  ];

  const aps: Record<string, unknown> = {
    alert: {
      title: msg.title,
      ...(msg.subtitle ? { body: msg.subtitle } : {}),
    },
    sound: 'default',
    'mutable-content': msg.imageUrl ? 1 : 0,
  };

  const apnsPayload: Record<string, unknown> = {
    aps,
    ...(msg.deepLink ? { deepLink: msg.deepLink } : {}),
    ...(msg.imageUrl ? { imageUrl: msg.imageUrl } : {}),
  };

  const apnsHeaders = {
    'Authorization': `bearer ${jwt}`,
    'apns-topic':     bundleId,
    'apns-push-type': 'alert',
    'apns-priority':  '10',
    'Content-Type':   'application/json',
  };
  const payloadBody = JSON.stringify(apnsPayload);
  console.log('[send-push][apns] Payload:', payloadBody);

  await mapWithConcurrency(tokens, 20, async (token) => {
    let delivered = false;
    let hardBounce = false;
    let softFailed = false;
    const tokenPrefix = `${token.slice(0, 8)}…`;

    for (const host of apnsHosts) {
      const hostLabel = host.includes('sandbox') ? 'sandbox' : 'production';
      try {
        const res = await fetch(`${host}/3/device/${token}`, {
          method: 'POST',
          headers: apnsHeaders,
          body: payloadBody,
        });

        if (res.ok) {
          await res.text();
          console.log(`[send-push][apns] ✓ ${tokenPrefix} → ${hostLabel} (${res.status})`);
          result.details.push({ token: tokenPrefix, status: 'ok', channel: `apns-${hostLabel}` });
          delivered = true;
          break;
        }

        const errText = await res.text();
        let errBody: { reason?: string } = {};
        try { errBody = JSON.parse(errText); } catch { /* no JSON */ }
        const reason = errBody.reason ?? errText.slice(0, 120);
        console.warn(`[send-push][apns] ✗ ${tokenPrefix} → ${hostLabel} (${res.status}): ${reason}`);

        if (errBody.reason === 'BadDeviceToken' || errBody.reason === 'Unregistered') {
          hardBounce = true;
          break; // definitivo: no tiene sentido probar el otro host
        }
        if (res.status === 403) {
          console.error(`[send-push][apns] ⚠ 403 en ${hostLabel} — posible problema con JWT, keyId o teamId`);
          // error de infraestructura, no penalizar el token
        } else {
          softFailed = true;
        }
        if (errBody.reason === 'TopicDisallowed') {
          console.error(`[send-push][apns] ⚠ TopicDisallowed — bundleId "${bundleId}" no coincide con la clave`);
        }
        if (errBody.reason === 'ExpiredProviderToken' || errBody.reason === 'InvalidProviderToken') {
          console.error(`[send-push][apns] ⚠ JWT rechazado (${errBody.reason}) — revisar KEY_ID / TEAM_ID / PRIVATE_KEY`);
        }
      } catch (fetchErr) {
        console.error(`[send-push][apns] ✗ ${tokenPrefix} → ${hostLabel} error de red:`, String(fetchErr));
        result.details.push({
          token: tokenPrefix, status: 'network_error', channel: `apns-${hostLabel}`, reason: String(fetchErr),
        });
        softFailed = true;
      }
    }

    if (delivered) {
      result.sent++;
      result.successTokens.push(token);
    } else {
      result.failed++;
      if (hardBounce) {
        result.invalidTokens.push(token);
        result.details.push({ token: tokenPrefix, status: 'failed', channel: 'apns', reason: 'bad_token' });
      } else {
        if (softFailed) result.softFailedTokens.push(token);
        result.details.push({
          token: tokenPrefix, status: 'failed', channel: 'apns',
          reason: softFailed ? 'soft_failure' : 'auth_error',
        });
      }
    }
  });

  return result;
}

// ── FCM (Android) ────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key:  string;
  token_uri?:   string;
}

/** Importa la clave privada RSA (PKCS8 PEM) del service account */
async function importFcmKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = Uint8Array.from(atob(cleaned), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** Intercambia un JWT firmado por un access_token OAuth2 con scope FCM */
async function getFcmAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header  = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlEncode(JSON.stringify({
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  }));
  const key = await importFcmKey(sa.private_key);
  const toSign = new TextEncoder().encode(`${header}.${payload}`);
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, toSign),
  );
  const jwt = `${header}.${payload}.${base64url(signature)}`;

  const tokenRes = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`OAuth2 token exchange failed (${tokenRes.status}): ${errText}`);
  }
  const { access_token } = await tokenRes.json();
  if (typeof access_token !== 'string') {
    throw new Error('OAuth2 response missing access_token');
  }
  return access_token;
}

/** Envía un mensaje a un conjunto de tokens Android via FCM HTTP v1. */
async function sendFcm(tokens: string[], msg: PushMessage): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, invalidTokens: [], softFailedTokens: [], successTokens: [], details: [] };
  if (tokens.length === 0) return result;

  const projectId  = Deno.env.get('FCM_PROJECT_ID');
  const saJsonRaw  = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');

  console.log('[send-push][fcm] Config — projectId:', projectId ?? 'MISSING',
    '| serviceAccount:', saJsonRaw ? `${saJsonRaw.length} chars` : 'MISSING');

  if (!projectId || !saJsonRaw) {
    console.warn('[send-push][fcm] Configuración incompleta — se omiten', tokens.length, 'tokens Android');
    result.failed = tokens.length;
    tokens.forEach(t => result.details.push({
      token: `${t.slice(0, 8)}…`, status: 'skipped_no_config', channel: 'fcm',
    }));
    return result;
  }

  let sa: ServiceAccount;
  try {
    sa = JSON.parse(saJsonRaw);
  } catch (parseErr) {
    console.error('[send-push][fcm] JSON inválido en FCM_SERVICE_ACCOUNT_JSON:', String(parseErr));
    result.failed = tokens.length;
    tokens.forEach(t => result.details.push({
      token: `${t.slice(0, 8)}…`, status: 'sa_parse_error', channel: 'fcm', reason: String(parseErr),
    }));
    return result;
  }

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken(sa);
    console.log('[send-push][fcm] Access token obtenido (longitud:', accessToken.length, ')');
  } catch (authErr) {
    console.error('[send-push][fcm] Error obteniendo access token:', String(authErr));
    result.failed = tokens.length;
    tokens.forEach(t => result.details.push({
      token: `${t.slice(0, 8)}…`, status: 'auth_error', channel: 'fcm', reason: String(authErr),
    }));
    return result;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  // Los valores en `data` deben ser strings (requisito de FCM HTTP v1).
  const dataPayload: Record<string, string> = {};
  if (msg.deepLink) dataPayload.deepLink = msg.deepLink;
  if (msg.imageUrl) dataPayload.imageUrl = msg.imageUrl;

  await mapWithConcurrency(tokens, 20, async (token) => {
    const tokenPrefix = `${token.slice(0, 8)}…`;
    const message: Record<string, unknown> = {
      token,
      notification: {
        title: msg.title,
        ...(msg.subtitle ? { body: msg.subtitle } : {}),
        ...(msg.imageUrl ? { image: msg.imageUrl } : {}),
      },
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: 'races_v1',
          ...(msg.imageUrl ? { image: msg.imageUrl } : {}),
        },
      },
      ...(Object.keys(dataPayload).length > 0 ? { data: dataPayload } : {}),
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ message }),
      });

      if (res.ok) {
        await res.text();
        console.log(`[send-push][fcm] ✓ ${tokenPrefix} (${res.status})`);
        result.sent++;
        result.successTokens.push(token);
        result.details.push({ token: tokenPrefix, status: 'ok', channel: 'fcm' });
        return;
      }

      const errText = await res.text();
      let errBody: { error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> } } = {};
      try { errBody = JSON.parse(errText); } catch { /* no JSON */ }
      const status    = errBody.error?.status ?? `HTTP_${res.status}`;
      const message2  = errBody.error?.message ?? errText.slice(0, 160);
      const errorCode = errBody.error?.details?.find(d => d.errorCode)?.errorCode;

      console.warn(`[send-push][fcm] ✗ ${tokenPrefix} (${res.status} ${status}): ${message2}`);

      result.failed++;

      // 404 NOT_FOUND / UNREGISTERED → token caducado (hard bounce)
      // 400 INVALID_ARGUMENT → token inválido (hard bounce)
      const isUnregistered =
        res.status === 404 ||
        status === 'NOT_FOUND' ||
        status === 'UNREGISTERED' ||
        errorCode === 'UNREGISTERED';
      const isInvalidArg =
        (res.status === 400 && errorCode === 'INVALID_ARGUMENT') ||
        errorCode === 'INVALID_ARGUMENT';
      const isAuthError = res.status === 401 || res.status === 403;

      if (isUnregistered || isInvalidArg) {
        result.invalidTokens.push(token);
        result.details.push({ token: tokenPrefix, status: 'failed', channel: 'fcm', reason: errorCode ?? status });
      } else if (isAuthError) {
        // error de infraestructura, no penalizar el token
        result.details.push({ token: tokenPrefix, status: 'failed', channel: 'fcm', reason: status });
      } else {
        result.softFailedTokens.push(token);
        result.details.push({ token: tokenPrefix, status: 'failed', channel: 'fcm', reason: errorCode ?? status });
      }

      if (res.status === 401) {
        console.error('[send-push][fcm] ⚠ 401 — token OAuth2 inválido o expirado, revisar FCM_SERVICE_ACCOUNT_JSON');
      } else if (res.status === 403) {
        if (message2.includes('has not been used') || message2.includes('disabled')) {
          console.error('[send-push][fcm] ⚠ 403 PERMISSION_DENIED — la Firebase Cloud Messaging API está deshabilitada en el proyecto. Habilitarla en Google Cloud Console → APIs & Services.');
        } else {
          console.error('[send-push][fcm] ⚠ 403 — acceso denegado, revisar FCM_SERVICE_ACCOUNT_JSON y scope');
        }
      }
    } catch (fetchErr) {
      console.error(`[send-push][fcm] ✗ ${tokenPrefix} error de red:`, String(fetchErr));
      result.failed++;
      result.softFailedTokens.push(token);
      result.details.push({
        token: tokenPrefix, status: 'network_error', channel: 'fcm', reason: String(fetchErr),
      });
    }
  });

  return result;
}

// ── Web Push (RFC 8030 + RFC 8291 + VAPID) ───────────────────────

interface WebPushSubData {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}

function b64urlDecode(str: string): Uint8Array {
  const pad = '='.repeat((4 - str.length % 4) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

async function hkdfDerive(
  ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key, length * 8,
  ));
}

/**
 * Importa la VAPID private key desde el formato raw base64url que genera
 * `web-push generate-vapid-keys` (32-byte EC P-256 raw private key).
 * Necesita la public key para construir el JWK con x/y.
 */
async function importVapidSigningKey(privB64: string, pubB64: string): Promise<CryptoKey> {
  const priv = b64urlDecode(privB64);
  const pub  = b64urlDecode(pubB64); // 65 bytes: 0x04 | x(32) | y(32)
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      d: base64url(priv),
      x: base64url(pub.slice(1, 33)),
      y: base64url(pub.slice(33, 65)),
      key_ops: ['sign'],
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  );
}

/** VAPID JWT para un endpoint concreto (aud = origin del endpoint). */
async function createVapidJWT(
  endpoint: string, signingKey: CryptoKey,
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header  = base64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64urlEncode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12 h
    sub: 'mailto:info@calendariociclismo.app',
  }));
  const toSign = new TextEncoder().encode(`${header}.${payload}`);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, toSign),
  );
  return `${header}.${payload}.${base64url(derToRaw(sig))}`;
}

/**
 * Cifra el payload siguiendo RFC 8291 (aes128gcm).
 * Devuelve el body completo listo para enviar como application/octet-stream.
 */
async function encryptWebPushPayload(
  plaintext: string,
  p256dhB64: string,
  authB64: string,
): Promise<Uint8Array> {
  const receiverPub = b64urlDecode(p256dhB64); // 65 bytes (uncompressed P-256)
  const authSecret  = b64urlDecode(authB64);   // 16 bytes

  // Clave efímera del remitente
  const senderKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const senderPub = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey));

  // Importar clave pública del suscriptor para ECDH
  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );

  // Secreto ECDH compartido
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKP.privateKey, 256),
  );

  // Paso 1: IKM = HKDF(ikm=ecdhSecret, salt=authSecret, info=keyInfo, len=32)
  const keyInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\x00'),
    receiverPub,
    senderPub,
  );
  const ikm = await hkdfDerive(ecdhSecret, authSecret, keyInfo, 32);

  // Salt aleatorio (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Paso 2: CEK y Nonce desde IKM + salt
  const cek   = await hkdfDerive(ikm, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfDerive(ikm, salt, new TextEncoder().encode('Content-Encoding: nonce\x00'),    12);

  // Registro: plaintext || 0x02 (delimitador de padding)
  const ptBytes = new TextEncoder().encode(plaintext);
  const record  = new Uint8Array(ptBytes.length + 1);
  record.set(ptBytes);
  record[ptBytes.length] = 0x02;

  // AES-128-GCM
  const aesKey    = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record),
  );

  // Cabecera RFC 8188 aes128gcm: salt(16) || rs(4, BE, 4096) || idlen(1) || senderPub(65)
  const header = new Uint8Array(21 + senderPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = senderPub.length;
  header.set(senderPub, 21);

  return concatBytes(header, ciphertext);
}

/** Envía notificaciones a suscripciones web (Web Push Protocol). */
async function sendWebPush(webTokens: string[], msg: PushMessage): Promise<SendResult> {
  const result: SendResult = {
    sent: 0, failed: 0, invalidTokens: [], softFailedTokens: [], successTokens: [], details: [],
  };
  if (webTokens.length === 0) return result;

  const vapidPriv = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidPub  = Deno.env.get('VAPID_PUBLIC_KEY');

  console.log('[send-push][web] Config — VAPID_PRIVATE_KEY:', vapidPriv ? 'presente' : 'MISSING',
    '| VAPID_PUBLIC_KEY:', vapidPub ? 'presente' : 'MISSING');

  if (!vapidPriv || !vapidPub) {
    console.warn('[send-push][web] Configuración incompleta — se omiten', webTokens.length, 'suscripciones web');
    result.failed = webTokens.length;
    webTokens.forEach(t => result.details.push({
      token: t.slice(0, 30) + '…', status: 'skipped_no_config', channel: 'webpush',
    }));
    return result;
  }

  let signingKey: CryptoKey;
  try {
    signingKey = await importVapidSigningKey(vapidPriv, vapidPub);
  } catch (e) {
    console.error('[send-push][web] Error importando VAPID key:', String(e));
    result.failed = webTokens.length;
    webTokens.forEach(t => result.details.push({
      token: t.slice(0, 30) + '…', status: 'key_import_error', channel: 'webpush', reason: String(e),
    }));
    return result;
  }

  const payload = JSON.stringify({
    title: msg.title,
    ...(msg.subtitle ? { body: msg.subtitle } : {}),
    ...(msg.imageUrl ? { image: msg.imageUrl } : {}),
    ...(msg.deepLink ? { deepLink: msg.deepLink } : {}),
  });

  await mapWithConcurrency(webTokens, 20, async (token) => {
    const tokenPrefix = token.slice(0, 40) + '…';
    let sub: WebPushSubData;
    try {
      sub = JSON.parse(token);
      if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('campos faltantes');
    } catch (e) {
      console.warn(`[send-push][web] Token inválido (${tokenPrefix}):`, String(e));
      result.failed++;
      result.invalidTokens.push(token);
      result.details.push({ token: tokenPrefix, status: 'failed', channel: 'webpush', reason: 'invalid_format' });
      return;
    }

    try {
      const body = await encryptWebPushPayload(payload, sub.keys.p256dh, sub.keys.auth);
      const jwt  = await createVapidJWT(sub.endpoint, signingKey);

      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':     'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          'TTL':              '2419200',
          'Urgency':          'normal',
          'Authorization':    `vapid t=${jwt},k=${vapidPub}`,
        },
        body,
      });

      if (res.ok) {
        await res.text();
        console.log(`[send-push][web] ✓ ${tokenPrefix}`);
        result.sent++;
        result.successTokens.push(token);
        result.details.push({ token: tokenPrefix, status: 'ok', channel: 'webpush' });
      } else {
        const errText = await res.text();
        console.warn(`[send-push][web] ✗ ${tokenPrefix} (${res.status}): ${errText.slice(0, 100)}`);
        result.failed++;
        // 404/410 = suscripción caducada (hard bounce)
        if (res.status === 404 || res.status === 410) {
          result.invalidTokens.push(token);
          result.details.push({ token: tokenPrefix, status: 'failed', channel: 'webpush', reason: 'gone' });
        } else {
          result.softFailedTokens.push(token);
          result.details.push({
            token: tokenPrefix, status: 'failed', channel: 'webpush', reason: `HTTP_${res.status}`,
          });
        }
      }
    } catch (fetchErr) {
      console.error(`[send-push][web] ✗ ${tokenPrefix} error:`, String(fetchErr));
      result.failed++;
      result.softFailedTokens.push(token);
      result.details.push({
        token: tokenPrefix, status: 'network_error', channel: 'webpush', reason: String(fetchErr),
      });
    }
  });

  return result;
}

// ── Lógica de envío centralizada ─────────────────────────────────

interface SendSummary {
  totalSent: number;
  totalFailed: number;
  totalDevices: number;
  ios: { sent: number; failed: number };
  android: { sent: number; failed: number };
  web: { sent: number; failed: number };
  invalidTokensRemoved: number;
  softBouncesTracked: number;
}

/**
 * Obtiene los tokens activos suscritos a la categoría indicada, envía el
 * mensaje a las tres plataformas en paralelo y gestiona los bounces.
 * Reutilizado tanto por el modo inmediato como por el procesado de
 * notificaciones programadas.
 *
 * Filtrado por categoría (Fase 3): hace un inner join a
 * push_subscription_categories filtrando por `category`. Solo entrega a
 * devices que tengan esa categoría activada en sus preferencias. Cumple
 * la regla "no degradar lo gratis" porque cada device parte con
 * 'general' por defecto (backfill + trigger AFTER INSERT) y las
 * categorías Premium se añaden de forma explícita desde la app.
 */
async function doSend(
  msg: PushMessage,
  adminClient: SupabaseClient,
  category: PushCategory = DEFAULT_CATEGORY,
  targetRegions?: PushRegion[],
  targetPlatforms?: PushPlatform[],
  raceId?: string,
  raceDayId?: string,
  targetCountryGroups?: PushCountryGroup[],
  targetLanguages?: PushLanguage[],
  targetToken?: string,
): Promise<SendSummary> {
  type Sub = { deviceToken: string; platform: string | null };
  let subs: Sub[];

  // Modo debug: envío a un único deviceToken (corta-circuita el resto de filtros).
  // No requiere isActive ni que la categoría esté activada — el caso de uso es
  // verificar la entrega a un dispositivo concreto desde el panel admin.
  if (targetToken) {
    const { data: rows, error } = await adminClient
      .from('push_subscriptions')
      .select('deviceToken, platform')
      .eq('deviceToken', targetToken)
      .limit(1);
    if (error) {
      console.error('[send-push] Error consultando token debug:', error.message);
      throw error;
    }
    subs = (rows ?? []) as Sub[];
    console.log(`[send-push] Modo debug — token=${targetToken.slice(0, 12)}… encontrados: ${subs.length}`);
  } else if (raceId || raceDayId) {
    // ── Envío segmentado por carrera y/o jornada ──────────────────
    // Cuatro grupos en paralelo:
    // 1. Suscriptores individuales a esta carrera (si raceId).
    // 2. Suscriptores con filtro de grupo que incluye esta carrera (si raceId).
    // 3. Suscriptores individuales a esta jornada (si raceDayId).
    // 4. Suscriptores "follow-all" (sin restricción de carrera ni jornada).

    // Determinar filterKeys que aplican a esta carrera
    const filterKeysPromise = raceId
      ? adminClient.rpc('get_race_filter_keys', { p_race_id: raceId }).then(r => {
          if (r.error) throw r.error;
          return r.data as string[] | null;
        })
      : Promise.resolve(null as string[] | null);

    const filterKeys = await filterKeysPromise;
    const hasFilters = filterKeys && filterKeys.length > 0;

    const [directResult, filterResult, stageResult, allResult] = await Promise.all([
      // Grupo 1: siguen esta carrera individualmente
      raceId
        ? (() => {
            let q = adminClient
              .from('push_subscriptions')
              .select('deviceToken, platform, push_subscription_categories!inner(category), push_race_subscriptions!inner(raceId)')
              .eq('isActive', true)
              .eq('push_subscription_categories.category', category)
              .eq('push_race_subscriptions.raceId', raceId);
            if (targetCountryGroups && targetCountryGroups.length > 0) q = q.in('countryGroup', targetCountryGroups);
            if (targetLanguages && targetLanguages.length > 0) q = q.in('language', targetLanguages);
            return q.then(r => { if (r.error) throw r.error; return (r.data ?? []) as Sub[]; });
          })()
        : Promise.resolve([] as Sub[]),

      // Grupo 2: filtros de grupo que coinciden
      hasFilters && filterKeys
        ? (() => {
            let q = adminClient
              .from('push_subscriptions')
              .select('deviceToken, platform, push_subscription_categories!inner(category), push_race_filters!inner(filterKey)')
              .eq('isActive', true)
              .eq('push_subscription_categories.category', category)
              .in('push_race_filters.filterKey', filterKeys);
            if (targetCountryGroups && targetCountryGroups.length > 0) q = q.in('countryGroup', targetCountryGroups);
            if (targetLanguages && targetLanguages.length > 0) q = q.in('language', targetLanguages);
            return q.then(r => { if (r.error) throw r.error; return (r.data ?? []) as Sub[]; });
          })()
        : Promise.resolve([] as Sub[]),

      // Grupo 3: siguen esta jornada individualmente
      raceDayId
        ? (() => {
            let q = adminClient
              .from('push_subscriptions')
              .select('deviceToken, platform, push_subscription_categories!inner(category), push_stage_subscriptions!inner(raceDayId)')
              .eq('isActive', true)
              .eq('push_subscription_categories.category', category)
              .eq('push_stage_subscriptions.raceDayId', raceDayId);
            if (targetLanguages && targetLanguages.length > 0) q = q.in('language', targetLanguages);
            return q.then(r => { if (r.error) throw r.error; return (r.data ?? []) as Sub[]; });
          })()
        : Promise.resolve([] as Sub[]),

      // Grupo 4: follow-all (sin restricción de carrera) — comportamiento actual
      adminClient
        .rpc('get_unrestricted_push_subscribers', {
          p_category:  category,
          p_regions:   targetRegions  && targetRegions.length  > 0 ? targetRegions  : null,
          p_platforms: targetPlatforms && targetPlatforms.length > 0 ? targetPlatforms : null,
        })
        .then(r => {
          if (r.error) throw r.error;
          let rows = (r.data ?? []) as Sub[];
          // El RPC actual no acepta countryGroup; aplicamos el filtro
          // adicional en cliente. Cuando los suscriptores follow-all
          // sin countryGroup poblado pasen a tener uno, este filtro
          // los excluirá correctamente (deseado para tv_start segmentado).
          if (targetCountryGroups && targetCountryGroups.length > 0) {
            // get_unrestricted_push_subscribers no devuelve countryGroup,
            // así que necesitamos una query adicional para conocer los
            // tokens cuyo countryGroup coincide. Optimizamos pidiéndolos
            // como SET una sola vez.
            // (Se sobreescribe abajo cuando esté la lista.)
          }
          return rows;
        }),
    ]);

    // Si hay filtro de countryGroup o language, recortamos el grupo
    // follow-all consultando una vez la tabla con ambos filtros. Las
    // dos columnas (countryGroup y language) viven en push_subscriptions
    // y no las expone get_unrestricted_push_subscribers, así que las
    // aplicamos aquí en cliente.
    let allResultFiltered: Sub[] = allResult;
    const needsCountryGroupFilter = targetCountryGroups && targetCountryGroups.length > 0;
    const needsLanguageFilter     = targetLanguages     && targetLanguages.length     > 0;
    if ((needsCountryGroupFilter || needsLanguageFilter) && allResult.length > 0) {
      const candidateTokens = allResult.map(s => s.deviceToken);
      let q = adminClient
        .from('push_subscriptions')
        .select('deviceToken')
        .eq('isActive', true)
        .in('deviceToken', candidateTokens);
      if (needsCountryGroupFilter) q = q.in('countryGroup', targetCountryGroups!);
      if (needsLanguageFilter)     q = q.in('language',     targetLanguages!);
      const { data: filtRows, error: filtError } = await q;
      if (filtError) {
        console.error('[send-push] Error filtrando follow-all por countryGroup/language:', filtError.message);
        throw filtError;
      }
      const allowed = new Set((filtRows ?? []).map((r: { deviceToken: string }) => r.deviceToken));
      allResultFiltered = allResult.filter(s => allowed.has(s.deviceToken));
    }

    // Deduplicar por deviceToken (un mismo token podría aparecer en varios grupos)
    const seen = new Set<string>();
    subs = [...directResult, ...filterResult, ...stageResult, ...allResultFiltered].filter(s => {
      if (seen.has(s.deviceToken)) return false;
      seen.add(s.deviceToken);
      return true;
    });
  } else {
    // ── Envío broadcast (comportamiento original sin restricción de carrera) ──
    let query = adminClient
      .from('push_subscriptions')
      .select('deviceToken, platform, push_subscription_categories!inner(category)')
      .eq('isActive', true)
      .eq('push_subscription_categories.category', category);

    if (targetRegions && targetRegions.length > 0) {
      query = query.in('region', targetRegions);
    }
    if (targetPlatforms && targetPlatforms.length > 0) {
      query = query.in('platform', targetPlatforms);
    }
    if (targetCountryGroups && targetCountryGroups.length > 0) {
      query = query.in('countryGroup', targetCountryGroups);
    }
    if (targetLanguages && targetLanguages.length > 0) {
      query = query.in('language', targetLanguages);
    }

    const { data: subscriptions, error: subError } = await query;
    if (subError) {
      console.error('[send-push] Error consultando push_subscriptions:', subError.message);
      throw subError;
    }
    subs = (subscriptions ?? []) as Sub[];
  }

  const iosTokens     = subs.filter(s => !s.platform || s.platform === 'ios').map(s => s.deviceToken);
  const androidTokens = subs.filter(s => s.platform === 'android').map(s => s.deviceToken);
  const webTokens     = subs.filter(s => s.platform === 'web').map(s => s.deviceToken);

  const regionLabel = targetRegions && targetRegions.length > 0
    ? targetRegions.join(',')
    : 'ALL';
  const platformLabel = targetPlatforms && targetPlatforms.length > 0
    ? targetPlatforms.join(',')
    : 'ALL';
  const countryGroupLabel = targetCountryGroups && targetCountryGroups.length > 0
    ? targetCountryGroups.join(',')
    : 'ALL';
  const languageLabel = targetLanguages && targetLanguages.length > 0
    ? targetLanguages.join(',')
    : 'ALL';
  const raceLabel = raceId ? ` | Carrera: ${raceId}` : '';
  const stageLabel = raceDayId ? ` | Jornada: ${raceDayId}` : '';
  const debugLabel = targetToken ? ` | DEBUG token=${targetToken.slice(0, 12)}…` : '';
  console.log(`[send-push] Categoría: ${category} | Regiones: ${regionLabel} | Plataformas: ${platformLabel} | Grupos: ${countryGroupLabel} | Idiomas: ${languageLabel}${raceLabel}${stageLabel}${debugLabel} | Tokens — iOS: ${iosTokens.length}, Android: ${androidTokens.length}, Web: ${webTokens.length}`);

  const [apnsResult, fcmResult, webResult] = await Promise.all([
    sendApns(iosTokens, msg),
    sendFcm(androidTokens, msg),
    sendWebPush(webTokens, msg),
  ]);

  const totalSent        = apnsResult.sent + fcmResult.sent + webResult.sent;
  const totalFailed      = apnsResult.failed + fcmResult.failed + webResult.failed;
  const invalidTokens    = [...apnsResult.invalidTokens, ...fcmResult.invalidTokens, ...webResult.invalidTokens];
  const softFailedTokens = [...apnsResult.softFailedTokens, ...fcmResult.softFailedTokens, ...webResult.softFailedTokens];
  const successTokens    = [...apnsResult.successTokens, ...fcmResult.successTokens, ...webResult.successTokens];

  console.log(`[send-push] Resumen — enviados: ${totalSent} | fallidos: ${totalFailed} | hard: ${invalidTokens.length} | soft: ${softFailedTokens.length}`);

  if (invalidTokens.length > 0) {
    const { error } = await adminClient
      .from('push_subscriptions')
      .update({ isActive: false, updatedAt: new Date().toISOString() })
      .in('deviceToken', invalidTokens);
    if (error) console.error('[send-push] Error desactivando tokens:', error.message);
  }
  if (softFailedTokens.length > 0) {
    const { error } = await adminClient.rpc('increment_push_fail_count', { p_tokens: softFailedTokens });
    if (error) console.error('[send-push] Error incrementando failCount:', error.message);
  }
  if (successTokens.length > 0) {
    const { error } = await adminClient.rpc('reset_push_fail_count', { p_tokens: successTokens });
    if (error) console.error('[send-push] Error reseteando failCount:', error.message);
  }

  return {
    totalSent, totalFailed, totalDevices: subs.length,
    ios:     { sent: apnsResult.sent, failed: apnsResult.failed },
    android: { sent: fcmResult.sent,  failed: fcmResult.failed  },
    web:     { sent: webResult.sent,  failed: webResult.failed  },
    invalidTokensRemoved: invalidTokens.length,
    softBouncesTracked:   softFailedTokens.length,
  };
}

/** Inserta un registro en push_notifications (historial de envíos). */
async function recordSent(
  msg: PushMessage,
  sentBy: string | null,
  recipientCount: number,
  adminClient: SupabaseClient,
  category: PushCategory = DEFAULT_CATEGORY,
  targetRegions?: PushRegion[],
  targetPlatforms?: PushPlatform[],
  raceId?: string,
  raceDayId?: string,
  targetCountryGroups?: PushCountryGroup[],
  targetLanguages?: PushLanguage[],
): Promise<void> {
  const { error } = await adminClient.from('push_notifications').insert({
    title:               msg.title,
    subtitle:            msg.subtitle  || null,
    imageUrl:            msg.imageUrl  || null,
    deepLink:            msg.deepLink  || null,
    category,
    targetRegions:       targetRegions && targetRegions.length > 0 ? targetRegions : null,
    targetPlatforms:     targetPlatforms && targetPlatforms.length > 0 ? targetPlatforms : null,
    targetCountryGroups: targetCountryGroups && targetCountryGroups.length > 0 ? targetCountryGroups : null,
    targetLanguages:     targetLanguages && targetLanguages.length > 0 ? targetLanguages : null,
    raceId:              raceId    ?? null,
    raceDayId:           raceDayId ?? null,
    sentBy,
    recipientCount,
  });
  if (error) console.error('[send-push] Error registrando en historial:', error.message);
}

// ── Modo: procesar notificaciones programadas ─────────────────────

interface ScheduledRow {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  deepLink: string | null;
  category: string | null;
  targetRegions: string[] | null;
  targetPlatforms: string[] | null;
  targetCountryGroups: string[] | null;
  targetLanguages: string[] | null;
  raceId: string | null;
  raceDayId: string | null;
  scheduledAt: string;
  createdBy: string | null;
}

async function handleProcessScheduled(adminClient: SupabaseClient): Promise<Response> {
  const madridHour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date()));

  if (madridHour < 8 || madridHour >= 22) {
    console.log(`[send-push][cron] Fuera de la franja 08:00–22:00 Europe/Madrid (${madridHour}:xx); no se procesan notificaciones`);
    return new Response(JSON.stringify({ ok: true, processed: 0, skipped: 'outside_delivery_window' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  console.log('[send-push][cron] ── Procesando notificaciones programadas ──');
  const now = new Date().toISOString();

  // Reclamar atómicamente todas las pendientes que ya tocaba enviar.
  // El filtro status='pending' en el UPDATE evita que dos runners concurrentes
  // procesen la misma notificación.
  const { data: claimed, error: claimError } = await adminClient
    .from('scheduled_push_notifications')
    .update({ status: 'processing' })
    .eq('status', 'pending')
    .lte('scheduledAt', now)
    .select('id, title, subtitle, imageUrl, deepLink, category, targetRegions, targetPlatforms, targetCountryGroups, targetLanguages, raceId, raceDayId, scheduledAt, createdBy');

  if (claimError) {
    console.error('[send-push][cron] Error reclamando notificaciones:', claimError.message);
    throw claimError;
  }

  const rows: ScheduledRow[] = claimed ?? [];
  console.log('[send-push][cron] Notificaciones reclamadas:', rows.length);

  if (rows.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const results: Array<{ id: string; status: string; sent?: number; error?: string }> = [];

  for (const row of rows) {
    const category = normalizeCategory(row.category);
    // Filtra elementos no válidos por defensa: si en algún momento la
    // BD termina con un targetRegions corrupto, no abortamos el lote.
    const targetRegions = (row.targetRegions ?? []).filter(
      (r): r is PushRegion => (VALID_REGIONS as readonly string[]).includes(r),
    );
    const targetRegionsArg = targetRegions.length > 0 ? targetRegions : undefined;
    const regionLabel = targetRegionsArg ? targetRegionsArg.join(',') : 'ALL';
    const targetPlatforms = (row.targetPlatforms ?? []).filter(
      (p): p is PushPlatform => (VALID_PLATFORMS as readonly string[]).includes(p),
    );
    const targetPlatformsArg = targetPlatforms.length > 0 ? targetPlatforms : undefined;
    const platformLabel = targetPlatformsArg ? targetPlatformsArg.join(',') : 'ALL';
    const targetCountryGroups = (row.targetCountryGroups ?? []).filter(
      (g): g is PushCountryGroup => (VALID_COUNTRY_GROUPS as readonly string[]).includes(g),
    );
    const targetCountryGroupsArg = targetCountryGroups.length > 0 ? targetCountryGroups : undefined;
    const countryGroupLabel = targetCountryGroupsArg ? targetCountryGroupsArg.join(',') : 'ALL';
    const targetLanguages = (row.targetLanguages ?? []).filter(
      (l): l is PushLanguage => (VALID_LANGUAGES as readonly string[]).includes(l),
    );
    const targetLanguagesArg = targetLanguages.length > 0 ? targetLanguages : undefined;
    const languageLabel = targetLanguagesArg ? targetLanguagesArg.join(',') : 'ALL';
    const raceIdArg    = row.raceId    ?? undefined;
    const raceDayIdArg = row.raceDayId ?? undefined;
    const raceLabel  = raceIdArg    ? ` | carrera: ${raceIdArg}`   : '';
    const stageLabel = raceDayIdArg ? ` | jornada: ${raceDayIdArg}` : '';
    console.log(`[send-push][cron] Procesando ${row.id} — "${row.title}" (programada: ${row.scheduledAt}, categoría: ${category}, regiones: ${regionLabel}, plataformas: ${platformLabel}, grupos: ${countryGroupLabel}, idiomas: ${languageLabel}${raceLabel}${stageLabel})`);
    const msg: PushMessage = {
      title:    row.title,
      subtitle: row.subtitle  ?? undefined,
      imageUrl: row.imageUrl  ?? undefined,
      deepLink: row.deepLink  ?? undefined,
    };

    try {
      const summary = await doSend(msg, adminClient, category, targetRegionsArg, targetPlatformsArg, raceIdArg, raceDayIdArg, targetCountryGroupsArg, targetLanguagesArg);
      const sentAt  = new Date().toISOString();

      await adminClient
        .from('scheduled_push_notifications')
        .update({ status: 'sent', sentAt, recipientCount: summary.totalSent })
        .eq('id', row.id);

      await recordSent(msg, row.createdBy, summary.totalSent, adminClient, category, targetRegionsArg, targetPlatformsArg, raceIdArg, raceDayIdArg, targetCountryGroupsArg, targetLanguagesArg);

      results.push({ id: row.id, status: 'sent', sent: summary.totalSent });
      console.log(`[send-push][cron] ✓ ${row.id} enviada a ${summary.totalSent} dispositivos`);
    } catch (err) {
      const errMsg = String(err);
      console.error(`[send-push][cron] ✗ ${row.id} falló:`, errMsg);
      await adminClient
        .from('scheduled_push_notifications')
        .update({ status: 'failed', errorMessage: errMsg })
        .eq('id', row.id);
      results.push({ id: row.id, status: 'failed', error: errMsg });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: rows.length, results }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Handler principal ────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    console.log('[send-push] ── Inicio de invocación ──');

    const supabaseUrl        = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader         = req.headers.get('Authorization') ?? '';

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Ensure pg_cron_config has the correct service_role_key for pg_cron to use
    if (supabaseServiceKey) {
      const { error: configError } = await adminClient
        .from('pg_cron_config')
        .upsert({
          key: 'supabase_service_role_key',
          value: supabaseServiceKey,
          description: 'Service role key for pg_cron (auto-populated)',
        });
      if (configError) {
        console.warn('[send-push] Warning: could not update pg_cron_config:', configError.message);
      }
    }

    // Leer payload
    const body = await req.json();

    // ── Modo 3: processScheduled — invocado por pg_cron o GitHub Actions ──
    // Acepta dos métodos de autenticación:
    // 1. service_role_key (recomendado): invocación interna desde pg_cron
    // 2. CRON_SECRET (alternativo): invocación desde GitHub Actions
    if (body.processScheduled) {
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const cronSecret = Deno.env.get('CRON_SECRET');

      const isServiceRoleAuth = serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`;
      const isCronSecretAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

      if (!isServiceRoleAuth && !isCronSecretAuth) {
        console.warn('[send-push] processScheduled rechazado — autenticación inválida');
        return new Response(JSON.stringify({ error: 'No autorizado' }), {
          status: 401,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const authMethod = isServiceRoleAuth ? 'service_role_key' : 'CRON_SECRET';
      console.log(`[send-push] processScheduled autenticado vía ${authMethod}`);
      return await handleProcessScheduled(adminClient);
    }

    // ── Modos 1 y 2: requieren sesión de usuario autenticado (admin) ──
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      console.error('[send-push] Auth fallida:', authError?.message ?? 'sin usuario');
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
    console.log('[send-push] Usuario autenticado:', user.email);

    const { title, subtitle, imageUrl, deepLink, scheduledAt } = body;
    if (!title) {
      return new Response(JSON.stringify({ error: 'El título es obligatorio' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Validación estricta de category: si viene un valor desconocido, error
    // explícito en lugar de cae al default silencioso (más fácil de debugear
    // si el panel admin se desincroniza).
    let category: PushCategory = DEFAULT_CATEGORY;
    if (body.category !== undefined && body.category !== null && body.category !== '') {
      if (typeof body.category !== 'string'
          || !(VALID_CATEGORIES as readonly string[]).includes(body.category)) {
        return new Response(JSON.stringify({
          error: `category inválida — esperado uno de: ${VALID_CATEGORIES.join(', ')}`,
        }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      category = body.category as PushCategory;
    }

    // Validación de targetRegions: opcional, si viene debe ser array
    // no vacío de regiones válidas. `null` significa rechazo explícito;
    // `undefined` significa "sin filtro" (default legacy).
    const targetRegions = normalizeTargetRegions(body.targetRegions);
    if (targetRegions === null) {
      return new Response(JSON.stringify({
        error: `targetRegions inválido — esperado array no vacío de: ${VALID_REGIONS.join(', ')}`,
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Validación de targetPlatforms: misma semántica que targetRegions.
    const targetPlatforms = normalizeTargetPlatforms(body.targetPlatforms);
    if (targetPlatforms === null) {
      return new Response(JSON.stringify({
        error: `targetPlatforms inválido — esperado array no vacío de: ${VALID_PLATFORMS.join(', ')}`,
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Validación de targetCountryGroups: misma semántica que
    // targetRegions/targetPlatforms. Filtra contra
    // push_subscriptions.countryGroup (grupo fino derivado de la TZ).
    const targetCountryGroups = normalizeTargetCountryGroups(body.targetCountryGroups);
    if (targetCountryGroups === null) {
      return new Response(JSON.stringify({
        error: `targetCountryGroups inválido — esperado array no vacío de: ${VALID_COUNTRY_GROUPS.join(', ')}`,
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Validación de targetLanguages: filtra contra push_subscriptions.language.
    const targetLanguages = normalizeTargetLanguages(body.targetLanguages);
    if (targetLanguages === null) {
      return new Response(JSON.stringify({
        error: `targetLanguages inválido — esperado array no vacío de: ${VALID_LANGUAGES.join(', ')}`,
      }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Modo debug single-token: dispara una notificación únicamente al
    // deviceToken indicado. Caso de uso: probar APNs/FCM/Web Push desde
    // el panel admin sin molestar al resto de suscriptores. Solo válido
    // en envío inmediato; no se persiste en el historial.
    let targetToken: string | undefined;
    if (body.targetToken !== undefined && body.targetToken !== null && body.targetToken !== '') {
      if (typeof body.targetToken !== 'string' || body.targetToken.length < 16) {
        return new Response(JSON.stringify({
          error: 'targetToken inválido — esperado deviceToken (string) de al menos 16 caracteres',
        }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      targetToken = body.targetToken;
    }

    // ── Modo 2: programar para más tarde ──────────────────────────
    if (scheduledAt) {
      if (targetToken) {
        return new Response(JSON.stringify({
          error: 'targetToken (debug) no compatible con scheduledAt — solo envío inmediato',
        }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      const scheduled = new Date(scheduledAt);
      if (isNaN(scheduled.getTime())) {
        return new Response(JSON.stringify({ error: 'scheduledAt no es una fecha válida' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      if (scheduled <= new Date()) {
        return new Response(JSON.stringify({ error: 'scheduledAt debe ser en el futuro' }), {
          status: 400,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      const regionLabelScheduled = targetRegions ? targetRegions.join(',') : 'ALL';
      const platformLabelScheduled = targetPlatforms ? targetPlatforms.join(',') : 'ALL';
      const countryGroupLabelScheduled = targetCountryGroups ? targetCountryGroups.join(',') : 'ALL';
      const languageLabelScheduled = targetLanguages ? targetLanguages.join(',') : 'ALL';
      console.log(`[send-push] Programando notificación para: ${scheduledAt} (categoría: ${category}, regiones: ${regionLabelScheduled}, plataformas: ${platformLabelScheduled}, grupos: ${countryGroupLabelScheduled}, idiomas: ${languageLabelScheduled})`);
      const { data, error: insertError } = await adminClient
        .from('scheduled_push_notifications')
        .insert({
          title,
          subtitle:            subtitle      || null,
          imageUrl:            imageUrl      || null,
          deepLink:            deepLink      || null,
          category,
          targetRegions:       targetRegions ?? null,
          targetPlatforms:     targetPlatforms ?? null,
          targetCountryGroups: targetCountryGroups ?? null,
          targetLanguages:     targetLanguages ?? null,
          scheduledAt:         scheduled.toISOString(),
          createdBy:           user.email,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      console.log('[send-push] Notificación programada, id:', data.id);

      return new Response(JSON.stringify({ ok: true, scheduled: data }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── Modo 1: envío inmediato ───────────────────────────────────
    const regionLabelImmediate = targetRegions ? targetRegions.join(',') : 'ALL';
    const platformLabelImmediate = targetPlatforms ? targetPlatforms.join(',') : 'ALL';
    const countryGroupLabelImmediate = targetCountryGroups ? targetCountryGroups.join(',') : 'ALL';
    const languageLabelImmediate = targetLanguages ? targetLanguages.join(',') : 'ALL';
    const debugLabelImmediate = targetToken ? ` | DEBUG token=${targetToken.slice(0, 12)}…` : '';
    console.log(`[send-push] Envío inmediato (categoría: ${category}, regiones: ${regionLabelImmediate}, plataformas: ${platformLabelImmediate}, grupos: ${countryGroupLabelImmediate}, idiomas: ${languageLabelImmediate}${debugLabelImmediate}):`, JSON.stringify({ title, subtitle, imageUrl, deepLink }));
    const msg: PushMessage = { title, subtitle, imageUrl, deepLink };
    const summary = await doSend(msg, adminClient, category, targetRegions ?? undefined, targetPlatforms ?? undefined, undefined, undefined, targetCountryGroups ?? undefined, targetLanguages ?? undefined, targetToken);
    // En modo debug no contaminamos el historial público de notificaciones.
    if (!targetToken) {
      await recordSent(msg, user.email, summary.totalSent, adminClient, category, targetRegions ?? undefined, targetPlatforms ?? undefined, undefined, undefined, targetCountryGroups ?? undefined, targetLanguages ?? undefined);
    }

    const result = {
      ok: true,
      sent:                 summary.totalSent,
      failed:               summary.totalFailed,
      ios:                  summary.ios,
      android:              summary.android,
      web:                  summary.web,
      invalidTokensRemoved: summary.invalidTokensRemoved,
      softBouncesTracked:   summary.softBouncesTracked,
      totalDevices:         summary.totalDevices,
    };
    console.log('[send-push] ── Respuesta final ──', JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[send-push] ── Error no controlado ──', String(err), err instanceof Error ? err.stack : '');
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
