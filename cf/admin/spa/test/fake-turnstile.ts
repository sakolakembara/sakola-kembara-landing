// The stand-in for Cloudflare's script lives with the shared module (cf/admin/shared/spa/test/fake-turnstile.ts), so the
// admin's tests and the student portal's use the same one.
export * from "../../shared/spa/test/fake-turnstile";
