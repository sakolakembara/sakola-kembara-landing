import type { ReactNode } from "react";

/**
 * The auth page layout: a narrow centered column on a plain page, no card
 * (the login-2 block Dzul picked). The legacy /login used a card
 * (app/(auth)/login/page.tsx); the copy is the same.
 */
export function AuthShell({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  /** Under the title. */
  description?: string;
  /** Below a rule at the bottom, e.g. the way back to sign-in. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <div className="flex flex-1 flex-col justify-center px-4 py-10 lg:px-6">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm">
          <div className="mb-8 text-center">
            <p className="inline-block font-[family-name:var(--font-display)] text-2xl text-gray-900">Sakola Kembara</p>
          </div>
          <h1 className="text-center font-[family-name:var(--font-display)] text-xl font-semibold text-gray-900">{title}</h1>
          {description && <p className="mt-2 text-center text-sm text-gray-600">{description}</p>}
          <div className="mt-6 space-y-4">{children}</div>
          {footer && <div className="mt-6 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">{footer}</div>}
        </div>
      </div>
    </main>
  );
}

/** The text link style used inside the auth cards. */
export const AUTH_LINK = "text-primary-blue font-semibold hover:underline";
