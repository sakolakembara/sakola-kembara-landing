// Fixture for the content API, so the SSR pages run locally without the VPS or the Worker API.
// Shapes follow docs/cloudflare/content-api.md (the contract), in the order the API promises.
//
//   node scripts/fixture-api.mjs            listens on FIXTURE_API_PORT (default 4391)
//
//   GET  /api/public/team              { "members": TeamMember[] }   (src/lib/team-types.ts)
//   GET  /api/public/reports           { "reports": Report[] }       newest year first, then newest upload
//   GET  /api/public/resources         { "resources": Resource[] }   category order, then the admin's order
//   GET  /api/public/blog              ?page=&pageSize=  featured + articles + paging (the contract's rules)
//   GET  /api/public/blog/<slug>       { article, related }, or 404 { "error": "not_found" }
//   POST /api/public/contact           the contact form: 201, 400, 429 (rate_limited, duplicate_recent)
//   GET  /api/public/shortlinks/<slug> { shortlink: { targetUrl } }, or 404 { "error": "not_found" } for an unknown or
//                                      switched-off link (an ADDITION to the contract: docs/cloudflare/content-api.md).
//                                      Like the real API it counts the click as it answers (see /__clicks).
//
// The blog is generated from the root content/blog/*.md with the SAME pipeline the build uses
// (plugins/blog-content.mjs, createBlogReader), so all 80 articles exist, with the rendered HTML
// (srcset and sizes on the images the asset manifest knows) and the rules of the contract
// (blog-contract.mjs, shared with the site). It needs `pnpm assets` to have run (the image
// manifest); the other endpoints work without.
//
// Test hooks (not part of the contract; nothing of them exists in the real API):
//
//   POST /__mode?m=<mode>[&for=<endpoint>]
//        modes: ok | 500 | slow | badjson | empty, and for the blog and the contact form also
//        html404 (a 404 that is not the contract's JSON), 503 | 429 | duplicate | invalid (contact only),
//        and for the contact form turnstile (always 400 turnstile_failed, the answer to a failed or
//        reused token) and require_token (400 turnstile_failed only when the request carries no
//        X-Sakem-Turnstile-Token, like the real API with a secret configured; the contract's position:
//        after the field checks, before the duplicate check).
//        Without `for` it applies to every endpoint and resets the per-endpoint overrides; `for` is
//        team | reports | resources | blog | contact | shortlink (shortlink modes: ok | 500 | slow | badjson | html404 |
//        empty (every link unknown) | unsafe (every link answers a javascript: target) | 429).
//   GET  /__hits                { hits (team, kept for older checks), mode, overrides, byEndpoint }
//   GET  /__requests?for=blog   the blog request targets (path + query), oldest first (`for=shortlink` too)
//   GET  /__clicks              { "<slug>": n }: the clicks the fixture counted, one per lookup that found a link
//   GET  /__contact-log         every contact request the fixture looked at: { clientIp, turnstileToken, headers, body }
//                               (a TEST fixture: the real API stores messages in D1, and the site never logs them;
//                               `turnstileToken` is the X-Sakem-Turnstile-Token header, or undefined when none came)
//   POST /__reset               forget everything: mode, overrides, hits, requests, the contact log, limiter and duplicates
//
// All names, titles, texts and links below are made up for the fixture (example.org is reserved).
// The file paths are root-relative, as the API returns them; nothing serves those files here.

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildListPayload, pickRelated, toWireSummary } from '../blog-contract.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const T = '2026-01-01T00:00:00.000Z';
const member = (n, category, displayOrder, extra = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  name: `Anggota Contoh ${n}`,
  role: `Peran Contoh ${n}`,
  image: null,
  category,
  bio: null,
  educationHistory: [],
  workHistory: [],
  displayOrder,
  createdAt: T,
  updatedAt: T,
  ...extra,
});

export const SAMPLE_MEMBERS = [
  member(1, 'dewan_pembina', 1, {
    bio: 'Biografi contoh untuk uji lokal.\nBaris kedua.',
    educationHistory: [{ institution: 'Universitas Contoh', degree: 'S1 Contoh', year: '2015' }],
    workHistory: [{ organization: 'Organisasi Contoh', role: 'Peran Contoh', period: '2018 - sekarang' }],
  }),
  member(2, 'dewan_pembina', 2),
  member(3, 'dewan_pengawas', 1, { bio: 'Pengawas contoh.' }),
  member(4, 'pengurus', 1),
  member(5, 'pengurus', 2, { image: '/images/team/contoh.jpg' }),
  member(6, 'pengurus', 3),
];

