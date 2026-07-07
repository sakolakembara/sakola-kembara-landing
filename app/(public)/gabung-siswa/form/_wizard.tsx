"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleDot,
  Lock,
} from "lucide-react";
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

const STORAGE_KEY = "sakem-student-form-v1";

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

export function Wizard() {
  const [values, setValues] = useState<FormValues>(emptyFormValues);
  const [stepIdx, setStepIdx] = useState(0);
  const [visited, setVisited] = useState<Set<StepId>>(
    () => new Set(["identity"]),
  );
  const [errors, setErrors] = useState<Record<StepId, FieldErrors>>({
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
    }
  }, []);

  // Persist on every meaningful change.
  useEffect(() => {
    if (submitState.status === "success") return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ values, stepIdx, visited: Array.from(visited) }),
      );
    } catch {
      // Storage full / disabled — silently drop.
    }
  }, [values, stepIdx, visited, submitState.status]);

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
      if (step === "review") return true;
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
      if (step.id === "review") continue;
      const schema = STEP_SCHEMAS[step.id];
      const result = schema.safeParse(values[step.id]);
      if (!result.success) {
        nextErrors[step.id] = flattenErrors(result.error);
        if (!firstBad) firstBad = step.id;
      }
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
        const idx = STEPS.findIndex((s) => s.id === result.step);
        if (idx >= 0) setStepIdx(idx);
      }
    }
  }, [values]);

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
    <div className="min-h-screen bg-gray-50 pt-[var(--hero-top,8rem)] pb-16">
      <div className="max-w-[1200px] mx-auto px-4 md:px-6">
        <header className="mb-6 md:mb-8">
          <Link
            href="/gabung-siswa"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-3"
          >
            <ArrowLeft size={14} /> Kembali ke halaman informasi
          </Link>
          <h1 className="font-[var(--font-display)] text-3xl md:text-4xl text-gray-900 mb-2">
            Formulir Pendaftaran Sakola Kembara Gen 6
          </h1>
          <p className="text-gray-600 max-w-[720px]">
            Isi seluruh bagian dengan jujur dan lengkap. Data yang kamu kirim
            akan dijaga kerahasiaannya dan hanya digunakan untuk seleksi.
            Progres kamu tersimpan otomatis di browser ini.
          </p>
          <Link
            href="/gabung-siswa/docs"
            target="_blank"
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 border-2 border-primary-blue/20 hover:border-primary-blue/60 text-primary-blue text-sm font-semibold rounded-lg bg-primary-blue/5 hover:bg-primary-blue/10 transition-colors"
          >
            <BookOpen size={14} />
            Buka Pusat Dokumen &amp; Berkas
          </Link>
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
              {currentStep.id === "identity" && <IdentityStep {...stepProps} />}
              {currentStep.id === "household" && (
                <HouseholdStep {...stepProps} />
              )}
              {currentStep.id === "housing" && <HousingStep {...stepProps} />}
              {currentStep.id === "organizations" && (
                <OrganizationsStep {...stepProps} />
              )}
              {currentStep.id === "documents" && (
                <DocumentsStep {...stepProps} />
              )}
              {currentStep.id === "marketing" && (
                <MarketingStep {...stepProps} />
              )}
              {currentStep.id === "interview" && (
                <InterviewStep {...stepProps} />
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
