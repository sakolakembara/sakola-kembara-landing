import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { forwardProof, isSameOrigin } from '~/lib/donation';

// PUT /donasi/bukti (SAKEM-128): the receipt of the donation in the cookie, from the page's own script
// (src/scripts/donation-proof.ts), streamed on to the API Worker (src/lib/donation.ts, `forwardProof`). JSON in, JSON out.
export const prerender = false;

export const PUT: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  return forwardProof(request, env);
};

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { allow: 'PUT', 'content-type': 'application/json', 'cache-control': 'no-store' } });
