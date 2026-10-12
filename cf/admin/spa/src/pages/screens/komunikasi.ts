import { AnnouncementFormPage } from "../announcements/AnnouncementFormPage";
import { AnnouncementsPage } from "../announcements/AnnouncementsPage";
import type { Screens } from "./types";

/** Pesan (messages) and Pengumuman. Owned by the Komunikasi worker. */
export const komunikasiScreens: Screens = {
  "/announcements": {
    index: AnnouncementsPage,
    routes: [
      { path: "new", Page: AnnouncementFormPage },
      { path: ":id/edit", Page: AnnouncementFormPage },
    ],
  },
};
