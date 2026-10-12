import { LogOut, X } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/cn";
import type { Me, Role } from "~/lib/me";
import type { VisibleNavGroup } from "~/lib/nav";

const ROLE_LABEL: Partial<Record<Role, string>> = {
  viewer: "Hanya baca",
  editor: "Editor",
  super_admin: "Super admin",
};

/**
 * What the sidebar and the mobile drawer both show: the brand, the menu for
 * this user, and their email with Keluar. The menu markup follows the legacy
 * sidebar (app/(admin)/admin/_sidebar.tsx); the groups are new.
 */
export function SidebarBody({
  me,
  groups,
  onSignOut,
  signingOut,
  signOutError,
  onNavigate,
  onClose,
}: {
  me: Pick<Me, "email" | "role">;
  groups: VisibleNavGroup[];
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: boolean;
  /** Called when a menu link is followed (the drawer closes). */
  onNavigate?: () => void;
  /** Present in the drawer: shows the close button. */
  onClose?: () => void;
}) {
  const roleLabel = ROLE_LABEL[me.role];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-8 flex items-center justify-between">
        <span className="font-[family-name:var(--font-display)] text-xl">SK Admin</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup menu"
            className="-mr-3 flex size-11 items-center justify-center text-gray-300 hover:text-white"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Menu utama" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto text-sm">
        {groups.map((group) => {
          const headingId = `nav-${group.id}`;
          return (
            <div key={group.id}>
              {group.label && (
                <p id={headingId} className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {group.label}
                </p>
              )}
              <ul role="list" aria-labelledby={group.label ? headingId : undefined} className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === "/"}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          "block rounded-md px-3 py-2.5 transition-colors md:py-2",
                          isActive
                            ? "bg-white/10 font-medium text-white"
                            : "text-gray-300 hover:bg-white/10 hover:text-white",
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="mt-6 border-t border-white/10 pt-6">
        <div className="truncate text-xs text-gray-400" title={me.email}>
          {me.email}
        </div>
        {roleLabel && <div className="mt-0.5 text-xs text-gray-400">{roleLabel}</div>}
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm text-gray-300 transition-colors hover:text-white disabled:opacity-60"
        >
          <LogOut size={14} aria-hidden="true" />
          Keluar
        </button>
        {signOutError && (
          <p role="alert" className="text-xs text-red-300">
            Gagal keluar. Silakan coba lagi.
          </p>
        )}
      </div>
    </div>
  );
}
