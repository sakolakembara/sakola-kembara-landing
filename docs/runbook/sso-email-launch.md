# SSO + Email Launch Checklist

> **Scope.** The extra plumbing needed to take the SSO handshake with the LMS (`lms.sakolakembara.org`) and transactional email (verification, password reset) from "landed in code" to "live in production". Everything in this doc happens **after** the main [`launch.md`](launch.md) has stood the site up.
>
> **Audience.** Whoever's rolling out the LMS integration to production. Assumes the main site is already live on `sakolakembara.org` and the VPS is provisioned.
>
> **Expected time.** ~90 minutes of attended work, plus DNS propagation waits (~1–4 hours before the sending domain verifies).

The three integration pieces move together — they share env vars and the same "coordinate with the LMS team" story — so this doc treats them as one rollout.

---

## Phase A — Things you must have before starting

- [ ] **Main site is live** on `https://sakolakembara.org` per [`launch.md`](launch.md). This doc doesn't stand up a new deploy.
- [ ] **Domain registrar access** for `sakolakembara.org` (DNS control). You'll add 3–4 TXT/CNAME records for email deliverability.
- [ ] **LMS team's ETA** for their own deployment. If they're weeks out, you can ship the SSO endpoints now — they're harmless until called. If they're days out, coordinate `SSO_JWT_SECRET` synchronously so you both hold the same value.
- [ ] **A Resend account** (or the recommended alternative — Postmark / SES both work with the same `lib/email.ts` shape, would just need a client swap). Free-tier signup at <https://resend.com>. Company email preferred over personal.
- [ ] **A one-time secret coordination channel** with the LMS team — Signal, in-person, or an encrypted note. `SSO_JWT_SECRET` MUST NOT travel over Slack DMs or unencrypted email.

---

## Phase B — Provision Resend + verify the sending domain

DNS propagation is the long pole; do this first so it can be baking while you do the rest.

### B.1 Create the API key

1. Log in at <https://resend.com>.
2. Sidebar → **API Keys** → **Create API Key**.
3. Name: `sakem-landing-prod`. Permission: **Full access** (Resend doesn't scope keys per domain; there's only one domain in this account).
4. Copy the key. It starts with `re_`. Save it in your password manager under "Sakola Kembara — Resend prod API key". This is the only time it's shown.

### B.2 Add the sending domain

1. Sidebar → **Domains** → **Add Domain**.
2. Enter `sakolakembara.org`. Choose region **AWS us-east-1** unless you have a specific reason for another (matters for latency but not deliverability).
3. Resend shows a list of DNS records to add. There are three groups:
   - **SPF** — a single `TXT` record on the apex.
   - **DKIM** — two `CNAME` records under `resend._domainkey` and `resend2._domainkey` (Resend uses two keys for rotation).
   - **DMARC** — a `TXT` record on `_dmarc`.
4. Copy each record's Name + Type + Value. Keep this tab open — you'll paste them into the DNS host.

### B.3 Add the records at your DNS host

Add them exactly as Resend shows. Two gotchas:

- **If a SPF `TXT` record already exists** on `sakolakembara.org` (from Google Workspace, Microsoft 365, etc.) — do NOT create a second one. Merge them. A single SPF record can only include one `v=spf1` prefix; you merge by appending Resend's include:
  ```
  v=spf1 include:_spf.google.com include:_spf.resend.com ~all
  ```
- **DMARC starts at `p=none`** — this puts DMARC in observation mode. Do NOT jump straight to `p=quarantine` or `p=reject` — one misconfigured record and legit mail starts bouncing. Observe for 2 weeks, then tighten.

Recommended DMARC value for launch:
```
v=DMARC1; p=none; rua=mailto:dmarc@sakolakembara.org; adkim=r; aspf=r
```

### B.4 Verify

1. In Resend's Domains page, click **Verify DNS Records**.
2. First attempt usually fails because propagation hasn't finished. Give it 15 minutes and retry. In the worst case (some registrars cache aggressively), allow up to 4 hours.
3. Once all three groups show **Verified** ✓, note the timestamp. Move on to Phase C while it settles.

---

## Phase C — Env vars on the VPS

SSH in as `deploy@vps` and edit the production env:

```bash
cd /opt/sakem
nano .env.production
```

Append (or edit if the SSO section already exists from an earlier edit) — grouped so they're easy to find later:

