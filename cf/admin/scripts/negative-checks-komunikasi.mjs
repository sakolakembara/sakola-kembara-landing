// The negative checks of the Komunikasi area (Pesan and Pengumuman, SAKEM-082), in their own file so the shared list in
// negative-checks.mjs stays short: it imports and spreads `komunikasiChecks`. Same rules as there: each check breaks ONE
// safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores the file. A
// pattern found other than exactly once is reported as FAIL, so a refactor cannot turn a check into a no-op.
//
//   node scripts/negative-checks.mjs --only komunikasi
//
// The SPA's side (the read-only look of the detail page, the explicit mark-as-read, the status word) is in
// negative-checks-spa-komunikasi.mjs.

const MESSAGES = "test/messages.test.ts";
const RULES = "test/announcements-rules.test.ts";
const ANNOUNCEMENTS = "test/announcements.test.ts";
const CONTRACT = "test/komunikasi-spa-contract.test.ts";

export const komunikasiChecks = [
  // ------------------------------------------------------------------ Pesan: who may
  {
    name: "komunikasi: the unread/total counts are answered to anyone (no area check)",
    file: "src/api/messages.ts",
    from: 'app.get("/counts", requireArea(AREA, "read"), async (c) => {',
    to: 'app.get("/counts", async (c) => {',
    tests: MESSAGES,
  },
  {
    name: "komunikasi: marking a message read only needs read access (a viewer can mark)",
    file: "src/api/messages.ts",
    from: 'app.post("/:id/read", requireArea(AREA, "write"), mark("read"));',
    to: 'app.post("/:id/read", requireArea(AREA, "read"), mark("read"));',
    tests: MESSAGES,
  },
  {
    name: "komunikasi: marking a message unread only needs read access (a viewer can mark)",
    file: "src/api/messages.ts",
    from: 'app.post("/:id/unread", requireArea(AREA, "write"), mark("unread"));',
    to: 'app.post("/:id/unread", requireArea(AREA, "read"), mark("unread"));',
    tests: MESSAGES,
  },
  {
    name: "komunikasi: a message delete only needs read access (the kit's route)",
    file: "src/api/crud/resource.ts",
    from: 'app.delete("/:id", requireArea(config.area, "write"), handlers.remove);',
    to: 'app.delete("/:id", requireArea(config.area, "read"), handlers.remove);',
    tests: MESSAGES,
  },
  {
    name: "komunikasi: the messages belong to the wrong area (an editor of konten reads them)",
    file: "src/api/messages.ts",
    from: "      area: AREA,",
    to: '      area: "konten",',
    tests: MESSAGES,
  },

  // ------------------------------------------------- Pesan: a GET changes nothing
  {
    name: "komunikasi: GET /:id marks the message read (opening it through a GET)",
    file: "src/api/messages.ts",
    from: "  // The list, `GET /:id` and `DELETE /:id` are the kit's. A message cannot be created or edited here.",
    to: '  app.get("/:id", async (c, next) => {\n    await c.env.DB.prepare("UPDATE contact_messages SET read_at = ? WHERE id = ? AND read_at IS NULL").bind(Date.now(), c.req.param("id")).run();\n    await next();\n  });',
    tests: `${MESSAGES} ${CONTRACT}`,
  },
  {
    name: "komunikasi: marking is not idempotent (the UPDATE matches a message already in that state, so it re-stamps and audits again)",
    file: "src/api/messages.ts",
    from: ".where(and(eq(schema.contactMessages.id, id), to === \"read\" ? isUnreadMessage : isNotNull(schema.contactMessages.readAt)))",
    to: ".where(eq(schema.contactMessages.id, id))",
    tests: MESSAGES,
  },

  // ------------------------------------------------- Pesan: what it answers and what it records
  {
    name: "komunikasi: the unread definition is changed in the one place the dashboard, the counts and the filter share",
    file: "src/dashboard/queries.ts",
    from: "export const isUnreadMessage = isNull(contactMessages.readAt);",
    to: "export const isUnreadMessage = sql`0 = 1`;",
    tests: `${MESSAGES} test/dashboard.test.ts`,
  },
  {
    name: "komunikasi: the unread filter lists the read messages",
    file: "src/api/messages.ts",
    from: 'if (raw === "unread") return { ok: true, where: isUnreadMessage };',
    to: 'if (raw === "unread") return { ok: true, where: isNotNull(schema.contactMessages.readAt) };',
    tests: MESSAGES,
  },
  {
    name: "komunikasi: the list carries the whole text, not a preview",
    file: "src/api/messages.ts",
    from: "preview: row.message.slice(0, PREVIEW_LENGTH),",
    to: "preview: row.message,",
    tests: MESSAGES,
  },
  {
    name: "komunikasi: the audit row of a message carries the sender's name (personal data in the trail)",
    file: "src/api/messages.ts",
    from: 'audit: { name: "contact_message", type: "contact_message" },',
    to: 'audit: { name: "contact_message", type: "contact_message", label: (row) => row.fullName },',
    tests: MESSAGES,
  },

  // ------------------------------------------------------ Pengumuman: who may, and the kit's checks
  {
    name: "komunikasi: the announcements belong to the wrong area (an editor of komunikasi is refused, one of konten is let in)",
    file: "src/api/announcements.ts",
    from: 'const AREA = "komunikasi" as const;',
    to: 'const AREA = "konten" as const;',
    tests: ANNOUNCEMENTS,
  },
  {
    name: "komunikasi: an announcement update only needs read access",
    file: "src/api/announcements.ts",
    from: 'app.put("/:id", requireArea(AREA, "write"), handlers.update);',
    to: 'app.put("/:id", requireArea(AREA, "read"), handlers.update);',
    tests: ANNOUNCEMENTS,
  },
  {
    name: "komunikasi: the stale check removed (an announcement's last save silently wins)",
    file: "src/api/crud/resource.ts",
    from: "if (!matches(precondition, current)) return stale(c);",
    to: "",
    tests: `${ANNOUNCEMENTS} ${RULES}`,
  },
  {
    name: "komunikasi: the public announcement is no longer purged after a change",
    file: "src/api/announcements.ts",
    from: '      purge: { area: "announcement" },',
    to: "",
    tests: `${ANNOUNCEMENTS} ${RULES}`,
  },

  // ------------------------------------------------ Pengumuman: which one is current, and the window
  {
    name: "komunikasi: the window start is exclusive in the predicate the strip and the list share",
    file: "src/public/queries.ts",
    from: "lte(announcements.startsAt, now)",
    to: "lte(announcements.startsAt, new Date(now.getTime() - 1))",
    tests: `${RULES} test/public-read.test.ts`,
  },
  {
    name: "komunikasi: the window end is exclusive in the predicate the strip and the list share",
    file: "src/public/queries.ts",
    from: "gte(announcements.endsAt, now)",
    to: "gte(announcements.endsAt, new Date(now.getTime() + 1))",
    tests: `${RULES} test/public-read.test.ts`,
  },
  {
    name: "komunikasi: the list works out its status without the window",
    file: "src/api/announcements.ts",
    from: "case when ${announcementIsLive(now)!} then 'live'",
    to: "case when ${eq(schema.announcements.active, true)} then 'live'",
    tests: RULES,
  },
  {
    name: "komunikasi: the list marks the oldest live announcement as current (the strip shows the newest)",
    file: "src/api/announcements.ts",
    from: ".orderBy(...announcementNewestFirst).limit(1),",
    to: ".orderBy(schema.announcements.createdAt).limit(1),",
    tests: RULES,
  },
  {
    name: "komunikasi: a live announcement is always current (a newer one never covers it)",
    file: "src/announcements/rules.ts",
    from: 'if (phase === "live") return id === currentId ? "current" : "superseded";',
    to: 'if (phase === "live") return "current";',
    tests: `${RULES} ${CONTRACT}`,
  },

  // ------------------------------------------------------------ Pengumuman: the CTA URL
  {
    name: "komunikasi: the CTA URL rule is not applied by the form",
    file: "src/api/announcements.ts",
    from: "const problem = v.ctaUrl === null ? null : ctaUrlProblem(v.ctaUrl);",
    to: "const problem = null as string | null;",
    tests: `${RULES} ${CONTRACT}`,
  },
  {
    name: "komunikasi: a javascript: CTA URL is accepted",
    file: "src/announcements/rules.ts",
    from: 'return parsed.protocol === "http:" || parsed.protocol === "https:" ? null : CTA_URL_MESSAGES.scheme;',
    to: "return null;",
    tests: RULES,
  },
  {
    name: "komunikasi: a protocol-relative CTA URL (//host) is accepted",
    file: "src/announcements/rules.ts",
    from: "if (url.startsWith(\"//\")) return CTA_URL_MESSAGES.offSite;",
    to: "",
    tests: RULES,
  },

  // ----------------------------------------------------- Pengumuman: what the public strip may say
  {
    name: "komunikasi: the public strip is allowed to carry the author (query and serializer both widened)",
    edits: [
      { file: "src/public/queries.ts", from: "      ctaUrl: announcements.ctaUrl,\n    })\n    .from(announcements)\n    .where(announcementIsLive(now))", to: "      ctaUrl: announcements.ctaUrl,\n      createdBy: announcements.createdBy,\n    })\n    .from(announcements)\n    .where(announcementIsLive(now))" },
      {
        file: "src/public/serializers.ts",
        from: "return { title: row.title, body: row.body, severity: row.severity, ctaLabel: row.ctaLabel, ctaUrl: row.ctaUrl };",
        to: "return { title: row.title, body: row.body, severity: row.severity, ctaLabel: row.ctaLabel, ctaUrl: row.ctaUrl, ...(row as unknown as Record<string, unknown>) } as PublicAnnouncement;",
      },
    ],
    tests: RULES,
  },
];
