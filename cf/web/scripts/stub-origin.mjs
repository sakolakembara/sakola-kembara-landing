// Stand-in for the legacy Next app, for local pass-through tests (SAKEM-075).
//
//   node scripts/stub-origin.mjs            listens on STUB_ORIGIN_PORT (default 4390)
//
// It answers like the real origin would for the paths the Worker forwards, and
// echoes what it received, so a test can prove method, headers, body and
// cookies arrived unchanged. Everything it returns carries `x-stub-origin: 1`.
//
//   GET  /__log          every request received so far (JSON), newest last
//   POST /__log/clear    forget them
//
// Not a copy of any real behaviour: no auth, no data, nothing from production.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const PAGES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'];
const PAGE_PREFIXES = ['/portal', '/admin', '/program', '/laporan', '/donasi', '/kontak', '/gabung-siswa'];

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

    if (p === '/api/auth/session') return json(200, {});
    if (p === '/api/announcements/current') {
      return json(200, { announcement: process.env.STUB_ANNOUNCEMENT ? sampleAnnouncement : null });
    }
    if (p.startsWith('/api/')) {
      // Echo: lets a test compare what was sent with what arrived.
      return json(200, { echo: true, method: req.method, path: p, search: url.search, headers: req.headers, body });
    }

    if (p === '/login') {
      // Two cookies on purpose: Set-Cookie must survive as two headers.
      return html(200, '/login', { 'set-cookie': ['authjs.csrf-token=stub1; Path=/; HttpOnly', 'authjs.callback-url=%2F; Path=/'] });
    }
    if (p === '/portal' || p.startsWith('/portal/') || p === '/admin' || p.startsWith('/admin/')) {
      const cookie = String(req.headers.cookie ?? '');
      if (!cookie.includes('stub-session=1')) {
        // Like the auth middleware: unauthenticated -> redirect to /login. The Worker must hand
        // this 307 to the browser as is, not follow it.
        return reply(307, 'text/plain', '', { location: `http://${req.headers.host}/login?from=${encodeURIComponent(p)}` });
      }
      return html(200, p);
    }
    if (PAGES.includes(p)) return html(200, p);
    if (PAGE_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return html(200, p);

    if (p.startsWith('/_next/')) {
      return reply(200, 'application/javascript', `/* legacy ${p} */`, { 'cache-control': 'public, max-age=31536000, immutable' });
    }
    if (p.startsWith('/images/') || p.startsWith('/blog/images/') || p.startsWith('/files/') || p.startsWith('/reports/')) {
      return reply(200, 'application/octet-stream', `legacy file ${p}`, { 'cache-control': 'public, max-age=0, must-revalidate' });
    }

    // Shortlinks: one active link, everything else is the legacy 404.
    if (p === '/daftar-2026') return reply(307, 'text/plain', '', { location: 'https://example.org/form' });
    return html(404, `404 for ${p}`);
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port, log, close: () => new Promise((r) => server.close(r)) }));
  });
}

const sampleAnnouncement = {
  id: 'stub',
  title: 'Pengumuman contoh',
  body: 'Teks pengumuman untuk uji lokal.',
  severity: 'info',
  ctaLabel: 'Selengkapnya',
  ctaUrl: '/blog',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startStubOrigin();
  console.log(`stub origin on http://127.0.0.1:${port}`);
}
