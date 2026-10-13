// The field rules of the seven buckets of the application form, as plain functions: no dependency, no framework, no
// zod. The Worker validates every step save and the submit with them; the wizard may run them per keystroke or per
// step without paying for a schema library. `schemas.ts` wraps the same functions as zod schemas for code that wants
// a `ZodType` (a resolver); nothing is decided there.
//
// Source of every rule and message: docs/cloudflare/portal-api.md, section 7, which is the legacy zod schemas of
// lib/student-form-types.ts (zod 3) re-expressed with the same Indonesian messages. Where the legacy left a message to
// zod's English default, this file writes "Maksimal N karakter" (the wording of the legacy register form) or a new
// short line; each such line is marked "new" below and pinned by test/portal-foundation-form.test.ts.
//
// What these functions return is the STORED value of a bucket (`application_drafts.form_data.<step>`): the validated
// input, strings trimmed, `whatsapp` without spaces, `instagramUsername` without its `@`, a rupiah amount still as the
// student typed it ("1.200.000"; it becomes a number at submit, `form-data.ts`), a count as it was sent (a number or a
// numeric string), unknown keys dropped, and the fields that only exist when a toggle is on left out when it is off.
// Validating a stored value again gives the same value (the submit does exactly that).

import {
  BRANCHES,
  GENDERS,
  GRADUATION_BATCHES,
  INTERVIEW_ANSWER_KEYS,
  INTERVIEW_MAX_CHARS,
  INTERVIEW_MIN_CHARS,
  RELIGIONS,
  RESIDENCE_STATUSES,
  YES_NO,
  type InterviewAnswerKey,
  type StepId,
} from "./steps";

export type FieldPath = (string | number)[];

/** One failed rule. `path` is the JSON path of the body, e.g. `["entries", 0, "name"]`; the API joins it with dots. */
export interface FieldIssue {
  path: FieldPath;
  message: string;
}

// ─── Messages ──────────────────────────────────────────────────────────

/** The `message` of a 400 `invalid` answer (docs/cloudflare/portal-api.md, 8.1). */
export const INVALID_FORM_MESSAGE = "Periksa kembali isian formulir.";

const REQUIRED = "Wajib diisi";
/** New: a value of the wrong JSON type (a number where text belongs). */
const INVALID_VALUE = "Isian tidak valid";
const maxChars = (max: number) => `Maksimal ${max} karakter`;
const YES_NO_MESSAGE = "Pilih Ya atau Tidak";

export const RUPIAH_MESSAGES = {
  required: REQUIRED,
  rp: 'Hilangkan "Rp". Contoh benar: 1.200.000',
  comma: "Hilangkan koma. Contoh benar: 1.200.000",
  range: "Isi satu angka pasti, bukan rentang.",
  digits: "Hanya angka. Contoh: 1.200.000",
  /** New: the legacy left it to zod's English default. */
  tooBig: "Angka terlalu besar",
} as const;

export const WHATSAPP_MESSAGE = "Gunakan format 62 diikuti 8–14 digit. Contoh: 6281392254544";
export const AGREEMENT_REFUSED_MESSAGE = "Pendaftaran hanya dapat dilanjutkan jika kamu bersedia menandatangani surat pernyataan bermaterai.";

// ─── Stored values ─────────────────────────────────────────────────────

/** A count exactly as the client sent it: a JSON number or a numeric string. */
export type CountInput = number | string;

export interface IdentityValue {
  fullName: string;
  nickname: string;
  gender: (typeof GENDERS)[number];
  religion: (typeof RELIGIONS)[number];
  schoolName: string;
  branch: (typeof BRANCHES)[number];
  homeAddress: string;
  graduationBatch: (typeof GRADUATION_BATCHES)[number];
  whatsapp: string;
}

