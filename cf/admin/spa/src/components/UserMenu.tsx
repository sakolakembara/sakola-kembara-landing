import { ChevronsUpDown, LogOut } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { displayName, initials, type Me, type Role } from "~/lib/me";
import { useDisclosure } from "~/lib/use-disclosure";

const ROLE_LABEL: Partial<Record<Role, string>> = {
  viewer: "Hanya baca",
  editor: "Editor",
  super_admin: "Super admin",
};

/**
 * Who is signed in, at the foot of the sidebar: the avatar, the name and the role, and under them a small panel with
 * the email and Keluar. A disclosure (`useDisclosure`), not an ARIA menu. On the icon rail only the avatar shows, and
 * the name stays in the button's accessible name.
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
  const menu = useDisclosure();
  const name = displayName(me);
  const roleLabel = ROLE_LABEL[me.role];

  return (
    <div {...menu.rootProps} className="relative">
      {/* The button comes first in the page, so Tab goes from it into the panel that opens above it. */}
      <button
        ref={menu.trigger}
        type="button"
        onClick={menu.toggle}
        aria-expanded={menu.open}
        aria-controls={menu.open ? menu.panelId : undefined}
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
      {menu.open && (
        <div
          id={menu.panelId}
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
