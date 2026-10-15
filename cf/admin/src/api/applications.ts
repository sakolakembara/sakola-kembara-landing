import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { REVIEW_FIELDS, REVIEW_MESSAGES, reviewAction, reviewInput, revocationProblem } from "../admission/review";
import { applicantPrefix, applicationDetailQuery, applicationsPageQuery, applicationsTotalQuery } from "../admission/queries";
import { requireArea } from "../auth/guard";
import { can } from "../auth/permissions";
import type { AppEnv } from "../context";
import { applicationStatus, studentApplications, type StudentApplicationFormData } from "../db/schema";
import {
  enumFilter,
  etagOf,
  fail,
  matches,
  nextVersion,
  notFound,
  pageOf,
  parseBody,
  parseListQuery,
  preconditionRequired,
  readIfMatch,
  stale,
  validationError,
  withAudit,
  type Filter,
} from "./crud";
import { getDb } from "../db/client";
import { applicationFilesQuery, presentListedFile } from "../private-files/list";

// Pendaftar (area `pendaftaran`): the applications students submit to a batch. A port of
// app/(admin)/admin/applications/*.
//
//   GET  /api/admin/applications               list: page, filters (status, batch), prefix search of name and email
//   GET  /api/admin/applications/:id           one application with all its answers, its notes and its batch
//   POST /api/admin/applications/:id/status    the review: a status and a note (If-Match required)
//
// There is no create, edit or delete: an application is a record with a lifecycle, written by the student's
// portal and moved through statuses here (docs/cloudflare/admin-crud.md#7-soft-or-hard-delete).
//
// Personal data: names, emails, phone numbers and answers leave this Worker only to someone allowed to read the
// area, in the list and the detail; they are never logged and never in an audit row (the row records the NAMES
// of the columns a decision wrote, not the note). Search is a PREFIX match on indexed columns, never
// `LIKE '%q%'`: this is the table that grows (src/admission/queries.ts).
//
// The legacy review rules and messages are in src/admission/review.ts. The legacy action sent no email to the
// applicant (the only mails the legacy app sends are the verification and the password reset), so none is sent
// here: a decision shows to the student in the portal, once the batch's results are published.

/** `?batch=<id>` or `?batch=all` (the same as no batch). An id nobody has is an empty list, not an error. */
const batchFilter: Filter = (raw) => {
  if (raw === "all") return { ok: true, where: sql`1 = 1` };
  return raw.length <= 128 ? { ok: true, where: eq(studentApplications.batchId, raw) } : { ok: false };
};

const MAX_ID_LENGTH = 128;
const validId = (id: string) => id.length > 0 && id.length <= MAX_ID_LENGTH;

type DetailRow = Awaited<ReturnType<typeof applicationDetailQuery>>[number];
type ListRow = Awaited<ReturnType<typeof applicationsPageQuery>>[number];

function presentListed(row: ListRow) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    schoolName: row.schoolName,
    graduationYear: row.graduationYear,
    branchPreference: row.branchPreference,
    status: row.status,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    batch: { id: row.batchId, year: row.batchYear, name: row.batchName },
  };
}

