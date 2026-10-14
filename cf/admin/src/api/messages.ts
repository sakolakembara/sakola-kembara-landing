import { and, count, eq, isNotNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireArea } from "../auth/guard";
import type { AppEnv } from "../context";
import { isUnreadMessage, unreadMessagesQuery } from "../dashboard/queries";
import * as schema from "../db/schema";
import { crudRoutes, notFound, withAudit, type Filter } from "./crud";
import { getDb } from "../db/client";

// Pesan (area `komunikasi`): the inbox of the public contact form (`POST /api/public/contact`, which is the only
// way a message is made). Behaviour, rules and endpoints: docs/cloudflare/admin-komunikasi.md.
//
//   GET    /api/admin/messages               list, newest first; ?filter=unread|read
//   GET    /api/admin/messages/counts        { total, unread } for the header and the filter pills
//   GET    /api/admin/messages/:id           one, with the whole text. NEVER marks it read
//   POST   /api/admin/messages/:id/read      mark read (idempotent)
//   POST   /api/admin/messages/:id/unread    mark unread (idempotent)
//   DELETE /api/admin/messages/:id           delete
//
// There is no POST (a message comes from the public form) and no PUT (nobody edits a visitor's message), and the
// table has no `updated_at`, so there is no ETag either: marking read or unread cannot lose anyone's work, and a
// delete needs no version. A message holds personal data (a name, an address, free text): the list and the detail are
// the only places it leaves the database, and the audit rows below carry ids and action names, never a field value.
//
// Port of app/(admin)/admin/messages/actions.ts. The legacy page marked a message read when its detail page was
// opened, from the browser, through a server action. Here that is an explicit `POST /:id/read` the SPA calls when it
// opens a message: a GET changes nothing, so a prefetch, a crawler-like tool or a link preview can never read a
// message on someone's behalf.

const AREA = "komunikasi" as const;
const MAX_ID_LENGTH = 128;
/** How much of the text the list carries (the legacy list showed one line of it). */
export const PREVIEW_LENGTH = 200;

type MessageRow = typeof schema.contactMessages.$inferSelect;

/** The whole message, for the detail page. An explicit field list. */
function present(row: MessageRow) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    subject: row.subject,
    message: row.message,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A row of the list: the first line or so of the text, never all of it (a message may be 5,000 characters). */
function presentInList(row: MessageRow) {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    subject: row.subject,
    preview: row.message.slice(0, PREVIEW_LENGTH),
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `?filter=unread` or `?filter=read`, as the dashboard's tile links and the legacy pills did. "Unread" is the
 * dashboard's own definition (`isUnreadMessage`, src/dashboard/queries.ts), so the number on the tile, the number in
 * the pill and the rows behind them are one rule.
 */
const readState: Filter = (raw) => {
  if (raw === "unread") return { ok: true, where: isUnreadMessage };
  if (raw === "read") return { ok: true, where: isNotNull(schema.contactMessages.readAt) };
  return { ok: false };
};

export function createMessageRoutes() {
  const app = new Hono<AppEnv>();

  // Before `/:id`, which would take "counts" for an id.
  app.get("/counts", requireArea(AREA, "read"), async (c) => {
    const db = getDb(c.env.DB);
    // One round trip. The unread count is the dashboard's own statement; the total reads the index entries.
    const [unread, total] = await db.batch([unreadMessagesQuery(db), db.select({ n: count() }).from(schema.contactMessages)]);
    return c.json({ total: total[0]?.n ?? 0, unread: unread[0]?.n ?? 0 });
  });

  // The list, `GET /:id` and `DELETE /:id` are the kit's. A message cannot be created or edited here.
  app.route(
    "/",
    crudRoutes({
      area: AREA,
      table: schema.contactMessages,
      // About people: no `label`, so the audit row of a delete is the id and the action and nothing else.
      audit: { name: "contact_message", type: "contact_message" },
      schema: z.object({}), // unused: `create` and `update` are off
      toRow: () => ({}),
      present,
      list: {
        filters: { filter: readState },
        sorts: { createdAt: schema.contactMessages.createdAt },
        defaultSort: "-createdAt",
        present: presentInList,
      },
      routes: { create: false, update: false },
    }),
  );

  // Mark read / unread: a state change that is not an edit, so a verb route (docs/cloudflare/admin-crud.md#2-the-url-scheme).
  // The UPDATE only matches a message that is not in that state yet, and the audit row is written only if it did, so
  // asking twice is harmless and leaves one row, not two.
  function mark(to: "read" | "unread") {
    return async (c: Context<AppEnv>) => {
      const id = c.req.param("id") ?? "";
      if (id.length === 0 || id.length > MAX_ID_LENGTH) return notFound(c);
      const db = getDb(c.env.DB);
      const [rows] = await withAudit(db, c.get("user"), { action: `contact_message.${to}`, resourceType: "contact_message", resourceId: id }, [
        db
          .update(schema.contactMessages)
          .set({ readAt: to === "read" ? new Date() : null })
          .where(and(eq(schema.contactMessages.id, id), to === "read" ? isUnreadMessage : isNotNull(schema.contactMessages.readAt)))
          .returning(),
      ]);
      let row = (rows as MessageRow[])[0];
      if (!row) {
        // Nothing changed: it is already in that state, or it is gone.
        row = (await db.select().from(schema.contactMessages).where(eq(schema.contactMessages.id, id)).limit(1))[0];
        if (!row) return notFound(c);
      }
      return c.json({ item: present(row) });
    };
  }
  app.post("/:id/read", requireArea(AREA, "write"), mark("read"));
  app.post("/:id/unread", requireArea(AREA, "write"), mark("unread"));

  return app;
}

export const messageRoutes = createMessageRoutes();
