import type { ReactNode } from "react";

/** The centered card the legacy /login uses (app/(auth)/login/page.tsx). */
export function AuthShell({
  title,
  subtitle,
  description,
  footer,
  children,
}: {
  title: string;
  /** Under the brand name, above the card. */
  subtitle?: string;
  /** Under the card's title. */
  description?: string;
  /** Below a rule at the bottom of the card, e.g. the way back to sign-in. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="inline-block font-[family-name:var(--font-display)] text-2xl text-gray-900">Sakola Kembara</p>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-5">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl text-gray-900 mb-1">{title}</h1>
            {description && <p className="text-sm text-gray-600">{description}</p>}
          </div>
          {children}
          {footer && <div className="pt-2 border-t border-gray-100 text-center text-xs text-gray-500">{footer}</div>}
        </div>
      </div>
    </main>
  );
}

/** The text link style used inside the auth cards. */
export const AUTH_LINK = "text-primary-blue font-semibold hover:underline";
