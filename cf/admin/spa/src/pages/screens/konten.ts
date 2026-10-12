import { ReportFormPage } from "../reports/ReportFormPage";
import { ReportsPage } from "../reports/ReportsPage";
import { ShortlinkFormPage } from "../shortlinks/ShortlinkFormPage";
import { ShortlinksPage } from "../shortlinks/ShortlinksPage";
import { TeamFormPage } from "../team/TeamFormPage";
import { TeamPage } from "../team/TeamPage";
import type { Screens } from "./types";

/** Blog, Laporan, Tim and Shortlink. Owned by the Konten worker; Blog is another worker's, the other three are here. */
export const kontenScreens: Screens = {
  "/reports": {
    index: ReportsPage,
    routes: [
      { path: "new", Page: ReportFormPage },
      { path: ":id/edit", Page: ReportFormPage },
    ],
  },
  "/team": {
    index: TeamPage,
    routes: [
      { path: "new", Page: TeamFormPage },
      { path: ":id/edit", Page: TeamFormPage },
    ],
  },
  "/shortlinks": {
    index: ShortlinksPage,
    routes: [
      { path: "new", Page: ShortlinkFormPage },
      { path: ":id/edit", Page: ShortlinkFormPage },
    ],
  },
};