export interface HouseholdValue {
  livingWith: string[];
  fatherName: string;
  fatherOccupation: string;
  fatherIncome: string;
  motherName: string;
  motherOccupation: string;
  motherIncome: string;
  hasOtherEarner1: boolean;
  /** Present only when `hasOtherEarner1`. */
  earner1Relation?: string;
  earner1Income?: string;
  hasOtherEarner2: boolean;
  /** Present only when `hasOtherEarner2`. */
  earner2Relation?: string;
  earner2Income?: string;
  familySize: CountInput;
}

export interface HousingValue {
  residenceStatus: (typeof RESIDENCE_STATUSES)[number];
  buildingArea: CountInput;
  motorcycles: CountInput;
  cars: CountInput;
  hasDebt: boolean;
  /** Present only when `hasDebt`. */
  debtType?: string;
  debtAmount?: string;
  debtInstallmentMonths?: CountInput;
  debtDescription?: string;
}

export interface OrganizationEntry {
  name: string;
  position: string;
}

export interface OrganizationsValue {
  hasOrganizations: boolean;
  /** The filled entries only; `[]` when `hasOrganizations` is false. */
  entries: OrganizationEntry[];
}

/** The answers of the documents step; the documents themselves are files (`slots.ts`). */
export interface DocumentsValue {
  dtksRegistered: (typeof YES_NO)[number];
}

/** The answers of the marketing step; the proofs themselves are files. */
export interface MarketingValue {
  instagramUsername: string;
}

export type InterviewValue = { [K in InterviewAnswerKey]: string } & { agreedToSignedStatement: "ya" };

export interface StepValues {
  identity: IdentityValue;
  household: HouseholdValue;
  housing: HousingValue;
  organizations: OrganizationsValue;
  documents: DocumentsValue;
  marketing: MarketingValue;
  interview: InterviewValue;
}

export type StepValidation<K extends StepId> =
  | { ok: true; value: StepValues[K] }
  | {
      ok: false;
      /** The first message of every failing field, keyed by the dotted JSON path (`entries.0.name`). */
      fields: Record<string, string>;
      /** Every failure in the order the rules ran. `issues[0]` is what the submit reports (legacy: `issues[0].message`). */
      issues: FieldIssue[];
      /** `issues[0].message`, or the generic line when the body is not an object. */
      message: string;
    };

// ─── Primitives ────────────────────────────────────────────────────────

