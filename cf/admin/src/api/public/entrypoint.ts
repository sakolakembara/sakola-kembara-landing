import { WorkerEntrypoint } from "cloudflare:workers";
import type { Bindings } from "../../env";
import { createInternalApp } from "./index";

// The service-binding face of the public API: the read endpoints and the
// contact form. A named entrypoint has no route, no workers.dev address and no
// custom domain: only a Worker that declares
//
//   "services": [{ "binding": "API", "service": "sakem-admin", "entrypoint": "PublicApi" }]
//
// can call it, with `env.API.fetch(new Request(".../api/public/contact", ...))`.
// How that is enforced, and why no header is trusted for it: ./internal.ts.

const app = createInternalApp();

export class PublicApi extends WorkerEntrypoint<Bindings> {
  fetch(request: Request): Promise<Response> | Response {
    return app.fetch(request, this.env, this.ctx);
  }
}
