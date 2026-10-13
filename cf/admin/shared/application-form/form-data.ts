// From the seven stored buckets to what `student_applications` holds: the five top-level columns and `form_data`
// version 3 (docs/cloudflare/portal-api.md, 9.3). Pure TypeScript, no dependency beyond the rules. The submit calls
// `buildFormData` after it has validated every bucket again, so these functions may assume valid buckets; they throw
// on one that is not rather than write a wrong number (the legacy fell back to 0 and left it to the admin to notice).
//
// Version 3 differs from version 2 (the legacy) only where the legacy held links: `documents` keeps `dtksRegistered`
// and `marketing` keeps `instagramUsername`; every document and proof is a file (`application_files`), not a field.
// Version 2 rows stay readable by the admin screen.

import { parseRupiah, type CountInput, type IdentityValue, type StepValues } from "./rules";

export const FORM_DATA_VERSION = 3 as const;

export interface FormDataV3 {
  formVersion: typeof FORM_DATA_VERSION;
  identity: {
    nickname: string;
    gender: IdentityValue["gender"];
    religion: IdentityValue["religion"];
    homeAddress: string;
  };
  household: {
    livingWith: string[];
    father: { name: string; occupation: string; income: number };
    mother: { name: string; occupation: string; income: number };
    /** Earner 1 then earner 2, only those switched on. */
    otherEarners: { relation: string; income: number }[];
    familySize: number;
  };
  housing: {
    residenceStatus: string;
    buildingArea: number;
    motorcycles: number;
    cars: number;
    /** `null` when the student has no debt. */
    debt: { type: string; amount: number; installmentMonths: number; description: string } | null;
  };
  /** Only entries with a name, trimmed; `[]` when the student belongs to none. */
  organizations: { name: string; position: string }[];
  documents: { dtksRegistered: boolean };
  marketing: { instagramUsername: string };
  interview: StepValues["interview"];
}

/** The top-level columns of `student_applications` that come out of the identity bucket. The email is the account's, read at submit. */
export interface IdentityColumns {
  fullName: string;
  whatsapp: string;
  schoolName: string;
  /** `graduation_year`: the text of the choice, verbatim ("2027 (Kelas 12)"). */
  graduationYear: string;
  /** `branch_preference`. */
  branchPreference: string;
}

export function identityColumns(identity: IdentityValue): IdentityColumns {
  return {
    fullName: identity.fullName,
    whatsapp: identity.whatsapp,
    schoolName: identity.schoolName,
    graduationYear: identity.graduationBatch,
    branchPreference: identity.branch,
  };
}

function amount(text: string | undefined): number {
  const parsed = parseRupiah(text ?? "");
  if (!parsed.ok) throw new Error("buildFormData: a rupiah amount was not validated");
  return parsed.value;
}

function whole(value: CountInput | undefined): number {
  const text = typeof value === "string" ? value.trim() : "";
  // An empty string is 0 to `Number()`, and a bucket that holds one was not validated (the rules refuse it).
  if (typeof value !== "number" && text === "") throw new Error("buildFormData: a count was not validated");
  const number = typeof value === "number" ? value : Number(text);
  if (!Number.isInteger(number)) throw new Error("buildFormData: a count was not validated");
  return number;
}

export function buildFormData(buckets: StepValues): FormDataV3 {
  const { identity, household, housing, organizations, documents, marketing, interview } = buckets;

  const otherEarners: FormDataV3["household"]["otherEarners"] = [];
  if (household.hasOtherEarner1) otherEarners.push({ relation: household.earner1Relation ?? "", income: amount(household.earner1Income) });
  if (household.hasOtherEarner2) otherEarners.push({ relation: household.earner2Relation ?? "", income: amount(household.earner2Income) });

  return {
    formVersion: FORM_DATA_VERSION,
    identity: { nickname: identity.nickname, gender: identity.gender, religion: identity.religion, homeAddress: identity.homeAddress },
    household: {
      livingWith: [...household.livingWith],
      father: { name: household.fatherName, occupation: household.fatherOccupation, income: amount(household.fatherIncome) },
      mother: { name: household.motherName, occupation: household.motherOccupation, income: amount(household.motherIncome) },
      otherEarners,
      familySize: whole(household.familySize),
    },
    housing: {
      residenceStatus: housing.residenceStatus,
      buildingArea: whole(housing.buildingArea),
      motorcycles: whole(housing.motorcycles),
      cars: whole(housing.cars),
      debt: housing.hasDebt
        ? {
            type: housing.debtType ?? "",
            amount: amount(housing.debtAmount),
            installmentMonths: whole(housing.debtInstallmentMonths),
            description: housing.debtDescription ?? "",
          }
        : null,
    },
    organizations: organizations.hasOrganizations ? organizations.entries.filter((entry) => entry.name !== "").map((entry) => ({ name: entry.name, position: entry.position })) : [],
    documents: { dtksRegistered: documents.dtksRegistered === "ya" },
    marketing: { instagramUsername: marketing.instagramUsername },
    interview: { ...interview },
  };
}
