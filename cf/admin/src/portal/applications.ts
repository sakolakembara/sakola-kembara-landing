import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { identityColumns } from "../../shared/application-form/form-data";
import { JSON_BODY_MAX_BYTES, STEP_BODY_MAX_BYTES } from "../../shared/application-form/limits";
import { INVALID_FORM_MESSAGE, validateStep } from "../../shared/application-form/rules";
import { isStepId } from "../../shared/application-form/steps";
import { isUniqueViolation } from "../api/crud/errors";
import type { AppEnv } from "../context";
import { sendEmail } from "../email/send";
import { applicationReceivedEmail } from "../email/templates";
import type { Bindings } from "../env";
import { requireStudent } from "./guard";
import { presentCurrent, presentOverview, presentSavedDraft, presentStatusItem } from "./present";
import {
  anyDraftQuery,
  dbOf,
  deleteMarkedFileRows,
  filesQuery,
  historyQuery,
  openStateQuery,
  openStateWithAnswersQuery,
  recentWhatsappQuery,
  saveStep,
  slotCountsQuery,
  statusQuery,
  submitApplication,
  toOpenState,
} from "./queries";
import {
  applicationFileKey,
  checkSubmission,
  countBySlot,
  dtksRegisteredIn,
  DUPLICATE_WINDOW_MS,
  formDataToStore,
  gateOf,
  MESSAGES,
  missingFilesOf,
  savedStepsOf,
  stepsOf,
  writeRefusal,
  type OpenState,
} from "./rules";

// The student's application API (docs/cloudflare/portal-api.md, sections 4 to 10; the design and its costs:
// docs/cloudflare/portal-architecture.md, sections 6, 7 and 10):
//
//   GET  /portal/api/overview                              the home page in one call
//   GET  /portal/api/applications/current                  the wizard's bootstrap: the open batch, the draft or the application, the files
//   PUT  /portal/api/applications/current/steps/:step     save one complete, valid bucket of the draft
//   POST /portal/api/applications/current/submit          validate everything again and submit
//   GET  /portal/api/applications                          the status page: every application and what the student may know of it
//
// Every route starts with `requireStudent(<limiter>)` (src/portal/guard.ts: the session, the role, the verified address
// and the limiter by user id, in that order, before the body or any other D1 read). Every query takes the student's
// id from the session: no route names an application, so there is no id to swap for another student's.
//
// Privacy: no name, address, number, answer, id or file name is ever logged here (the two console lines of this file
// say that a background step failed, and name no value), and an answer is built field by field (src/portal/present.ts).

type Ctx = Context<AppEnv>;

/** The one error shape of the API (docs/cloudflare/portal-api.md, section 1): `{ error, message?, ...extra }`. */
function refuse(c: Ctx, status: ContentfulStatusCode, error: string, message?: string, extra: Record<string, unknown> = {}) {
  return c.json({ error, ...(message ? { message } : {}), ...extra }, status);
}

// ─── The body of a JSON route (section 1): 415, 413, 400, in that order ───

type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * The body as JSON, never more than `maxBytes` of it in memory: the declared length is checked first, and the stream is
 * cut at the limit whatever it declares (a client that lies, or sends no length). A route that has no body sends `{}`.
 */
async function readJsonBody(c: Ctx, maxBytes: number): Promise<JsonBody> {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return { ok: false, response: refuse(c, 415, "json_required") };
  const declared = c.req.header("content-length");
  if (declared !== undefined && /^\d{1,15}$/.test(declared) && Number(declared) > maxBytes) return { ok: false, response: refuse(c, 413, "body_too_large", undefined, { maxBytes }) };

  const reader = c.req.raw.body?.getReader();
  if (!reader) return { ok: false, response: refuse(c, 400, "invalid_json") };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, response: refuse(c, 413, "body_too_large", undefined, { maxBytes }) };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: refuse(c, 400, "invalid_json") };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: refuse(c, 400, "invalid_json") };
  }
}

// ─── The gate of a write (6.2) ───

type WriteGate = { ok: true; state: OpenState } | { ok: false; response: Response };

/**
 * A batch must be open, and the student must not have an application for it: else `409 no_open_batch`,
 * `409 batch_closed` (no batch is open but the student still has a draft: it belongs to a batch that closed) or
 * `409 already_submitted`. One statement; the second one is asked only when nothing is open. The submit needs the draft's
 * answers, a step save does not, so the answers are read only when asked for.
 */
async function writeGate(c: Ctx, userId: string, now: Date, withAnswers: boolean): Promise<WriteGate> {
  const db = dbOf(c.env.DB);
  const [row] = withAnswers ? await openStateWithAnswersQuery(db, userId, now) : await openStateQuery(db, userId, now);
  const state = toOpenState(row);
  const refusal = writeRefusal(state, state === null && (await anyDraftQuery(db, userId)).length > 0);
  if (refusal) return { ok: false, response: refuse(c, 409, refusal.error, refusal.message) };
  return { ok: true, state: state! };
}

