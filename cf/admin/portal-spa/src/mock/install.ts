import { setTransport } from "@shared/spa/api";
import { installMockTurnstile } from "@shared/spa/mock-turnstile";
import { parsePersona } from "./persona";
import { createMockTransport } from "./transport";

// MOCK, local development only. main.tsx imports this file only when `VITE_PORTAL_MOCK=true`
// (`pnpm dev:portal-spa:mock`), so a normal build does not contain it (scripts/check-portal-spa-bundle.mjs fails
// the build check if it does).
//
// Pick who you are and what state your application is in from the address bar, once; the choice is kept for the
// browser tab (the names are in mock/persona.ts):
//   http://localhost:5174/portal/?mock=submitted

const KEY = "sakem-portal-mock";

interface Saved {
  persona?: string;
  signedIn?: boolean;
}

function load(): Saved {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function save(next: Saved): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private window: the choice just lasts until the next reload.
  }
}

export function installMockApi(): void {
  const query = new URLSearchParams(window.location.search);
  const saved = load();
  if (query.has("mock")) saved.persona = query.get("mock") ?? undefined;
  save(saved);

  const persona = parsePersona(saved.persona);

  setTransport(
    createMockTransport({
      persona,
      delayMs: 350,
      session: {
        get: () => load().signedIn === true,
        set: (signedIn) => save({ ...load(), signedIn }),
      },
    }),
  );

  // The security check's widget: a stand-in, so Cloudflare's script is never fetched.
  installMockTurnstile();

  const banner = document.createElement("div");
  banner.setAttribute("role", "note");
  banner.textContent = `Mode mock: data tiruan, bukan data sungguhan (${persona}).`;
  banner.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:9999;padding:4px 10px;border-radius:8px;background:#fad02b;color:#1f2937;font:600 12px system-ui;pointer-events:none;box-shadow:0 1px 4px rgb(0 0 0/.3)";
  document.body.appendChild(banner);
}
