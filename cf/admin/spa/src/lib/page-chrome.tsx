import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

// What a page may put in the shell's top bar (cf/admin/DESIGN.md, "Shell"): the last step of the breadcrumb (the
// article's title), something next to it (its status) and its actions. The shell draws the bar and two empty slots in
// it (`ChromeSlot`); the page renders its parts into them (`PageBar`), so an editor has ONE bar, not the shell's and a
// second one under it. A page that does not use it leaves the bar as it was.

interface PageChrome {
  /** The last step of the breadcrumb, after the entry of the menu. */
  leaf: string | null;
  setLeaf: (label: string | null) => void;
  /** Where the list's step of the breadcrumb leads, when the page wants it to be the list as the person had it (its filters). */
  crumbHref: string | null;
  setCrumbHref: (href: string | null) => void;
  /** A page has put actions in the bar: the link to the public site makes room for them. */
  hasActions: boolean;
  setHasActions: (has: boolean) => void;
  leading: HTMLElement | null;
  setLeading: (element: HTMLElement | null) => void;
  actions: HTMLElement | null;
  setActions: (element: HTMLElement | null) => void;
}

const Context = createContext<PageChrome | null>(null);

export function PageChromeProvider({ children }: { children: ReactNode }) {
  const [leaf, setLeaf] = useState<string | null>(null);
  const [crumbHref, setCrumbHref] = useState<string | null>(null);
  const [hasActions, setHasActions] = useState(false);
  const [leading, setLeading] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const value = useMemo(
    () => ({ leaf, setLeaf, crumbHref, setCrumbHref, hasActions, setHasActions, leading, setLeading, actions, setActions }),
    [leaf, crumbHref, hasActions, leading, actions],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** `null` outside the shell (a form rendered on its own in a test): the page then draws its parts itself. */
export const usePageChrome = () => useContext(Context);

/** A place in the top bar that a page fills. Empty, it takes no room (`empty:hidden`). */
export function ChromeSlot({ slot, className }: { slot: "leading" | "actions"; className?: string }) {
  const chrome = usePageChrome();
  return <div ref={slot === "leading" ? chrome?.setLeading : chrome?.setActions} className={className} />;
}
