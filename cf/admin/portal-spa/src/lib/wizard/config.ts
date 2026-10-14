import { api } from "@shared/spa/api";
import { useEffect, useState } from "react";
import { ENDPOINTS } from "~/lib/paths";
import { parsePortalConfig } from "~/lib/public-config";

// What the wizard reads from `GET /portal/api/config` besides what the shell already uses (`siteUrl`):
//
//   contactWhatsapp   the number of the admissions desk, digits only with the country code ("62..."): "Butuh bantuan?" on the first screen
//   whatsappGroupUrl  the invitation to the participants' WhatsApp group, an https address: the "Langkah selanjutnya" after sending
//
// The contract's answer does not carry these two yet (portal-api.md, 4.1; the PR says so). They are deployment values and
// not code: this repository is public, and a phone number and a group invitation do not belong in it. Until the Worker sends
// them the wizard shows its words without the link, and nothing else changes.

export interface WizardConfig {
  /** "" = the public site is on this origin (the apex). */
  siteUrl: string;
  /** Digits only, or "". */
  contactWhatsapp: string;
  /** An https address, or "". */
  whatsappGroupUrl: string;
}

export const NO_WIZARD_CONFIG: WizardConfig = { siteUrl: "", contactWhatsapp: "", whatsappGroupUrl: "" };

export function parseWizardConfig(raw: unknown): WizardConfig {
  const body = (raw !== null && typeof raw === "object" ? raw : {}) as { contactWhatsapp?: unknown; whatsappGroupUrl?: unknown };
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
  return { siteUrl: parsePortalConfig(raw).siteUrl, contactWhatsapp: /^\d{8,15}$/.test(digits) ? digits : "", whatsappGroupUrl: group };
}

/** `wa.me` address of the admissions desk. */
export const contactHref = (digits: string) => `https://wa.me/${digits}`;

/** Read once when the wizard opens; until it arrives (or when it cannot be read) there are no links and the words stand alone. */
export function useWizardConfig(): WizardConfig {
  const [config, setConfig] = useState<WizardConfig>(NO_WIZARD_CONFIG);
  useEffect(() => {
    let cancelled = false;
    void api<unknown>(ENDPOINTS.config).then((result) => {
      if (!cancelled && result.ok) setConfig(parseWizardConfig(result.data));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