// ─── The routes ───

export function createApplicationRoutes() {
  const app = new Hono<AppEnv>();

  // The home page in one call (4.3): the open batch, what the student has for it, and the history. One round trip.
  app.get("/overview", requireStudent("portalRead"), async (c) => {
    const user = c.get("user");
    const db = dbOf(c.env.DB);
    const now = new Date();
    const [stateRows, history] = await db.batch([openStateQuery(db, user.id, now), historyQuery(db, user.id)]);
    return c.json(presentOverview({ now, name: user.name, state: toOpenState(stateRows[0]), history }));
  });

  // The wizard's bootstrap (5.1). It never creates a draft and never reads the bytes of a file.
  app.get("/applications/current", requireStudent("portalRead"), async (c) => {
    const user = c.get("user");
    const db = dbOf(c.env.DB);
    const now = new Date();
    const state = toOpenState((await openStateWithAnswersQuery(db, user.id, now))[0]);
    const gate = gateOf(state);
    // The files of the draft, or of the application when it was sent; a batch that closed shows neither (the draft stays in D1, unread).
    const ownerId = gate === "submitted" ? state!.application!.id : gate === "open" ? state!.draft?.id : undefined;
    const files = ownerId ? await filesQuery(db, ownerId) : [];
    const formData = gate === "open" ? (state!.draft?.formData ?? null) : null;
    return c.json(
      presentCurrent({
        now,
        gate,
        state,
        user,
        steps: stepsOf(formData),
        saved: savedStepsOf(formData),
        missingFiles: missingFilesOf(countBySlot(files), dtksRegisteredIn(formData)),
        files,
      }),
    );
  });

  // Save one bucket (8.1). Order: the common checks, the step name, the gate, the body, the rules, the write.
  app.put("/applications/current/steps/:step", requireStudent("portalSave"), async (c) => {
    const step = c.req.param("step");
    if (!isStepId(step)) return refuse(c, 404, "unknown_step");
    const user = c.get("user");
    const now = new Date();
    const gate = await writeGate(c, user.id, now, false);
    if (!gate.ok) return gate.response;

    const body = await readJsonBody(c, STEP_BODY_MAX_BYTES);
    if (!body.ok) return body.response;
    const checked = validateStep(step, body.value);
    if (!checked.ok) return refuse(c, 400, "invalid", INVALID_FORM_MESSAGE, { fields: checked.fields });

    const saved = await saveStep(c.env.DB, {
      userId: user.id,
      batchId: gate.state.batch.id,
      step,
      bucketJson: JSON.stringify(checked.value),
      newDraftId: crypto.randomUUID(),
      now,
      // The DTKS answer decides whether the SKTM file may exist at all.
      removeDtks: step === "documents" && (checked.value as { dtksRegistered?: unknown }).dtksRegistered === "tidak",
    });
    if (!saved.draft) {
      // The statement's own guards refused (the batch closed, or an application appeared, since the gate read): say what is true now.
      const again = await writeGate(c, user.id, new Date(), false);
      return again.ok ? refuse(c, 409, "no_open_batch", MESSAGES.noOpenBatch) : again.response;
    }
    if (saved.removed.length > 0) c.executionCtx.waitUntil(removeDtksObjects(c.env, gate.state.batch.year, saved.draft.id, saved.removed));

    return c.json({
      step,
      savedAt: saved.draft.updatedAt.toISOString(),
      draft: presentSavedDraft(saved.draft, saved.saved, missingFilesOf(saved.counts, saved.dtksRegistered)),
      removedSlots: saved.removed.length > 0 ? ["dtks"] : [],
    });
  });

  // Submit (9). The legacy order of checks, then the new ones; the first failure answers.
  app.post("/applications/current/submit", guardSubmit(), async (c) => {
    const user = c.get("user");
    const now = new Date();
    // Cheap before D1: a body that is not JSON is a client mistake whatever the state is.
    const body = await readJsonBody(c, JSON_BODY_MAX_BYTES);
    if (!body.ok) return body.response;

    const gate = await writeGate(c, user.id, now, true);
    if (!gate.ok) return gate.response;
    const { state } = gate;
    const draft = state.draft;
    if (!draft) return refuse(c, 404, "no_draft", MESSAGES.noDraft);

    const db = dbOf(c.env.DB);
    // The files of the draft and the anti-duplicate lookup in one round trip. The number is the one the draft
    // stores (already cleaned when it was saved); the check below runs only after every bucket has passed again, and
    // asks again in the unreachable case that the validated number is another one.
    const stored = (draft.formData?.identity as { whatsapp?: unknown } | undefined)?.whatsapp;
    const lookedUp = typeof stored === "string" ? stored : "";
    const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS);
    const [counted, recent] = await db.batch([slotCountsQuery(db, draft.id), recentWhatsappQuery(db, lookedUp, since)]);

    const checked = checkSubmission(draft.formData ?? {}, Object.fromEntries(counted.map((row) => [row.slot, row.n])));
    if (!checked.ok) {
      return refuse(c, 422, "incomplete", checked.message, {
        step: checked.step,
        ...(checked.fields ? { fields: checked.fields } : {}),
        ...(checked.missingFiles ? { missingFiles: checked.missingFiles } : {}),
      });
    }
    const identity = checked.values.identity;
    const duplicates = identity.whatsapp === lookedUp ? recent : await recentWhatsappQuery(db, identity.whatsapp, since);
    if (duplicates.length > 0) return refuse(c, 409, "duplicate_whatsapp", MESSAGES.duplicateWhatsapp, { step: "identity" });

    let inserted: boolean;
    try {
      inserted = await submitApplication(c.env.DB, {
        applicationId: draft.id,
        userId: user.id,
        userEmail: user.email,
        batchId: state.batch.id,
        batchYear: state.batch.year,
        draftVersion: draft.updatedAt,
        columns: identityColumns(identity),
        formDataJson: JSON.stringify(formDataToStore(checked.values)),
        auditId: crypto.randomUUID(),
        now,
      });
    } catch (error) {
      // The unique `(user_id, batch_id)` index is the last line: it refuses a second application for the pair, and the
      // whole batch with it (nothing was written). A state the route does not make, but one a manual write could.
      if (!isUniqueViolation(error, "student_applications.user_id, student_applications.batch_id")) throw error;
      inserted = false;
    }
    if (!inserted) {
      // Nothing was written: the draft changed after it was read, or a second submit won. Say which.
      const after = await writeGate(c, user.id, new Date(), false);
      return after.ok ? refuse(c, 409, "draft_changed", MESSAGES.draftChanged) : after.response;
    }

    // After the answer: the confirmation. Best effort and counted against the day's budget (src/email/send.ts): a
    // failure is logged by purpose and reason only and changes nothing, because the application is already saved.
    c.executionCtx.waitUntil(
      sendEmail(c.env, applicationReceivedEmail(user.email, { batchName: state.batch.name, receivedAt: now.getTime(), url: `${new URL(c.req.url).origin}/portal/status` })).then(
        () => undefined,
        () => console.error("[portal] the confirmation email could not be sent"),
      ),
    );
    return c.json({ applicationId: draft.id, submittedAt: now.toISOString(), batch: { id: state.batch.id, year: state.batch.year, name: state.batch.name } }, 201);
  });

  // The status page (10.1). The batch's publication decides what is sent: before it, `processing` and nothing else.
  app.get("/applications", requireStudent("portalRead"), async (c) => {
    const rows = await statusQuery(dbOf(c.env.DB), c.get("user").id);
    return c.json({ items: rows.map(presentStatusItem) });
  });

  return app;
}

