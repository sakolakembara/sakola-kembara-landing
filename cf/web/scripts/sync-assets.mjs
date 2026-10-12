// Copies the few files whose URL must be stable and live at the site root from
// the legacy app into this app's public/ folder, so the Worker serves them from
// its own assets (free, no origin hop) while the legacy files stay the single
// source. Run by `pnpm dev` and `pnpm build`; the copies are gitignored.
//
//   app/favicon.ico, app/icon.png, app/apple-icon.png  <link rel="icon"> targets
//   public/og-default.jpg                              default og:image / twitter:image
//   public/images/logo-sakola-kembara.png              Organization/Article JSON-LD logo URL
//
// Everything else the pages use is imported by the components, which gives it a
// hashed URL and (for photos) a build-time resize. See docs/cloudflare/web-skeleton.md.

import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..'); // legacy repo root
const publicDir = path.resolve(here, '../public');

export const SYNCED = [
  ['app/favicon.ico', 'favicon.ico'],
  ['app/icon.png', 'icon.png'],
  ['app/apple-icon.png', 'apple-icon.png'],
  ['public/og-default.jpg', 'og-default.jpg'],
  ['public/images/logo-sakola-kembara.png', 'images/logo-sakola-kembara.png'],
];

export function syncAssets() {
  for (const [from, to] of SYNCED) {
    const dest = path.join(publicDir, to);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(root, from), dest);
  }
  return SYNCED.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`sync-assets: copied ${syncAssets()} files into public/`);
}