const report = (n, year, category, title, description, filePath, fileSize) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  title,
  description,
  category,
  year,
  filePath,
  fileSize,
});

/** Newest year first (string order: "2025/2026" sorts above "2025"), then newest upload first. */
export const SAMPLE_REPORTS = [
  report(1, '2025/2026', 'impact', 'Laporan Dampak 2025/2026', 'Ringkasan dampak program bagi siswa dan cabang pada tahun ajaran berjalan (data contoh).', '/reports/2025-2026/impact/laporan-dampak-contoh.pdf', 1843200),
  report(2, '2025/2026', 'financial', 'Laporan Keuangan Semester 1 2025/2026', null, '/reports/2025-2026/financial/laporan-keuangan-semester-1-contoh.pdf', 512000),
  report(3, '2025', 'yearly', 'Laporan Tahunan 2025', 'Gambaran kegiatan, capaian, dan pengelolaan sepanjang tahun 2025 (data contoh).', '/reports/2025/yearly/laporan-tahunan-2025-contoh.pdf', 3145728),
  report(4, '2025', 'donation', 'Laporan Donasi 2025', 'Penerimaan dan penyaluran donasi sepanjang tahun 2025 (data contoh).', '/reports/2025/donation/laporan-donasi-2025-contoh.pdf', 87040),
  report(5, '2024/2025', 'impact', 'Laporan Dampak 2024/2025', null, '/reports/2024-2025/impact/laporan-dampak-contoh.pdf', 1572864),
  report(6, '2024', 'yearly', 'Laporan Tahunan 2024', 'Laporan tahun pertama yang dipublikasikan (data contoh).', '/reports/2024/yearly/laporan-tahunan-2024-contoh.pdf', 2411724),
];

const resource = (n, category, contentType, title, description, extra) => ({
  id: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  title,
  description,
  category,
  contentType,
  filePath: null,
  fileSize: null,
  externalUrl: null,
  bodyText: null,
  ...extra,
});

/** Category order panduan, berkas-pendaftaran, berkas-marketing, tutorial, lainnya; the admin's order inside each. */
export const SAMPLE_RESOURCES = [
  resource(1, 'panduan', 'file', 'Panduan Pendaftaran Siswa Baru', 'Alur dan poin penting pendaftaran (dokumen contoh).', {
    filePath: '/resources/panduan-pendaftaran-contoh.pdf',
    fileSize: 902144,
  }),
  resource(2, 'berkas-pendaftaran', 'file', 'Template Surat Izin Orang Tua', null, {
    filePath: '/resources/template-surat-izin-contoh.docx',
    fileSize: 51200,
  }),
  resource(3, 'berkas-pendaftaran', 'file', 'Contoh Surat Keterangan Penghasilan', 'Contoh pengisian untuk dilihat sebelum menyiapkan berkas sendiri.', {
    filePath: '/resources/contoh-surat-penghasilan.pdf',
    fileSize: 204800,
  }),
  resource(4, 'berkas-marketing', 'text', 'Caption Instagram', 'Salin, tempel, lalu sesuaikan dengan ceritamu.', {
    bodyText: 'Aku ikut Open Recruitment Gen 6 Sakola Kembara!\n\nBelajar gratis satu tahun, dampingan mentor dari kampus terbaik.\n\n#SakolaKembara #OpenRecruitment',
  }),
  resource(5, 'berkas-marketing', 'url', 'Twibbon Open Recruitment', null, {
    externalUrl: 'https://example.org/twibbon-contoh',
  }),
  resource(6, 'berkas-marketing', 'file', 'Poster Open Recruitment', null, {
    filePath: '/resources/poster-open-recruitment-contoh.png',
    fileSize: 2411724,
  }),
  resource(7, 'tutorial', 'url', 'Cara Mengunduh Struk Token Listrik', 'Video pendek langkah demi langkah (tautan contoh).', {
    externalUrl: 'https://example.org/tutorial-token-listrik',
  }),
  resource(8, 'lainnya', 'text', 'Template Pesan Broadcast', null, {
    bodyText: 'Halo! Pendaftaran siswa baru Sakola Kembara sudah dibuka. Info lengkap: https://example.org/info-contoh',
  }),
];


// ---- the blog, from the markdown ---------------------------------------------------------------

