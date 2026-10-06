// Servidor estático mínimo para previsualizar el sitio en local (solo desarrollo).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, extname, normalize } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8765;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };

createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(requestUrl.pathname);
    if (path.split('/').some(segment => segment.startsWith('.') || ['work','output','node_modules','supabase','scripts','docs'].includes(segment))) {
      res.writeHead(403).end('forbidden'); return;
    }
    let fsPath = normalize(join(ROOT, path));
    if (!fsPath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    if (path === '/js/config.js' && process.env.CC_PREVIEW_CONFIG) fsPath = resolve(process.env.CC_PREVIEW_CONFIG);
    let entry = await stat(fsPath).catch(() => null);
    if (entry?.isDirectory()) { fsPath = join(fsPath, 'index.html'); entry = await stat(fsPath).catch(() => null); }
    if (!entry && !extname(path)) {
      const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
      const shells = { resultados: 'resultados.html', results: 'resultados.html', corredor: 'corredor.html', rider: 'corredor.html', equipo: 'equipo.html', team: 'equipo.html', inscritos: 'inscritos.html', startlist: 'inscritos.html', jornada: 'jornada.html', stage:'jornada.html', competicion: 'competicion.html', race:'competicion.html', perfil:'perfil.html', profile:'perfil.html', mapa:'mapa.html', map:'mapa.html', 'orden-salida':'orden-salida.html', 'start-order':'orden-salida.html' };
      shells['route-map'] = 'mapa.html';
      const shell = shells[segments[0] === 'en' ? segments[1] : segments[0]];
      if (shell) { fsPath = join(ROOT, shell); entry = await stat(fsPath).catch(() => null); }
    }
    if (!entry) { res.writeHead(404).end('not found'); return; }
    // Las fuentes no llevan ?v= (la versión se aplica en el build): sin caché,
    // cada recarga pide los módulos actuales.
    res.writeHead(200, { 'content-type': TYPES[extname(fsPath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    let body = await readFile(fsPath);
    if (extname(fsPath) === '.html') {
      // Las páginas de producción generan rutas absolutas. La previsualización
      // de sus shells debe resolver los mismos assets bajo una URL profunda.
      body = body.toString().replace(/((?:src|href)=")((?:js|css|img|images|fonts)\/)/g, '$1/$2');
      if (path.startsWith('/en/')) body = body.replace('<html lang="es">','<html lang="en">');
      if (requestUrl.searchParams.get('_preview_text') === '2') body = body.replace('</head>','<style>html{font-size:200%}</style></head>');
    }
    res.end(body);
  } catch (error) { res.writeHead(500).end(String(error)); }
}).listen(PORT, '127.0.0.1', () => console.log(`static server on http://127.0.0.1:${PORT}`));
