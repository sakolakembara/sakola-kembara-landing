import { describe, expect, it } from 'vitest';
import { canonicalPath } from '~/lib/canonical-path';

describe('canonicalPath', () => {
  it.each([
    ['/tim/', '/tim'],
    ['/blog/', '/blog'],
    ['/blog/some-slug/', '/blog/some-slug'],
    ['/blog.html', '/blog'],
    ['/blog/some-slug.html', '/blog/some-slug'],
    ['/index.html', '/'],
    ['/blog/index.html', '/blog'],
    ['/a//', '/a'],
    ['/robots.txt/', '/robots.txt'],
  ])('%s -> %s', (from, to) => {
    expect(canonicalPath(from)).toBe(to);
  });

  it.each(['/', '/tim', '/blog/some-slug', '/robots.txt', '/sitemap.xml', '/a.b'])('%s is already canonical', (p) => {
    expect(canonicalPath(p)).toBeNull();
  });
});
