// Stand-in for the live WordPress site behind the Worker's route, for local pass-through tests (SAKEM-075, rewritten by
// SAKEM-103 for Phase A of the cutover, when WordPress is the origin and the legacy Next app is not).
//
//   node scripts/stub-origin.mjs            listens on STUB_ORIGIN_PORT (default 4390)
//
// It answers like WordPress would for the paths the Worker forwards (src/lib/legacy-paths.ts: /wp-admin, /wp-login.php,
// /wp-content, /wp-includes, /wp-json, /xmlrpc.php and /login), and echoes what it received, so a test can prove method,
// headers, body and cookies arrived unchanged. Everything it returns carries `x-stub-origin: 1`.
//
//   GET  /__log                  every request received so far (JSON), newest last
//   POST /__log/clear            forget them
//   /wp-json/stub/echo/...       answers 200 with what it received (method, path, query, headers, body): any method
//   GET  /wp-login.php           the sign-in form, with two Set-Cookie headers (WordPress sets its test cookie there)
//   POST /wp-login.php           a 302 to /wp-admin/ with two Set-Cookie headers (a fake sign-in: no password is ever checked)
//   /login, /login/              a 302 to the ABSOLUTE address of /wp-login.php on this stub (the live site redirects /login/ there),
//                                so a test can prove the Worker points the Location back at the host the browser used
//   /wp-admin, /wp-admin/        a 302 to /wp-login.php (what WordPress does for a visitor who is not signed in)
//   /wp-admin/admin-ajax.php     200 `0` (what WordPress answers an unknown action)
//   /wp-content/...              200: an image for /wp-content/uploads/*, otherwise a small file; the cache headers a web server sends
//   /wp-includes/...             200, a script
//   /wp-json/...                 200, `[]`
//   /xmlrpc.php                  GET: 405 with WordPress's sentence; POST: 200, an XML body
//
// Anything else answers a 404 with `x-stub-origin`, and a test that sees one for a page of the NEW site has found a request that
// reached the origin and should not have. It knows nothing about the new site's pages, /portal, /admin (the site's) or /api.
//
// Not a copy of any real behaviour: no auth, no data, nothing from production.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

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
      reply(status, 'text/html; charset=utf-8', `<!doctype html><title>stub origin ${title}</title><h1>stub origin ${title}</h1>`, headers);
    const json = (status, value, headers) => reply(status, 'application/json', JSON.stringify(value), headers);
    const redirect = (location, headers = {}) => reply(302, 'text/html; charset=utf-8', '', { location, ...headers });

    const p = url.pathname;
    const origin = `http://${req.headers.host}`;

    if (p === '/wp-json/stub/echo' || p.startsWith('/wp-json/stub/echo/')) {
      // Echo: lets a test compare what was sent with what arrived.
      return json(200, { echo: true, method: req.method, path: p, search: url.search, headers: req.headers, body });
    }

    if (p === '/wp-login.php') {
      // Two cookies on purpose: Set-Cookie must survive as two headers. The names and values are invented.
      if (req.method === 'POST') {
        return redirect('/wp-admin/', { 'set-cookie': ['stub_auth=1; Path=/; HttpOnly', 'stub_logged_in=1; Path=/'] });
      }
      return html(200, 'wp-login', { 'set-cookie': ['stub_test_cookie=check; Path=/', 'stub_other=2; Path=/; HttpOnly'] });
    }
    if (p === '/login' || p === '/login/') return redirect(`${origin}/wp-login.php`);

    if (p === '/wp-admin' || p === '/wp-admin/') return redirect('/wp-login.php?redirect_to=%2Fwp-admin%2F&reauth=1');
    if (p === '/wp-admin/admin-ajax.php') return reply(200, 'text/plain; charset=utf-8', '0');
    if (p.startsWith('/wp-admin/')) return html(200, p);

    if (p.startsWith('/wp-content/uploads/')) {
      return reply(200, 'image/jpeg', `stub upload ${p}`, { 'cache-control': 'public, max-age=0, must-revalidate' });
    }
    if (p === '/wp-content' || p.startsWith('/wp-content/')) {
      return reply(200, 'text/css; charset=utf-8', `/* stub ${p} */`, { 'cache-control': 'public, max-age=31536000, immutable' });
    }
    if (p.startsWith('/wp-includes/')) {
      return reply(200, 'application/javascript', `/* stub ${p} */`, { 'cache-control': 'public, max-age=31536000, immutable' });
    }
    if (p === '/wp-json' || p.startsWith('/wp-json/')) return json(200, []);

    if (p === '/xmlrpc.php') {
      if (req.method === 'POST') return reply(200, 'text/xml; charset=UTF-8', '<?xml version="1.0"?><methodResponse><params/></methodResponse>');
      return reply(405, 'text/plain; charset=UTF-8', 'XML-RPC server accepts POST requests only.', { allow: 'POST' });
    }

    // Nothing of the new site is here: pages, shortlinks, /portal and /api never reach this origin. A request that did gets this 404
    // (with `x-stub-origin`), which the e2e checks notice.
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
