import type { AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router";

/**
 * Stands in for `next/link` (see the alias in vite.config.ts), so components/ui
 * from the Next app, `Button` in particular, run unchanged in this SPA. Only
 * the props the kit uses are mapped; Next-only props are accepted and ignored.
 */
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  prefetch?: boolean;
  scroll?: boolean;
  replace?: boolean;
};

export default function Link({ href, prefetch: _prefetch, scroll: _scroll, replace, ...rest }: Props) {
  return <RouterLink to={href} replace={replace} {...rest} />;
}
