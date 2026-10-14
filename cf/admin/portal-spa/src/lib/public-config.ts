import { api } from "@shared/spa/api";
import { NO_CONFIG, type PublicConfig as AuthConfig, parsePublicConfig } from "@shared/spa/captcha";
import { useEffect, useState } from "react";
import { ENDPOINTS } from "./paths";

// `GET /portal/api/config`: what the browser may know before anyone signs in (docs/cloudflare/portal-api.md#41-get-portalapiconfig).
//
//   google            Google sign-in is switched on
//   turnstileSiteKey  the widget's public key, or null (local runs, the mock)
//   siteUrl           the public site's origin ("" = the same origin, the apex): for the links to /gabung-siswa
//   adminUrl          where an admin account is sent ("" or missing = no link); the contract names the variable
//                     ADMIN_URL for this screen but its answer does not carry it yet (see the PR)

export interface PortalConfig extends AuthConfig {
  siteUrl: string;
  adminUrl: string;
}

export const NO_PORTAL_CONFIG: PortalConfig = { ...NO_CONFIG, siteUrl: "", adminUrl: "" };

/** An http(s) origin (no path, no query), or "". Anything else is not a place to send a student. */
export function httpOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/** Reads the answer of `GET /portal/api/config`; anything unexpected means "not configured". */
export function parsePortalConfig(raw: unknown): PortalConfig {
  const body = (raw !== null && typeof raw === "object" ? raw : {}) as { siteUrl?: unknown; adminUrl?: unknown };
  return { ...parsePublicConfig(raw), siteUrl: httpOrigin(body.siteUrl), adminUrl: httpOrigin(body.adminUrl) };
}

/** A link to a page of the public site (the portal itself is on the same apex, so "" means a path of this origin). */
export function siteLink(siteUrl: string, path: string): string {
  return `${siteUrl}${path}`;
}

/**
 * `GET /portal/api/config`, read once when the page opens. Until the answer arrives, and when it cannot be read at
 * all, the result is "nothing configured": no Google button and no widget, and the form works as it did before there
 * was one (the server still decides what it accepts).
 */
export function usePublicConfig(): PortalConfig {
  const [config, setConfig] = useState<PortalConfig>(NO_PORTAL_CONFIG);

  useEffect(() => {
    let cancelled = false;
    void api<unknown>(ENDPOINTS.config).then((result) => {
      if (!cancelled && result.ok) setConfig(parsePortalConfig(result.data));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
