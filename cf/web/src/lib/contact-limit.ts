// Rate limiting for the contact form: 5 submissions per minute per visitor address, the
// legacy limit (CONTACT_RATE_LIMIT in the contract). Two implementations of one tiny interface:
//
//   production   a Cloudflare rate-limit binding (`CONTACT_LIMITER`, wrangler.jsonc). Its counters
//                live at the edge, are kept per Cloudflare location and are eventually consistent,
//                so it is a good first line, not an exact counter. The API Worker applies the
//                contract's exact 5 per minute again behind it (it gets the visitor address in
//                `X-Sakem-Client-Ip`).
//   fallback     an in-memory fixed window, used when the binding is absent: local development,
//                tests, and any deploy where the binding has not been added. It lives in one
//                isolate (Workers run many, and they restart), so it only slows a script down;
//                it is documented as the dev fallback, not as protection.

export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The legacy numbers: 5 per 60 s. The binding in wrangler.jsonc must say the same. */
export const CONTACT_RATE_LIMIT = { limit: 5, windowSeconds: 60 } as const;

export function createMemoryLimiter(
  opts: { limit?: number; windowSeconds?: number; now?: () => number; maxKeys?: number } = {},
): Limiter & { size(): number } {
  const { limit = CONTACT_RATE_LIMIT.limit, windowSeconds = CONTACT_RATE_LIMIT.windowSeconds, now = Date.now, maxKeys = 1000 } = opts;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    size: () => windows.size,
    async limit({ key }) {
      const t = now();
      const windowMs = windowSeconds * 1000;
      if (windows.size >= maxKeys) {
        // Bounded memory: a flood of distinct keys cannot grow the map without limit.
        for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
        if (windows.size >= maxKeys) windows.clear();
      }
      const current = windows.get(key);
      if (!current || t - current.start >= windowMs) {
        windows.set(key, { start: t, count: 1 });
        return { success: true };
      }
      current.count++;
      return { success: current.count <= limit };
    },
  };
}
