// How this Worker reaches the API Worker (docs/cloudflare/content-api.md,
// "How the callers reach the API").
//
//   production   an internal SERVICE BINDING named `API` (wrangler.jsonc, `services`). The Worker
//                calls the API Worker directly, not over the public internet, so there is no
//                public path to authenticate and no shared secret. A service binding ignores the
//                host of the URL it is given, only the path counts.
//   local / CI   `CONTENT_API_URL` (read endpoints) and `CONTACT_API_URL` (the contact form) point at
//                scripts/fixture-api.mjs. They win over the binding whenever they are set, so a
//                developer machine never needs the API Worker. Do not set them in production:
//                the contact form would then leave the binding and travel over public HTTP.
//   (`/tim`, `/laporan` and `/gabung-siswa/docs` read CONTENT_API_URL only, through lib/content-api.ts;
//   moving them to the binding is `target.base` and `target.fetchImpl` in their `contentRuntime`.)

/** The bit of a service binding this site uses. */
export interface ServiceBinding {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface ApiEnv {
  /** Base URL of the read endpoints (local/CI). Unset in production. */
  CONTENT_API_URL?: string;
  /** Base URL of the contact endpoint (local/CI). Unset in production, where the binding is used. */
  CONTACT_API_URL?: string;
  /** The service binding to the API Worker (wrangler.jsonc `services`). */
  API?: ServiceBinding;
}

export interface ApiTarget {
  /** No trailing slash. Only the path of a URL built on it matters to a service binding. */
  base: string;
  fetchImpl: typeof fetch;
  /** Where the requests go, for tests: never log the URL itself. */
  via: 'url' | 'binding';
}

/** The host a service-bound request carries. It is never resolved. */
export const SERVICE_BINDING_BASE = 'https://api.internal';

function target(url: string | undefined, binding: ServiceBinding | undefined): ApiTarget | null {
  if (url) return { base: url.replace(/\/+$/, ''), fetchImpl: (input, init) => fetch(input, init), via: 'url' };
  if (binding) {
    return {
      base: SERVICE_BINDING_BASE,
      fetchImpl: (input, init) => binding.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input, init),
      via: 'binding',
    };
  }
  return null;
}

/** Where the read endpoints (`GET /api/public/*`) are fetched from; null when nothing is configured. */
export const contentApiTarget = (env: ApiEnv): ApiTarget | null => target(env.CONTENT_API_URL, env.API);

/** Where the contact form is posted. Same rule with its own override, so `CONTENT_API_URL` cannot pull it off the binding. */
export const contactApiTarget = (env: ApiEnv): ApiTarget | null => target(env.CONTACT_API_URL, env.API);
