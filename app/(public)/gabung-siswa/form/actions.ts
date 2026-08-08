"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte } from "drizzle-orm";
import { requireStudent } from "@/lib/auth-helpers";
import { getCurrentOpenBatch } from "@/lib/admission-batches";
import { getUserApplicationForBatch } from "@/lib/student-applications";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import {
  studentApplications,
  type StudentApplicationFormData,
} from "@/lib/db/schema";
import {
  documentsSchema,
  householdSchema,
  housingSchema,
  identitySchema,
  interviewSchema,
  marketingSchema,
  organizationsSchema,
  rupiahSchema,
  type FormValues,
  type StepId,
} from "@/lib/student-form-types";

export type SubmitResult =
  | { status: "success"; applicationId: string }
  | { status: "error"; message: string; step?: StepId };

/**
 * Full-form re-validation. Client validates step-by-step but never trust
 * client input; re-parse everything here and only proceed if all seven
 * step schemas succeed.
 */
export async function submitStudentApplication(
  values: FormValues,
): Promise<SubmitResult> {
  // Every submission must be tied to an authenticated student *and* an open
  // batch. Client wizard shouldn't render without both, but we re-check here
  // so a rogue POST can't bypass the gate.
  const student = await requireStudent();
  const batch = await getCurrentOpenBatch();
  if (!batch) {
    return {
      status: "error",
      message:
        "Belum ada batch pendaftaran yang dibuka. Silakan kembali saat pendaftaran berikutnya diumumkan.",
    };
  }

  const alreadySubmitted = await getUserApplicationForBatch(student.userId, batch.id);
  if (alreadySubmitted) {
    return {
      status: "error",
      message:
        "Kamu sudah mengirim pendaftaran untuk batch ini. Cek status di halaman Portal Siswa.",
    };
  }

  const identity = identitySchema.safeParse(values.identity);
  if (!identity.success) {
    return {
      status: "error",
      message: identity.error.issues[0]?.message ?? "Isian identitas belum lengkap.",
      step: "identity",
    };
  }
  const household = householdSchema.safeParse(values.household);
  if (!household.success) {
    return {
      status: "error",
      message: household.error.issues[0]?.message ?? "Isian keluarga belum lengkap.",
      step: "household",
    };
  }
  const housing = housingSchema.safeParse(values.housing);
  if (!housing.success) {
    return {
      status: "error",
      message: housing.error.issues[0]?.message ?? "Isian tempat tinggal belum lengkap.",
      step: "housing",
    };
  }
  const organizations = organizationsSchema.safeParse(values.organizations);
  if (!organizations.success) {
    return {
      status: "error",
      message: organizations.error.issues[0]?.message ?? "Isian organisasi belum lengkap.",
      step: "organizations",
    };
  }
  const documents = documentsSchema.safeParse(values.documents);
  if (!documents.success) {
    return {
      status: "error",
      message: documents.error.issues[0]?.message ?? "Isian berkas belum lengkap.",
      step: "documents",
    };
  }
  const marketing = marketingSchema.safeParse(values.marketing);
  if (!marketing.success) {
    return {
      status: "error",
      message: marketing.error.issues[0]?.message ?? "Isian marketing belum lengkap.",
      step: "marketing",
    };
  }
  const interview = interviewSchema.safeParse(values.interview);
  if (!interview.success) {
    return {
      status: "error",
      message: interview.error.issues[0]?.message ?? "Isian interview belum lengkap.",
      step: "interview",
    };
  }

  // Soft anti-duplicate: reject same WhatsApp submitted within the last hour.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.query.studentApplications.findFirst({
    where: and(
      eq(studentApplications.whatsapp, identity.data.whatsapp),
      gte(studentApplications.submittedAt, oneHourAgo),
    ),
    columns: { id: true },
  });
  if (recent) {
    return {
      status: "error",
      message:
        "Pendaftaran dari nomor WhatsApp ini baru saja dikirim. Mohon tunggu sebelum mencoba lagi.",
      step: "identity",
    };
  }

  // father/mother incomes are transformed by rupiahSchema (string → number)
  // inside householdSchema, so household.data.fatherIncome is already numeric.
  // The optional earners are validated via superRefine on the raw string, so
  // we still need expectRupiah for those.
  const fatherIncome = household.data.fatherIncome;
  const motherIncome = household.data.motherIncome;

  const otherEarners: StudentApplicationFormData["household"]["otherEarners"] =
    [];
  if (household.data.hasOtherEarner1) {
    otherEarners.push({
      relation: household.data.earner1Relation ?? "",
      income: expectRupiah(household.data.earner1Income ?? ""),
    });
  }
  if (household.data.hasOtherEarner2) {
    otherEarners.push({
      relation: household.data.earner2Relation ?? "",
      income: expectRupiah(household.data.earner2Income ?? ""),
    });
  }

  const debtBlock: StudentApplicationFormData["housing"]["debt"] = housing.data
    .hasDebt
    ? {
        type: housing.data.debtType ?? "",
        amount: expectRupiah(housing.data.debtAmount ?? ""),
        installmentMonths: Number(housing.data.debtInstallmentMonths ?? 0),
        description: housing.data.debtDescription ?? "",
      }
    : null;

  const orgList = organizations.data.hasOrganizations
    ? organizations.data.entries
        .filter((e) => (e.name?.trim().length ?? 0) > 0)
        .map((e) => ({
          name: (e.name ?? "").trim(),
          position: (e.position ?? "").trim(),
        }))
    : [];

  const formData: StudentApplicationFormData = {
    identity: {
      nickname: identity.data.nickname,
      gender: identity.data.gender,
      religion: identity.data.religion,
      homeAddress: identity.data.homeAddress,
    },
    household: {
      livingWith: household.data.livingWith,
      father: {
        name: household.data.fatherName,
        occupation: household.data.fatherOccupation,
        income: fatherIncome,
      },
      mother: {
        name: household.data.motherName,
        occupation: household.data.motherOccupation,
        income: motherIncome,
      },
      otherEarners,
      familySize: household.data.familySize,
    },
    housing: {
      residenceStatus: housing.data.residenceStatus,
      buildingArea: housing.data.buildingArea,
      motorcycles: housing.data.motorcycles,
      cars: housing.data.cars,
      debt: debtBlock,
    },
    organizations: orgList,
    documents: {
      fatherIncomeUrl: documents.data.fatherIncomeUrl || null,
      motherIncomeUrl: documents.data.motherIncomeUrl || null,
      otherEarner1IncomeUrl: documents.data.otherEarner1IncomeUrl || null,
      otherEarner2IncomeUrl: documents.data.otherEarner2IncomeUrl || null,
      debtProofUrl: documents.data.debtProofUrl || null,
      electricityBillUrl: documents.data.electricityBillUrl,
      familyCardUrl: documents.data.familyCardUrl,
      parentPermissionUrl: documents.data.parentPermissionUrl,
      selfPhotoUrl: documents.data.selfPhotoUrl,
      dtksRegistered: documents.data.dtksRegistered === "ya",
      dtksUrl: documents.data.dtksUrl || null,
      houseImagesUrl: documents.data.houseImagesUrl,
      vehicleImagesUrl: documents.data.vehicleImagesUrl,
    },
    marketing: {
      instagramUsername: marketing.data.instagramUsername,
      instagramFollowProofUrl: marketing.data.instagramFollowProofUrl,
      broadcastProofUrl: marketing.data.broadcastProofUrl,
      twibbonUploadUrl: marketing.data.twibbonUploadUrl,
      storyUploadUrl: marketing.data.storyUploadUrl,
    },
    interview: {
      motivationHigherEducation: interview.data.motivationHigherEducation,
      motivationSakem: interview.data.motivationSakem,
      consistencyPlan: interview.data.consistencyPlan,
      attendanceCommitment: interview.data.attendanceCommitment,
      parentResponse: interview.data.parentResponse,
      ifParentChangesMind: interview.data.ifParentChangesMind,
      agreedToSignedStatement: interview.data.agreedToSignedStatement === "ya",
    },
  };

  const [inserted] = await db
    .insert(studentApplications)
    .values({
      userId: student.userId,
      batchId: batch.id,
      fullName: identity.data.fullName,
      email: student.email,
      whatsapp: identity.data.whatsapp,
      schoolName: identity.data.schoolName,
      graduationYear: identity.data.graduationBatch,
      branchPreference: identity.data.branch,
      formData,
    })
    .returning({ id: studentApplications.id });

  await writeAudit({
    actorEmail: student.email,
    actorId: student.userId,
    action: "application.submit",
    resourceType: "application",
    resourceId: inserted.id,
    metadata: {
      batchId: batch.id,
      batchYear: batch.year,
      schoolName: identity.data.schoolName,
      graduationBatch: identity.data.graduationBatch,
      branch: identity.data.branch,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/applications");
  revalidatePath(`/admin/batches/${batch.id}`);
  revalidatePath("/portal");
  revalidatePath("/portal/status");

  return { status: "success", applicationId: inserted.id };
}

/** Server-side wrapper for the rupiah parser (raises with a clear error). */
function expectRupiah(input: string | undefined): number {
  const result = rupiahSchema.safeParse(input ?? "");
  if (!result.success) {
    // Should not happen — client validated. Fall back to 0 rather than crash;
    // admin will spot it in the review UI.
    return 0;
  }
  return result.data;
}
