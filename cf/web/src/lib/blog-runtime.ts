// The Workers side of the blog data source: this Worker's bindings and its default
// cache, handed to getBlogSource(). Kept out of blog.ts so that file (and everything
// that imports it) loads in plain Node, where tests run: `cloudflare:workers` only
// exists inside workerd.

import { env } from 'cloudflare:workers';
import type { BlogRuntime } from './blog';

/** `waitUntil` is `Astro.locals.cfContext.waitUntil` of the request. */
export function blogRuntime(waitUntil: (promise: Promise<unknown>) => void): BlogRuntime {
  return { env, cache: typeof caches !== 'undefined' ? caches.default : undefined, waitUntil };
}
