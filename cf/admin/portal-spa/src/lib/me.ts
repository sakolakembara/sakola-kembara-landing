// The signed-in account as the portal sees it. `GET /portal/api/me` answers
//
//   { user: { id, name, email, emailVerified, role } }
//
// for ANY role (docs/cloudflare/portal-api.md#42-get-portalapime): the one route that does not check it. The server
// stays the authority (every data route answers `403 student_only` to anyone else); the SPA uses the role only to
// decide what to show.

export interface Me {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  /** As the server sent it. Only the exact text "student" is a student: an unknown role is NOT one. */
  role: string;
}

/** Reads the `/portal/api/me` body; null when it has no user with an id and an email. */
export function parseMe(body: unknown): Me | null {
  if (typeof body !== "object" || body === null) return null;
  const user = (body as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  const raw = user as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.email !== "string") return null;
  return {
    id: raw.id,
    email: raw.email,
    name: typeof raw.name === "string" ? raw.name : "",
    emailVerified: raw.emailVerified === true,
    role: typeof raw.role === "string" ? raw.role : "",
  };
}

/** The portal is for students; an admin account (or a role this app does not know) gets the "not a student" screen. */
export function isStudent(me: Pick<Me, "role">): boolean {
  return me.role === "student";
}

/** Name for the nav: the display name, else the email (the legacy portal's rule). */
export function displayName(me: Pick<Me, "name" | "email">): string {
  const name = me.name.trim();
  return name === "" ? me.email : name;
}
