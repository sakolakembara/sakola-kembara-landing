# Cloudflare account setup (owner's guide)

What the account owner does in the terminal and dashboard, and **when** each step is needed. Written for Dzul; nothing here is done by an agent. Ticket: SAKEM-077.

## Decisions this guide relies on

- Sakola Kembara runs in the **existing** Cloudflare account of designbydzul@gmail.com. dzul@sakolakembara.org is a member of it. There is no separate organisation account.
- That account is on **Workers Paid**, so the Free 10 ms CPU limit is not enforced there. CPU is judged from per-route CPU-time metrics instead (SAKEM-084).
- The account already holds unrelated Workers, D1 databases and R2 buckets. Everything for Sakola Kembara is created with the prefix **`sakem-`** and nothing existing is touched.
- This repo is public: no account id, token, resource id or infrastructure hostname goes into a tracked file, ticket, PR or chat message. Say "done" or "failed", never the value.

## What is needed when

| Milestone | Needed from the account |
| --- | --- |
| M1 to M4 (building, local) | Nothing. All work runs locally. |
| M5 staging | Terminal login (Part 2), CI token and GitHub secrets (Part 3), `workers.dev` subdomain. The zone is **not** needed: staging lives on `workers.dev`. |
| Cutover | Zone and DNS, Resend domain, Turnstile, R2 public domain, rollback notes (Part 4). |

## Part 1: quick checks (5 minutes, now)

1. Sign in to the Cloudflare dashboard as dzul@sakolakembara.org and confirm the account is listed. Note the role you have: you need **Administrator** (or equivalent) to create tokens and resources.
2. Check your GitHub permission on the repo (needed for environment secrets):

   ```bash
   gh api repos/sakolakembara/sakola-kembara-landing --jq .permissions
   ```

   `"admin": true` means you can add secrets yourself. If it is false, ask a repo admin (Anggara or Faishal) to create the environments and **type the secret in themselves**; never send a token to anyone through chat.

## Part 2: terminal login (before the first staging deploy)

```bash
cd cf/web
pnpm exec wrangler login          # opens the browser; approve as the account owner
pnpm exec wrangler whoami         # lists the accounts you can reach
```

- `wrangler login` stores the session in your user profile in plain text. `wrangler login --use-keyring` keeps it in the macOS keychain instead.
- The login belongs to the Mac user, **not to one terminal**: any `wrangler` command run on this Mac afterwards, including by Claude, uses it. That is why every deploy or resource command needs your explicit OK per step.
- Because the account holds other projects, pin the account for the shell instead of writing it in `wrangler.jsonc`:

  ```bash
  export CLOUDFLARE_ACCOUNT_ID=<id shown by wrangler whoami>   # this shell only, never committed
  ```

- When the staging work is finished: `pnpm exec wrangler logout`.
- Proposed names (not yet created): Workers `sakem-web-staging` and `sakem-admin-staging`, D1 `sakem-staging`, R2 `sakem-files-staging`. Creation is a separate approved step.
- Workers needs a `workers.dev` subdomain on the account; if the dashboard asks for one, pick it once (Workers & Pages, then the subdomain setting).

## Part 3: CI token (before CI deploys to staging)

1. Dashboard, **Manage Account**, **API Tokens**, **Create Token**, then **Custom token** (the "Edit Cloudflare Workers" template is a good starting point).
2. Name it `sakem-ci-staging`. Permissions to start with, all **Account** level: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Account Settings Read. Check the summary screen before creating.
3. Resources: **this account only**. Set a TTL (for example 90 days) and note the renewal date.
4. Create it and copy the secret once (it is shown only once). Check that it works without putting it in your shell history:

   ```bash
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN   # paste, press Enter (input is hidden)
   pnpm exec wrangler whoami                                      # should list the account
   unset CLOUDFLARE_API_TOKEN
   ```

   While `CLOUDFLARE_API_TOKEN` is set, wrangler uses it instead of the browser login. A token made under **Manage Account** belongs to the account, so it keeps working if a member leaves.
5. Store it as a **GitHub environment secret**. `staging` does not exist yet (only `production` does); create it in the repo settings, then:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --env staging --repo sakolakembara/sakola-kembara-landing
   gh secret set CLOUDFLARE_ACCOUNT_ID --env staging --repo sakolakembara/sakola-kembara-landing
   ```

   `gh` prompts for the value, so it does not end up in your shell history. Clear the clipboard afterwards.
6. If a deploy fails with a permission error, add exactly the permission the error names (for routes or custom domains that is usually a **Zone** permission on `sakolakembara.org` only). Do not widen to "all zones" or "all accounts".

## Part 4: before cutover (not now)

- **Zone and DNS.** Staging does not need the zone. When the date is agreed: add `sakolakembara.org` to the account, compare the imported records with the current ones, export them (**DNS, Records, Export**) to a private place **outside the repo**, keep the existing records DNS-only, and change nameservers only on cutover day. The WordPress site and mail keep working until then.
- **Resend.** Create the account, add the domain, publish the SPF and DKIM records it shows, wait for "verified". The API key is created with sending access only and goes to the Worker as a secret (`wrangler secret put`), never into the repo.
- **Turnstile.** Create a widget for the production and staging hostnames. The site key is public, the secret key goes to the Worker as a secret.
- **R2 public domain.** A `files.` subdomain on the bucket, created at cutover (needs the zone).
- **Rollback notes.** Written in SAKEM-084 with the DNS export and the old VPS kept alive until cutover is verified.

## Report back (no values)

Tell Claude only: Part 1 done and role confirmed; Part 2 login done; Part 3 secrets set in `staging`; token expiry date. Nothing else is required before staging.
