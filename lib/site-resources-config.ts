// Client-safe helpers for the dynamic docs catalog rendered at
// `/gabung-siswa/docs` and managed at `/admin/resources`. The category enum
// stays here (rather than only in the DB schema) so client components and
// public links can safely reference `#berkas-marketing` anchors.

import type { ResourceCategory, ResourceContentType } from "@/lib/db/schema";
import type { TagTone } from "@/components/ui/tag";

export const RESOURCE_CATEGORY_ORDER: readonly ResourceCategory[] = [
  "panduan",
  "berkas-pendaftaran",
  "berkas-marketing",
  "tutorial",
  "lainnya",
] as const;

export const RESOURCE_CATEGORY_LABEL: Record<ResourceCategory, string> = {
  panduan: "Panduan Pendaftaran",
  "berkas-pendaftaran": "Berkas Pendaftaran",
  "berkas-marketing": "Berkas Marketing",
  tutorial: "Tutorial",
  lainnya: "Lainnya",
};

export const RESOURCE_CATEGORY_DESCRIPTION: Record<ResourceCategory, string> = {
  panduan:
    "Panduan lengkap, poin-poin penting, dan alur pendaftaran Sakola Kembara.",
  "berkas-pendaftaran":
    "Template surat izin, surat penghasilan, SKTM, dan berkas lain yang perlu diunggah calon siswa.",
  "berkas-marketing":
    "Poster, twibbon, caption Instagram, dan bahan promosi lain yang wajib dibagikan calon siswa.",
  tutorial:
    "Video atau artikel pendek untuk membantu calon siswa menyiapkan berkas (mis. token listrik PLN).",
  lainnya: "Dokumen tambahan yang tidak masuk kategori di atas.",
};

export const RESOURCE_CATEGORY_TONE: Record<ResourceCategory, TagTone> = {
  panduan: "blue",
  "berkas-pendaftaran": "green",
  "berkas-marketing": "purple",
  tutorial: "amber",
  lainnya: "gray",
};

export const RESOURCE_CONTENT_TYPE_LABEL: Record<ResourceContentType, string> = {
  file: "File",
  url: "Link Eksternal",
  text: "Teks (dapat disalin)",
};

/** Public URL for /gabung-siswa/docs with a category anchor. */
export function docsUrlForCategory(category: ResourceCategory): string {
  return `/gabung-siswa/docs#${category}`;
}
