// What the wizard reads from `GET /portal/api/config` besides what the shell already uses (`siteUrl`):
//
//   contactWhatsapp   the number of the admissions desk, digits only with the country code ("62..."): "Butuh bantuan?" on the first screen
//   whatsappGroupUrl  the invitation to the participants' WhatsApp group, an https address: the "Langkah selanjutnya" after sending
//
// Both are OPTIONAL deployment values (public variables of the portal Worker): this repository is public, and a phone number
// and a group invitation do not belong in it. An answer without them, or with them empty, is "no link": the first screen
// links to the Kontak page of the public site and the confirmation has no group button.
//
// Pure (no DOM, no React, relative imports only, so the Worker suite can run it against the real route:
// cf/admin/test/portal-wizard-spa-contract.test.ts). The hook that reads the route is `use-wizard-config.ts`.

export interface WizardConfig {
  /** "" = the public site is on this origin (the apex). */
  siteUrl: string;
  /** Digits only, or "". */
  contactWhatsapp: string;
  /** An https address, or "". */
  whatsappGroupUrl: string;
}

export const NO_WIZARD_CONFIG: WizardConfig = { siteUrl: "", contactWhatsapp: "", whatsappGroupUrl: "" };

/** An http(s) origin (no path, no query), or "": the same rule as `httpOrigin` of `~/lib/public-config` (a test keeps the two equal). */
function httpOrigin(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

export function parseWizardConfig(raw: unknown): WizardConfig {
  const body = (raw !== null && typeof raw === "object" ? raw : {}) as { siteUrl?: unknown; contactWhatsapp?: unknown; whatsappGroupUrl?: unknown };
  const digits = typeof body.contactWhatsapp === "string" ? body.contactWhatsapp.replace(/[\s+-]/g, "") : "";
  let group = "";
  if (typeof body.whatsappGroupUrl === "string") {
    try {
      const url = new URL(body.whatsappGroupUrl.trim());
      if (url.protocol === "https:") group = url.href;
    } catch {
      // Not an address: no link.
    }
  }
  return { siteUrl: httpOrigin(body.siteUrl), contactWhatsapp: /^\d{8,15}$/.test(digits) ? digits : "", whatsappGroupUrl: group };
}

/** `wa.me` address of the admissions desk. */
export const contactHref = (digits: string) => `https://wa.me/${digits}`;
