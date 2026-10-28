// Proves the site's tests of the blog's SEO title and noindex are not vacuous (SAKEM-109): each check breaks ONE safeguard
// (the parser, the head of the article page, the sitemap), runs the tests that must notice, expects them to FAIL, and always
// restores the file. The admin's side (the API, the form) has its own checks in cf/admin/scripts/negative-checks-blog-seo.mjs.
//
//   node scripts/negative-checks-blog-seo.mjs        (pnpm test:negative:blog-seo)
//
// Run it on a clean tree. A pattern found other than exactly once is reported as FAIL.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
process.chdir(webRoot);

const TESTS = ['tests/blog-seo-fields.test.ts'];
const api = 'src/lib/blog-api.ts';
const seo = 'src/lib/seo.ts';
const sitemap = 'src/lib/sitemap.ts';
const page = 'src/pages/blog/[slug].astro';
const sitemapPage = 'src/pages/sitemap.xml.ts';

const checks = [
  // the parser
  { name: 'any truthy noindex hides an article ("true", 1)', file: api, from: '  if (raw.noindex === true) summary.noindex = true;', to: '  if (raw.noindex) summary.noindex = true;' },
  { name: 'the SEO title is not read from the API', file: api, from: '      seoTitle: str(payload.article.seoTitle),', to: '      seoTitle: null,' },

  // the head of the article page
  { name: 'the SEO title gets the site suffix', file: seo, from: '    title: input.seoTitle || pageTitle(input.title),', to: '    title: pageTitle(input.seoTitle || input.title),' },
  { name: 'og:title ignores the SEO title', file: seo, from: '      title: shownTitle,\n      description: input.description,\n      url:', to: '      title: input.title,\n      description: input.description,\n      url:' },
  { name: 'noindex stops following the links too', file: seo, from: "export const ROBOTS_NOINDEX = 'noindex, follow';", to: "export const ROBOTS_NOINDEX = 'noindex, nofollow';" },
  { name: 'noindex keeps the googlebot line that says index', file: seo, from: '    googlebot: input.noindex ? null : GOOGLEBOT_INDEX,', to: '    googlebot: GOOGLEBOT_INDEX,' },
  { name: 'the article page does not pass noindex', file: page, from: '    noindex: article.noindex === true,\n', to: '' },
  { name: 'the article page does not pass the SEO title', file: page, from: '    seoTitle: article.seoTitle,\n', to: '' },

  // the sitemap
  { name: 'the sitemap keeps an article hidden from search', file: sitemap, from: '    .filter((article) => article.noindex !== true)\n', to: '' },
  { name: 'the sitemap page lists the articles itself, without the helper', file: sitemapPage, from: 'const blogRoutes = blogSitemapEntries(articles.data);', to: 'const blogRoutes = blogSitemapEntries(articles.data.map((a) => ({ ...a, noindex: undefined })));' },
];

let bad = 0;
for (const check of checks) {
  const original = readFileSync(check.file, 'utf8');
  const found = original.split(check.from).length - 1;
  if (found !== 1) {
    console.log(`FAIL  ${check.name}: pattern found ${found} times in ${check.file}, expected exactly once`);
    bad++;
    continue;
  }
  try {
    writeFileSync(check.file, original.replace(check.from, () => check.to));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', ...TESTS], { encoding: 'utf8' });
    const failed = (run.stdout + run.stderr).match(/Tests\s+(\d+) failed/);
    if (run.status !== 0 && failed) console.log(`OK    ${check.name}: ${failed[1]} test(s) failed as they should`);
    else {
      console.log(`FAIL  ${check.name}: tests still pass (exit ${run.status})`);
      bad++;
    }
  } finally {
    writeFileSync(check.file, original);
  }
}
console.log(bad === 0 ? `\nAll ${checks.length} safeguards are covered by tests.` : `\n${bad} of ${checks.length} checks did not behave.`);
process.exit(bad === 0 ? 0 : 1);
