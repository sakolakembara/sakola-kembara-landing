import type { Auth } from "./auth/factory";
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
    /** Set by `requireAccess`. */
    user: AuthUser;
  };
};
