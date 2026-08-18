// A tiny static server for the landing page, because this repo's sandbox will
// not let python's http.server bind a port. `node site/serve.mjs` serves
// site/ on http://localhost:4321 — nothing to compile, nothing to install.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

const root = new URL('./', import.meta.url).pathname;
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const path = normalize(join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url ?? '/')));
  if (!path.startsWith(root)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const body = readFileSync(path);
    res.writeHead(200, {
      'Content-Type': types[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(4321, () => console.log('serving on http://localhost:4321'));
