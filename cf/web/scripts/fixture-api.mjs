// Fixture for the content API, so the SSR pages run locally without the VPS or the Worker API.
// Shapes follow docs/cloudflare/content-api.md (the contract), in the order the API promises.
//
//   node scripts/fixture-api.mjs            listens on FIXTURE_API_PORT (default 4391)
//
//   GET  /api/public/team         { "members": TeamMember[] }   (src/lib/team-types.ts)
//   GET  /api/public/reports      { "reports": Report[] }       newest year first, then newest upload
//   GET  /api/public/resources    { "resources": Resource[] }   category order, then the admin's order
//   POST /__mode?m=ok|500|slow|badjson|empty[&for=team|reports|resources]
//                                 switch behaviour at runtime (tests use this); without `for` it
//                                 applies to every endpoint, and resets the per-endpoint overrides
//   GET  /__hits                  { hits (team, kept for older checks), mode, byEndpoint }
//
// All names, titles, texts and links below are made up for the fixture (example.org is reserved).
// The file paths are root-relative, as the API returns them; nothing serves those files here.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

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

const ENDPOINTS = {
  '/api/public/team': { name: 'team', key: 'members', data: SAMPLE_MEMBERS },
  '/api/public/reports': { name: 'reports', key: 'reports', data: SAMPLE_REPORTS },
  '/api/public/resources': { name: 'resources', key: 'resources', data: SAMPLE_RESOURCES },
};

export function startFixtureApi({ port = Number(process.env.FIXTURE_API_PORT ?? 4391), host = '127.0.0.1' } = {}) {
  let mode = 'ok';
  const overrides = {};
  const byEndpoint = { team: 0, reports: 0, resources: 0 };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/__mode') {
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
    if (url.pathname === '/__hits') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ hits: byEndpoint.team, mode, overrides, byEndpoint }));
    }
    const endpoint = ENDPOINTS[url.pathname];
    if (!endpoint) {
      res.writeHead(404);
      return res.end();
    }
    byEndpoint[endpoint.name]++;
    const current = overrides[endpoint.name] ?? mode;
    if (current === '500') {
      res.writeHead(500);
      return res.end('boom');
    }
    if (current === 'badjson') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(`{"${endpoint.key}": "not a list"}`);
    }
    const send = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ [endpoint.key]: current === 'empty' ? [] : endpoint.data }));
    };
    if (current === 'slow') return void setTimeout(send, 5000); // longer than the Worker's 2 s timeout
    send();
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startFixtureApi();
  console.log(`fixture content API on http://127.0.0.1:${port}/api/public/{team,reports,resources}`);
}
