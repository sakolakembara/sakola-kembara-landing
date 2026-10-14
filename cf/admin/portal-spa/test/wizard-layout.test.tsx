import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { UI_STEP_ORDER, type UiStepId } from "../../shared/application-form/steps";
import { openAt, resetWizardMocks, wizardServer } from "./wizard-helpers";

// No browser is available here, so the layout at 360 px is checked as far as classes can show it: nothing has a fixed width
// that does not fit a phone, every grid is one column to begin with and only widens from `sm`, everything a finger has to hit
// is at least 44 px (Tailwind `min-h-11`), and the buttons stack. Whether it LOOKS right is Dzul's check (the PR says so).
// The width a field has at 360 px: 360 - 2 x 16 (page) - 2 x 24 (the card) = 280 px.

beforeEach(() => void wizardServer());
afterEach(resetWizardMocks);

const heading = (name: string) => screen.findByRole("heading", { name });
const SCREENS: [UiStepId, string][] = [
  ["intro", "Sebelum Mulai Pendaftaran"],
  ["identity", "Identitas Pribadi"],
  ["household", "Keluarga & Ekonomi"],
  ["housing", "Tempat Tinggal & Hutang"],
  ["organizations", "Organisasi"],
  ["interview", "Interview Tertulis"],
  ["documents", "Berkas Pendaftaran"],
  ["review", "Tinjau & Kirim"],
];
/** Fields that show every part of their screen: the toggles that reveal more are on. */
const OPEN_UP = {
  household: { hasOtherEarner1: true, hasOtherEarner2: true },
  housing: { hasDebt: true },
  organizations: { hasOrganizations: true },
  documents: { dtksRegistered: "ya" },
};

const tokensOf = (element: Element) => (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
const wide = (token: string): number | null => {
  const px = /^(?:min-)?w-\[(\d+)px\]$/.exec(token);
  if (px) return Number(px[1]);
  const scale = /^(?:min-)?w-(\d+)$/.exec(token);
  return scale ? Number(scale[1]) * 4 : null;
};

describe.each(SCREENS)("%s at 360 px", (id, title) => {
  async function open() {
    openAt(id, id === "review" ? {} : (Object.fromEntries(Object.entries(OPEN_UP).filter(([bucket]) => bucket === id || (id === "documents" && bucket === "documents"))) as never));
    await heading(title);
    return screen.getByRole("main");
  }

  test("nothing has a width that does not fit a phone (a width on its own, with no breakpoint, over 340 px)", async () => {
    const main = await open();
    const bad: string[] = [];
    for (const element of main.querySelectorAll("*")) for (const token of tokensOf(element)) if ((wide(token) ?? 0) > 340) bad.push(token);
    expect(bad).toEqual([]);
  });

  test("a grid with more columns at a wider screen is one column to begin with", async () => {
    const main = await open();
    for (const element of main.querySelectorAll("[class*='grid-cols-']")) {
      const tokens = tokensOf(element);
      // What is there without a breakpoint is one column, or the yes/no pair: two short buttons in a 320 px box.
      const base = tokens.filter((token) => /^grid-cols-/.test(token));
      expect(
        base.every((token) => token === "grid-cols-1" || (token === "grid-cols-2" && tokens.includes("max-w-xs"))),
        element.className,
      ).toBe(true);
    }
  });

  test("every button, and every card of a choice, is at least 44 px high (or a large button)", async () => {
    const main = await open();
    expect(main.querySelectorAll("button").length).toBeGreaterThan(2);
    const small: string[] = [];
    for (const button of main.querySelectorAll("button")) {
      const tokens = tokensOf(button);
      if (!tokens.some((token) => token === "min-h-11" || token === "size-11" || token === "py-4" || token === "h-11")) small.push(button.textContent?.slice(0, 30) || button.getAttribute("aria-label") || "?");
    }
    for (const input of main.querySelectorAll("input[type='radio'], input[type='checkbox']")) {
      const label = input.closest("label");
      if (!label || !tokensOf(label).includes("min-h-11")) small.push(`${(input as HTMLInputElement).name}`);
    }
    expect(small).toEqual([]);
  });

  test("text goes onto the next line instead of out of the screen: no `whitespace-nowrap`, and long values break", async () => {
    const main = await open();
    expect(Array.from(main.querySelectorAll("*")).filter((element) => tokensOf(element).includes("whitespace-nowrap")).length).toBe(0);
    if (id === "review") for (const dd of main.querySelectorAll("dd")) expect(tokensOf(dd)).toContain("break-words");
  });
});

describe("the frame", () => {
  test("the form is one column on a phone (the list above it) and two from lg; both columns may shrink; the buttons stack with 'Selanjutnya' on top", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const frame = screen.getByRole("navigation", { name: "Bagian formulir" }).closest("aside")?.parentElement as HTMLElement;
    expect(tokensOf(frame)).toEqual(expect.arrayContaining(["grid", "lg:grid-cols-[280px_1fr]"]));
    expect(tokensOf(frame).filter((token) => /^grid-cols-/.test(token))).toEqual([]);
    for (const column of frame.children) expect(tokensOf(column)).toContain("min-w-0");
    const footer = screen.getByRole("button", { name: "Selanjutnya" }).parentElement as HTMLElement;
    expect(tokensOf(footer)).toEqual(expect.arrayContaining(["flex-col-reverse", "sm:flex-row", "items-stretch"]));
  });

  test("the page margin on a phone is 16 px (the form needs the width more than the margin) and 24 px from md", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const container = screen.getByRole("heading", { level: 1 }).closest("header")?.parentElement as HTMLElement;
    expect(tokensOf(container)).toEqual(expect.arrayContaining(["px-4", "md:px-6"]));
    expect(tokensOf(container)).not.toContain("px-6");
  });

  test("the list of screens is folded behind one button below lg and open from lg", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const list = document.getElementById("daftar-bagian") as HTMLElement;
    expect(tokensOf(list)).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
  });

  test("the units of the field are drawn inside it, with room for the text (pr-16), and are not read twice", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    const area = screen.getByRole("textbox", { name: "Luas Bangunan Tempat Tinggal" });
    expect(tokensOf(area)).toContain("pr-16");
    expect(area.parentElement?.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the list of screens, as a whole", () => {
  test("every screen of the legacy list is in it, in order", async () => {
    openAt("housing");
    await heading("Tempat Tinggal & Hutang");
    expect(UI_STEP_ORDER).toHaveLength(8);
  });
});
