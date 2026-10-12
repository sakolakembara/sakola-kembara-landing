import { AuditPage } from "../audit/AuditPage";
import { AdminFormPage } from "../settings/AdminFormPage";
import { SettingsPage } from "../settings/SettingsPage";
import type { Screens } from "./types";

/** Aktivitas and Pengaturan. Owned by the Sistem worker; both are for super_admin only (the area `sistem`). */
export const sistemScreens: Screens = {
  "/audit": { index: AuditPage },
  "/settings": {
    index: SettingsPage,
    routes: [
      { path: "new", Page: AdminFormPage },
      { path: ":id/edit", Page: AdminFormPage },
    ],
  },
};
