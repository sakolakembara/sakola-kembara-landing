import { describe, expect, test } from 'vitest';
import { coverAttrs } from '../src/lib/blog';
import { rewriteUploadsInHtml, uploadUrl, uploadsBase } from '../src/lib/uploads';

// UPLOADS_BASE_URL: where an upload lives for a visitor (src/lib/uploads.ts,
// docs/cloudflare/uploads.md). Empty must change nothing, byte for byte.

const BASE = 'https://files.example.org';
const ID = '0b9d8f7e-1234-4abc-9def-0123456789ab';
const PHOTO = `/uploads/team-photo/2026/${ID}-foto.jpg`;
const PDF = `/uploads/report/2026/${ID}-laporan.pdf`;

describe('uploadsBase: what counts as a usable base', () => {
  test('an http(s) origin, with or without a trailing slash', () => {
    expect(uploadsBase(BASE)).toBe(BASE);
    expect(uploadsBase(`${BASE}/`)).toBe(BASE);
    expect(uploadsBase(`  ${BASE}//  `)).toBe(BASE);
    expect(uploadsBase(`${BASE}\n`)).toBe(BASE); // a trailing newline from a pasted value
    expect(uploadsBase('http://localhost:8787')).toBe('http://localhost:8787');
    expect(uploadsBase('https://files.example.org:8443')).toBe('https://files.example.org:8443');
  });

  test('nothing, or anything that is not a plain origin, is no base', () => {
    for (const value of [undefined, null, '', '   ', '/', 'files.example.org', '//files.example.org', 'ftp://files.example.org']) {
      expect(uploadsBase(value), String(value)).toBe('');
    }
    for (const value of [
      'javascript:alert(1)',
      'https://files.example.org/uploads', // a path: the paths already start with /uploads/
      'https://files.example.org/?x=1',
      'https://user:pass@files.example.org',
      'https://files.example.org"onerror="alert(1)',
      "https://files.example.org'>",
      'https://files example.org',
      'https://.example.org',
      'https://files.example.org:99999999',
    ]) {
      expect(uploadsBase(value), value).toBe('');
    }
  });
});

describe('uploadUrl: one path from the API', () => {
  test('an upload path gets the base in front of it', () => {
    expect(uploadUrl(PHOTO, BASE)).toBe(`${BASE}${PHOTO}`);
    expect(uploadUrl(PDF, `${BASE}/`)).toBe(`${BASE}${PDF}`);
  });

  test('without a base the path is returned as it is, same string', () => {
    for (const base of [undefined, null, '', ' ', 'not an origin']) expect(uploadUrl(PHOTO, base)).toBe(PHOTO);
  });

  test('null stays null', () => {
    expect(uploadUrl(null, BASE)).toBeNull();
    expect(uploadUrl(null, undefined)).toBeNull();
  });

  // Negative check: rewrite every root-relative path and the first four lines below change.
  test('only paths under /uploads/ are touched: the static assets the Worker serves, absolute URLs and look-alikes are not', () => {
    for (const path of [
      '/blog/images/2025/10/foto.jpg',
      '/files/pitchdeck-sakola-kembara.pdf',
      '/images/team/foto.jpg',
      '/reports/2025/laporan.pdf',
      '/resources/panduan.pdf',
      '/uploads', // no file
      '/uploads/', // no file
      '/uploadsx/foto.jpg',
      '/UPLOADS/foto.jpg',
      '/blog/uploads/foto.jpg',
      'uploads/foto.jpg',
      '//uploads/foto.jpg',
      `//cdn.example.org${PHOTO}`,
      `https://cdn.example.org${PHOTO}`,
      `${BASE}${PHOTO}`, // already absolute: not prefixed twice
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '',
      '#fragment',
    ]) {
      expect(uploadUrl(path, BASE), path).toBe(path);
    }
  });

  test('a path that tries to leave /uploads/ is not rewritten', () => {
    for (const path of ['/uploads/../admin', '/uploads/a/../../b', '/uploads/..', '/uploads/a/..', '/uploads/x.png?x=1', '/uploads/x.png#y', '/uploads/a b.png', '/uploads/a\\b.png', '/uploads/a\n.png']) {
      expect(uploadUrl(path, BASE), JSON.stringify(path)).toBe(path);
    }
    // Dots inside a name are fine.
    expect(uploadUrl('/uploads/a..b/c.png', BASE)).toBe(`${BASE}/uploads/a..b/c.png`);
  });
});