let blogData;
/** Every article of the root content/blog as the API would serve it, read once on the first blog request. */
function loadBlog() {
  blogData ??= (async () => {
    const { createBlogReader } = await import('../plugins/blog-content.mjs');
    const reader = createBlogReader({
      contentDir: path.resolve(webRoot, '../../content/blog'),
      manifestFile: path.join(webRoot, 'src/generated/image-manifest.json'),
    });
    const articles = await reader.readAll(); // newest first
    return {
      summaries: articles.map((a) => toWireSummary(a.meta)),
      bySlug: new Map(articles.map((a) => [a.meta.id, a])),
    };
  })();
  return blogData;
}

/** Cache headers of the contract (content-api.md, "Caching"). */
const READ_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';

// ---- the contact form ---------------------------------------------------------------------------

const MESSAGES = {
  rateLimited: 'Terlalu banyak percobaan pengiriman. Silakan tunggu satu menit lalu coba lagi.',
  invalid: 'Silakan periksa kembali isian formulir.',
  duplicate: 'Pesan dari email ini baru saja dikirim. Mohon tunggu beberapa menit sebelum mengirim ulang.',
  success: 'Pesan kamu sudah kami terima. Tim kami akan menghubungi via email.',
  // The real API's own text for turnstile_failed (cf/admin src/public/contact.ts); the site shows its own wording instead.
  botCheckFailed: 'Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.',
};
const EMAIL = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;
const IP_V4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const isIp = (v) => (IP_V4.test(v) ? v.split('.').every((n) => Number(n) <= 255) : v.includes(':') && /^[0-9a-f:.]{2,45}$/i.test(v));

/** The contract's field rules (the legacy zod schema, word for word). Returns fieldErrors, or null when valid. */
function validateContact(input) {
  const s = (v) => (typeof v === 'string' ? v : '');
  const fullName = s(input.fullName).trim();
  const email = s(input.email).trim().toLowerCase();
  const message = s(input.message).trim();
  const errors = {};
  const add = (field, text) => ((errors[field] ??= []).push(text));
  if (fullName.length < 2) add('fullName', 'Nama lengkap minimal 2 karakter');
  if (fullName.length > 120) add('fullName', 'Maksimal 120 karakter');
  if (!EMAIL.test(email)) add('email', 'Format email belum benar');
  if (email.length > 254) add('email', 'Maksimal 254 karakter');
  if (!['partnership', 'donation', 'other'].includes(s(input.subject))) add('subject', 'Pilih salah satu subjek');
  if (message.length < 10) add('message', 'Tulis minimal 10 karakter');
  if (message.length > 5000) add('message', 'Maksimal 5000 karakter');
  return Object.keys(errors).length > 0 ? { errors } : { ok: { fullName, email, message } };
}

/**
 * The shortlinks the fixture knows. An inactive link is simply absent: the contract answers 404 for it, the same as for
 * an unknown slug. (Targets are made up; example.org is reserved.)
 */
export const SAMPLE_SHORTLINKS = {
  'daftar-2026': 'https://example.org/form',
  gabung: '/gabung-siswa?utm_source=ig',
  'unduh-panduan': 'https://example.org/panduan.pdf',
};

/** The slug grammar the real API checks before it reads anything (cf/admin/src/shortlinks/rules.ts). */
const SLUG_GRAMMAR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ENDPOINTS = {
  '/api/public/team': { name: 'team', key: 'members', data: SAMPLE_MEMBERS },
  '/api/public/reports': { name: 'reports', key: 'reports', data: SAMPLE_REPORTS },
  '/api/public/resources': { name: 'resources', key: 'resources', data: SAMPLE_RESOURCES },
};

