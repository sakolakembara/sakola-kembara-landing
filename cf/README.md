# cf/

The Cloudflare Workers apps that run sakolakembara.org (live since the October 2026 cutover). Not part of the old Next.js app in the repository root: the root `tsconfig.json`, ESLint config, Tailwind scan, Docker context and test runner all skip this folder.

- Each `cf/<app>/` has its own `package.json` and lockfile. It is **not** a pnpm workspace; install and run inside the app folder.
- `cf/web/`: the public site, Astro 6 on the Worker `sakola-kembara-web`. It reads content from the admin Worker through a service binding and passes paths it does not own through to the old WordPress site on the same host. Run and results: [`docs/cloudflare/web-skeleton.md`](../docs/cloudflare/web-skeleton.md).
- `cf/admin/`: the API and admin, Hono + React SPA + D1 + R2 + Better Auth on the Worker `sakem-admin` (`admin.sakolakembara.org`). The student portal (`portal-spa/`, `wrangler.portal.jsonc`) is built but switched off in production. Run and results: [`docs/cloudflare/admin-skeleton.md`](../docs/cloudflare/admin-skeleton.md).
- `cf/scripts/`: the deploy command printers and dry runs, the `on-main` check (production deploys only from `origin/main`, SAKEM-126), the account pin (SAKEM-123), and the production and zone checkers.
- Hard limit: Cloudflare Workers **Free** plan, $0. Design for 10 ms CPU per request and 100k requests per day.
- No secrets, account ids or resource ids in this folder. Local values go in untracked `.dev.vars`; production public values in untracked `.production.vars`.

Why and how: [`docs/cloudflare/README.md`](../docs/cloudflare/README.md). Quick start and deploy: the root [`README.md`](../README.md).