class Collector {
  readonly issues: FieldIssue[] = [];
  add(path: FieldPath, message: string): void {
    this.issues.push({ path, message });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string, trimmed; `undefined` for anything that is not one. */
function trimmed(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

/** `nonEmpty(max)`: 1 to `max` characters once trimmed. */
function requiredText(c: Collector, path: FieldPath, value: unknown, max: number): string {
  const text = trimmed(value);
  if (text === undefined) {
    c.add(path, value === undefined || value === null ? REQUIRED : INVALID_VALUE);
    return "";
  }
  if (text === "") c.add(path, REQUIRED);
  else if (text.length > max) c.add(path, maxChars(max));
  return text;
}

/** Text that may be empty, at most `max` characters. Whether it is required is the caller's rule. */
function optionalText(c: Collector, path: FieldPath, value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  const text = trimmed(value);
  if (text === undefined) {
    c.add(path, INVALID_VALUE);
    return "";
  }
  if (text.length > max) c.add(path, maxChars(max));
  return text;
}

/** `choice(list)`: exactly one of the listed strings (after trimming). */
function choice<T extends string>(c: Collector, path: FieldPath, value: unknown, list: readonly T[], message: string): T {
  const text = trimmed(value);
  const found = list.find((item) => item === text);
  if (found === undefined) c.add(path, message);
  return (found ?? list[0]) as T;
}

/** A toggle. A missing key is "off"; anything else that is not a boolean is an error. */
function toggle(c: Collector, path: FieldPath, value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  c.add(path, YES_NO_MESSAGE);
  return false;
}

// ─── Rupiah ────────────────────────────────────────────────────────────

const RUPIAH_MAX = 1_000_000_000_000;

/**
 * `rupiahSchema` of the legacy app: "1.200.000" or "1200000" are 1200000. Rejects "Rp", commas, ranges and anything
 * that is not digits and dots. The checks run in this order and the first failure is the message.
 */
export function parseRupiah(text: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = text.trim();
  if (value === "") return { ok: false, message: RUPIAH_MESSAGES.required };
  if (/rp/i.test(value)) return { ok: false, message: RUPIAH_MESSAGES.rp };
  if (value.includes(",")) return { ok: false, message: RUPIAH_MESSAGES.comma };
  if (value.includes("-")) return { ok: false, message: RUPIAH_MESSAGES.range };
  const digits = value.replaceAll(".", "");
  if (!/^\d+$/.test(digits)) return { ok: false, message: RUPIAH_MESSAGES.digits };
  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount > RUPIAH_MAX) return { ok: false, message: RUPIAH_MESSAGES.tooBig };
  return { ok: true, value: amount };
}

/** A rupiah field: stored as typed (trimmed). A value that is not text is "Wajib diisi" when missing, "Hanya angka" otherwise. */
function rupiah(c: Collector, path: FieldPath, value: unknown): string {
  if (value === undefined || value === null) {
    c.add(path, RUPIAH_MESSAGES.required);
    return "";
  }
  if (typeof value !== "string") {
    c.add(path, RUPIAH_MESSAGES.digits);
    return "";
  }
  const parsed = parseRupiah(value);
  if (!parsed.ok) c.add(path, parsed.message);
  return value.trim();
}

// ─── Counts (a number, or a numeric string, as `z.coerce.number()` took them) ───

interface CountRules {
  /** Not a number at all. */
  notNumber: string;
  /** A number with a fraction. */
  notWhole: string;
  min: number;
  minMessage: string;
  max: number;
  maxMessage: string;
  /**
   * An empty string. The legacy coerced it to 0, so it reached the minimum's message; that is kept where the minimum
   * is above 0 (the family size, the months of an installment). Where 0 is a valid answer (an area, a vehicle count)
   * an untouched field would pass as an answer, so an empty string is "not a number" there (a deliberate tightening).
   */
  emptyIsZero: boolean;
}

/** A whole number as the form sends it. Returns what to store (as sent, trimmed) or `undefined` after reporting. */
function count(c: Collector, path: FieldPath, value: unknown, rules: CountRules): CountInput | undefined {
  let number: number;
  let stored: CountInput;
  if (typeof value === "number") {
    number = value;
    stored = value;
  } else if (typeof value === "string") {
    const text = value.trim();
    if (text === "" && rules.emptyIsZero) number = 0;
    else if (/^-?\d+(\.\d+)?$/.test(text)) number = Number(text);
    else number = Number.NaN;
    stored = text;
  } else {
    number = Number.NaN;
    stored = "";
  }
  if (!Number.isFinite(number)) {
    c.add(path, rules.notNumber);
    return undefined;
  }
  if (!Number.isInteger(number)) c.add(path, rules.notWhole);
  else if (number < rules.min) c.add(path, rules.minMessage);
  else if (number > rules.max) c.add(path, rules.maxMessage);
  else return stored;
  return undefined;
}

const FAMILY_SIZE: CountRules = {
  notNumber: REQUIRED,
  notWhole: "Isi dengan angka bulat", // new
  min: 1,
  minMessage: "Minimal 1 (termasuk kamu)",
  max: 20,
  maxMessage: "Maksimal 20",
  emptyIsZero: true,
};
const BUILDING_AREA: CountRules = {
  notNumber: "Isi luas dalam meter persegi",
  notWhole: "Isi luas dalam meter persegi",
  min: 0,
  minMessage: "Tidak boleh negatif",
  max: 10_000,
  maxMessage: "Maksimal 10000", // new
  emptyIsZero: false,
};
const VEHICLES: CountRules = {
  notNumber: "Isi dengan angka",
  notWhole: "Isi dengan angka",
  min: 0,
  minMessage: "Tidak boleh negatif",
  max: 50,
  maxMessage: "Maksimal 50", // new
  emptyIsZero: false,
};
const INSTALLMENT_MONTHS: CountRules = {
  notNumber: REQUIRED,
  notWhole: "Isi dalam angka bulan tanpa satuan",
  min: 1,
  minMessage: "Minimal 1 bulan",
  max: 600,
  maxMessage: "Maksimal 600 bulan",
  emptyIsZero: true,
};

// ─── The seven buckets ─────────────────────────────────────────────────

function validateIdentity(input: Record<string, unknown>, c: Collector): IdentityValue {
  // Name: min, max, then "not only capitals" (the legacy chain). An empty or missing name is "too short".
  const fullName = trimmed(input.fullName) ?? "";
  if (fullName.length < 3) c.add(["fullName"], "Nama minimal 3 karakter");
  else if (fullName.length > 120) c.add(["fullName"], maxChars(120)); // new
  else if (/^[A-ZÀ-ÿ ]+$/.test(fullName)) c.add(["fullName"], "Jangan menggunakan huruf kapital semua. Contoh: Dadi Dinan Haris");

  const nickname = requiredText(c, ["nickname"], input.nickname, 60);
  const gender = choice(c, ["gender"], input.gender, GENDERS, "Pilih jenis kelamin");
  const religion = choice(c, ["religion"], input.religion, RELIGIONS, "Pilih agama");
  const schoolName = requiredText(c, ["schoolName"], input.schoolName, 200);
  const branch = choice(c, ["branch"], input.branch, BRANCHES, "Pilih cabang");
  const homeAddress = requiredText(c, ["homeAddress"], input.homeAddress, 500);
  const graduationBatch = choice(c, ["graduationBatch"], input.graduationBatch, GRADUATION_BATCHES, "Pilih tahun angkatan");

  // WhatsApp: all whitespace removed, then 62 and 8 to 14 digits.
  const whatsapp = (trimmed(input.whatsapp) ?? "").replace(/\s+/g, "");
  if (!/^62\d{8,14}$/.test(whatsapp)) c.add(["whatsapp"], WHATSAPP_MESSAGE);

  return { fullName, nickname, gender, religion, schoolName, branch, homeAddress, graduationBatch, whatsapp };
}

const LIVING_WITH_MAX_ITEMS = 10;
const LIVING_WITH_MAX_LENGTH = 60;

function validateHousehold(input: Record<string, unknown>, c: Collector): HouseholdValue {
  const livingWith: string[] = [];
  const rawLiving = input.livingWith;
  if (!Array.isArray(rawLiving) || rawLiving.length === 0) c.add(["livingWith"], "Pilih minimal satu");
  else if (rawLiving.length > LIVING_WITH_MAX_ITEMS) c.add(["livingWith"], `Pilih maksimal ${LIVING_WITH_MAX_ITEMS}`); // new
  else {
    rawLiving.forEach((item: unknown, index) => {
      const text = trimmed(item);
      if (text === undefined || text === "") c.add(["livingWith", index], REQUIRED); // new
      else if (text.length > LIVING_WITH_MAX_LENGTH) c.add(["livingWith", index], maxChars(LIVING_WITH_MAX_LENGTH)); // new
      else livingWith.push(text);
    });
  }

  const fatherName = requiredText(c, ["fatherName"], input.fatherName, 120);
  const fatherOccupation = requiredText(c, ["fatherOccupation"], input.fatherOccupation, 120);
  const fatherIncome = rupiah(c, ["fatherIncome"], input.fatherIncome);
  const motherName = requiredText(c, ["motherName"], input.motherName, 120);
  const motherOccupation = requiredText(c, ["motherOccupation"], input.motherOccupation, 120);
  const motherIncome = rupiah(c, ["motherIncome"], input.motherIncome);
  const hasOtherEarner1 = toggle(c, ["hasOtherEarner1"], input.hasOtherEarner1);
  const hasOtherEarner2 = toggle(c, ["hasOtherEarner2"], input.hasOtherEarner2);
  const familySize = count(c, ["familySize"], input.familySize, FAMILY_SIZE);

  const value: HouseholdValue = {
    livingWith,
    fatherName,
    fatherOccupation,
    fatherIncome,
    motherName,
    motherOccupation,
    motherIncome,
    hasOtherEarner1,
    hasOtherEarner2,
    familySize: familySize ?? "",
  };

  // The conditional rules come after the plain fields, as the legacy `superRefine` did.
  if (hasOtherEarner1) {
    value.earner1Relation = optionalText(c, ["earner1Relation"], input.earner1Relation, 120);
    if (value.earner1Relation === "") c.add(["earner1Relation"], REQUIRED);
    value.earner1Income = rupiah(c, ["earner1Income"], input.earner1Income);
  }
  if (hasOtherEarner2) {
    if (!hasOtherEarner1) c.add(["earner2Relation"], "Isi anggota pertama dulu.");
    value.earner2Relation = optionalText(c, ["earner2Relation"], input.earner2Relation, 120);
    if (value.earner2Relation === "") c.add(["earner2Relation"], REQUIRED);
    value.earner2Income = rupiah(c, ["earner2Income"], input.earner2Income);
  }
  return value;
}

function validateHousing(input: Record<string, unknown>, c: Collector): HousingValue {
  const residenceStatus = choice(c, ["residenceStatus"], input.residenceStatus, RESIDENCE_STATUSES, "Pilih status tempat tinggal");
  const buildingArea = count(c, ["buildingArea"], input.buildingArea, BUILDING_AREA);
  const motorcycles = count(c, ["motorcycles"], input.motorcycles, VEHICLES);
  const cars = count(c, ["cars"], input.cars, VEHICLES);
  const hasDebt = toggle(c, ["hasDebt"], input.hasDebt);

  const value: HousingValue = { residenceStatus, buildingArea: buildingArea ?? "", motorcycles: motorcycles ?? "", cars: cars ?? "", hasDebt };
  if (hasDebt) {
    value.debtType = optionalText(c, ["debtType"], input.debtType, 200);
    if (value.debtType === "") c.add(["debtType"], REQUIRED);
    value.debtAmount = rupiah(c, ["debtAmount"], input.debtAmount);
    value.debtInstallmentMonths = count(c, ["debtInstallmentMonths"], input.debtInstallmentMonths, INSTALLMENT_MONTHS) ?? "";
    value.debtDescription = optionalText(c, ["debtDescription"], input.debtDescription, 500);
    if (value.debtDescription === "") c.add(["debtDescription"], REQUIRED);
  }
  return value;
}

const ORGANIZATIONS_MAX_ENTRIES = 20;
const ORGANIZATION_FIELD_MAX = 200;

function validateOrganizations(input: Record<string, unknown>, c: Collector): OrganizationsValue {
  const hasOrganizations = toggle(c, ["hasOrganizations"], input.hasOrganizations);
  // "When hasOrganizations is false the entries are ignored": not checked, not stored.
  if (!hasOrganizations) return { hasOrganizations, entries: [] };

  const raw = input.entries;
  if (raw !== undefined && !Array.isArray(raw)) {
    c.add(["entries"], INVALID_VALUE); // new
    return { hasOrganizations, entries: [] };
  }
  const list: unknown[] = raw ?? [];
  if (list.length > ORGANIZATIONS_MAX_ENTRIES) {
    c.add(["entries"], `Maksimal ${ORGANIZATIONS_MAX_ENTRIES} organisasi`); // new
    return { hasOrganizations, entries: [] };
  }

  const entries: OrganizationEntry[] = [];
  list.forEach((entry, index) => {
    if (!isRecord(entry)) {
      c.add(["entries", index], INVALID_VALUE); // new
      return;
    }
    const name = optionalText(c, ["entries", index, "name"], entry.name, ORGANIZATION_FIELD_MAX); // length message is new
    const position = optionalText(c, ["entries", index, "position"], entry.position, ORGANIZATION_FIELD_MAX);
    if (name === "" && position === "") return; // an empty row is not an entry
    // Every filled entry needs both. The index is the entry's place in the body (the legacy counted among the
    // filled ones, which put the message on the wrong row when an empty row came first).
    if (name === "") c.add(["entries", index, "name"], "Nama organisasi wajib diisi");
    if (position === "") c.add(["entries", index, "position"], "Jabatan wajib diisi");
    entries.push({ name, position });
  });
  if (entries.length === 0 && c.issues.length === 0) c.add(["entries"], "Tambahkan minimal satu organisasi");
  return { hasOrganizations, entries };
}

function validateDocuments(input: Record<string, unknown>, c: Collector): DocumentsValue {
  return { dtksRegistered: choice(c, ["dtksRegistered"], input.dtksRegistered, YES_NO, YES_NO_MESSAGE) };
}

function validateMarketing(input: Record<string, unknown>, c: Collector): MarketingValue {
  // One leading "@" is dropped; then 1 to 30 characters of letters, digits, dots and underscores.
  const username = (trimmed(input.instagramUsername) ?? "").replace(/^@/, "");
  if (username === "") c.add(["instagramUsername"], REQUIRED);
  else if (username.length > 30) c.add(["instagramUsername"], maxChars(30));
  else if (!/^[a-zA-Z0-9._]+$/.test(username)) c.add(["instagramUsername"], "Hanya huruf, angka, titik, dan garis bawah.");
  return { instagramUsername: username };
}

function validateInterview(input: Record<string, unknown>, c: Collector): InterviewValue {
  const value = {} as { [K in InterviewAnswerKey]: string };
  for (const key of INTERVIEW_ANSWER_KEYS) {
    const text = trimmed(input[key]) ?? "";
    if (text.length < INTERVIEW_MIN_CHARS) c.add([key], `Tulis minimal ${INTERVIEW_MIN_CHARS} karakter`);
    else if (text.length > INTERVIEW_MAX_CHARS) c.add([key], maxChars(INTERVIEW_MAX_CHARS));
    value[key] = text;
  }
  const answer = trimmed(input.agreedToSignedStatement);
  if (answer !== "ya" && answer !== "tidak") c.add(["agreedToSignedStatement"], YES_NO_MESSAGE);
  else if (answer === "tidak") c.add(["agreedToSignedStatement"], AGREEMENT_REFUSED_MESSAGE);
  return { ...value, agreedToSignedStatement: "ya" };
}

const VALIDATORS: { [K in StepId]: (input: Record<string, unknown>, c: Collector) => StepValues[K] } = {
  identity: validateIdentity,
  household: validateHousehold,
  housing: validateHousing,
  organizations: validateOrganizations,
  documents: validateDocuments,
  marketing: validateMarketing,
  interview: validateInterview,
};

/**
 * Runs every rule of one bucket against a request body (or a stored bucket). Never throws. On success `value` is what
 * is stored; on failure nothing is stored and `fields` is what the 400 answer carries.
 */
export function validateStep<K extends StepId>(step: K, body: unknown): StepValidation<K> {
  if (!isRecord(body)) return { ok: false, fields: {}, issues: [{ path: [], message: INVALID_FORM_MESSAGE }], message: INVALID_FORM_MESSAGE };
  const collector = new Collector();
  const value = VALIDATORS[step](body, collector) as StepValues[K];
  if (collector.issues.length === 0) return { ok: true, value };
  const fields: Record<string, string> = {};
  for (const issue of collector.issues) {
    const key = issue.path.join(".");
    if (!(key in fields)) fields[key] = issue.message;
  }
  return { ok: false, fields, issues: collector.issues, message: collector.issues[0]!.message };
}

/** What would be stored for this body, or `null` when a rule fails. */
export function sanitizeStep<K extends StepId>(step: K, body: unknown): StepValues[K] | null {
  const result = validateStep(step, body);
  return result.ok ? result.value : null;
}