describe('rewriteUploadsInHtml: the attributes inside an article', () => {
  const rewrite = (html: string) => rewriteUploadsInHtml(html, BASE);

  test('src, href and poster of any tag, double-quoted, single-quoted or bare', () => {
    expect(rewrite(`<img src="${PHOTO}" alt="Foto">`)).toBe(`<img src="${BASE}${PHOTO}" alt="Foto">`);
    expect(rewrite(`<img src='${PHOTO}'>`)).toBe(`<img src='${BASE}${PHOTO}'>`);
    expect(rewrite(`<img src=${PHOTO} alt=x>`)).toBe(`<img src=${BASE}${PHOTO} alt=x>`);
    expect(rewrite(`<p>Unduh <a href="${PDF}" target="_blank" rel="noopener noreferrer">laporan</a>.</p>`)).toBe(
      `<p>Unduh <a href="${BASE}${PDF}" target="_blank" rel="noopener noreferrer">laporan</a>.</p>`,
    );
    expect(rewrite(`<video poster="${PHOTO}" src="${PHOTO}" controls></video>`)).toBe(`<video poster="${BASE}${PHOTO}" src="${BASE}${PHOTO}" controls></video>`);
  });

  test('srcset: every candidate that is an upload, descriptors and the other candidates kept', () => {
    expect(rewrite(`<img srcset="${PHOTO} 1x, ${PHOTO} 2x" src="${PHOTO}">`)).toBe(`<img srcset="${BASE}${PHOTO} 1x, ${BASE}${PHOTO} 2x" src="${BASE}${PHOTO}">`);
    expect(rewrite(`<img srcset="/blog/images/a.webp 400w,${PHOTO} 800w, https://cdn.example.org/b.webp 1200w">`)).toBe(
      `<img srcset="/blog/images/a.webp 400w,${BASE}${PHOTO} 800w, https://cdn.example.org/b.webp 1200w">`,
    );
    expect(rewrite(`<source srcset="${PHOTO}">`)).toBe(`<source srcset="${BASE}${PHOTO}">`);
  });

  test('uppercase tag and attribute names, odd spacing, self-closing tags', () => {
    expect(rewrite(`<IMG SRC="${PHOTO}"/>`)).toBe(`<IMG SRC="${BASE}${PHOTO}"/>`);
    expect(rewrite(`<img\n  src = "${PHOTO}"\n  alt="x"\n/>`)).toBe(`<img\n  src = "${BASE}${PHOTO}"\n  alt="x"\n/>`);
    expect(rewrite(`<br/><img src="${PHOTO}"><br />`)).toBe(`<br/><img src="${BASE}${PHOTO}"><br />`);
  });

  test('a real article: several images and a link, text around them untouched', () => {
    const html = `<h3>Judul</h3>\n<p>Isi <strong>tebal</strong>.</p>\n<img src="${PHOTO}" alt="Satu" width="800" height="600" class="rounded-xl" loading="lazy">\n<p>Lagi <a href="${PDF}">PDF</a> dan <a href="/blog/lain">artikel lain</a>.</p>\n<img src="/blog/images/2025/10/lama.jpg" alt="Lama">`;
    expect(rewrite(html)).toBe(html.replace(`src="${PHOTO}"`, `src="${BASE}${PHOTO}"`).replace(`href="${PDF}"`, `href="${BASE}${PDF}"`));
  });

  // Negative check: make the scan match attributes anywhere in the text and the cases below change.
  describe('what must stay exactly as it is', () => {
    const untouched: [string, string][] = [
      ['an attribute written inside a code block (the tag is escaped)', `<pre><code>&lt;img src="${PHOTO}"&gt;</code></pre>`],
      ['the same in inline code', `<p>Pakai <code>src="${PHOTO}"</code> untuk gambar.</p>`],
      ['plain text that mentions a path', `<p>Berkasnya ada di ${PHOTO} ya.</p>`],
      ['a data- attribute', `<img data-src="${PHOTO}" data-href="${PDF}" data-poster="${PHOTO}" src="/blog/images/a.jpg">`],
      ['an attribute whose name merely ends in src', `<img xsrc="${PHOTO}" lazysrc="${PHOTO}" nosrcset="${PHOTO}">`],
      ['other attributes: alt, title, class, style, id, content', `<img alt="${PHOTO}" title="${PHOTO}" class="${PHOTO}" style="background:url(${PHOTO})" id="${PHOTO}"><meta content="${PHOTO}">`],
      ['a URL that merely contains the text', `<a href="https://example.org${PHOTO}">x</a><a href="/blog${PHOTO}">y</a><a href="//cdn.example.org${PHOTO}">z</a>`],
      ['an absolute URL on the files domain already', `<img src="${BASE}${PHOTO}">`],
      ['the static asset paths', '<img src="/blog/images/2025/10/foto.jpg"><a href="/files/pitchdeck-sakola-kembara.pdf">PDF</a><img src="/images/team/a.jpg">'],
      ['a closing tag and a comment', `<!-- <img src="${PHOTO}"> --><p>x</p></p>`],
      ['a mailto and an anchor', '<a href="mailto:info@example.org">m</a><a href="#uploads">u</a>'],
    ];
    for (const [label, html] of untouched) {
      test(label, () => {
        expect(rewrite(html)).toBe(html);
      });
    }
  });

  test('a tag after a quoted ">" in an attribute value is still found', () => {
    const html = `<img alt="a > b" src="${PHOTO}"><img title='x > y' src='${PHOTO}'>`;
    expect(rewrite(html)).toBe(`<img alt="a > b" src="${BASE}${PHOTO}"><img title='x > y' src='${BASE}${PHOTO}'>`);
  });

  test('an upload path inside another attribute value does not confuse the scan', () => {
    const html = `<img alt='src="${PHOTO}"' src="${PHOTO}">`;
    expect(rewrite(html)).toBe(`<img alt='src="${PHOTO}"' src="${BASE}${PHOTO}">`);
  });

  test('broken HTML is returned as far as it can be read, never thrown on', () => {
    const open = `<p>ok</p><img src="${PHOTO}"><img src="${PHOTO}`; // the last quote never closes
    expect(rewrite(open)).toBe(`<p>ok</p><img src="${BASE}${PHOTO}"><img src="${PHOTO}`);
    // A cut-off tag (no ">" at all, as in a truncated article) is dropped by browsers; what was read before the cut is still rewritten.
    expect(rewrite(`<img src="${PHOTO}"`)).toBe(`<img src="${BASE}${PHOTO}"`);
    expect(rewrite('<')).toBe('<');
    expect(rewrite(`< img src="${PHOTO}">`)).toBe(`< img src="${PHOTO}">`);
    expect(rewrite(`<<<<img src="${PHOTO}">`)).toBe(`<<<<img src="${BASE}${PHOTO}">`);
    expect(rewrite(`<!-- never closed <img src="${PHOTO}">`)).toBe(`<!-- never closed <img src="${PHOTO}">`);
    expect(rewrite(`<img src=>`)).toBe(`<img src=>`);
    expect(rewrite(`<img =x src="${PHOTO}">`)).toBe(`<img =x src="${BASE}${PHOTO}">`);
  });

  // Negative check: return a rewritten copy even when the base is empty and the first case fails.
  test('without a base the very same string comes back, whatever is in it', () => {
    const html = `<p>x</p><img src="${PHOTO}"><a href="${PDF}">y</a>`;
    for (const base of [undefined, null, '', 'garbage', 'javascript:alert(1)']) {
      const result = rewriteUploadsInHtml(html, base);
      expect(result).toBe(html);
    }
    expect(rewriteUploadsInHtml('', BASE)).toBe('');
    // No upload path anywhere: nothing to rewrite, nothing is scanned.
    const plain = '<p>Teks <img src="/blog/images/a.jpg"></p>';
    expect(rewriteUploadsInHtml(plain, BASE)).toBe(plain);
  });

  test('linear work: a long article with thousands of tags is rewritten in well under a second', () => {
    const paragraph = `<p>Teks <a href="/blog/lain">tautan</a> <img src="${PHOTO}" alt="x" width="1" height="1"></p>\n`;
    const html = paragraph.repeat(5000);
    const started = performance.now();
    const result = rewrite(html);
    const elapsed = performance.now() - started;
    expect(result.split(`src="${BASE}${PHOTO}"`).length - 1).toBe(5000);
    expect(elapsed).toBeLessThan(500);
    // And hostile input: a million "<" and a million unmatched quotes.
    const hostile = '<'.repeat(1_000_000) + `<img src="${PHOTO}`;
    const t = performance.now();
    expect(rewrite(hostile)).toBe(hostile);
    const quotes = `<a title="${'"x'.repeat(100_000)}" href="${PHOTO}">`;
    rewrite(quotes);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe('coverAttrs: the blog covers', () => {
  test('an upload cover gets the base; the width and height from the API are kept', () => {
    expect(coverAttrs(PHOTO, 1600, 900, BASE)).toEqual({ src: `${BASE}${PHOTO}`, width: 1600, height: 900 });
  });

  test('without a base, or for a path that is not an upload, nothing changes', () => {
    expect(coverAttrs(PHOTO, 1600, 900)).toEqual({ src: PHOTO, width: 1600, height: 900 });
    expect(coverAttrs(PHOTO, null, null, '')).toEqual({ src: PHOTO });
    expect(coverAttrs('https://cdn.example.org/a.jpg', 10, 10, BASE)).toEqual({ src: 'https://cdn.example.org/a.jpg', width: 10, height: 10 });
    expect(coverAttrs(null, 10, 10, BASE)).toBeNull();
  });

  test('a migrated image keeps its WebP ladder and is never prefixed', () => {
    const migrated = coverAttrs('/blog/images/2025/10/1.png', null, null, BASE);
    expect(migrated?.src.startsWith(BASE)).toBe(false);
    expect(migrated?.srcset).toBeTruthy();
    expect(migrated).toEqual(coverAttrs('/blog/images/2025/10/1.png', null, null));
  });
});
