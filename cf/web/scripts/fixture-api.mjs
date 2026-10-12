// Fixture for the content API, so /tim runs locally without the VPS.
//
//   node scripts/fixture-api.mjs            listens on FIXTURE_API_PORT (default 4391)
//
//   GET  /api/public/team         { "members": TeamMember[] } (shape: src/lib/team-types.ts)
//   POST /__mode?m=ok|500|slow|badjson   switch behaviour at runtime (tests use this)
//   GET  /__hits                  how many times /api/public/team was requested
//
// All names, roles and bios below are made up for the fixture.

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

export function startFixtureApi({ port = Number(process.env.FIXTURE_API_PORT ?? 4391), host = '127.0.0.1' } = {}) {
  let mode = 'ok';
  let hits = 0;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (url.pathname === '/__mode') {
      mode = url.searchParams.get('m') ?? 'ok';
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/__hits') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ hits, mode }));
    }
    if (url.pathname !== '/api/public/team') {
      res.writeHead(404);
      return res.end();
    }
    hits++;
    if (mode === '500') {
      res.writeHead(500);
      return res.end('boom');
    }
    if (mode === 'badjson') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"members": "not a list"}');
    }
    const send = () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ members: SAMPLE_MEMBERS }));
    };
    if (mode === 'slow') return void setTimeout(send, 5000); // longer than the Worker's 2 s timeout
    send();
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port, close: () => new Promise((r) => server.close(r)) }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { port } = await startFixtureApi();
  console.log(`fixture content API on http://127.0.0.1:${port}/api/public/team`);
}
