import { publicOrigin } from "../config/public-origin";

// The public origin the files are served from, as the SPA needs it to show an
// uploaded image (`GET /api/config` answers `uploadsBaseUrl`): an http(s) origin
// without a trailing slash, or "" for "same origin" (local development, where
// `/uploads/...` is served by the dev route through the Vite proxy). The rule is
// the one of every public origin of the config (src/config/public-origin.ts).

/** The usable base (no trailing slash), or "" when there is none. */
export const uploadsBase = publicOrigin;
