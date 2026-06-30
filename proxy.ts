import NextAuth from "next-auth";
import { ALLOWED_DOMAIN, authConfig } from "@/auth.config";

// Middleware runs on the Edge runtime, which can't load `pg`. We instantiate
// a NextAuth here from the edge-safe auth.config (no Credentials provider)
// — sessions are JWT-based, so the JWT can be decoded without DB access.

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  if (!isAdminPage && !isAdminApi) return;

  if (!req.auth) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("from", pathname);
    return Response.redirect(url);
  }

  const email = String(req.auth.user?.email ?? "").toLowerCase();
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return Response.redirect(new URL("/login?error=domain", req.nextUrl));
  }
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
