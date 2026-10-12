import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import blogContent from './plugins/blog-content.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

// Unit tests run in plain Node. The blog virtual modules come from the same
// plugin the build uses, so the tests see exactly what the pages see.
export default defineConfig({
  plugins: [blogContent({ contentDir: `${repoRoot}content/blog`, publicDir: `${repoRoot}public` })],
  // '@' is the legacy app's own path prefix; the tests import a few of its files.
  resolve: { alias: { '~': `${root}src`, '@root': repoRoot.replace(/\/$/, ''), '@': repoRoot.replace(/\/$/, '') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
