import { useEffect, useState } from "react";
import { Container } from "@/components/ui/container";
import { LoadFailure, LoadingBlock } from "~/components/LoadState";
import { usePageTitle } from "~/lib/hooks";
import { clearLocal } from "~/lib/wizard/persist";
import { wipeLocalDrafts } from "~/lib/local-drafts";
import { useMe } from "~/lib/session";
import { useApiData } from "~/lib/use-api-data";
import { CURRENT_PATH, GATE_MESSAGES, type GateError, parseCurrent } from "~/lib/wizard/api";
import { useWizardConfig } from "~/lib/wizard/use-wizard-config";
import { NoBatchGate, SubmittedGate } from "./Gates";
import { Wizard } from "./Wizard";

/**
 * `/daftar`: reads where the student stands (`GET applications/current`) and shows what fits: the form, or, when there is
 * nothing to fill in, the legacy screen that says why (no batch is open; the application is already sent). This is the
 * whole of the wizard's chunk; the route (`DaftarRoute`) loads it only when a student opens the page.
 */
export default function DaftarPage() {
  usePageTitle("Daftar Sekarang");
  const me = useMe();
  const { state, reload } = useApiData(CURRENT_PATH, parseCurrent);
  const config = useWizardConfig();
  // A save or a submit found the batch closed while the student was filling the form in: the Worker's own sentence.
  const [closed, setClosed] = useState<string | null>(null);

  const answer = state.status === "ready" ? state.data : null;

  // Nothing to fill in any more: whatever the browser still holds for this application has no use. (No open batch: no key
  // can be named, so every copy of this student's goes, as it does at sign-out.)
  useEffect(() => {
    if (!answer) return;
    if (answer.gate === "no_open_batch") wipeLocalDrafts(me.id);
    if (answer.gate === "submitted" && answer.batch) clearLocal(me.id, answer.batch.id);
  }, [answer, me.id]);

  // The screen that replaces the form takes focus on its heading.
  useEffect(() => {
    if (closed !== null) document.querySelector<HTMLElement>("[data-gate-heading]")?.focus();
  }, [closed]);

  const onGate = (gate: GateError, message: string) => {
    // Sent from another tab (or by a double click that got through): read it again, it is the "sudah kami terima" screen now.
    if (gate === "already_submitted") reload();
    else setClosed(message || GATE_MESSAGES[gate]);
  };

  if (closed !== null) return <NoBatchGate siteUrl={config.siteUrl} notice={closed} />;

  if (state.status === "loading")
    return (
      <Container size="focused" className="px-4 py-12 md:px-6 md:py-16">
        <LoadingBlock label="Memuat formulir pendaftaran…" />
      </Container>
    );
  if (state.status === "error")
    return (
      <Container size="focused" className="px-4 py-12 md:px-6 md:py-16">
        <LoadFailure onRetry={reload} />
      </Container>
    );

  const data = state.data;
  if (data.gate === "no_open_batch" || !data.batch) return <NoBatchGate siteUrl={config.siteUrl} />;
  if (data.gate === "submitted" && data.application) return <SubmittedGate batch={data.batch} submittedAt={data.application.submittedAt} />;

  // Keyed: a different batch or a different student is a new form, never a carried-over one.
  return <Wizard key={`${me.id}:${data.batch.id}`} init={{ userId: me.id, batch: data.batch, answer: data }} config={config} onGate={onGate} />;
}
