import { cn } from "@/lib/cn";

// The pieces of the signed-in frame that `Shell` and `ShellSkeleton` (the frame drawn while the session is still
// being asked for) both draw: one set of classes, so the skeleton cannot drift away from the page that replaces it.
// `spa/index.html` draws the same frame once more, in plain CSS, before any script has run (its `#boot`); the numbers
// there (248 and 72 px, 56 px, 52 px) are these, and test/boot.test.tsx keeps them honest.

/** Column on phones (top bar above main), row on desktop (sidebar left of main). */
export const FRAME_CLASS = "relative flex h-dvh flex-col overflow-hidden bg-background md:flex-row";

/** The navy bar of a phone: 4 px, the 44 px menu button, 4 px. */
export const MOBILE_BAR_CLASS = "flex shrink-0 items-center justify-between bg-sidebar px-4 py-1 text-sidebar-accent-foreground md:hidden";

/** The white bar of a desktop, 56 px with its rule. */
export const HEADER_CLASS = "hidden h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-6 md:flex";

/** The sidebar: 248 px, or the 72 px icon rail. */
export const asideClass = (collapsed: boolean) =>
  cn("hidden shrink-0 bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none md:block", collapsed ? "md:w-[72px]" : "md:w-[248px]");

export function MobileBrand() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-[13px] font-bold text-sidebar-primary-foreground">
        SK
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Admin</span>
    </span>
  );
}
