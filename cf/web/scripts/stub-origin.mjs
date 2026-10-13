// Stand-in for the legacy Next app, for local pass-through tests (SAKEM-075).
//
//   node scripts/stub-origin.mjs            listens on STUB_ORIGIN_PORT (default 4390)
//
// It answers like the real origin would for the paths the Worker still forwards (since M4, SAKEM-083: /_next,
// /images, /blog/images, /files, /reports, /resources), and echoes what it received, so a test can prove method,
// headers, body and cookies arrived unchanged. Everything it returns carries `x-stub-origin: 1`.
//
//   GET  /__log          every request received so far (JSON), newest last
//   POST /__log/clear    forget them
//   /files/echo/...      answers 200 with what it received (method, path, query, headers, body)
//   /files/cookies       answers with two Set-Cookie headers, so a test can prove both survive
//
// It knows NOTHING about /login, /register, /portal, /admin or /api any more: those no longer reach the old app (the
// Worker redirects them, answers a 404, or another Worker owns them), and a request that did reach it would get the
// stub's 404 with `x-stub-origin`, which the e2e checks notice.
//
// Not a copy of any real behaviour: no auth, no data, nothing from production.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const PAGE_PREFIXES = ['/program', '/laporan', '/donasi', '/kontak', '/gabung-siswa'];

export function startStubOrigin({ port = Number(process.env.STUB_ORIGIN_PORT ?? 4390), host = '127.0.0.1' } = {}) {
  /** @type {Record<string, unknown>[]} */
  const log = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');

    if (url.pathname === '/__log') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(log));
    }
    if (url.pathname === '/__log/clear') {
      log.length = 0;
      res.statusCode = 204;
      return res.end();
    }

    const entry = {
      method: req.method,
      path: url.pathname,
      search: url.search,
      headers: req.headers,
      body,
      rawHeaders: req.rawHeaders,
    };
    log.push(entry);

    const reply = (status, contentType, text, headers = {}) => {
      res.writeHead(status, { 'content-type': contentType, 'x-stub-origin': '1', ...headers });
      res.end(req.method === 'HEAD' ? undefined : text);
    };
    const html = (status, title, headers) =>
      reply(status, 'text/html; charset=utf-8', `<!doctype html><title>legacy ${title}</title><h1>legacy ${title}</h1>`, headers);
    const json = (status, value, headers) => reply(status, 'application/json', JSON.stringify(value), headers);

    const p = url.pathname;

    if (p === '/files/echo' || p.startsWith('/files/echo/')) {
      // Echo: lets a test compare what was sent with what arrived.
      return json(200, { echo: true, method: req.method, path: p, search: url.search, headers: req.headers, body });
    }
    if (p === '/files/cookies') {
      // Two cookies on purpose: Set-Cookie must survive as two headers.
      return reply(200, 'text/plain', 'cookies', { 'set-cookie': ['stub-one=1; Path=/; HttpOnly', 'stub-two=2; Path=/'] });
    }
    if (PAGE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return html(200, p);

    if (p.startsWith('/_next/')) {
      return reply(200, 'application/javascript', `/* legacy ${p} */`, { 'cache-control': 'public, max-age=31536000, immutable' });
    }
    if (p.startsWith('/images/') || p.startsWith('/blog/images/') || p.startsWith('/files/') || p.startsWith('/reports/')) {
      return reply(200, 'application/octet-stream', `legacy file ${p}`, { 'cache-control': 'public, max-age=0, must-revalidate' });
    }

    // No shortlinks here any more: they are resolved through the API (scripts/fixture-api.mjs). A slug that reached
    // this origin would be a regression, and it gets the legacy 404 (with `x-stub-origin`), which the e2e checks notice.
    return html(404, `404 for ${p}`);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port, log, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startStubOrigin();
  console.log(`stub origin on http://127.0.0.1:${port}`);
}
