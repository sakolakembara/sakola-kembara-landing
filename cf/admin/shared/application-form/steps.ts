// The steps of the application form and the option lists of its choices. No dependency, no framework.
//
// Two orders exist and they are not the same thing:
//   * `STEP_IDS`, the seven BUCKETS the API stores (`application_drafts.form_data` has one key per bucket) and the
//     order the submit validates them in: identity, household, housing, organizations, documents, marketing, interview.
//   * `UI_STEP_ORDER`, the eight SCREENS of the wizard, in the order of the legacy wizard (docs/cloudflare/portal-api.md,
//     section 7; portal-architecture.md, open decision 4): an intro screen first, the interview before the documents,
//     the marketing proofs drawn under the documents on the same screen, and a review screen last. Changing the screen
//     order, or splitting a screen, changes only the SPA.
//
// Source of the lists: lib/student-form-types.ts of the legacy app (hard-coded there too: the branches and the
// graduation batches change every year, and updating them is a code change).

/** The seven buckets of an application, in the order the submit checks them. */
export const STEP_IDS = ["identity", "household", "housing", "organizations", "documents", "marketing", "interview"] as const;
export type StepId = (typeof STEP_IDS)[number];

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

/** The eight screens of the wizard, in the legacy order. `intro` and `review` hold no bucket; `marketing` has no screen of its own (it is drawn inside `documents`). */
export const UI_STEP_ORDER = ["intro", "identity", "household", "housing", "organizations", "interview", "documents", "review"] as const;
export type UiStepId = (typeof UI_STEP_ORDER)[number];

/** The legacy labels of the screens (stepper and headings). */
export const UI_STEP_LABELS: Record<UiStepId, string> = {
  intro: "Sebelum Mulai",
  identity: "Identitas Pribadi",
  household: "Keluarga & Ekonomi",
  housing: "Tempat Tinggal & Hutang",
  organizations: "Organisasi",
  interview: "Interview Tertulis",
  documents: "Pengumpulan Berkas",
  review: "Tinjau & Kirim",
};

/** Which bucket(s) each screen saves. */
export const UI_STEP_BUCKETS: Record<UiStepId, readonly StepId[]> = {
  intro: [],
  identity: ["identity"],
  household: ["household"],
  housing: ["housing"],
  organizations: ["organizations"],
  interview: ["interview"],
  documents: ["documents", "marketing"],
  review: [],
};

/** The submit's message for a bucket that was never saved (legacy wording, docs/cloudflare/portal-api.md, 9.1). */
export const STEP_NOT_SAVED_MESSAGE: Record<StepId, string> = {
  identity: "Isian identitas belum lengkap.",
  household: "Isian keluarga belum lengkap.",
  housing: "Isian tempat tinggal belum lengkap.",
  organizations: "Isian organisasi belum lengkap.",
  documents: "Isian berkas belum lengkap.",
  marketing: "Isian marketing belum lengkap.",
  interview: "Isian interview belum lengkap.",
};

// ─── Option lists ──────────────────────────────────────────────────────

export const GENDERS = ["laki-laki", "perempuan"] as const;

export const RELIGIONS = ["Islam", "Kristen Protestan", "Kristen Katolik", "Hindu", "Budha", "Konghucu"] as const;

export const BRANCHES = ["Cililin", "Bandung", "Cirebon", "Cibodas", "Bojong", "Purbalingga", "Samarinda", "Online"] as const;

export const GRADUATION_BATCHES = ["2025/2026 (Gap Year)", "2027 (Kelas 12)"] as const;

/** Suggestions only: the field takes any text (docs/cloudflare/portal-api.md, 7.3). */
export const FATHER_OCCUPATIONS = ["Tidak bekerja", "Buruh harian", "Guru Honorer", "Pedagang", "Petani", "PNS", "TNI/Polri", "Wiraswasta", "Wirausaha"] as const;
export const MOTHER_OCCUPATIONS = ["Ibu rumah tangga", "Petani", "Pedagang", "PNS", "Wirausaha", "Wiraswasta"] as const;
export const OTHER_EARNER_RELATIONS = ["Kakak", "Paman/Bibi", "Kakek/Nenek"] as const;

export const RESIDENCE_STATUSES = ["Rumah Pribadi", "Mengontrak/Menyewa", "Menumpang Pada Orang Lain"] as const;

/** The two options of the legacy form; the field also takes free text (the legacy "Other"). */
export const LIVING_WITH_OPTIONS = ["Ayah", "Ibu"] as const;

/** `documents.dtksRegistered` and `interview.agreedToSignedStatement`. */
export const YES_NO = ["ya", "tidak"] as const;

/** The longest interview answer, in characters (the legacy `INTERVIEW_MAX_CHARS`). */
export const INTERVIEW_MAX_CHARS = 2000;
export const INTERVIEW_MIN_CHARS = 20;

/** The six free-text answers of the interview bucket. */
export const INTERVIEW_ANSWER_KEYS = [
  "motivationHigherEducation",
  "motivationSakem",
  "consistencyPlan",
  "attendanceCommitment",
  "parentResponse",
  "ifParentChangesMind",
] as const;
export type InterviewAnswerKey = (typeof INTERVIEW_ANSWER_KEYS)[number];
