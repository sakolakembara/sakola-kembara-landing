import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph, buildSeo } from '~/lib/seo';
import { REGISTRATION_PATH, REGISTRATION_SLUG } from '~/lib/site';
import { readWeb, webRoot } from './helpers';

// `/daftar`, the registration link (SAKEM-103, Phase A of the cutover): an admin shortlink, and the polite page of its own when no shortlink
// answers it. The served behaviour (307, 308 of the slash, the page, its status and headers, the outage 503) is checked against the built
// Worker by scripts/e2e.mjs, group `registration`; this file pins what the e2e cannot see from outside: the words, the head data, and the few
// lines of source that make a 404 a polite 404 and the registration link a link.

const page = readWeb('src/pages/[...path].astro');
const component = readWeb('src/components/RegistrationUnavailablePage.astro');

describe('the catch-all gives /daftar a page of its own, only for the registration link and only when the API says "not found"', () => {
  it('REGISTRATION_SLUG is the registration link, the one shortlink the site itself links to', () => {
    expect(REGISTRATION_SLUG).toBe('daftar');
    expect(REGISTRATION_PATH).toBe('/daftar');
  });

  it('the answer comes after the redirect and the outage branches: a link that exists redirects, an API that cannot answer is a 503, only "not found" shows the page', () => {
    const redirectAt = page.indexOf("if (result.kind === 'redirect') return redirectResponse(result.target);");
    const outageAt = page.indexOf("if (result.kind === 'unavailable') return unavailableResponse();");
    const flagAt = page.indexOf('registrationUnavailable = slug === REGISTRATION_SLUG;');
    expect(redirectAt).toBeGreaterThan(0);
    expect(outageAt).toBeGreaterThan(redirectAt);
    expect(flagAt).toBeGreaterThan(outageAt);
  });

  it('it is a real 404 that is never kept: the status is set for every branch, and no-store when the page is the polite one', () => {
    expect(page).toContain('Astro.response.status = 404;');
    expect(page).not.toMatch(/Astro\.response\.status = (200|503|410)/);
    expect(page).toContain("if (registrationUnavailable) Astro.response.headers.set('cache-control', 'no-store');");
    expect(page).toContain('{registrationUnavailable ? <RegistrationUnavailablePage /> : <NotFoundPage />}');
  });

  it('the registration link is looked up like any shortlink (nothing special in the lookup: one call, never cached), and the names WordPress and the portal own are not looked up', () => {
    expect(page).toContain('isShortlinkCandidate(slug) && !isPortalOwnedPath(`/${slug}`) && !isLegacyPath(`/${slug}`)');
    expect(page).toContain("const result = await resolveShortlink(slug, {");
  });
});

describe('the polite page: its words (new copy, for Dzul to approve), its head and its shell', () => {
  it('says what it says, in plain formal Indonesian, with the 404 page\'s buttons and no emoji', () => {
    expect(component).toContain('<Eyebrow class="mb-4">Daftar Siswa</Eyebrow>');
    expect(component).toContain('<Heading level="page" class="mb-4 text-gray-900">Formulir pendaftaran belum tersedia</Heading>');
    expect(component.replace(/\s+/g, ' ')).toContain(
      'Saat ini formulir pendaftaran belum dapat dibuka. Silakan coba lagi nanti, atau hubungi kami untuk informasi pendaftaran terbaru.',
    );
    expect(component).toContain('<Button href="/kontak">Hubungi Kami</Button>');
    expect(component).toContain('<Button href="/" variant="outline">Kembali ke Beranda</Button>');
    // no English, no casual words, no emoji
    expect(component.slice(component.indexOf('<Base'))).not.toMatch(/\p{Extended_Pictographic}|\b(Yuk|Ayo|Klik di sini|Sign Up|Register|Learn More)\b/u);
  });

  it('its head is the 404\'s: noindex, no canonical, no structured data, a title that names what it is', () => {
    const seo = buildSeo({ kind: 'notfound', title: 'Formulir pendaftaran belum tersedia' });
    expect(seo.title).toBe('Formulir pendaftaran belum tersedia - Yayasan Sakola Kembara Indonesia');
    expect(seo.robots).toBe('noindex');
    expect(seo.googlebot).toBeNull();
    expect(seo.canonical).toBeNull();
    expect(seo.og.url).toBeNull();
    expect(buildGraph({ kind: 'notfound', title: 'Formulir pendaftaran belum tersedia' })).toBeNull();
    expect(component).toContain("<Base seo={{ kind: 'notfound', title: 'Formulir pendaftaran belum tersedia' }}>");
  });

  it('the generic 404 page is unchanged (its title, and the sentence of the root app/not-found.tsx)', () => {
    expect(buildSeo({ kind: 'notfound' }).title).toBe('Halaman tidak ditemukan - Yayasan Sakola Kembara Indonesia');
    expect(readWeb('src/components/NotFoundPage.astro')).toContain('Halaman yang Anda cari tidak ada atau sudah dipindahkan.');
  });

  it('ships no script and no link out of the site: the one script of the page is the navbar\'s', () => {
    expect(component).not.toMatch(/<script\b/);
    expect(component).not.toMatch(/href="https?:/);
  });
});

describe('the address of the registration form is in no file of this repository\'s site code', () => {
  // The form is public content, but it changes with every cohort, and the point of /daftar being a shortlink is that nobody edits code or
  // deploys for it: it lives only in the admin (D1). A short link of the old kind (s.id, bit.ly, forms.gle) in src/
  // would be the old way creeping back. (The donation confirmation form of /donasi is another form: a Google Forms address there is not this.)
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? (name === 'generated' ? [] : walk(file)) : [file];
  });

  it('src/ names no short link of the old kind (s.id, bit.ly, forms.gle) and no /portal/daftar link', () => {
    const files = walk(path.join(webRoot, 'src')).filter((f) => /\.(astro|ts|tsx|json|css)$/.test(f));
    expect(files.length).toBeGreaterThan(80);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, path.relative(webRoot, file)).not.toMatch(/forms\.gle|https?:\/\/s\.id|bit\.ly\//i);
      expect(text, path.relative(webRoot, file)).not.toContain('href="/portal/daftar"');
    }
  });
});
