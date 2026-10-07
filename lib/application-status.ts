import type { TagTone } from "@/components/ui/tag";
import type { ApplicationStatus } from "@/lib/db/schema/student-applications";

/** How an application status reads in the admin (lists, detail, dashboard). */
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "Pending",
  under_review: "Dalam Review",
  accepted: "Diterima",
  rejected: "Ditolak",
};

export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, TagTone> = {
  pending: "amber",
  under_review: "blue",
  accepted: "green",
  rejected: "red",
};
