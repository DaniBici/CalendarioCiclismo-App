// Servidor del prototipo, con las reglas que tendría nginx: HTTP/2, Brotli ya
// comprimido, `immutable` para los activos con hash y `no-cache` con ETag para el
// resto. En modo espejo sirve la web actual tal cual desde una copia local, para
// comparar ambos sistemas sobre el mismo transporte. Retardos opcionales para
// emular la distancia al VPS (`rtt`, `tls`, en milisegundos).
import { createSecureServer } from 'node:http2';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};
const dormir = ms => new Promise(done => setTimeout(done, ms));

/** Certificado autofirmado de localhost, en `dir`. */
export function certificado(dir) {
  mkdirSync(dir, { recursive: true });
  const key = join(dir, 'clave.pem');
  const cert = join(dir, 'certificado.pem');
  if (!existsSync(cert)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

// Jornada que cambió de slug. En nginx sería un `map` regenerado o una búsqueda
// del archivo `r/<clave>.txt` al no encontrar la página.
function responderTraslado(stream, raiz, ruta) {
  const partes = /^\/(jornada|en\/stage|inscritos|en\/startlist)\/([^/]+)\/$/.exec(ruta);
  if (!partes) return false;
  const clave = { jornada: 'es', 'en/stage': 'en', inscritos: 'inscritos-es', 'en/startlist': 'inscritos-en' }[partes[1]];
  const file = join(raiz, 'r', clave, `${partes[2]}.txt`);
  if (!existsSync(file)) return false;
  stream.respond({ ':status': 301, location: readFileSync(file, 'utf8'), 'cache-control': 'no-cache' });
  stream.end();
  return true;
}

function responderEstatico(stream, cabeceras, raiz, ruta) {
  const limpia = normalize(decodeURIComponent(ruta)).replace(/^(\.\.[/\\])+/, '');
  let file = join(raiz, limpia);
  if (limpia.endsWith('/') || (existsSync(file) && statSync(file).isDirectory())) file = join(file, 'index.html');
  if (!existsSync(file)) return responderTraslado(stream, raiz, limpia);
  const inmutable = limpia.startsWith('/a/');
  const brotli = /\bbr\b/.test(cabeceras['accept-encoding'] || '') && existsSync(`${file}.br`);
  const servido = brotli ? `${file}.br` : file;
  const stat = statSync(servido);
  const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
  const base = {
    'content-type': TIPOS[extname(file)] || 'application/octet-stream',
    'cache-control': inmutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    etag, vary: 'Accept-Encoding',
    ...(brotli ? { 'content-encoding': 'br' } : {}),
  };
  if (cabeceras['if-none-match'] === etag) {
    stream.respond({ ':status': 304, etag, 'cache-control': base['cache-control'] });
    stream.end();
    return true;
  }
  const cuerpo = readFileSync(servido);
  stream.respond({ ':status': 200, ...base, 'content-length': cuerpo.length });
  stream.end(cuerpo);
  return true;
}

async function responderEspejo(stream, cabeceras, { origen, cache }, ruta) {
  const clave = createHash('sha1').update(ruta).digest('hex');
  const cuerpoFile = join(cache, `${clave}.bin`);
  const metaFile = join(cache, `${clave}.json`);
  if (!existsSync(metaFile)) {
    const respuesta = await fetch(`${origen}${ruta}`, { headers: { 'accept-encoding': 'gzip' }, redirect: 'manual' });
    // fetch descomprime: la copia se guarda en claro y se sirve con gzip, como Pages.
    const cuerpo = Buffer.from(await respuesta.arrayBuffer());
    writeFileSync(cuerpoFile, cuerpo);
    writeFileSync(metaFile, JSON.stringify({
      status: respuesta.status,
      tipo: respuesta.headers.get('content-type'),
      cache: respuesta.headers.get('cache-control'),
      etag: respuesta.headers.get('etag'),
      location: respuesta.headers.get('location'),
    }));
  }
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const crudo = readFileSync(cuerpoFile);
  const comprimible = /text|javascript|json|svg/.test(meta.tipo || '');
  const cuerpo = comprimible ? gzipSync(crudo, { level: 6 }) : crudo;
  stream.respond({
    ':status': meta.status,
    ...(meta.tipo ? { 'content-type': meta.tipo } : {}),
    ...(meta.cache ? { 'cache-control': meta.cache } : {}),
    ...(meta.location ? { location: meta.location } : {}),
    ...(comprimible ? { 'content-encoding': 'gzip' } : {}),
    'content-length': cuerpo.length,
  });
  stream.end(cuerpo);
}

/**
 * Servidor HTTP/2. `raiz`: árbol publicado; `espejo`: { origen, cache }, también
 * como respaldo de `raiz`;
 * `admin(ruta, parametros, stream)`: rutas /__… locales de medición.
 */
export function crearServidor({ puerto, tls, raiz = null, espejo = null, rtt = 0, tlsMs = 0, admin = null }) {
  if (espejo) mkdirSync(espejo.cache, { recursive: true });
  const servidor = createSecureServer({ ...tls, allowHTTP1: false }, undefined);
  servidor.on('session', sesion => { sesion.cc_nueva = true; });
  servidor.on('stream', async (stream, cabeceras) => {
    stream.on('error', () => {});
    const url = new URL(cabeceras[':path'], 'https://localhost');
    try {
      if (admin && url.pathname.startsWith('/__')) return await admin(url, stream);
      const sesion = stream.session;
      const espera = rtt + (sesion?.cc_nueva ? tlsMs : 0);
      if (sesion) sesion.cc_nueva = false;
      if (espera) await dormir(espera);
      // Lo publicado primero; lo demás, de la web actual. Es la migración gradual:
      // nginx delante, con proxy a Pages para lo que aún no se ha trasladado.
      if (raiz && responderEstatico(stream, cabeceras, raiz, url.pathname)) return;
      if (espejo) return await responderEspejo(stream, cabeceras, espejo, cabeceras[':path']);
      stream.respond({ ':status': 404, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
      stream.end('404');
    } catch (error) {
      // El navegador puede cerrar la petición a medias, sobre todo con la pestaña cerrada.
      if (stream.destroyed) return;
      if (!stream.headersSent) stream.respond({ ':status': 500 });
      stream.end(String(error.message));
    }
  });
  return new Promise(done => servidor.listen(puerto, '127.0.0.1', () => done(servidor)));
}
