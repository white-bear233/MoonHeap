import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const routes = new Map([
  ['/', ['web/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['web/index.html', 'text/html; charset=utf-8']],
  ...['app.mjs','worker.mjs','engine.mjs'].map(n => ['/' + n, ['web/' + n, 'text/javascript; charset=utf-8']]),
  ['/style.css', ['web/style.css', 'text/css; charset=utf-8']],
  ['/workspace.css', ['web/workspace.css', 'text/css; charset=utf-8']],
  ...['before','growth','cleanup','shared','residual'].map(n => ['/examples/' + n + '.heapsnapshot', ['examples/' + n + '.heapsnapshot', 'application/json']])
]);
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname, route = routes.get(pathname);
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  if (!route || !['GET','HEAD'].includes(req.method)) { res.writeHead(404, headers); res.end('Not found'); return; }
  try {
    const body = await readFile(fileURLToPath(new URL(route[0], root)));
    res.writeHead(200, { ...headers, 'Content-Type': route[1], 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(503, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Run node scripts/build.mjs before starting the demo.');
  }
});
server.listen(port, '127.0.0.1', () => console.log('MoonHeap: http://127.0.0.1:' + server.address().port));

