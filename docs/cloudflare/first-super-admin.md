# The first super_admin (owner's runbook)

How the owner creates the first super_admin on an empty D1 database, local, staging or production, **without a public sign-up and without a password in chat, in the repo or in the shell history**. Ticket: SAKEM-087. Written for Dzul; an agent never runs the remote steps.

## Why it needs its own path

Pengaturan is where admins are invited, and only a super_admin can open Pengaturan. So the first super_admin cannot come from inside the app. The legacy app solved this with `SEED_SUPER_ADMIN_EMAIL` (and a password) read by a seed script (`lib/env.ts`, `seed:super-admin`). The new admin has no public registration for admins by decision ([`auth.md`](auth.md)), so this is the one step that happens outside it.

## The design, and what was not chosen

**A command the owner runs on their own machine** (`pnpm first-admin`, `cf/admin/scripts/create-first-admin.ts`). It asks for the address and the password at a hidden prompt, hashes the password **locally** with the Worker's own `hashPassword` (PBKDF2-SHA256, 100,000 iterations, the stored format of `src/auth/password.ts`), and runs three guarded `INSERT`s with `wrangler d1 execute --file`. Only the hash reaches the database; the password exists in the terminal and in memory while the hash is made.

Chosen over:

| Alternative | Why not |
| --- | --- |
| A seed on the Worker's first start, from `SEED_SUPER_ADMIN_EMAIL` and a password secret (what the legacy app did) | Puts a password in a Worker secret and bootstrap code that runs in the public Worker on an empty database. It would have to be an unauthenticated path that creates a super_admin, even if it switches itself off afterwards. |
| A one-time HTTP route with a token | A public route that creates admins is the thing the decision "no public admin sign-up" rules out, and the token is one more secret to leak. |
| Typing `INSERT` statements with `wrangler d1 execute --command` | Needs a PBKDF2 hash made by hand (by what tool?), puts the hash on the command line (shell history) and has no guard against a second super_admin or a taken address. |
| Signing in with Google only, no password | Possible later; it still needs a user row to link to, and Google may not be configured on staging. The password path works with nothing but D1. |

## What the command does, and refuses

In order, and in this order on purpose:

