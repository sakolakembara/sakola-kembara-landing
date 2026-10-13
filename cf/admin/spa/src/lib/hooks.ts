// The form and focus hooks are the shared ones (cf/admin/shared/spa/hooks.ts, also used by the student portal's
// SPA), at their old path so every admin import stays as it was. The page title keeps the admin's template.
import { usePageTitle as usePageTitleWith } from "../../../shared/spa/hooks";

export * from "../../../shared/spa/hooks";

/** The browser tab title, "Judul | Admin Sakola Kembara" (the legacy admin's template). */
export function usePageTitle(title: string | null | undefined): void {
  usePageTitleWith(title, "Admin Sakola Kembara");
}
