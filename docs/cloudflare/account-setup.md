# Cloudflare account setup (owner's guide)

What the account owner does in the terminal and dashboard, and **when** each step is needed. Written for Dzul; nothing here is done by an agent. Ticket: SAKEM-077.

## Decisions this guide relies on

- Sakola Kembara runs in the **organisation account** (named after dzul@sakolakembara.org, plan **Free**; a payment card is on file only because enabling R2 requires one). The owner's personal account and any other account the login can see are **not** used.
- A single wrangler login can see several accounts (personal, organisation, client accounts). **Always pin the account explicitly** (`CLOUDFLARE_ACCOUNT_ID` or `--account-id`) and never run a command without it.
- Because the plan is Free, the 10 ms CPU limit is enforced there and error 1102 is a valid signal. Real per-route CPU is measured in this account (SAKEM-084).
- "$0" means no charges while staying inside the free tiers (R2: 10 GB storage, 1 million Class A and 10 million Class B operations per month). The card is not a spending cap: keep uploads small and set a usage or billing alert in the dashboard (Notifications).
- This repo is public: no account id, token, resource id or infrastructure hostname goes into a tracked file, ticket, PR or chat message. Say "done" or "failed", never the value.

## What is needed when

| Milestone | Needed from the account |
| --- | --- |
| M1 to M4 (building, local) | Nothing. All work runs locally. |
| M5 staging | Terminal login (Part 2), CI token and GitHub secrets (Part 3), and, once the staging database exists and has its migrations, the first super_admin ([`first-super-admin.md`](first-super-admin.md)). A `workers.dev` staging works for most checks, but the Workers Cache API is only documented to work on custom domains, so testing cache behaviour needs a staging subdomain on `sakolakembara.org`, which means an **active zone** (nameservers moved) before cutover. Open decision, see SAKEM-084. |
| Cutover | Zone and DNS, Resend domain, Turnstile, R2 public domain, rollback notes (Part 4). |

## Part 1: quick checks (5 minutes, now)

1. Sign in to the Cloudflare dashboard, switch to the organisation account and confirm: the plan is **Free** (Billing or Subscriptions), R2 is enabled, a usage or billing notification is set, and your role is **Administrator** (or equivalent), which you need to create tokens and resources.
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
- `wrangler whoami` lists every account the login can reach. Pin the **organisation** account for the shell instead of writing it in `wrangler.jsonc`:

  ```bash
  export CLOUDFLARE_ACCOUNT_ID=<id of the organisation account from wrangler whoami>   # this shell only, never committed
  ```

- When the staging work is finished: `pnpm exec wrangler logout`.
- Proposed names (not yet created): Workers `sakem-web-staging` and `sakem-admin-staging`, D1 `sakem-staging`, R2 `sakem-files-staging`. Creation is a separate approved step.
- Workers needs a `workers.dev` subdomain on the account; if the dashboard asks for one, pick it once (Workers & Pages, then the subdomain setting).

## Part 3: CI token (before CI deploys to staging)

1. Dashboard, **Manage Account**, **API Tokens**, **Create Token**, then **Custom token** (the "Edit Cloudflare Workers" template is a good starting point).
2. Name it `sakem-ci-staging`. Permissions to start with, all **Account** level: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Account Settings Read. Check the summary screen before creating.
3. Resources: **the organisation account only**. Set a TTL (for example 90 days) and note the renewal date.
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

> **Update 2026-10-15:** the zone `sakolakembara.org` is already active in the organisation account (Free plan) with the live WordPress site behind it, and the cutover is split in two: Phase A (the public site and the admin) first, the portal later. The steps below that say "add the zone" are done; what is left of this part, in order and with the commands, is [`cutover-runbook.md`](cutover-runbook.md#14-cutover-phase-a-the-public-site-and-the-admin-first-sakem-104), section 14.

- **Zone and DNS.** Staging does not need the zone. When the date is agreed: add `sakolakembara.org` to the account, compare the imported records with the current ones, export them (**DNS, Records, Export**) to a private place **outside the repo**, keep the existing records DNS-only, and change nameservers only on cutover day. The WordPress site and mail keep working until then.
- **Resend.** Create the account, add the domain, publish the SPF and DKIM records it shows, wait for "verified". The API key is created with sending access only and goes to the Worker as a secret (`wrangler secret put`), never into the repo.
- **Turnstile.** Create a widget for the production and staging hostnames. The site key is public, the secret key goes to the Worker as a secret.
- **R2 public domain.** A `files.` subdomain on the bucket, created at cutover (needs the zone). The steps, the bucket binding and `UPLOADS_BASE_URL`: [`uploads.md`](uploads.md#owner-steps-bucket-domain-variable).
- **Rollback notes.** Written in SAKEM-084 with the DNS export and the old VPS kept alive until cutover is verified.

## Report back (no values)

Tell Claude only: Part 1 done and role confirmed; Part 2 login done; Part 3 secrets set in `staging`; token expiry date. Nothing else is required before staging.
