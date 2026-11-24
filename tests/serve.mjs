// Minimal static file server for the browser tests and screenshots: `node tests/serve.mjs [port]`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8' };

export function startServer(port = 4173) {
  const server = createServer(async (req, res) => {
    // also served under /diorama-viewer/, the GitHub Pages project sub-path
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/diorama-viewer') { res.writeHead(301, { location: '/diorama-viewer/' }).end(); return; }
    if (path.startsWith('/diorama-viewer/')) path = path.slice('/diorama-viewer'.length);
    const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = +(process.argv[2] || process.env.PORT || 4173);
  await startServer(port);
  console.log(`Serving ${ROOT} at http://127.0.0.1:${port}/`);
}
