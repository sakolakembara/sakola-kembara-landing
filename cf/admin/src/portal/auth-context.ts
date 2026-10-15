import { STUDENT_AUDIENCE } from "../auth/audience";
import { createAuthContext } from "../auth/session";

// Makes `c.get("auth")()` available on the portal Worker, for the student audience: the admin's `authContext`
// (src/auth/session.ts) for the other audience, so the portal gets what it has, and a change to it reaches both.
//
// Lazy: Better Auth is looked up on the first call, so a request that never touches auth (a 404, a `config`, a request
// without the portal's cookie: see src/portal/guard.ts) pays nothing for it. One instance per isolate: it was built on
// every request before (docs/cloudflare/free-plan-audit.md, "CPU on the hot routes"). The audience is in its key, so
// the student instance never answers for the admin's mount point or cookie name, nor the other way round.

export const studentAuthContext = createAuthContext(STUDENT_AUDIENCE);
