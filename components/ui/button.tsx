import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Button styles (atom). Exported on their own for the one case where the
 * element can't be a button or link: a CTA inside a card that is already one
 * link, which must be a styled `<span>` (add `group-hover:` classes there).
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-center font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-blue text-white hover:bg-primary-blue-dark",
        outline:
          "border-[1.5px] border-primary-blue text-primary-blue hover:bg-primary-blue/5",
        "outline-on-navy": "border-[1.5px] border-white/60 text-white hover:bg-white/10",
        "yellow-on-navy":
          "bg-secondary-yellow text-gray-900 hover:bg-secondary-yellow/90",
        "white-on-navy": "bg-white text-primary-blue hover:bg-gray-50",
        /** Destructive and irreversible, e.g. revoking an acceptance. */
        danger: "bg-red-600 text-white hover:bg-red-700",
        subtle: "bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-primary-blue",
        neutral:
          "border border-gray-200 text-gray-700 hover:border-primary-blue/40 hover:bg-primary-blue/5 hover:text-primary-blue",
      },
      size: {
        // A minimum height, not a fixed one: a label that has to wrap on a
        // narrow screen makes the button taller instead of overflowing it.
        /** 40px, desktop header only — touch layouts need `md` or larger. */
        sm: "min-h-10 rounded-lg px-4 py-2 text-[15px] leading-snug",
        md: "min-h-11 rounded-lg px-5 py-2 text-[15px] leading-snug",
        lg: "rounded-xl px-8 py-4 text-base",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type StyleProps = VariantProps<typeof buttonVariants> & {
  className?: string;
  children: React.ReactNode;
};

type AsButton = StyleProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof StyleProps> & {
    href?: undefined;
  };

type AsLink = StyleProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof StyleProps | "href"> & {
    href: string;
  };

export type ButtonProps = AsButton | AsLink;

/**
 * How a button link is rendered. External URLs open in a new tab. Files (any
 * path ending in an extension, e.g. `/reports/….pdf`), mail/tel links and
 * downloads stay a plain `<a>`: through `next/link` the router would prefetch
 * them as pages. Everything else is an app route.
 */
export function linkKind(href: string, download?: unknown): "external" | "plain" | "route" {
  if (/^https?:\/\//.test(href)) return "external";
  const path = href.split(/[?#]/)[0];
  if (/^(mailto:|tel:)/.test(href) || /\.[a-z0-9]+$/i.test(path) || download !== undefined) {
    return "plain";
  }
  return "route";
}

/** A `<button>`, or a link when `href` is set (see `linkKind`). */
export function Button({ variant, size, fullWidth, className, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (props.href !== undefined) {
    const { href, ...rest } = props;
    switch (linkKind(href, rest.download)) {
      case "external":
        return <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...rest} />;
      case "plain":
        return <a href={href} className={classes} {...rest} />;
      case "route":
        return <Link href={href} className={classes} {...rest} />;
    }
  }

  const { type = "button", ...rest } = props;
  return <button type={type} className={classes} {...rest} />;
}
