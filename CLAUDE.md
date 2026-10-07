# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo. Keep this file short: the details live in `docs/` and in the Saung project notes.

## Workflow — read this first, every session

1. **Ticket first.** Every task, bug, or content change has a `SAKEM-NNN` ticket in Saung (project "Sakola Kembara"), created *before* writing code. Tickets are **not** stored in this repo. If you don't have Saung access, ask the user to open the ticket and tell you its ID.
2. **Read `docs/`.** Start with `docs/README.md` and `docs/mvp-status.md`, then the files relevant to the task (the map is in `docs/README.md`). `docs/` is the source of truth for why the site is shaped the way it is.
3. **Plan before editing.** For anything non-trivial or that touches public pages, summarise the plan first: files to change, the user-visible outcome, and constraints from `docs/`. Show it to the user.
4. **One PR = one ticket.** Branch from `development`, the team integration branch, and open the PR into `development`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`. `main` only receives releases from `development`; `dev.angga` is Anggara's branch and stays frozen. Put the ID in every commit — `type(scope): summary (SAKEM-NNN)` — and in the PR's "Ticket" field.
5. **Keep `docs/current-state/` current.** If the change is structural (new route, dependency, deploy step, data model), update the matching file in the same PR.
6. When the PR merges, close the ticket in Saung and paste the PR link.

Statuses, tags, ticket shape, and the definition of done live in the "Cara kerja" note on the Saung project.

## Guardrails

- **Tone is fixed; visuals change only through a ticket.** The Indonesian copy and voice are not up for redesign (`docs/context/tone-of-voice.md`). The visual style is documented in [`DESIGN.md`](DESIGN.md): follow it, and change it only through a SAKEM ticket whose PR also updates `DESIGN.md`.
- **No secrets or personal data** in tickets, commits, PRs, or docs: no passwords, tokens, `.env` contents, or student/applicant data. Name the variable, never its value.
- **Database changes** need a migration under `drizzle/` and a note on risk and deploy order in the ticket. See `docs/roadmap/data-model.md` and `docs/runbook/`.
- **Commands** (dev server, build, test, lint) come from the `package.json` scripts — don't guess them.
