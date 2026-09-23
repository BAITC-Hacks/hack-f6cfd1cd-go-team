import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const target = path.resolve(root, relative);
    const publicFiles = new Set(['index.html', 'styles.css', 'app.js', 'domain.js', 'catalog.js', 'api.js', 'search-model.js', 'live-search.js', 'chat-api.js', 'live-chat.js', 'favicon.svg']);
    if (!publicFiles.has(relative) || !target.startsWith(root)) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT) || 5173, '127.0.0.1', () => console.log('EKT demo: http://127.0.0.1:' + (process.env.PORT || 5173)));
