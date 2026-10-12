import { ApplicationDetailPage } from "../applications/ApplicationDetailPage";
import { ApplicationsPage } from "../applications/ApplicationsPage";
import { BatchDetailPage } from "../batches/BatchDetailPage";
import { BatchFormPage } from "../batches/BatchFormPage";
import { BatchesPage } from "../batches/BatchesPage";
import { ResourceFormPage } from "../resources/ResourceFormPage";
import { ResourcesPage } from "../resources/ResourcesPage";
import type { Screens } from "./types";

/** Batch, Pendaftar and Pusat Dokumen. Owned by the Pendaftaran worker. */
export const pendaftaranScreens: Screens = {
  "/batches": {
    index: BatchesPage,
    routes: [
      { path: "new", Page: BatchFormPage },
      { path: ":id/edit", Page: BatchFormPage },
      { path: ":id", Page: BatchDetailPage },
    ],
  },
  "/applications": {
    index: ApplicationsPage,
    routes: [{ path: ":id", Page: ApplicationDetailPage }],
  },
  "/resources": {
    index: ResourcesPage,
    routes: [
      { path: "new", Page: ResourceFormPage },
      { path: ":id/edit", Page: ResourceFormPage },
    ],
  },
};