```dotenv
# ─── SSO / LMS integration ─────────────────────────────────────────
# The exact same SSO_JWT_SECRET must be set on the LMS Django side.
# Rotate quarterly (schedule a reminder). Generate with:
#   openssl rand -base64 32
SSO_JWT_SECRET=

# Parent domain the shared session cookie is scoped to. The leading dot
# is required so the cookie is visible on lms.sakolakembara.org.
SSO_COOKIE_DOMAIN=.sakolakembara.org

# Comma-separated CORS allow-list for /api/sso/{session,register,signout}
# AND the login-CSRF guard on state-changing calls. No wildcards.
# REQUIRED in production — POST /api/sso/{register,signout} FAIL CLOSED when
# this is empty, rejecting every origin including the real LMS. That is
# deliberate: these endpoints mint a session cookie, and Set-Cookie lands in
# the victim's jar whether or not CORS lets an attacker read the reply, so a
# forgotten variable must break registration loudly rather than open
# login-CSRF to the internet. Symptom: every register call returns
# 403 {"reason":"forbidden_origin"}.
SSO_ALLOWED_ORIGINS=https://lms.sakolakembara.org

# ─── Transactional email (Resend) ──────────────────────────────────
RESEND_API_KEY=                # from Phase B.1 — starts with re_
EMAIL_FROM=Sakola Kembara <no-reply@sakolakembara.org>
APP_URL=https://sakolakembara.org
```

`SSO_JWT_SECRET` — generate on the VPS itself and share with the LMS team over your one-time secret channel:

```bash
openssl rand -base64 32
```

Save the file. Restart the app:

```bash
docker compose up -d --force-recreate app
docker compose logs -f app 2>&1 | head -40
```

Look for the "Ready" line and the absence of any `[auth]`, `[sso]`, or `[email]` errors.

---

## Phase D — Verify each piece

Everything here uses `curl` from your laptop or the VPS itself. Do them in order — each depends on the previous.

### D.1 SSO cookie mints on sign-in

Sign in as an existing admin via the credentials form (or Google). Then inspect the cookies your browser holds for `sakolakembara.org`. You should see **both**:
- `authjs.session-token` — the existing Auth.js host-only cookie
- `sakem-session` — the new cross-subdomain cookie, `Domain=.sakolakembara.org`

If `sakem-session` is missing, `SSO_JWT_SECRET` isn't loaded — env vars are read at container boot, so a `docker compose up -d --force-recreate app` after editing `.env.production` is required.

### D.2 Session probe endpoint

Copy the `sakem-session` cookie value out of DevTools, then:

```bash
curl -s -b "sakem-session=<paste>" https://sakolakembara.org/api/sso/session
```

Expected:
```json
{"authenticated": true, "user": {"sub":"...", "email":"...", "emailVerified": true, "landingRole":"super_admin", "acceptedInBatches": []}}
```

### D.2b Live-claims check (the endpoint reads the DB, not the cookie)

`GET /api/sso/session` re-reads Postgres on every call, so revoking an
acceptance takes effect immediately rather than waiting up to 30 days for the
JWT to expire. Confirm on a throwaway account:

```bash
# 1. With an accepted, published application, note acceptedInBatches:
curl -s -b "sakem-session=<paste>" https://sakolakembara.org/api/sso/session

# 2. In /admin, reject that application (or un-publish the batch results).

# 3. Same cookie, unchanged — acceptedInBatches must now be []:
curl -s -b "sakem-session=<paste>" https://sakolakembara.org/api/sso/session
```

If step 3 still lists the batch, the deploy is running pre-2026-08-28 code.

The response also carries a refreshed `Set-Cookie` whose `exp` is unchanged —
re-issuing keeps claims current without extending the session. Check with
`curl -sD - ... | grep -i set-cookie`.

### D.3 CORS + Origin guard

```bash
# Should return CORS headers because origin is in the allow-list:
curl -sI -X OPTIONS https://sakolakembara.org/api/sso/session \
  -H "Origin: https://lms.sakolakembara.org" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control

# Should return NO CORS headers because origin isn't allow-listed:
curl -sI -X OPTIONS https://sakolakembara.org/api/sso/session \
  -H "Origin: https://evil.example.com" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control

# Should 403 — state-changing POST from a non-allow-listed origin:
curl -sI -X POST https://sakolakembara.org/api/sso/register \
  -H "Origin: https://evil.example.com" \
  -H "Content-Type: application/json" \
  -d '{"name":"x","email":"e@e.com","password":"12345678"}' | head -1
```

### D.4 Email verification round-trip

Register a real disposable email you can check the inbox of (or your own with a `+test` suffix):

1. Visit `https://sakolakembara.org/register`. Fill the form. Submit.
2. Within 30s, the "Verifikasi email Sakola Kembara" email should arrive at that address.
3. **Check that From is `no-reply@sakolakembara.org`** (not `onboarding@resend.dev`). If it's the Resend sandbox, the domain verification didn't take — go back to Phase B.
4. Click the verify link. Should land on `/verify-email` with "Email kamu berhasil diverifikasi".
5. Sign in on `/login` with the same credentials. Portal loads without the yellow verification banner.

