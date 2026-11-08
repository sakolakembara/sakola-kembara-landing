import { AuditPage } from "../audit/AuditPage";
import { DonationDetailPage } from "../donations/DonationDetailPage";
import { DonationsPage } from "../donations/DonationsPage";
import { AdminFormPage } from "../settings/AdminFormPage";
import { SettingsPage } from "../settings/SettingsPage";
import type { Screens } from "./types";

/** Donasi, Aktivitas and Pengaturan: super_admin only (the area `sistem`). */
export const sistemScreens: Screens = {
  // The /donasi confirmations (SAKEM-128): a list and a detail page; a row is made by the public form only.
  "/donations": {
    index: DonationsPage,
    routes: [{ path: ":id", Page: DonationDetailPage }],
  },
  "/audit": { index: AuditPage },
  "/settings": {
    index: SettingsPage,
    routes: [
      { path: "new", Page: AdminFormPage },
      { path: ":id/edit", Page: AdminFormPage },
    ],
  },
};
