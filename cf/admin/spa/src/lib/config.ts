import { useEffect, useState } from "react";
import { api } from "./api";
import { normaliseBase } from "./crud/upload-kinds";

// What `GET /api/config` tells every page that is not about sign-in (the sign-in pages read the same answer for the
// Google button and the widget, in their own code): the two public origins of the Worker's variables. Read once
// per page load and shared, so a page that needs both (the blog editor) asks once.
//
//   uploadsBaseUrl  where uploaded files are served from (UPLOADS_BASE_URL); "" = same origin (local development)
//   siteUrl         the public site (SITE_URL), for "Lihat di publik"; "" = no link
//
// Both are normalised here by the rule the Worker applies (`normaliseBase`): an http(s) origin or "".

export interface PublicConfig {
  uploadsBaseUrl: string;
  siteUrl: string;
}

const UNKNOWN: PublicConfig = { uploadsBaseUrl: "", siteUrl: "" };

let cached: PublicConfig | null = null;
let pending: Promise<PublicConfig> | null = null;

/** Forgets what `GET /api/config` said (tests). */
export function resetConfig(): void {
  cached = null;
  pending = null;
}

function load(): Promise<PublicConfig> {
  pending ??= api<unknown>("/api/config").then((result) => {
    const body = result.ok && result.data !== null && typeof result.data === "object" ? (result.data as { uploadsBaseUrl?: unknown; siteUrl?: unknown }) : {};
    cached = { uploadsBaseUrl: normaliseBase(body.uploadsBaseUrl), siteUrl: normaliseBase(body.siteUrl) };
    return cached;
  });
  return pending;
}

/**
 * The public origins, read once per page load. Both are "" until they are known, and when the answer cannot be
 * read: files then stay same-origin (right in development, where the Vite proxy serves `/uploads`; a broken image,
 * never a crash, elsewhere) and there is no link to the site.
 */
export function useConfig(): PublicConfig {
  const [config, setConfig] = useState(cached ?? UNKNOWN);
  useEffect(() => {
    if (cached !== null) {
      setConfig(cached);
      return;
    }
    let cancelled = false;
    void load().then((value) => {
      if (!cancelled) setConfig(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
