import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import blogContent from './plugins/blog-content.mjs';
import { toUnderscoreRedirects } from './redirects.config.mjs';

// The legacy Next app lives two folders up. Its content/blog markdown and its
// public/ images are the single source for this slice, so they are read in
// place (no copy). See docs/cloudflare/web-skeleton.md.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

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
        await writeFile(new URL('_redirects', clientDir), toUnderscoreRedirects());
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
    plugins: [
      tailwindcss(),
      blogContent({
        contentDir: `${repoRoot}content/blog`,
        publicDir: `${repoRoot}public`,
      }),
    ],
    resolve: { alias: { '@root': repoRoot.replace(/\/$/, '') } },
    // Dev server only: allow imports of the legacy repo's public/ images.
    server: { fs: { allow: [repoRoot] } },
  },
});
