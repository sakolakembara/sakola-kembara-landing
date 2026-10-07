import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Button styles (atom). Exported on their own for the one case where the
 * element can't be a button or link: a CTA inside a card that is already one
 * link, which must be a styled `<span>` (add `group-hover:` classes there).
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
  {
    variants: {
      variant: {
        primary: "bg-primary-blue text-white hover:bg-primary-blue-dark",
        outline:
          "border-[1.5px] border-primary-blue text-primary-blue hover:bg-primary-blue/5",
        "outline-on-navy": "border-[1.5px] border-white/60 text-white hover:bg-white/10",
        "yellow-on-navy":
          "bg-secondary-yellow text-gray-900 hover:bg-secondary-yellow/90",
        subtle: "bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-primary-blue",
        neutral:
          "border border-gray-200 text-gray-700 hover:border-primary-blue/40 hover:bg-primary-blue/5 hover:text-primary-blue",
      },
      size: {
        /** 40px, desktop header only — touch layouts need `md` or larger. */
        sm: "h-10 rounded-lg px-4 text-[15px]",
        md: "h-11 rounded-lg px-5 text-[15px]",
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
 * A `<button>`, or a link when `href` is set. App routes go through
 * `next/link`; external URLs open in a new tab; files, mail/tel links and
 * downloads stay plain `<a>` so the router doesn't try to navigate to them.
 */
export function Button({ variant, size, fullWidth, className, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (props.href !== undefined) {
    const { href, ...rest } = props;
    if (/^https?:\/\//.test(href)) {
      return <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...rest} />;
    }
    if (/^(mailto:|tel:)/.test(href) || href.startsWith("/files/") || rest.download !== undefined) {
      return <a href={href} className={classes} {...rest} />;
    }
    return <Link href={href} className={classes} {...rest} />;
  }

  const { type = "button", ...rest } = props;
  return <button type={type} className={classes} {...rest} />;
}
