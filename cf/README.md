# cf/

Independent Cloudflare Workers apps for the next version of sakolakembara.org (SAKEM-075). Not part of the Next.js app: the root `tsconfig.json`, ESLint config, Tailwind scan, Docker context and test runner all skip this folder.

- Each `cf/<app>/` has its own `package.json` and lockfile. It is **not** a pnpm workspace; install and run inside the app folder.
- `cf/web/` — public site: Astro 6 SSR on Workers. Serves the public pages and passes dynamic paths (`/login`, `/portal/*`, `/admin/*`, `/api/*`, ...) through to the legacy Next app so URLs, cookies and SSO do not change.
- `cf/admin/` — admin/portal backend slice: Hono API + React SPA + D1 + Better Auth, local only (SAKEM-078). Run and results: [`docs/cloudflare/admin-skeleton.md`](../docs/cloudflare/admin-skeleton.md).
- Later: `cf/api/` (Hono + D1) and `cf/admin/` (React SPA) for the admin and portal.
- Hard limit: Cloudflare Workers **Free** plan, $0. Design for 10 ms CPU per request and 100k requests per day.
- No secrets, account ids or resource ids in this folder. Local values go in untracked `.dev.vars`.

Why and how: [`docs/cloudflare/README.md`](../docs/cloudflare/README.md). Run and results for the web slice: [`docs/cloudflare/web-skeleton.md`](../docs/cloudflare/web-skeleton.md).
