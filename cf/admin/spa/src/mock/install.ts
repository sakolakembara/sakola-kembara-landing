import { setTransport } from "~/lib/api";
import { parsePersona } from "./persona";
import { createMockTransport, type DashboardMode } from "./transport";

// MOCK, local development only. main.tsx imports this file only when
// `VITE_ADMIN_MOCK=true` (`pnpm dev:spa:mock`), so a normal build does not
// contain it (scripts/check-spa-bundle.mjs fails the build check if it does).
//
// Pick who you are and what the dashboard does from the address bar, once;
// the choice is kept for the browser tab:
//   ?mock=viewer | editor | editor:konten,komunikasi | editor:- | super_admin | student
//   ?mock-dashboard=ready | empty | error | unavailable | slow

const KEY = "sakem-admin-mock";
const MODES: readonly string[] = ["ready", "empty", "error", "unavailable", "slow"];

interface Saved {
  persona?: string;
  dashboard?: string;
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
  if (query.has("mock-dashboard")) saved.dashboard = query.get("mock-dashboard") ?? undefined;
  save(saved);

  const persona = parsePersona(saved.persona);
  const dashboard = (MODES.includes(saved.dashboard ?? "") ? saved.dashboard : "ready") as DashboardMode;

  setTransport(
    createMockTransport({
      persona,
      dashboard,
      delayMs: 350,
      session: {
        get: () => load().signedIn === true,
        set: (signedIn) => save({ ...load(), signedIn }),
      },
    }),
  );

  const banner = document.createElement("div");
  banner.setAttribute("role", "note");
  banner.textContent = `Mode mock: data tiruan, bukan data sungguhan (${saved.persona ?? "super_admin"}).`;
  banner.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:9999;padding:4px 10px;border-radius:8px;background:#fad02b;color:#1f2937;font:600 12px system-ui;pointer-events:none;box-shadow:0 1px 4px rgb(0 0 0/.3)";
  document.body.appendChild(banner);
}