export function startFixtureApi({ port = Number(process.env.FIXTURE_API_PORT ?? 4391), host = '127.0.0.1' } = {}) {
  let mode = 'ok';
  const overrides = {};
  const byEndpoint = { team: 0, reports: 0, resources: 0, blog: 0, contact: 0, shortlink: 0 };
  const requests = { blog: [], shortlink: [] };
  /** slug -> clicks counted, as the real API does after it has answered. */
  const clicks = new Map();
  const contact = { log: [], windows: new Map(), recent: new Map() };
  /** The mode an endpoint answers in: its own override, else the global one. */
  const modeOf = (name) => overrides[name] ?? mode;
  const reset = () => {
    mode = 'ok';
    for (const k of Object.keys(overrides)) delete overrides[k];
    for (const k of Object.keys(byEndpoint)) byEndpoint[k] = 0;
    requests.blog.length = 0;
    requests.shortlink.length = 0;
    clicks.clear();
    contact.log.length = 0;
    contact.windows.clear();
    contact.recent.clear();
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  // `slow` answers after 5 s, longer than the Worker's 2 s timeout.
  const delayed = (current, fn) => (current === 'slow' ? setTimeout(fn, 5000) : fn());

  /** The failure modes the blog shares with the lists. Returns true when it answered. */
  const failMode = (res, current) => {
    if (current === '500') {
      res.writeHead(500);
      res.end('boom');
      return true;
    }
    if (current === 'badjson') {
      send(res, 200, '{"articles": "not a list", "article": "x"}');
      return true;
    }
    if (current === 'html404') {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end('<h1>Not Found</h1>');
      return true;
    }
    return false;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const p = url.pathname;

    // ---- test hooks
    if (p === '/__mode') {
      const m = url.searchParams.get('m') ?? 'ok';
      const only = url.searchParams.get('for');
      if (only) {
        overrides[only] = m;
      } else {
        mode = m;
        for (const k of Object.keys(overrides)) delete overrides[k];
      }
      res.writeHead(204);
      return res.end();
    }
    if (p === '/__hits') return send(res, 200, { hits: byEndpoint.team, mode, overrides, byEndpoint });
    if (p === '/__requests') return send(res, 200, requests[url.searchParams.get('for') ?? 'blog'] ?? []);
    if (p === '/__contact-log') return send(res, 200, contact.log);
    if (p === '/__clicks') return send(res, 200, Object.fromEntries(clicks));
    if (p === '/__reset') {
      reset();
      res.writeHead(204);
      return res.end();
    }

    // ---- blog
    if (p === '/api/public/blog' || p.startsWith('/api/public/blog/')) {
      if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
      byEndpoint.blog++;
      requests.blog.push(p + url.search);
      const current = modeOf('blog');
      if (failMode(res, current)) return;
      let data;
      try {
        data = await loadBlog();
      } catch (error) {
        return send(res, 500, { error: 'fixture_not_ready', hint: String(error.message ?? error) });
      }
      return delayed(current, () => {
        if (p === '/api/public/blog') {
          const list = current === 'empty' ? [] : data.summaries;
          return send(res, 200, buildListPayload(list, url.searchParams.get('page'), url.searchParams.get('pageSize')), {
            'cache-control': READ_CACHE,
          });
        }
        const slug = decodeURIComponent(p.slice('/api/public/blog/'.length));
        const entry = current === 'empty' ? undefined : data.bySlug.get(slug);
        if (!entry) return send(res, 404, { error: 'not_found' }, { 'cache-control': 'public, s-maxage=30' });
        const summary = data.summaries.find((a) => a.slug === slug);
        return send(
          res,
          200,
          {
            article: { ...summary, modifiedISO: entry.meta.modifiedISO, contentMarkdown: entry.markdown, contentHtml: entry.html },
            related: pickRelated(summary, data.summaries),
          },
          { 'cache-control': READ_CACHE },
        );
      });
    }

    // ---- shortlinks: the lookup of the redirect. never cacheable; counts a click for a link it finds
    if (p.startsWith('/api/public/shortlinks/')) {
      const noStore = { 'cache-control': 'no-store' };
      if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' }, noStore);
      byEndpoint.shortlink++;
      requests.shortlink.push(p + url.search);
      const current = modeOf('shortlink');
      if (current === '500') {
        res.writeHead(500);
        return res.end('boom');
      }
      if (current === '429') return send(res, 429, { error: 'rate_limited' }, { ...noStore, 'retry-after': '5' });
      if (current === 'badjson') return send(res, 200, '{"shortlink": "not an object"}', noStore);
      if (current === 'html404') {
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('<h1>Not Found</h1>');
      }
      let slug = '';
      try {
        slug = decodeURIComponent(p.slice('/api/public/shortlinks/'.length));
      } catch {
        // not a slug
      }
      const target = current === 'unsafe' ? 'javascript:alert(1)' : SLUG_GRAMMAR.test(slug) && slug.length <= 64 && current !== 'empty' ? SAMPLE_SHORTLINKS[slug] : undefined;
      return delayed(current, () => {
        if (!target) return send(res, 404, { error: 'not_found' }, noStore);
        // `unsafe` models an API that hands out a target it should not (the real one never does): no click to count.
        if (current !== 'unsafe') clicks.set(slug, (clicks.get(slug) ?? 0) + 1);
        return send(res, 200, { shortlink: { targetUrl: target } }, noStore);
      });
    }

    // ---- contact
    if (p === '/api/public/contact') {
      const noStore = { 'cache-control': 'no-store' };
      if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, noStore);
      byEndpoint.contact++;
      const current = modeOf('contact');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size <= 64 * 1024) chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      const clientIp = String(req.headers['x-sakem-client-ip'] ?? '').trim();
      const turnstileToken = String(req.headers['x-sakem-turnstile-token'] ?? '').trim() || undefined;
      const entry = {
        clientIp,
        turnstileToken,
        headers: { 'content-type': req.headers['content-type'], 'x-sakem-client-ip': clientIp || undefined, 'x-sakem-turnstile-token': turnstileToken },
        body: undefined,
      };
      contact.log.push(entry);

      // The modes of the test hooks answer first, whatever the body is.
      if (current === '500') return send(res, 500, { error: 'boom' }, noStore);
      if (current === '503') return send(res, 503, { error: 'service_unavailable' }, noStore);
      if (current === 'html404') {
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('<h1>Not Found</h1>');
      }
      if (current === '429') {
        return send(res, 429, { error: 'rate_limited', message: MESSAGES.rateLimited, retryAfterSeconds: 42 }, { ...noStore, 'retry-after': '42' });
      }
      if (current === 'duplicate') {
        return send(res, 429, { error: 'duplicate_recent', message: MESSAGES.duplicate, retryAfterSeconds: 300 }, { ...noStore, 'retry-after': '300' });
      }
      if (current === 'invalid') {
        return send(res, 400, { error: 'validation_failed', message: MESSAGES.invalid, fieldErrors: { email: ['Format email belum benar'] } }, noStore);
      }
      if (current === 'turnstile') return send(res, 400, { error: 'turnstile_failed', message: MESSAGES.botCheckFailed }, noStore);
      if (current === 'slow') return setTimeout(() => send(res, 201, { ok: true, message: MESSAGES.success }, noStore), 10_000);

      // The contract's checks, in its order.
      if (size > 32 * 1024) return send(res, 400, { error: 'body_too_large' }, noStore);
      if (!clientIp || !isIp(clientIp)) return send(res, 400, { error: 'invalid_client_ip' }, noStore);
      const now = Date.now();
      const w = contact.windows.get(clientIp);
      if (!w || now - w.start >= 60_000) contact.windows.set(clientIp, { start: now, count: 1 });
      else if (++w.count > 5) {
        const retry = Math.max(1, Math.ceil((w.start + 60_000 - now) / 1000));
        return send(res, 429, { error: 'rate_limited', message: MESSAGES.rateLimited, retryAfterSeconds: retry }, { ...noStore, 'retry-after': String(retry) });
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'invalid_json' }, noStore);
      }
      entry.body = body;
      if (typeof body?.website === 'string' && body.website.length > 0) return send(res, 201, { ok: true, message: MESSAGES.success }, noStore); // honeypot: nothing saved
      const verdict = validateContact(body ?? {});
      if (verdict.errors) return send(res, 400, { error: 'validation_failed', message: MESSAGES.invalid, fieldErrors: verdict.errors }, noStore);
      // After the field checks (a typo does not spend a single-use token), before the duplicate check: the real API's order.
      if (current === 'require_token' && !turnstileToken) return send(res, 400, { error: 'turnstile_failed', message: MESSAGES.botCheckFailed }, noStore);
      const last = contact.recent.get(verdict.ok.email);
      if (last && now - last < 5 * 60_000) {
        return send(res, 429, { error: 'duplicate_recent', message: MESSAGES.duplicate, retryAfterSeconds: 300 }, { ...noStore, 'retry-after': '300' });
      }
      contact.recent.set(verdict.ok.email, now);
      return send(res, 201, { ok: true, message: MESSAGES.success }, noStore);
    }

    // ---- the lists
    const endpoint = ENDPOINTS[p];
    if (!endpoint) {
      res.writeHead(404);
      return res.end();
    }
    byEndpoint[endpoint.name]++;
    const current = modeOf(endpoint.name);
    if (current === '500') {
      res.writeHead(500);
      return res.end('boom');
    }
    if (current === 'badjson') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(`{"${endpoint.key}": "not a list"}`);
    }
    const reply = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ [endpoint.key]: current === 'empty' ? [] : endpoint.data }));
    };
    if (current === 'slow') return void setTimeout(reply, 5000); // longer than the Worker's 2 s timeout
    reply();
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startFixtureApi();
  console.log(`fixture content API on http://127.0.0.1:${port}/api/public/{team,reports,resources,blog,blog/<slug>,contact,shortlinks/<slug>}`);
}
