import { usePageTitle as usePageTitleWith } from "@shared/spa/hooks";

export * from "@shared/spa/hooks";

/** The browser tab title, "Judul | Portal Siswa" (the legacy portal's template). */
export function usePageTitle(title: string | null | undefined): void {
  usePageTitleWith(title, "Portal Siswa");
}
