"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** Admin roles — mirrors `adminRoles` in lib/db/schema/users.ts. */
const ADMIN_ROLES = ["viewer", "editor", "super_admin"];

interface Target {
  href: string;
  label: string;
}

const SIGNED_OUT: Target = { href: "/login", label: "Masuk" };

/**
 * Auth-aware header action. The public pages are statically rendered, so we
 * deliberately do NOT call `auth()` in the layout — that would read cookies
 * and turn every marketing page dynamic. Instead we resolve the session on
 * the client from the Auth.js session endpoint and swap the label.
 *
 * Optimistic default is "Masuk": most visitors are signed out, so they see
 * the final state immediately; signed-in students get one quiet swap to
 * "Portal" (same button footprint, so no layout shift).
 */
export function AuthNavButton({
  variant = "desktop",
  onNavigate,
}: {
  variant?: "desktop" | "mobile";
  onNavigate?: () => void;
}) {
  const [target, setTarget] = useState<Target>(SIGNED_OUT);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((session: { user?: { role?: string } } | null) => {
        if (!session?.user) return;
        const role = session.user.role;
        setTarget(
          role && ADMIN_ROLES.includes(role)
            ? { href: "/admin", label: "Dashboard" }
            : { href: "/portal", label: "Portal" },
        );
      })
      .catch(() => {
        // Offline or endpoint unreachable — keep the signed-out affordance.
      });
    return () => controller.abort();
  }, []);

  const base =
    "inline-flex items-center font-semibold rounded-lg border border-gray-200 text-gray-700 hover:text-primary-blue hover:border-primary-blue/40 hover:bg-primary-blue/5 transition-colors";

  return (
    <Link
      href={target.href}
      onClick={onNavigate}
      className={
        variant === "desktop"
          ? `${base} h-10 px-4 text-[15px]`
          : `${base} justify-center px-6 py-3 text-[15px]`
      }
    >
      {target.label}
    </Link>
  );
}
