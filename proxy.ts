import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Middleware runs on the Edge runtime, which can't load `pg` or `bcrypt`. We
// instantiate a NextAuth here from the edge-safe auth.config (no Credentials
// provider) — sessions are JWT-based, so the JWT (with role stamped in the
// jwt callback) can be decoded without DB access.

const { auth } = NextAuth(authConfig);

const ADMIN_ROLES = new Set(["viewer", "editor", "super_admin"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  const isPortalArea = pathname.startsWith("/portal") || pathname.startsWith("/api/portal");
  if (!isAdminArea && !isPortalArea) return;

  if (!req.auth) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("from", pathname);
    return Response.redirect(url);
  }

  const role = (req.auth.user as { role?: string } | undefined)?.role ?? "";

  if (isAdminArea && !ADMIN_ROLES.has(role)) {
    // Signed in as a student trying to reach /admin — send them home to the
    // portal with an explanatory flag.
    const url = new URL("/portal", req.nextUrl);
    url.searchParams.set("error", "admin-only");
    return Response.redirect(url);
  }

  if (isPortalArea && role !== "student" && !ADMIN_ROLES.has(role)) {
    // Unknown role — force a fresh sign-in.
    const url = new URL("/login", req.nextUrl);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/portal/:path*",
    "/api/portal/:path*",
  ],
};
