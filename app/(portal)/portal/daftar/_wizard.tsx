"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CircleDot, Lock } from "lucide-react";
import { z } from "zod";
import {
  STEPS,
  documentsSchema,
  emptyFormValues,
  householdSchema,
  housingSchema,
  identitySchema,
  interviewSchema,
  marketingSchema,
  organizationsSchema,
  type FormValues,
  type StepId,
} from "@/lib/student-form-types";
import { submitStudentApplication } from "./actions";
import { IntroStep } from "./_steps/intro";
import { IdentityStep } from "./_steps/identity";
import { HouseholdStep } from "./_steps/household";
import { HousingStep } from "./_steps/housing";
import { OrganizationsStep } from "./_steps/organizations";
import { DocumentsStep } from "./_steps/documents";
import { MarketingStep } from "./_steps/marketing";
import { InterviewStep } from "./_steps/interview";
import { ReviewStep } from "./_steps/review";
import { SuccessScreen } from "./_success";
import type { FieldErrors } from "./_shared";

// v2 = new schema (auth-gated, per-batch, prefills identity from user).
// Bump the key when the wizard shape changes so we don't try to hydrate an
// incompatible saved payload.
const STORAGE_KEY_PREFIX = "sakem-student-form-v2";

interface WizardProps {
  batch: { id: string; year: number; name: string };
  user: { email: string; name: string | null };
}

const STEP_SCHEMAS = {
  identity: identitySchema,
  household: householdSchema,
  housing: housingSchema,
  organizations: organizationsSchema,
  documents: documentsSchema,
  marketing: marketingSchema,
  interview: interviewSchema,
} as const;

