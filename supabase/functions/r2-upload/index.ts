// ─────────────────────────────────────────────────────────────────
//  Edge Function: r2-upload
//  Proxy de subida/borrado/listado de archivos en Cloudflare R2.
//  Evita exponer credenciales R2 en el cliente y elimina problemas
//  de CORS al hacer fetch directo al endpoint S3 de R2.
//
//  Variables de entorno necesarias (Supabase Dashboard → Settings → Edge Functions):
//    R2_ENDPOINT   — https://<account>.r2.cloudflarestorage.com
//    R2_BUCKET     — nombre del bucket
//    R2_ACCESS_KEY — access key ID
//    R2_SECRET_KEY — secret access key
// ─────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-action, x-filename',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PROFILE_DOWNLOAD_SIZE = 25 * 1024 * 1024; // 25 MB

// ── AWS4-HMAC-SHA256 signing helpers ─────────────────────────────
async function hmacSHA256(key: ArrayBuffer | Uint8Array | string, data: string): Promise<Uint8Array> {
  const k = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data)));
}

async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signRequest(
  method: string,
  path: string,
  query: string,
  headers: Record<string, string>,
  signedHeaderNames: string,
  payloadHash: string,
  endpoint: string,
  accessKey: string,
  secretKey: string,
): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  // Inject amzDate into headers
  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = payloadHash;

  const sortedHeaderKeys = signedHeaderNames.split(';').sort();
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';
  const sortedSignedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [method, path, query, canonicalHeaders, sortedSignedHeaders, payloadHash].join('\n');
  const credScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const strToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${await sha256Hex(canonicalRequest)}`;

  const kDate = await hmacSHA256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, service);
  const kSigning = await hmacSHA256(kService, 'aws4_request');
  const signature = toHex(await hmacSHA256(kSigning, strToSign));

  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${sortedSignedHeaders}, Signature=${signature}`;
}

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

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Auth check
  if (!(await verifyAuth(req))) {
    return jsonRes({ error: 'No autorizado' }, 401);
  }

  const R2_ENDPOINT  = Deno.env.get('R2_ENDPOINT')!;
  const R2_BUCKET    = Deno.env.get('R2_BUCKET')!;
  const R2_ACCESS_KEY = Deno.env.get('R2_ACCESS_KEY')!;
  const R2_SECRET_KEY = Deno.env.get('R2_SECRET_KEY')!;
  const host = R2_ENDPOINT.replace('https://', '');

  const action = req.headers.get('x-action') || 'upload';

  // ── DOWNLOAD PROFILE (GET) ────────────────────────────────────
  // El CDN público duplica Access-Control-Allow-Origin y los fetch() del
  // navegador fallan. Este proxy autenticado permite a PDF.js leer únicamente
  // los PDF canónicos de perfil, sin convertir la función en un proxy R2 libre.
  if (req.method === 'GET' && action === 'download-profile') {
    const rawFilename = req.headers.get('x-filename');
    const filename = rawFilename ? decodeURIComponent(rawFilename) : null;
    if (!filename
      || filename.includes('..')
      || !/^races\/.+\/profile(?:-\d+)?\.pdf$/i.test(filename)) {
      return jsonRes({ error: 'Solo se pueden descargar PDF canónicos de perfil' }, 400);
    }

    const path = `/${R2_BUCKET}/${filename}`;
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const headers: Record<string, string> = { 'host': host };
    const signedHeaderNames = 'host;x-amz-content-sha256;x-amz-date';
    const authorization = await signRequest(
      'GET', path, '', headers, signedHeaderNames, emptyHash,
      R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY,
    );
    const r2Res = await fetch(`${R2_ENDPOINT}${path}`, {
      headers: {
        'x-amz-content-sha256': headers['x-amz-content-sha256'],
        'x-amz-date': headers['x-amz-date'],
        'Authorization': authorization,
      },
    });
    if (!r2Res.ok) {
      return jsonRes({ error: `R2 error ${r2Res.status}` }, r2Res.status === 404 ? 404 : 502);
    }
    const contentLength = Number(r2Res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_PROFILE_DOWNLOAD_SIZE) {
      await r2Res.body?.cancel();
      return jsonRes({ error: 'Perfil PDF demasiado grande (máx 25 MB)' }, 413);
    }
    return new Response(r2Res.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/pdf',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  // Las guías técnicas pueden medir hasta 100 MB. No deben atravesar esta Edge
  // Function (que tendría que bufferizarlas): se entrega una URL PUT de R2 de
  // vida corta, limitada a la clave y Content-Type solicitados.
  if (req.method === 'POST' && action === 'sign-upload') {
    const rawFilename = req.headers.get('x-filename');
    const filename = rawFilename ? decodeURIComponent(rawFilename) : null;
    const contentType = req.headers.get('content-type') || 'application/octet-stream';
    if (!filename || !filename.startsWith('races/') || !/\/technicalGuide(?:-\d+)?\.pdf$/i.test(filename)) {
      return jsonRes({ error: 'Solo se pueden firmar guías técnicas PDF canónicas' }, 400);
    }
    if (contentType !== 'application/pdf') {
      return jsonRes({ error: 'La guía técnica debe ser un PDF' }, 400);
    }
    const url = new URL(`${R2_ENDPOINT}/${R2_BUCKET}/${filename}`);
    url.searchParams.set('X-Amz-Expires', '900');
    const r2 = new AwsClient({ accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY });
    const signed = await r2.sign(new Request(url, {
      method: 'PUT', headers: { 'Content-Type': contentType },
    }), { aws: { signQuery: true, region: 'auto', service: 's3' } });
    return jsonRes({ url: signed.url }, 200);
  }

  // ── UPLOAD (POST) ──────────────────────────────────────────────
  if (req.method === 'POST' && action === 'upload') {
    const contentType = req.headers.get('content-type') || 'application/octet-stream';

    // Read filename from x-filename header (URL-encoded to support non-ASCII)
    const rawFilename = req.headers.get('x-filename');
    const filename = rawFilename ? decodeURIComponent(rawFilename) : null;
    if (!filename) {
      return jsonRes({ error: 'Falta cabecera x-filename' }, 400);
    }

    const body = await req.arrayBuffer();
    if (body.byteLength > MAX_FILE_SIZE) {
      return jsonRes({ error: 'Archivo demasiado grande (máx 10 MB)' }, 413);
    }

    const path = `/${R2_BUCKET}/${filename}`;
    const payloadHash = await sha256Hex(body);
    const headers: Record<string, string> = {
      'content-type': contentType,
      'host': host,
    };
    const signedHeaderNames = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const authorization = await signRequest(
      'PUT', path, '', headers, signedHeaderNames, payloadHash,
      R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY,
    );

    const r2Res = await fetch(`${R2_ENDPOINT}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type':         contentType,
        'x-amz-content-sha256': headers['x-amz-content-sha256'],
        'x-amz-date':           headers['x-amz-date'],
        'Authorization':        authorization,
      },
      body,
    });

    if (!r2Res.ok) {
      const txt = await r2Res.text();
      return jsonRes({ error: `R2 error ${r2Res.status}: ${txt.slice(0, 200)}` }, 502);
    }

    return jsonRes({ ok: true, filename }, 200);
  }

  // ── DELETE (DELETE) ────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const { filename } = await req.json();
    if (!filename) return jsonRes({ error: 'Falta filename' }, 400);

    const path = `/${R2_BUCKET}/${filename}`;
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const headers: Record<string, string> = { 'host': host };
    const signedHeaderNames = 'host;x-amz-content-sha256;x-amz-date';

    const authorization = await signRequest(
      'DELETE', path, '', headers, signedHeaderNames, emptyHash,
      R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY,
    );

    const r2Res = await fetch(`${R2_ENDPOINT}${path}`, {
      method: 'DELETE',
      headers: {
        'x-amz-content-sha256': headers['x-amz-content-sha256'],
        'x-amz-date':           headers['x-amz-date'],
        'Authorization':        authorization,
      },
    });

    if (!r2Res.ok) {
      const txt = await r2Res.text();
      return jsonRes({ error: `R2 error ${r2Res.status}: ${txt.slice(0, 200)}` }, 502);
    }

    return jsonRes({ ok: true }, 200);
  }

  // ── LIST (GET) ─────────────────────────────────────────────────
  if (req.method === 'GET') {
    const path = `/${R2_BUCKET}`;
    const query = 'list-type=2&max-keys=100';
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const headers: Record<string, string> = { 'host': host };
    const signedHeaderNames = 'host;x-amz-content-sha256;x-amz-date';

    const authorization = await signRequest(
      'GET', path, query, headers, signedHeaderNames, emptyHash,
      R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY,
    );

    const r2Res = await fetch(`${R2_ENDPOINT}${path}?${query}`, {
      headers: {
        'x-amz-content-sha256': headers['x-amz-content-sha256'],
        'x-amz-date':           headers['x-amz-date'],
        'Authorization':        authorization,
      },
    });

    if (!r2Res.ok) {
      const txt = await r2Res.text();
      return jsonRes({ error: `R2 error ${r2Res.status}: ${txt.slice(0, 200)}` }, 502);
    }

    const xml = await r2Res.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    return jsonRes({ files: keys }, 200);
  }

  return jsonRes({ error: 'Método no soportado' }, 405);
});
