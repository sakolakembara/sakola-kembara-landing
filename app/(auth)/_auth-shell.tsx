import type { ReactNode } from "react";

/**
 * The layout every auth page shares (`/login`, `/register`, `/forgot-password`,
 * `/reset-password`, `/verify-email`): a narrow centered column on a plain
 * white page, no card, one heading. The form comes first. It is the same
 * layout as the new admin sign-in (SAKEM-086), so the two look alike.
 *
 * There is no brand wordmark and no intro block above the heading: the page
 * says what it is once, in `title`. Add a `description` only when it holds
 * instructions the heading does not.
 */
export function AuthShell({
  title,
  description,
  footer,
  children,
}: {
  /** The page's one `<h1>`. */
  title: string;
  /** Under the title: instructions for the form, not a second heading. */
  description?: string;
  /** Under a thin rule at the bottom, e.g. the way to the other auth page. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white">
      <div className="flex flex-1 flex-col justify-center px-4 py-10 lg:px-6">
        <div className="sm:mx-auto sm:w-full sm:max-w-sm">
          <h1 className="text-center font-[family-name:var(--font-display)] text-xl font-semibold text-gray-900">
            {title}
          </h1>
          {description && <p className="mt-2 text-center text-sm text-gray-600">{description}</p>}
          <div className="mt-6 space-y-4">{children}</div>
          {footer && (
            <div className="mt-6 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">{footer}</div>
          )}
        </div>
      </div>
    </main>
  );
}

/** The style of a text link inside the footer or description of an auth page. */
export const AUTH_LINK = "text-primary-blue font-semibold hover:underline";

/**
 * A thin rule with "atau" in the middle, between the form and the Google
 * button. The label sits on white, so the rule runs behind it.
 */
export function AuthDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-gray-200" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-white px-3 uppercase tracking-wider text-gray-500">atau</span>
      </div>
    </div>
  );
}