1. Reads the options. A real database needs `--remote` **and** `--database <name>` spelled out (there is no default for it). Without `--remote` it only ever runs `wrangler ... --local`.
2. Asks for the address (twice), a name (Enter = the part before the `@`), and the password (twice, **not shown**). The password is never an argument or an environment variable. A password under 8 or over 128 characters is refused, like the Worker does.
3. Hashes the password and asks for a confirmation **before any command reaches a database, even a read-only one**: `y` for a local database; for a remote one, the **database name typed back exactly**. Anything else stops with nothing done.
4. Looks at the database and **refuses when a super_admin who can sign in already exists** ([the rule](auth.md#the-last-super_admin)) or when the address already has an account of any role. A database whose only super_admin is an invitation nobody could open is not locked out of this command: that is the situation it exists to repair, so it proceeds. When the migrations are missing it says so.
5. Writes the SQL to a private temporary directory **outside the repository** (mode 0600), runs it, and deletes it whatever happens. The SQL carries its own conditions as well: the user row is only inserted while no super_admin who can sign in exists, and the password and audit rows only when the user row was written. Running the file twice, or twice by two people, creates one admin.
6. Looks again, and reports success only if the database shows that address as a super_admin who can sign in. It prints neither the password nor the hash, and hides the hash from wrangler's error text.

What it writes: the user (`super_admin`, **address marked verified**: like every admin who has an account, since an admin never has to verify an address ([`auth.md`](auth.md#admins-and-email-verification), SAKEM-089), and besides there is no mailbox flow on a database with no admin and you typed the address yourself, twice), the `credential` account holding the hash, and one audit row `admin.create` (the new admin is the actor), which Aktivitas shows as "Admin ditambahkan".

`--no-run --out <file>` only writes the SQL (mode 0600; it refuses a path inside the repository or a file that exists) and prints how to run it, for anyone who wants to read it first. Then deleting the file is yours to do; it holds the password hash.

## The steps

### 1. Rehearse on your own machine (any time, no account)

```bash
cd cf/admin
pnpm install --frozen-lockfile
pnpm db:migrate:local        # a clean local D1: all twelve migrations, 0000 to 0011
pnpm first-admin             # the local database; answer the questions
pnpm dev                     # builds the SPA, runs wrangler dev; sign in with what you typed
```

`pnpm check:first-admin` does the same without you: a clean D1 in a temporary directory, the real command, `wrangler dev` on a free port, and a sign-in through the Worker's route (see [What was tested](#what-was-tested)).

### 2. A real database (staging, then production), by the owner

The database comes from the deploy ticket (SAKEM-084). Names and ids stay out of the repo: pin the **organisation** account in this shell as [`account-setup.md`](account-setup.md#part-2-terminal-login-before-the-first-staging-deploy) says (`export CLOUDFLARE_ACCOUNT_ID=...`, this shell only), and use the wrangler configuration the deploy ticket gives you, which has the database id. Pass it with `--config` if it is not `wrangler.jsonc`.

1. **Apply the migrations** to that database and check that all twelve are in (`0000` to `0011`; on a database with no data the order against the Worker does not matter, [`auth.md`](auth.md#the-last-super_admin) has it for one that has):

   ```bash
   pnpm exec wrangler d1 migrations apply <database-name> --remote
   pnpm exec wrangler d1 execute <database-name> --remote --command \
     "SELECT type, name FROM sqlite_master WHERE name IN ('signable_super_admins', 'users_keep_one_super_admin')"
   # two rows: a view and a trigger
   ```

2. **Run the command**, naming the database again:

   ```bash
   pnpm first-admin --database <database-name> --remote
   ```

   It says in capitals that it is the real database, asks the questions, then asks you to type the database name. Wrangler may ask its own confirmation for a remote file: answer it.

3. **Sign in** at the admin host with the address and the password, open **Pengaturan**, and invite the other admins. They choose their own passwords through the invitation link, so the Worker needs Resend configured (`RESEND_API_KEY`, `EMAIL_FROM`) before then. Signing in as this admin needs no email at all.

4. **Check Aktivitas:** the first row is "Admin ditambahkan" with your address as the actor.

Do it on staging first, with an address you control, and again on production. Production's first super_admin is whoever the owner decides; they can invite a second one the same day (an invitation that is still unopened does not count as a second super_admin, so the first one cannot step down until it is accepted).

## The password, the shell history and the clipboard

- The command line you type is `pnpm first-admin --database <name> --remote`. It contains **no secret**, so the history line is harmless. The password is typed at the hidden prompt, which neither the history nor the process list sees.
- **Do not feed it through a pipe or a here-string** (`echo ... | pnpm first-admin`, `printf`). The command reads answers from standard input when it is not a terminal, so that the tests can drive it; for you that would put the password in the history or on a command line. Always run it from an interactive terminal.
- Paste the password from a password manager if you like; clear the clipboard afterwards. Choose a long passphrase: it is the only thing between the internet and the first super_admin.
- Never send the password, the hash, or the file made by `--no-run` through chat, a ticket or the repo. A hash is a password in disguise: 100,000 rounds slow a guess down, they do not make a short password safe.
- **If a password ended up on a command line or in a chat by mistake:** treat it as burned. Sign in and change it with "Lupa password" (it needs email), or, if you cannot, see recovery below. Then remove the line from your shell history (`history -d <n>` in the shell, or edit the history file) and delete the message where you can.
- If the process is killed between writing and deleting the file, the temporary directory `sakem-first-admin-*` under your system's temp directory may remain; delete it. It holds a hash, not the password.

## When something goes wrong

| What you see | What it means, and what to do |
| --- | --- |
| "A super_admin who can sign in already exists" | There is already one. Sign in and invite others from Pengaturan. If nobody can remember the password: "Lupa password" for that address (needs Resend); if that address is not reachable either, see "Locked out" below. |
| "That address already has an account (any role)" | A student or another admin has it. Use another address (a student cannot be promoted by this command or by an invitation). |
| "The database has no tables yet, or it is missing migration 0010" | Apply the migrations first (step 2.1). |
| The statements ran but the check does not show the admin | Do **not** run it twice blindly. Look: `pnpm exec wrangler d1 execute <name> --remote --command "SELECT id, email, role, email_verified FROM users"`, and `... "SELECT user_id, provider_id FROM account"`. A user without an account is not signable; delete that user row (below) and run the command again. |
| You mistyped the address | It was typed twice, so this is rare. The admin is signable under the wrong address, so the command refuses another run. On a database that has nothing else in it yet, delete that user and run the command again: `pnpm exec wrangler d1 execute <name> --remote --command "DELETE FROM users WHERE email = '<the wrong one>'"` (its account and sessions go with it; every other table only loses the link, and the audit row keeps its actor's address). Do not leave a super_admin under an address that belongs to a stranger: "Lupa password" on it would hand them the account. |
| **Locked out** (the only super_admin lost the password and their address cannot receive email) | You hold the database, so you are the break-glass, by a direct write that no guard stops. Take that account's way in: `... --command "DELETE FROM account WHERE user_id = (SELECT id FROM users WHERE email = '<their address>')"` (what goes is the password nobody remembers, and a linked Google account, which links again at their next Google sign-in; the user row, its role and its audit trail stay). It stops counting, so run `pnpm first-admin` with another address (it accepts a database where nobody can sign in), sign in, and decide about the old account from Pengaturan: it reads "Diundang" now (no way in), so "Kirim ulang undangan" sends it a link once its address can receive mail, or demote or deactivate it, which is allowed because it does not count. (Setting `email_verified = 0` no longer takes an admin out of the count: an admin never has to verify an address, SAKEM-089.) Do it from the owner's machine only and write down when. |

## What was tested

Everything below ran on this machine against a local D1. **Nothing was run against Cloudflare**: no `wrangler login`, no remote command, no real database.

- `test/first-admin.test.ts` (17 tests, in the Worker suite; the "Locked out" statement of the runbook is one of them, run as written): the SQL on an empty database, then a sign-in through the Worker's own route, `/api/me` as a super_admin, Pengaturan listing the admin as active, Aktivitas showing the audit row; the hash verifying with the Worker's `verifyPassword` in the stored format, two runs giving two salts; the password nowhere in the SQL; a quote in an address and an SQL-shaped name stored as text; nothing written when a super_admin who can sign in exists (run twice too); an unopened invitation not stopping it; a taken address failing at the first statement with nothing left behind; the account and audit rows following the user row only; the checks of the command (address, name, password bounds equal to the Worker's, literals).
- `pnpm check:first-admin` (20 checks): a clean local D1 gets all twelve migrations; `--remote` without `--database` is refused; `--remote` with the name typed wrong is refused **and no wrangler call was attempted** (a stand-in `pnpm` records any call); a short password, two different passwords, and an answer other than `y` all write nothing; the real command creates the admin (exit 0) and its temporary directory is gone; a second run is refused; `--no-run --out` inside the repository is refused, outside it writes mode 0600 with the hash and not the password, and does not overwrite; `wrangler dev` starts on a free port, a wrong password gets 401, the typed password signs in (200 and a cookie), the session is a super_admin, Pengaturan lists one active admin, Aktivitas shows the creation first; the password and the hash appear nowhere in what the command printed.
- Negative checks (`node scripts/negative-checks.mjs --only "last-super-admin: the first-admin"`, five): the SQL writing when a super_admin who can sign in exists, counting an unopened invitation, writing the password row without the user row, holding the password itself instead of its hash, not doubling quotes. Each makes the tests fail.

**Not verified:** the `--remote` path itself (`wrangler d1 execute --remote --file`: whether a remote D1 runs a file as one transaction is not documented, which is why each statement carries its own condition and the command checks the result), a wrangler configuration with the database id kept outside the repository (how the deploy ticket supplies it decides what `--config` should be), the interactive hidden prompt in a real terminal (the tests use the non-terminal path; the raw-mode prompt is the part nobody has typed into), and Windows.
