import { AnnouncementFormPage } from "../announcements/AnnouncementFormPage";
import { AnnouncementsPage } from "../announcements/AnnouncementsPage";
import { MessageDetailPage } from "../messages/MessageDetailPage";
import { MessagesPage } from "../messages/MessagesPage";
import type { Screens } from "./types";

/** Pesan (messages) and Pengumuman. Owned by the Komunikasi worker. */
export const komunikasiScreens: Screens = {
  // The inbox of the contact form: a list and a detail page (nothing is created or edited here, so no `new` or `:id/edit`).
  "/messages": {
    index: MessagesPage,
    routes: [{ path: ":id", Page: MessageDetailPage }],
  },
  "/announcements": {
    index: AnnouncementsPage,
    routes: [
      { path: "new", Page: AnnouncementFormPage },
      { path: ":id/edit", Page: AnnouncementFormPage },
    ],
  },
};
