import type { Auth } from "./auth/factory";
import type { GrantableArea } from "./auth/permissions";
import type { Bindings } from "./env";
import type { UserRole } from "./auth/roles";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    /** Better Auth for this request, created on first use. */
    auth: () => Auth;
    /** Set by `requireArea`. */
    user: AuthUser;
    /** Set by `requireArea`: the editor's area grants, read from D1 for this request. Empty for every other role. */
    grantedAreas: GrantableArea[];
  };
};
