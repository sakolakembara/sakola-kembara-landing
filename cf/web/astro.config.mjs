import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import blogContent from './plugins/blog-content.mjs';
import { mirroredUploadRules, slashFoldPaths, toUnderscoreRedirects } from './redirects.config.mjs';
import { PORTAL_ENABLED_VARIABLE, parsePortalEnabled } from './portal-enabled.config.mjs';
import { BEACON_ID_VARIABLE, parseBeaconId } from './web-analytics.config.mjs';

// The legacy Next app lives two folders up. Its content/blog markdown is read in
// place (no copy); its public/ images go through scripts/build-assets.mjs, which
// writes the manifest the blog plugin reads. See docs/cloudflare/web-skeleton.md.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Where the blog comes from: `api` (default, the content API at request time) or
// `markdown` (the root content/blog rendered at build time and bundled: local
// development without the fixture API, never a deploy). See src/lib/blog.ts.
const blogSource = process.env.BLOG_SOURCE ?? 'api';
if (blogSource !== 'api' && blogSource !== 'markdown') {
  throw new Error(`BLOG_SOURCE must be "api" or "markdown", got "${blogSource}"`);
}

// The Cloudflare Web Analytics beacon id of the PRERENDERED pages (SAKEM-095). It comes only from the shell
// environment of this build (`WEB_ANALYTICS_BEACON_ID=<32 hex characters> pnpm build`), never from `.dev.vars` (the
// prerender's `env` holds that file) and never from the Worker variable, which static HTML cannot see. A value that is
// not a beacon id is ignored with a warning that does not repeat it. The pages the Worker renders read the Worker
// variable instead. See src/lib/web-analytics.ts and docs/cloudflare/web-skeleton.md, "Web Analytics".
const beaconId = parseBeaconId(process.env[BEACON_ID_VARIABLE]);
if (beaconId === null && (process.env[BEACON_ID_VARIABLE] ?? '').trim() !== '') {
  console.warn(`${BEACON_ID_VARIABLE} is set but is not a beacon id (32 hexadecimal characters): the prerendered pages are built without the beacon`);
}

// Whether the PRERENDERED pages offer the student portal ("Masuk" and the session script of the navbar; SAKEM-103, Phase A of
// the cutover). Like the beacon id it comes only from the shell environment of this build (`PORTAL_ENABLED=true pnpm build`),
// never from `.dev.vars` and never from the Worker variable, which static HTML cannot see; the pages the Worker renders read the
// Worker variable instead. Strict: exactly `true` switches it on, unset or `false` is off, anything else is off with one warning
// that does not repeat the value. See src/lib/portal-enabled.ts and docs/cloudflare/web-skeleton.md, "The student portal switch".
const portalSetting = parsePortalEnabled(process.env[PORTAL_ENABLED_VARIABLE]);
if (portalSetting === null) {
  console.warn(`${PORTAL_ENABLED_VARIABLE} is set but is neither "true" nor "false": the prerendered pages are built with the portal off`);
}
const portalEnabled = portalSetting === true;

/**
 * Writes the WordPress/legacy redirect table to dist/client/_redirects, where
 * the Workers assets layer answers it before the Worker is invoked. Astro's own
 * `redirects` option is not used: see redirects.config.mjs.
 */
function redirectsFile() {
  let clientDir;
  return {
    name: 'sakem:redirects-file',
    hooks: {
      'astro:config:done': ({ config }) => {
        clientDir = config.build.client;
      },
      'astro:build:done': async () => {
        // The prerendered pages are the .html files of the client folder (the home page and the 404 excluded):
        // each also gets its trailing-slash twin folded with a 308, see slashFoldPaths. The WordPress upload URLs of the
        // files this build ships under /blog/images get their own one-hop 308 (mirroredUploadRules): every other
        // /wp-content/uploads path is WordPress's and reaches the origin (src/lib/legacy-paths.ts).
        const files = (await readdir(clientDir, { recursive: true })).map((f) => String(f).replaceAll('\\', '/'));
        await writeFile(
          new URL('_redirects', clientDir),
          toUnderscoreRedirects(undefined, { slashFolds: slashFoldPaths(files), uploadMirrors: mirroredUploadRules(files) }),
        );
      },
    },
  };
}

export default defineConfig({
  site: 'https://sakolakembara.org',
  // Everything is SSR unless a page says `export const prerender = true`.
  output: 'server',
  // Prerendered pages are emitted as blog/<slug>.html and served at /blog/<slug>
  // (the URL shape the Next app has: no trailing slash).
  build: { format: 'file' },
  integrations: [redirectsFile()],
  adapter: cloudflare({
    // Plain <img> only. Images the pages import are resized at build time with
    // sharp; nothing is transformed at runtime (no Cloudflare Images binding).
    imageService: { build: 'compile', runtime: 'passthrough' },
  }),
  // Sessions are not used. The adapter's default driver would add a KV binding
  // (a resource to provision); an in-memory driver adds nothing.
  session: { driver: sessionDrivers.memory() },
  // Pass-through must be transparent. Astro's built-in origin check answers 403
  // to any POST/PUT/PATCH/DELETE with a form content type and no matching
  // Origin header, which would reject requests the legacy app accepts today
  // (server-to-server callbacks, curl, a form posted from the LMS host). The
  // Astro pages of this slice have no state-changing endpoints; when one is
  // added (the contact form), it validates Origin itself.
  security: { checkOrigin: false },
  devToolbar: { enabled: false },
  server: { host: true, port: process.env.PORT ? Number(process.env.PORT) : 4321 },
  vite: {
    define: { __BLOG_SOURCE__: JSON.stringify(blogSource), __WEB_ANALYTICS_BEACON_ID__: JSON.stringify(beaconId), __PORTAL_ENABLED__: JSON.stringify(portalEnabled) },
    plugins: [
      tailwindcss(),
      blogContent({
        contentDir: `${repoRoot}content/blog`,
        manifestFile: fileURLToPath(new URL('./src/generated/image-manifest.json', import.meta.url)),
      }),
    ],
    resolve: { alias: { '@root': repoRoot.replace(/\/$/, '') } },
    // Dev server only: allow imports of the legacy repo's public/ images.
    server: { fs: { allow: [repoRoot] } },
  },
});
