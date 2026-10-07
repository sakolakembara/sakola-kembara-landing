import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const display = "font-[family-name:var(--font-display)]";

/** The type scale decided in SAKEM-031 (D3). Color is left to the caller. */
export const headingVariants = cva("", {
  variants: {
    level: {
      display: cn(display, "font-bold text-[28px] leading-[1.2] sm:text-4xl md:text-5xl md:leading-tight lg:text-[56px]"),
      page: cn(display, "text-3xl leading-tight sm:text-4xl md:text-5xl lg:text-6xl"),
      article: cn(display, "text-3xl leading-tight md:text-4xl lg:text-5xl"),
      section: cn(display, "text-[26px] leading-tight sm:text-3xl md:text-4xl"),
      subsection: cn(display, "text-2xl md:text-3xl"),
      panel: "text-2xl font-bold",
      card: "text-xl font-bold",
    },
  },
  defaultVariants: { level: "section" },
});

type Level = NonNullable<VariantProps<typeof headingVariants>["level"]>;

const defaultTag: Record<Level, "h1" | "h2" | "h3"> = {
  display: "h1",
  page: "h1",
  article: "h1",
  section: "h2",
  subsection: "h2",
  panel: "h3",
  card: "h3",
};

/**
 * A heading on the site's type scale (atom). `level` sets the look; `as`
 * overrides the element when the outline needs a different one (e.g. a
 * section-sized heading that is the page's h1).
 */
export function Heading({
  level = "section",
  as,
  className,
  ...rest
}: { level?: Level; as?: "h1" | "h2" | "h3" | "h4" | "p" } & React.HTMLAttributes<HTMLHeadingElement>) {
  const Tag = as ?? defaultTag[level];
  return <Tag className={cn(headingVariants({ level }), className)} {...rest} />;
}