/** The application as the detail page needs it: an explicit field list (no `userId`, no reviewer), dates as ISO strings. */
export function presentApplication(row: DetailRow) {
  return {
    id: row.id,
    batch: { id: row.batchId, year: row.batchYear, name: row.batchName },
    fullName: row.fullName,
    email: row.email,
    whatsapp: row.whatsapp,
    schoolName: row.schoolName,
    graduationYear: row.graduationYear,
    branchPreference: row.branchPreference,
    motivation: row.motivation,
    economicBackground: row.economicBackground,
    // The answers of the wizard, as stored (docs/cloudflare/admin-pendaftaran.md: the SPA reads them defensively).
    formData: row.formData as StudentApplicationFormData | null,
    status: row.status,
    reviewNotes: row.reviewNotes,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `2` (the legacy links) or `3` (uploaded files) as the wizard stored it in `formData.formVersion`, else null. */
function formVersionOf(formData: unknown): 2 | 3 | null {
  const version = typeof formData === "object" && formData !== null ? (formData as { formVersion?: unknown }).formVersion : undefined;
  return version === 2 || version === 3 ? version : null;
}

export function createApplicationRoutes() {
  const app = new Hono<AppEnv>();
  const read = requireArea("pendaftaran", "read");
  const write = requireArea("pendaftaran", "write");

  app.get("/", read, async (c) => {
    const parsed = parseListQuery(c, {
      // No `search`: the kit's search is `LIKE '%q%'`; this table's is a prefix match (applicantPrefix).
      sorts: { submittedAt: studentApplications.submittedAt, fullName: studentApplications.fullName },
      defaultSort: "-submittedAt",
      filters: { status: enumFilter(studentApplications.status, applicationStatus), batch: batchFilter },
      id: studentApplications.id,
    });
    if (!parsed.ok) return parsed.response;
    const prefix = applicantPrefix(parsed.query.q);
    const query = { ...parsed.query, where: prefix ? (parsed.query.where ? and(parsed.query.where, prefix) : prefix) : parsed.query.where };
    const db = getDb(c.env.DB);
    // One round trip: the page and the total over the same WHERE.
    const [rows, totals] = await db.batch([applicationsPageQuery(db, query), applicationsTotalQuery(db, query)]);
    return c.json(pageOf(rows.map(presentListed), query, totals[0]?.total ?? 0));
  });

  app.get("/:id", read, async (c) => {
    const id = c.req.param("id");
    if (!validId(id)) return notFound(c);
    const db = getDb(c.env.DB);
    // One round trip: the application and the list of its files (SAKEM-083, docs/cloudflare/portal-api.md, 12.1).
    const [rows, files] = await db.batch([applicationDetailQuery(db, id), applicationFilesQuery(db, id)]);
    const row = rows[0];
    if (!row) return notFound(c);
    c.header("ETag", etagOf(row.updatedAt));
    const formVersion = formVersionOf(row.formData);
    return c.json({
      item: {
        ...presentApplication(row),
        formVersion,
        // Metadata only, for a version 3 application (the files are uploads); a version 2 one has links, no files.
        files: formVersion === 3 ? files.map(presentListedFile) : [],
        // Opening a file, and purging them, need `pendaftaran` write: a viewer sees the list and cannot open one (Dzul, 2026-10-13).
        canOpenFiles: can(c.get("user").role, c.get("grantedAreas"), "pendaftaran", "write"),
      },
    });
  });

  // The review. Order of the answers: If-Match (428), the body (415, 413, 400), the application (404), the version
  // (409 stale), the revocation rule (400), then the write and its audit row in one batch.
  app.post("/:id/status", write, async (c) => {
    const id = c.req.param("id");
    const precondition = readIfMatch(c);
    if (!precondition.present) return preconditionRequired(c);
    const body = await parseBody(c, reviewInput, { maxBytes: 16 * 1024 });
    if (!body.ok) return body.response;
    if (!validId(id)) return fail(c, 404, "not_found", REVIEW_MESSAGES.notFound);

    const db = getDb(c.env.DB);
    const before = (await applicationDetailQuery(db, id))[0];
    if (!before) return fail(c, 404, "not_found", REVIEW_MESSAGES.notFound);
    if (!matches(precondition, before.updatedAt)) return stale(c);

    const problem = revocationProblem(before.status, body.data);
    if (problem) return validationError(c, { [problem.field]: problem.message });

    const user = c.get("user");
    const now = new Date();
    // The version is in the WHERE: two reviewers who loaded the same version cannot both decide, and the
    // revocation rule above was checked against exactly the status this write replaces.
    const [updated] = await withAudit(
      db,
      user,
      // The action says what was decided (`application.accepted`, or `application.revoke`). No label: it is about a person.
      { action: reviewAction(before.status, body.data.status), resourceType: "application", resourceId: id, fields: REVIEW_FIELDS },
      [
        db
          .update(studentApplications)
          .set({
            status: body.data.status,
            reviewNotes: body.data.reviewNotes || null,
            reviewedBy: user.id,
            reviewedAt: now,
            updatedAt: nextVersion(before.updatedAt, now),
          })
          .where(and(eq(studentApplications.id, id), eq(studentApplications.updatedAt, before.updatedAt)))
          .returning(),
      ],
    );
    const row = (updated as (typeof studentApplications.$inferSelect)[])[0];
    if (!row) return stale(c); // lost the race: nothing was written, no audit row either
    c.header("ETag", etagOf(row.updatedAt));
    return c.json({ item: presentApplication({ ...before, ...row }) });
  });

  return app;
}

export const applicationRoutes = createApplicationRoutes();