### D.5 Password reset round-trip

1. `https://sakolakembara.org/forgot-password` → enter the same email → submit.
2. Within 30s, the "Reset password akun Sakola Kembara" email should arrive.
3. Click the reset link. Set a new password. Portal loads, signed in.
4. Sign out. Sign back in with the new password — should work.
5. Sign out. Try the old password — should fail with "Email atau password salah".

### D.6 Enumeration probe (should NOT reveal which emails exist)

```bash
# Known email
curl -sI -X POST https://sakolakembara.org/forgot-password \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@sakolakembara.org" | head -1
# Unknown email
curl -sI -X POST https://sakolakembara.org/forgot-password \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=nobody@nowhere.example" | head -1
```

Both should look identical from the outside. (No email actually gets sent to the unknown address — that's the point of silent-200.)

### D.7 Cross-subdomain visibility (when the LMS is up)

Only when the LMS team has landed their Django-side auth backend:

1. Sign in on `https://sakolakembara.org`.
2. Navigate to `https://lms.sakolakembara.org/` (any authenticated page).
3. Django logs should show `LMSUser` provisioned with the correct `landing_user_id`, `email`, and `accepted_batch_ids`.
4. Sign out on landing → visit LMS again → LMS should either redirect to `/login` or auto-provision a fresh session.

If step 3 shows an unauthenticated request even though landing has an active session, check:
- LMS Django's `SSO_JWT_SECRET` matches landing's (a single-character mismatch fails silently as "invalid token").
- Cookie's `Domain` in the browser is `.sakolakembara.org` (with the leading dot) — otherwise it doesn't cross to the subdomain.

---

## Phase E — Post-launch monitoring (first 14 days)

Set calendar reminders — this stuff always fails at hour 22 of day 3, not on launch day.

- [ ] **Resend dashboard** — check bounce + complaint rates daily for the first week. Bounce rate > 5% or complaint rate > 0.1% means the domain reputation is drifting; investigate immediately.
- [ ] **Application logs** — search for `[auth]`, `[sso]`, `[email]` prefixes. Sentry should be capturing anything thrown; log lines are the "quietly wrong" cases.
- [ ] **DMARC reports** land at whatever address you set in `rua=`. Skim weekly. Look for legitimate-looking senders that are failing DMARC — those are your leftover senders (marketing tools, cron alerters) that need to move to Resend or need their own SPF include.
- [ ] **After 2 weeks of clean DMARC reports**, tighten to `p=quarantine` (rejected mail lands in spam) and observe for 2 more weeks. Only then move to `p=reject`.
- [ ] **`SSO_JWT_SECRET` rotation** is a quarterly manual task. Publish a new value, both apps accept OLD-or-NEW for a 24h window, then landing switches to NEW-only and LMS drops OLD. See the "Signing key" section in [`../architecture/lms-integration.md`](../architecture/lms-integration.md).

---

## Rollback

If any part of this rollout goes sideways, you can safely walk it back — the code is designed to be dormant when the env vars aren't set.

- **SSO endpoints acting up**: unset `SSO_JWT_SECRET` in `.env.production` and restart. Landing keeps working; LMS gets 401 on its integration. Auth.js's own sign-in flow is untouched.
- **Email vendor rejecting**: unset `RESEND_API_KEY`. Verification / reset flows still run but emails go to the container's stdout (via the dev fallback). Users lose self-service verification until you fix Resend, but no data loss.
- **DNS records causing a mail deliverability crisis** at the org (unrelated senders bouncing because you edited SPF wrong): revert the SPF `TXT` record. Resend will unverify the domain within an hour; email sending falls back to the sandbox `onboarding@resend.dev` sender until you fix it.
- **CSRF guard blocking legit LMS traffic**: check `SSO_ALLOWED_ORIGINS` value on the VPS. If it is **empty or missing**, the guard fails closed and rejects everything — that is the most likely cause of a blanket `403 forbidden_origin`. If the LMS runs on a different origin than `https://lms.sakolakembara.org` (e.g. behind a `www.` you didn't expect), add it. Env vars are read at container boot, so restart with `docker compose up -d --force-recreate app`.

---

## Related docs

- [`launch.md`](launch.md) — the main site cutover; do first.
- [`../architecture/lms-integration.md`](../architecture/lms-integration.md) — the JWT contract, Django-side integration guide, and full landing-side checklist grouped by milestone. This runbook is the ops summary; that doc is the developer reference.
- [`../architecture/authentication.md`](../architecture/authentication.md) — how landing's own auth works. Read this if a sign-in behavior surprises you.
- [`../current-state/deployment.md`](../current-state/deployment.md) — steady-state ops (deploys, restarts, backups).
