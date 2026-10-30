import { ChevronsUpDown, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { displayName, initials, type Me, type Role } from "~/lib/me";

const ROLE_LABEL: Partial<Record<Role, string>> = {
  viewer: "Hanya baca",
  editor: "Editor",
  super_admin: "Super admin",
};

/**
 * Who is signed in, at the foot of the sidebar: the avatar, the name and the role, and under them a small panel with
 * the email and Keluar. A disclosure, not an ARIA menu: one button opens a panel of ordinary controls, so Tab walks
 * through it and no arrow-key handling is promised. Escape, a press outside it or Tab out of it close it. On the icon
 * rail only the avatar shows, and the name stays in the button's accessible name.
 */
export function UserMenu({
  me,
  collapsed,
  onSignOut,
  signingOut,
  signOutError,
}: {
  me: Pick<Me, "name" | "email" | "role">;
  collapsed: boolean;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = displayName(me);
  const roleLabel = ROLE_LABEL[me.role];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
      onBlur={(event) => {
        // Focus moved to something outside (Tab); a press on plain text inside has no target and is left alone.
        if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      {/* The button comes first in the page, so Tab goes from it into the panel that opens above it. */}
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sidebar-accent-foreground transition-colors hover:bg-white/8",
          collapsed && "justify-center px-0",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/14 text-xs font-semibold"
        >
          {initials(me)}
        </span>
        <span className={collapsed ? "sr-only" : "min-w-0 flex-1"}>
          <span className="block truncate text-sm font-semibold">{name}</span>
          {roleLabel && <span className="block truncate text-xs text-white/70">{roleLabel}</span>}
        </span>
        {!collapsed && <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-70" />}
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute bottom-full left-0 z-50 mb-2 w-60 rounded-xl border border-border bg-card p-3 text-foreground shadow-lg"
        >
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-[13px] text-muted-foreground" title={me.email}>
            {me.email}
          </p>
          <Button variant="neutral" size="sm" fullWidth onClick={onSignOut} disabled={signingOut} className="mt-3">
            <LogOut aria-hidden="true" />
            Keluar
          </Button>
          {signOutError && <Alert className="mt-3 px-3 py-2 text-[13px]">Gagal keluar. Silakan coba lagi.</Alert>}
        </div>
      )}
    </div>
  );
}
