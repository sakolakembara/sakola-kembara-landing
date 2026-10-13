// MOCK, local development only (see mock/install.ts). Not part of any build that ships.

/**
 * Who the mock signs in as, and what state their application is in. Picked with `?mock=<name>` in the address bar
 * (`pnpm dev:portal-spa:mock`, then http://localhost:5174/portal/?mock=submitted):
 *
 *   open                 a batch is open, nothing started (the default)
 *   no-batch             no batch is open
 *   draft                a batch is open and a draft is saved on the server
 *   submitted            the application is sent; the batch is not published (status: "sedang diproses")
 *   published-accepted   the batch is published, the student is accepted
 *   published-rejected   the batch is published, the student is not accepted (with a note)
 *   published-undecided  the batch is published but the application has no decision (the odd state)
 *   unverified           signed in with an address that is not verified (the banner)
 *   admin-account        an admin account (the "not a student" screen)
 *   error                the home and status calls fail (the "Coba lagi" screens)
 */
export const PERSONAS = [
  "open",
  "no-batch",
  "draft",
  "submitted",
  "published-accepted",
  "published-rejected",
  "published-undecided",
  "unverified",
  "admin-account",
  "error",
] as const;

export type Persona = (typeof PERSONAS)[number];

/** Reads the `?mock=` value. Anything unrecognised is the default, `open`. */
export function parsePersona(raw: string | null | undefined): Persona {
  return (PERSONAS as readonly string[]).includes(raw ?? "") ? (raw as Persona) : "open";
}
