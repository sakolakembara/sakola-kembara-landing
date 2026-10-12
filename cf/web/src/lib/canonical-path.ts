// One URL per page. The Next app answers a trailing slash with a 308 to the URL
// without it (trailingSlash: false); the Worker does the same for the pages it
// owns, and also folds `.html` URLs, which the assets layer would otherwise serve
// next to the clean ones (/blog.html showing /blog). The page's <link
// rel="canonical"> is the second line of defence, not the first.

/** The path this URL should have, or null when it already has it. */
export function canonicalPath(pathname: string): string | null {
  if (pathname === '/') return null;
  let path = pathname.replace(/\/+$/, '');
  path = path.replace(/\/index\.html$/, '').replace(/\.html$/, '');
  if (path === '') path = '/';
  return path === pathname ? null : path;
}
