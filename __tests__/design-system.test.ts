import { describe, expect, it } from "vitest";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";
import { headingVariants } from "@/components/ui/heading";

describe("cn", () => {
  it("lets the later Tailwind class win and drops falsy values", () => {
    expect(cn("px-5 h-11", false, undefined, "px-8")).toBe("h-11 px-8");
    expect(cn("bg-primary-blue", "bg-primary-blue-dark")).toBe("bg-primary-blue-dark");
  });

  it("keeps the display font next to a font weight", () => {
    // Without the family-name hint the var() form is read as a font weight
    // and would be dropped here; the hinted form must survive.
    expect(cn("font-[family-name:var(--font-display)]", "font-bold")).toBe(
      "font-[family-name:var(--font-display)] font-bold",
    );
  });
});

describe("buttonVariants", () => {
  it("defaults to the primary, 44px button", () => {
    const classes = buttonVariants();
    expect(classes).toContain("bg-primary-blue");
    expect(classes).toContain("h-11");
  });

  it("never renders a pill-shaped button", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(buttonVariants({ size })).not.toContain("rounded-full");
    }
  });
});

describe("headingVariants", () => {
  it("puts the Lora levels on the display font family, not a weight", () => {
    for (const level of ["display", "page", "article", "section", "subsection"] as const) {
      expect(headingVariants({ level })).toContain("font-[family-name:var(--font-display)]");
    }
    expect(headingVariants({ level: "card" })).not.toContain("--font-display");
  });
});