function flattenErrors(err: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function Wizard({ batch, user }: WizardProps) {
  // Per-user + per-batch storage key so a shared browser doesn't leak one
  // student's answers to another, and so switching batches starts fresh.
  // useMemo so hooks below can safely include this in their deps arrays.
  const STORAGE_KEY = useMemo(
    () => `${STORAGE_KEY_PREFIX}:${batch.id}:${user.email}`,
    [batch.id, user.email],
  );
  const [values, setValues] = useState<FormValues>(() => {
    // Seed the identity fullName from the Google-provided name — cheap win,
    // students always want to correct or confirm it anyway.
    return {
      ...emptyFormValues,
      identity: {
        ...emptyFormValues.identity,
        fullName: user.name ?? "",
      },
    };
  });
  const [stepIdx, setStepIdx] = useState(0);
  const [visited, setVisited] = useState<Set<StepId>>(
    () => new Set(["intro"]),
  );
  // Gate the persist effect until localStorage has been read once, so the
  // initial empty state doesn't clobber a saved payload before React commits
  // the loaded values.
  const [hydrated, setHydrated] = useState(false);
  const [errors, setErrors] = useState<Record<StepId, FieldErrors>>({
    intro: {},
    identity: {},
    household: {},
    housing: {},
    organizations: {},
    documents: {},
    marketing: {},
    interview: {},
    review: {},
  });
  const [submitState, setSubmitState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "success"; applicationId: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  // Restore from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        values: FormValues;
        stepIdx: number;
        visited: StepId[];
      };
      if (parsed.values) setValues({ ...emptyFormValues, ...parsed.values });
      if (typeof parsed.stepIdx === "number") {
        setStepIdx(Math.min(parsed.stepIdx, STEPS.length - 1));
      }
      if (Array.isArray(parsed.visited)) {
        setVisited(new Set<StepId>(parsed.visited));
      }
    } catch {
      // Ignore — bad payload just means fresh form.
    } finally {
      setHydrated(true);
    }
  }, [STORAGE_KEY]);

  // Persist on every meaningful change, but only after hydration.
  useEffect(() => {
    if (!hydrated) return;
    if (submitState.status === "success") return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ values, stepIdx, visited: Array.from(visited) }),
      );
    } catch {
      // Storage full / disabled — silently drop.
    }
  }, [STORAGE_KEY, hydrated, values, stepIdx, visited, submitState.status]);

  const currentStep = STEPS[stepIdx];

  const updateStep = useCallback(
    <K extends keyof FormValues>(step: K, patch: Partial<FormValues[K]>) => {
      setValues((prev) => ({ ...prev, [step]: { ...prev[step], ...patch } }));
    },
    [],
  );

  const clearFieldError = useCallback(
    (step: StepId, path: string) => {
      setErrors((prev) => {
        const next = { ...prev[step] };
        // Clear anything nested under this path too.
        for (const key of Object.keys(next)) {
          if (key === path || key.startsWith(`${path}.`)) delete next[key];
        }
        return { ...prev, [step]: next };
      });
    },
    [],
  );

  const validateStep = useCallback(
    (step: StepId): boolean => {
      if (step === "intro" || step === "review") return true;
      // The "documents" step visually contains both documents + marketing,
      // so advancing past it must validate both buckets.
      if (step === "documents") {
        const docResult = documentsSchema.safeParse(values.documents);
        const mktResult = marketingSchema.safeParse(values.marketing);
        setErrors((prev) => ({
          ...prev,
          documents: docResult.success ? {} : flattenErrors(docResult.error),
          marketing: mktResult.success ? {} : flattenErrors(mktResult.error),
        }));
        return docResult.success && mktResult.success;
      }
      const schema = STEP_SCHEMAS[step];
      const result = schema.safeParse(values[step]);
      if (result.success) {
        setErrors((prev) => ({ ...prev, [step]: {} }));
        return true;
      }
      setErrors((prev) => ({ ...prev, [step]: flattenErrors(result.error) }));
      return false;
    },
    [values],
  );

  const goToStep = useCallback(
    (targetIdx: number) => {
      const target = STEPS[targetIdx];
      // Allow free jump to any *visited* step; forbid skipping past validation.
      if (visited.has(target.id)) {
        setStepIdx(targetIdx);
        return;
      }
      // Forward jump — must validate every step up to (but not including) target.
      for (let i = 0; i <= targetIdx - 1; i++) {
        if (!validateStep(STEPS[i].id)) {
          setStepIdx(i);
          return;
        }
      }
      setVisited((prev) => new Set(prev).add(target.id));
      setStepIdx(targetIdx);
    },
    [visited, validateStep],
  );

  const goNext = useCallback(() => {
    if (!validateStep(currentStep.id)) {
      // Scroll to first error so user sees what to fix.
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>('[data-error="true"]')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    const nextIdx = Math.min(stepIdx + 1, STEPS.length - 1);
    setVisited((prev) => new Set(prev).add(STEPS[nextIdx].id));
    setStepIdx(nextIdx);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentStep.id, stepIdx, validateStep]);

  const goPrev = useCallback(() => {
    setStepIdx((idx) => Math.max(idx - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handleSubmit = useCallback(async () => {
    // Final full-form validation.
    let firstBad: StepId | null = null;
    const nextErrors: Record<StepId, FieldErrors> = {
      intro: {},
      identity: {},
      household: {},
      housing: {},
      organizations: {},
      documents: {},
      marketing: {},
      interview: {},
      review: {},
    };
    for (const step of STEPS) {
      if (step.id === "intro" || step.id === "review") continue;
      const schema = STEP_SCHEMAS[step.id];
      const result = schema.safeParse(values[step.id]);
      if (!result.success) {
        nextErrors[step.id] = flattenErrors(result.error);
        if (!firstBad) firstBad = step.id;
      }
    }
    // Marketing lives inside the documents step visually but is validated as
    // its own bucket. Failures navigate the user back to the documents step.
    const mktResult = marketingSchema.safeParse(values.marketing);
    if (!mktResult.success) {
      nextErrors.marketing = flattenErrors(mktResult.error);
      if (!firstBad) firstBad = "documents";
    }
    setErrors(nextErrors);
    if (firstBad) {
      const idx = STEPS.findIndex((s) => s.id === firstBad);
      setStepIdx(idx);
      setSubmitState({
        status: "error",
        message:
          "Beberapa isian belum lengkap. Silakan lengkapi bagian yang ditandai.",
      });
      return;
    }

    setSubmitState({ status: "submitting" });
    const result = await submitStudentApplication(values);
    if (result.status === "success") {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      setSubmitState({
        status: "success",
        applicationId: result.applicationId,
      });
    } else {
      setSubmitState({ status: "error", message: result.message });
      if (result.step) {
        // Marketing is rendered inside the documents step panel.
        const targetStep = result.step === "marketing" ? "documents" : result.step;
        const idx = STEPS.findIndex((s) => s.id === targetStep);
        if (idx >= 0) setStepIdx(idx);
      }
    }
  }, [STORAGE_KEY, values]);

  const progress = useMemo(() => {
    const totalSteps = STEPS.length - 1; // exclude review
    return Math.round(((stepIdx) / totalSteps) * 100);
  }, [stepIdx]);

  if (submitState.status === "success") {
    return <SuccessScreen applicationId={submitState.applicationId} />;
  }

  const stepProps = {
    values,
    updateStep,
    errors,
    clearFieldError,
  };

  return (
    <div className="py-8 md:py-12">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6">
        <header className="mb-6 md:mb-8">
          <Link
            href="/portal"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-3"
          >
            <ArrowLeft size={14} /> Kembali ke portal
          </Link>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-primary-blue uppercase tracking-wider mb-3">
            <span className="w-2 h-2 bg-secondary-yellow rounded-full" />
            Formulir Pendaftaran · {batch.name}
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-2 leading-tight">
            Ceritakan tentang dirimu, {user.name?.split(" ")[0] ?? "Sakemers"}
          </h1>
          <p className="text-gray-600 max-w-[720px]">
            Isi seluruh bagian dengan jujur dan lengkap. Data yang kamu kirim
            akan dijaga kerahasiaannya dan hanya digunakan untuk seleksi.
            Progres kamu tersimpan otomatis di browser ini.
          </p>
        </header>

        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="lg:sticky lg:top-6 lg:self-start">
            <nav
              aria-label="Bagian formulir"
              className="bg-white rounded-2xl border border-gray-100 p-3 md:p-4"
            >
              <div className="mb-3 px-2">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                  <span>
                    Bagian {stepIdx + 1} dari {STEPS.length}
                  </span>
                  <span className="font-semibold">{progress}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-blue transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              <ol className="space-y-1">
                {STEPS.map((step, i) => {
                  const isCurrent = i === stepIdx;
                  const isVisited = visited.has(step.id);
                  const canJump = isVisited || i <= stepIdx;
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        disabled={!canJump}
                        onClick={() => goToStep(i)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                          isCurrent
                            ? "bg-primary-blue/10 text-primary-blue font-semibold"
                            : canJump
                              ? "text-gray-700 hover:bg-gray-50"
                              : "text-gray-400 cursor-not-allowed"
                        }`}
                      >
                        <span
                          className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                            isCurrent
                              ? "bg-primary-blue text-white"
                              : isVisited
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {isVisited && !isCurrent ? (
                            <Check size={12} />
                          ) : isCurrent ? (
                            <CircleDot size={12} />
                          ) : canJump ? (
                            i + 1
                          ) : (
                            <Lock size={12} />
                          )}
                        </span>
                        <span className="flex-1 min-w-0 truncate">
                          {step.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </aside>

          {/* Main step */}
          <div>
            <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-8">
              {currentStep.id === "intro" && <IntroStep />}
              {currentStep.id === "identity" && <IdentityStep {...stepProps} />}
              {currentStep.id === "household" && (
                <HouseholdStep {...stepProps} />
              )}
              {currentStep.id === "housing" && <HousingStep {...stepProps} />}
              {currentStep.id === "organizations" && (
                <OrganizationsStep {...stepProps} />
              )}
              {currentStep.id === "interview" && (
                <InterviewStep {...stepProps} />
              )}
              {currentStep.id === "documents" && (
                <div className="space-y-10">
                  <DocumentsStep {...stepProps} />
                  <div className="border-t border-gray-100 pt-8">
                    <MarketingStep {...stepProps} />
                  </div>
                </div>
              )}
              {currentStep.id === "review" && (
                <ReviewStep
                  values={values}
                  onEditStep={(id) => {
                    const idx = STEPS.findIndex((s) => s.id === id);
                    if (idx >= 0) setStepIdx(idx);
                  }}
                />
              )}
            </div>

            {submitState.status === "error" && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                {submitState.message}
              </div>
            )}

            {/* Nav footer */}
            <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <button
                type="button"
                onClick={goPrev}
                disabled={stepIdx === 0}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowLeft size={16} />
                Sebelumnya
              </button>
              {currentStep.id === "review" ? (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitState.status === "submitting"}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {submitState.status === "submitting"
                    ? "Mengirim…"
                    : "Kirim Pendaftaran"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary-blue text-white font-semibold rounded-lg hover:bg-primary-blue-dark transition-colors"
                >
                  Selanjutnya
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
