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
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let fsPath = normalize(join(ROOT, path));
    if (!fsPath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    let entry = await stat(fsPath).catch(() => null);
    if (entry?.isDirectory()) { fsPath = join(fsPath, 'index.html'); entry = await stat(fsPath).catch(() => null); }
    if (!entry && !extname(path)) {
      const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
      const shells = { resultados: 'resultados.html', results: 'resultados.html', corredor: 'corredor.html', rider: 'corredor.html', equipo: 'equipo.html', team: 'equipo.html', inscritos: 'inscritos.html', startlist: 'inscritos.html', jornada: 'jornada.html', competicion: 'competicion.html' };
      const shell = shells[segments[0] === 'en' ? segments[1] : segments[0]];
      if (shell) { fsPath = join(ROOT, shell); entry = await stat(fsPath).catch(() => null); }
    }
    if (!entry) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(fsPath)] || 'application/octet-stream' });
    res.end(await readFile(fsPath));
  } catch (error) { res.writeHead(500).end(String(error)); }
}).listen(PORT, () => console.log(`static server on http://localhost:${PORT}`));
