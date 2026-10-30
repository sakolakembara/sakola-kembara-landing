import { cva, type VariantProps } from "class-variance-authority";
import { Link } from "react-router";
import { linkKind } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * The admin's button (cf/admin/DESIGN.md sections 2 and 4): the shadcn recipe on our tokens, in place of the public
 * kit's `components/ui/button.tsx`, which stays as it is for the portal and the legacy app. Same props, so a screen
 * only changes its import. 40 px tall (44 px on a phone: root DESIGN.md, touch targets), `rounded-lg`, 14 px medium.
 * `neutral` is shadcn's outline: the default look of a secondary action.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-blue-dark",
        neutral: "border border-input bg-card text-gray-700 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900",
        subtle: "bg-secondary text-secondary-foreground hover:bg-gray-200",
        ghost: "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
        /** Destructive and irreversible, e.g. deleting a row. */
        danger: "bg-destructive text-white hover:bg-red-800",
      },
      size: {
        // A minimum height, not a fixed one: a label that wraps makes the button taller instead of overflowing it.
        /** Toolbars and row actions: 34 px from `md` up, 40 px on a phone. */
        sm: "min-h-10 px-3 text-sm md:min-h-[34px]",
        /** The default: 40 px from `md` up, 44 px on a phone. */
        md: "min-h-11 px-4 text-sm md:min-h-10",
        /** The one main action of a form: 44 px everywhere. */
        lg: "min-h-11 px-5 text-[15px]",
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

/** A `<button>`, or a link when `href` is set (an app route goes through the router; see `linkKind` of the public kit). */
export function Button({ variant, size, fullWidth, className, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, fullWidth }), className);

  if (props.href !== undefined) {
    const { href, ...rest } = props;
    switch (linkKind(href, rest.download)) {
      case "external":
        return <a data-slot="button" href={href} target="_blank" rel="noopener noreferrer" className={classes} {...rest} />;
      case "plain":
        return <a data-slot="button" href={href} className={classes} {...rest} />;
      case "route":
        return <Link data-slot="button" to={href} className={classes} {...rest} />;
    }
  }

  const { type = "button", ...rest } = props;
  return <button data-slot="button" type={type} className={classes} {...rest} />;
}
