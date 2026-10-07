import { twMerge, type ClassNameValue } from "tailwind-merge";

/**
 * Join class names; on a Tailwind conflict the later class wins
 * (`cn("px-5", "px-8")` → `"px-8"`). Falsy values are dropped.
 *
 * Write the display font as `font-[family-name:var(--font-display)]`. Without
 * the `family-name:` hint Tailwind 4.3 compiles the var() form to
 * `font-weight`, and tailwind-merge then drops it next to `font-bold`.
 */
export function cn(...inputs: ClassNameValue[]) {
  return twMerge(...inputs);
}
