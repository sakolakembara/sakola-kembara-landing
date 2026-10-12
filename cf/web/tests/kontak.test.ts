import { describe, expect, it } from 'vitest';
import { readRoot } from './helpers';

// /kontak: the Indonesian copy is fixed (docs/context/tone-of-voice.md), so every phrase must appear,
// whitespace-normalised, in BOTH the legacy source and the port. (The rendered page, the form without
// JavaScript and every status code are checked in scripts/e2e.mjs, group "contact".)
const norm = (s: string) => s.replace(/\{" "\}/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const page = norm(readRoot('cf/web/src/pages/kontak.astro'));
const form = norm(readRoot('cf/web/src/components/contact/ContactForm.astro'));
const legacyPage = norm(readRoot('app/(public)/kontak/page.tsx') + readRoot('app/(public)/kontak/layout.tsx'));
const legacyForm = norm(readRoot('app/(public)/kontak/_contact-form.tsx'));

describe('/kontak copy', () => {
  it.each([
    'Mari Bergerak Bersama',
    'Punya pertanyaan, ingin berkolaborasi, atau tertarik menjadi relawan? Kami senang mendengar dari Anda.',
    'Kirim Pesan',
    'Informasi Kontak',
    'Ikuti Kami',
    'Hubungi tim Sakola Kembara untuk pertanyaan, kerjasama, atau peluang relawan. Berbasis di Bandung, melayani siswa di seluruh Indonesia.',
  ])('the page has %j, as the legacy page does', (phrase) => {
    expect(legacyPage).toContain(phrase);
    expect(page).toContain(phrase);
  });

  it.each([
    'Nama Lengkap',
    'Masukkan nama Anda',
    'Email',
    'email@example.com',
    'Subjek',
    'Pilih subjek',
    'Pesan',
    'Tulis pesan Anda di sini...',
    'Pesan Terkirim',
    'Kirim Pesan',
    'Mengirim...',
    'autoComplete="email"',
  ])('the form has %j, as the legacy form does', (phrase) => {
    expect(legacyForm).toContain(phrase);
    // the React attribute is spelled the HTML way in the port
    const port = phrase === 'autoComplete="email"' ? 'autocomplete="email"' : phrase;
    expect(form).toContain(port);
  });

  it('the honeypot is the legacy one: an offscreen, aria-hidden "website" input that skips the tab order', () => {
    expect(legacyForm).toContain('-left-[10000px]');
    expect(form).toContain('-left-[10000px]');
    expect(form).toContain('aria-hidden="true"');
    expect(form).toContain('name="website"');
    expect(form).toContain('tabindex="-1"');
    expect(form).toContain('autocomplete="off"');
  });

  it('the fields are required by attribute and the form skips native validation, so the Indonesian messages are the ones shown', () => {
    expect(legacyForm).toContain('noValidate');
    expect(form).toContain('novalidate');
    for (const name of ['fullName', 'email', 'subject', 'message']) expect(form).toMatch(new RegExp(`name="${name}"\\s+required`));
  });

  it('the form is a plain POST to /kontak (it posts without JavaScript, where no bot check is enforced); its own script only adds the pending state, the widget has a script of its own', () => {
    expect(form).toContain('method="post" action="/kontak"');
    const script = form.slice(form.lastIndexOf('<script>')); // the form's own script is the last one; the widget's is the import before it
    expect(script.length).toBeLessThan(1200);
    expect(script).toContain("'Mengirim...'");
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
  });

  it('the page is rendered by the Worker (it receives the form) and never caches an answer to a post', () => {
    expect(page).toContain('export const prerender = false');
    expect(page).toContain("method === 'POST'");
    expect(page).toContain("'cache-control': 'no-store'");
    expect(page).toContain('status: 303');
    // no logging of anything from the form in the page
    expect(page).not.toMatch(/console\./);
    expect(form).not.toMatch(/console\./);
  });

  it('the three contact cards use the legacy icon order (Mail, MessageCircle, MapPin) and the sub-page hero', () => {
    expect(legacyPage).toContain('{ Icon: Mail');
    expect(legacyPage).toContain('{ Icon: MessageCircle');
    expect(legacyPage).toContain('{ Icon: MapPin');
    expect(page).toContain('name="mail"');
    expect(page).toContain('Lucide "message-circle"');
    expect(page).toContain('name="map-pin"');
    expect(page).toContain('<PageHero');
  });
});
