# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Keep this file short: the details live in `docs/` and in the Saung project notes.

## Workflow — read this first, every session

1. **Ticket first.** Every task, bug, or content change has a `SAKEM-NNN` ticket in Saung (project "Sakola Kembara"), created *before* writing code. Tickets are **not** stored in this repo. If you don't have Saung access, ask the user to open the ticket and tell you its ID.
2. **Read `docs/`.** Start with `docs/README.md` and `docs/mvp-status.md`, then the files relevant to the task (the map is in `docs/README.md`). `docs/` is the source of truth for why the site is shaped the way it is.
3. **Plan before editing.** For anything non-trivial or that touches public pages, summarise the plan first: files to change, the user-visible outcome, and constraints from `docs/`. Show it to the user.
4. **One PR = one ticket.** Branch from `main` and open the PR into `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`. **`main` is what is live:** production is deployed only from a clean checkout of `origin/main` (SAKEM-126). `dev.angga` is Anggara's branch and stays frozen. Put the ID in every commit — `type(scope): summary (SAKEM-NNN)` — and in the PR's "Ticket" field.
5. **Keep `docs/current-state/` current.** If the change is structural (new route, dependency, deploy step, data model), update the matching file in the same PR.
6. When the PR merges, close the ticket in Saung and paste the PR link.

Statuses, tags, ticket shape, and the definition of done live in the "Cara kerja" note on the Saung project.

## Guardrails

- **Tone is fixed; visuals change only through a ticket.** The Indonesian copy and voice are not up for redesign (`docs/context/tone-of-voice.md`). The visual style is documented in [`DESIGN.md`](DESIGN.md): follow it, and change it only through a SAKEM ticket whose PR also updates `DESIGN.md`.
- **No secrets or personal data** in tickets, commits, PRs, or docs: no passwords, tokens, `.env` contents, or student/applicant data. Name the variable, never its value.
- **Database changes** need a migration under `drizzle/` and a note on risk and deploy order in the ticket. See `docs/roadmap/data-model.md` and `docs/runbook/`.
- **Commands** (dev server, build, test, lint) come from the `package.json` scripts — don't guess them.

## Local setup (this Mac)

- **One working worktree for the Cloudflare code:** `../sakem-cf`, on a branch cut from `origin/main`. Switch branches inside it instead of adding a worktree per task (each one costs about 2 GB with `node_modules` and builds). A short-lived extra worktree is removed once its PR is merged (`git worktree remove`, then delete the merged branch).
- **Production vars live outside worktrees:** `~/.config/sakem/web.production.vars` and `admin.production.vars` (public per-deploy values, mode 600), symlinked as `cf/web/.production.vars` and `cf/admin/.production.vars`. If they are missing, rebuild them from the live version's plain-text bindings (`wrangler versions view <id> --name <worker> --json`).
- **Deploy only with the printed command** (`pnpm deploy:prod:command` in `cf/web` or `cf/admin`): it refuses to run unless the checkout is exactly `origin/main` and clean (SAKEM-126), and pins the organisation account (SAKEM-123). Never answer wrangler's "Select an account" prompt.
- **After a local e2e run**, delete wrangler logs older than 7 days (`~/Library/Preferences/.wrangler/logs`); they pile up by the thousand.
- `gh` default repo is `sakolakembara/sakola-kembara-landing` (`gh repo set-default`).
