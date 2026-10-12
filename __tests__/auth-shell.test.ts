import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthDivider, AuthShell } from "@/app/(auth)/_auth-shell";

const render = (props: { title: string; description?: string; footer?: string }) =>
  renderToStaticMarkup(h(AuthShell, { ...props, children: h("form", null, "isi halaman") }));

describe("AuthShell", () => {
  it("is a narrow column on a plain white page, with no card", () => {
    const html = render({ title: "Masuk ke Sakola Kembara" });
    expect(html).toContain("<main");
    expect(html).toContain("bg-white");
    expect(html).toContain("sm:max-w-sm");
    expect(html).toContain("px-4 py-10");
    // The old look: a gray page with a rounded, shadowed card on it.
    expect(html).not.toContain("bg-gray-50");
    expect(html).not.toContain("rounded-2xl");
    expect(html).not.toContain("shadow");
  });

  it("has one heading, in the display font written the way Tailwind reads as a family", () => {
    const html = render({ title: "Masuk ke Sakola Kembara" });
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Masuk ke Sakola Kembara</h1>");
    // `font-[var(--font-display)]` compiles to a font weight (SAKEM-035).
    expect(html).toContain("font-[family-name:var(--font-display)]");
    expect(html).not.toContain("font-[var(--font-display)]");
    expect(html).toContain("text-xl font-semibold");
  });

  it("shows no brand wordmark and no link home", () => {
    const html = render({ title: "Lupa password?" });
    expect(html).not.toContain("Sakola Kembara");
    expect(html).not.toContain('href="/"');
  });

  it("puts the content after the heading", () => {
    const html = render({ title: "Masuk", description: "Instruksi" });
    expect(html.indexOf("Masuk</h1>")).toBeLessThan(html.indexOf("Instruksi"));
    expect(html.indexOf("Instruksi")).toBeLessThan(html.indexOf("isi halaman"));
  });

  it("adds a description and a footer only when given", () => {
    const bare = render({ title: "Masuk" });
    expect(bare).not.toContain("<p");
    expect(bare).not.toContain("border-t");

    const full = render({ title: "Lupa password?", description: "Masukkan email akun kamu.", footer: "Kembali" });
    expect(full).toContain("<p");
    expect(full).toContain("Masukkan email akun kamu.");
    // The footer sits under a thin rule, after the content.
    expect(full).toContain("border-t border-gray-100");
    expect(full.indexOf("isi halaman")).toBeLessThan(full.indexOf("Kembali"));
  });
});

describe("AuthDivider", () => {
  it("is a rule with a small uppercase label in the middle", () => {
    const html = renderToStaticMarkup(h(AuthDivider));
    expect(html).toContain("border-t");
    expect(html).toContain("uppercase");
    expect(html).toContain(">atau<");
    // The label's gray must stay readable on white (DESIGN.md: 4.5:1 or more).
    expect(html).not.toContain("text-gray-400");
  });
});
