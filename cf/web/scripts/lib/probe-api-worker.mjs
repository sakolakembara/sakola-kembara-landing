// A stand-in for the API Worker (cf/admin), for the e2e stack that proves the built site reads and posts
// through its `API` service binding (scripts/lib/harness.mjs, option `binding`). It is started by the
// same `wrangler dev` as the site, under the name the site's `services` entry asks for, and:
//
//   - its named entrypoint `PublicApi` (the only thing a service binding with `entrypoint: "PublicApi"`
//     can reach) forwards the request, path, query, headers and body, to the fixture content API;
//   - its default export, the public face of a real API Worker, answers a plain 404 for everything:
//     the read endpoints are not on it (the real one mounts no /api/public route), and neither is the
//     contact route.
//
// It is a test double: no validation, no storage, no logging. The fixture is what answers.

import { WorkerEntrypoint } from 'cloudflare:workers';

export class PublicApi extends WorkerEntrypoint {
  async fetch(request) {
    const { pathname, search } = new URL(request.url);
    return fetch(new Request(`${this.env.FIXTURE_URL}${pathname}${search}`, request));
  }
}

export default {
  fetch() {
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  },
};