export const applicationRoutes = createApplicationRoutes();

// ─── The submit's guard: the common checks, with the submit's own sentence for an unverified address ───

/**
 * `requireStudent("portalSubmit")`, with one difference the contract names (portal-api.md, 9.1, row 1): the 403
 * `email_not_verified` of a submit says "Verifikasi email kamu dulu sebelum mengirim pendaftaran." Every other
 * refusal of the guard is passed on as it is. (An unverified student cannot sign in at all; this is defence in depth.)
 */
function guardSubmit(): MiddlewareHandler<AppEnv> {
  const guard = requireStudent("portalSubmit");
  return async (c, next) => {
    const refused = await guard(c, next);
    if (refused && refused.status === 403) {
      const body = (await refused.clone().json().catch(() => null)) as { error?: unknown } | null;
      if (body?.error === "email_not_verified") return refuse(c, 403, "email_not_verified", MESSAGES.verifyBeforeSubmit);
    }
    return refused;
  };
}

// ─── The DTKS files of a student who says they are not registered ───

/**
 * Deletes the objects of the `dtks` files a step save just marked deleted, then their rows. After the answer, I/O
 * only. If the bucket is missing, or an object cannot be deleted, the rows stay MARKED (their bytes were already
 * given back to the counter) so a later purge finds them; the student's answer is not affected. Nothing but the
 * outcome is logged: no key, no id.
 */
async function removeDtksObjects(env: Bindings, year: number, applicationId: string, files: readonly { id: string; contentType: string }[]): Promise<void> {
  try {
    const keyed = files.flatMap((file) => {
      const key = applicationFileKey({ year, applicationId, fileId: file.id, contentType: file.contentType });
      return key === null ? [] : [{ id: file.id, key }];
    });
    if (!env.PRIVATE_FILES || keyed.length === 0) return;
    await env.PRIVATE_FILES.delete(keyed.map((file) => file.key));
    await deleteMarkedFileRows(env.DB, keyed.map((file) => file.id));
  } catch {
    console.error("[portal] the objects of the removed dtks files could not be deleted; their rows stay marked");
  }
}
