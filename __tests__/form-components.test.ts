import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";

describe("Field", () => {
  it("labels the input and points it at the hint", () => {
    const html = renderToStaticMarkup(
      h(Field, {
        id: "email",
        label: "Email",
        hint: "Kami tidak membagikan email kamu.",
        children: h(Input, { type: "email" }),
      }),
    );
    expect(html).toContain('for="email"');
    expect(html).toContain('id="email"');
    expect(html).toContain('aria-describedby="email-hint"');
    expect(html).not.toContain("aria-invalid");
  });

  it("swaps the hint for the error and marks the input invalid", () => {
    const html = renderToStaticMarkup(
      h(Field, {
        id: "email",
        label: "Email",
        hint: "Petunjuk",
        error: "Format email belum benar.",
        children: h(Input, { type: "email" }),
      }),
    );
    expect(html).toContain('aria-describedby="email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Format email belum benar.");
    expect(html).not.toContain("Petunjuk");
  });
});

describe("Alert", () => {
  it("announces errors immediately and other tones politely", () => {
    expect(renderToStaticMarkup(h(Alert, { children: "Gagal" }))).toContain('role="alert"');
    expect(renderToStaticMarkup(h(Alert, { tone: "success", children: "Terkirim" }))).toContain('role="status"');
  });
});
