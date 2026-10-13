// What the admin SPA and the Worker agree on about Turnstile: the shared file (cf/admin/shared/spa/captcha.ts, also
// used by the student portal's SPA) at its old path, plus the admin's own routes. Pure, like the shared file: the
// Worker's contract test imports it (test/spa-contract.test.ts).
import { type TurnstileAction, turnstileRoutes } from "../../../shared/spa/captcha";

export * from "../../../shared/spa/captcha";

// The admin has no registration page: `register` is the portal's.
const { register: _register, ...adminRoutes } = turnstileRoutes("/api");

/**
 * The route each action protects, as the admin SPA calls it. The contract test checks that the Worker's route table
 * (`AUTH_POLICIES` in src/auth/gate.ts) asks for exactly this action on exactly these routes.
 *
 * `resend-verification` has no button in the admin SPA: Better Auth sends a fresh link by itself when an unverified
 * account signs in. The portal's registration page does use it.
 */
export const TURNSTILE_ROUTES: Record<Exclude<TurnstileAction, "register">, string> = adminRoutes;
