import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Heading } from "@/components/ui/heading";
import { UI_STEP_LABELS, type UiStepId } from "@shared/application-form/steps";
import type { GateError } from "~/lib/wizard/api";
import type { WizardConfig } from "~/lib/wizard/config";
import { indexOfScreen } from "~/lib/wizard/screens";
import { summaryItems } from "~/lib/wizard/summary";
import { SUMMARY_TITLE, useWizard, type WizardInit } from "~/lib/wizard/use-wizard";
import { ErrorSummary, focusField } from "./ErrorSummary";
import { FormProvider } from "./form";
import { Stepper } from "./Stepper";
import { DocumentsStep } from "./steps/Documents";
import { HouseholdStep } from "./steps/Household";
import { HousingStep } from "./steps/Housing";
import { IdentityStep } from "./steps/Identity";
import { IntroStep } from "./steps/Intro";
import { InterviewStep } from "./steps/Interview";
import { OrganizationsStep } from "./steps/Organizations";
import { ReviewStep } from "./steps/Review";
import { SuccessScreen } from "./Success";

/** "Ceritakan tentang dirimu, Sari": the first word of the account's name, or the legacy "Sakemers". */
function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "Sakemers" : first;
}

/**
 * The form: the heading and the list of screens, the screen the student is on, and the buttons that move between them
 * (the legacy layout, app/(portal)/portal/daftar/_wizard.tsx). What it does is `useWizard`'s; this draws it, moves focus
 * (to the heading of a new screen, to the summary of what needs fixing) and says what is happening in a live region.
 */
export function Wizard({ init, config, onGate }: { init: WizardInit; config: WizardConfig; onGate: (gate: GateError, message: string) => void }) {
  const wizard = useWizard(init, onGate);
  const { screen, screenId, errors, notice, status, busy } = wizard;
  const panel = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const shown = useRef(screen);

  // A new screen: focus its heading, so a keyboard or screen reader user starts at the top of what is new.
  useEffect(() => {
    if (shown.current === screen) return;
    shown.current = screen;
    panel.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [screen]);

  // Something to fix: focus the summary. (After the effect above, so it wins when a refusal also moves to another screen.)
  useEffect(() => {
    if (wizard.summaryToken > 0) summary.current?.focus();
  }, [wizard.summaryToken]);

  // The application is sent: the confirmation takes the place of the form, and its heading takes focus.
  useEffect(() => {
    if (wizard.sent) document.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [wizard.sent]);

  if (wizard.sent) return <SuccessScreen sent={wizard.sent} config={config} />;

  const items = summaryItems(screenId, errors);
  const isReview = screenId === "review";
  const statusText =
    status.kind === "saving" ? "Menyimpan…" : status.kind === "submitting" ? "Mengirim…" : status.kind === "saved" ? `Bagian ${UI_STEP_LABELS[status.screen]} tersimpan.` : "";
  const nextLabel = status.kind === "saving" ? "Menyimpan…" : "Selanjutnya";

  return (
    <div className="py-8 md:py-12">
      {/* px-4 on phones: the form needs the width more than the margin. */}
      <Container className="px-4 md:px-6">
        <header className="mb-6 md:mb-8">
          <Link to="/" className="mb-3 inline-flex min-h-11 w-fit items-center text-sm text-gray-500 transition-colors hover:text-gray-900">
            Kembali ke portal
          </Link>
          <Eyebrow className="mb-3">Formulir Pendaftaran · {init.batch.name}</Eyebrow>
          <Heading level="article" className="mb-2 text-gray-900">
            Ceritakan tentang dirimu, {greeting(init.answer.user.name)}
          </Heading>
          <p className="max-w-[760px] text-gray-600">
            Isi seluruh bagian dengan jujur dan lengkap. Data yang kamu kirim akan dijaga kerahasiaannya dan hanya digunakan untuk seleksi. Progres kamu tersimpan otomatis di browser ini.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <Stepper screen={screen} visited={wizard.visited} unsaved={wizard.unsaved} busy={busy} onJump={wizard.jump} />
          </aside>

          <div className="min-w-0">
            <div ref={panel} className="rounded-2xl border border-gray-100 bg-white p-6 md:p-8">
              {(items.length > 0 || notice) && (
                <ErrorSummary ref={summary} title={SUMMARY_TITLE} message={notice} items={items} onSelect={(key) => focusField(panel.current ?? document, key)} />
              )}
              <FormProvider form={wizard}>
                <Screen id={screenId} wizard={wizard} config={config} />
              </FormProvider>
            </div>

            {/* What the form is doing, read out politely: "Menyimpan…", "Bagian Identitas Pribadi tersimpan." Always in the page, so a change is announced. */}
            <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-gray-600">
              {statusText}
            </p>

            <div className="mt-3 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
              <Button variant="neutral" size="lg" onClick={wizard.back} disabled={screen === 0 || busy}>
                Sebelumnya
              </Button>
              {isReview ? (
                <Button size="lg" onClick={wizard.submit} disabled={busy}>
                  {status.kind === "submitting" || status.kind === "saving" ? "Mengirim…" : "Kirim Pendaftaran"}
                </Button>
              ) : (
                <Button size="lg" onClick={wizard.next} disabled={busy}>
                  {nextLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Container>
    </div>
  );
}

function Screen({ id, wizard, config }: { id: UiStepId; wizard: ReturnType<typeof useWizard>; config: WizardConfig }) {
  switch (id) {
    case "intro":
      return <IntroStep config={config} />;
    case "identity":
      return <IdentityStep />;
    case "household":
      return <HouseholdStep />;
    case "housing":
      return <HousingStep />;
    case "organizations":
      return <OrganizationsStep />;
    case "interview":
      return <InterviewStep />;
    case "documents":
      return <DocumentsStep siteUrl={config.siteUrl} />;
    case "review":
      return (
        <ReviewStep
          values={wizard.values}
          files={wizard.files}
          unsaved={wizard.unsaved}
          groupInvitation={config.whatsappGroupUrl !== ""}
          onEdit={(target) => wizard.jump(indexOfScreen(target))}
        />
      );
  }
}
