// The SPA's negative checks of the Komunikasi area (Pesan and Pengumuman, SAKEM-082), in their own file so the shared
// list in negative-checks-spa.mjs stays short: it imports and spreads `komunikasiSpaChecks`. Same rules as there: each
// check breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner
// restores the file.
//
//   node scripts/negative-checks-spa.mjs
//
// The Worker's side (the area checks, a GET that never marks a message read, the window of the current announcement,
// the public allow-list) is in negative-checks-komunikasi.mjs.

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const MESSAGES = "messages.test.tsx";
const MOCK = "komunikasi-mock.test.ts";
const ANNOUNCEMENTS = "announcements.test.tsx";

export const komunikasiSpaChecks = [
  // ------------------------------------------ a read-only role is offered nothing to change
  {
    name: "komunikasi: a message is deletable by a role that cannot write (the Hapus button is always shown)",
    file: "spa/src/pages/messages/MessageDetailPage.tsx",
    from: "{canWrite && (",
    to: "{true && (",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the mark read/unread toggle is shown to a role that cannot write",
    file: "spa/src/pages/messages/MessageDetailPage.tsx",
    from: "{canWrite && !marking && (",
    to: "{!marking && (",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the detail page treats everyone as able to write (buttons and the automatic mark)",
    file: "spa/src/pages/messages/MessageDetailPage.tsx",
    from: 'const canWrite = accessTo(me, "komunikasi") === "write";',
    to: "const canWrite = true;",
    tests: t(MESSAGES),
  },

  // ------------------------------------------- opening a message marks it read, once, explicitly
  {
    name: "komunikasi: a viewer's visit marks the message read (the automatic mark ignores the permission)",
    file: "spa/src/pages/messages/MessageDetailPage.tsx",
    from: "if (!canWrite || !message || message.readAt !== null || tried.current === message.id) return;",
    to: "if (!message || message.readAt !== null || tried.current === message.id) return;",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: marking unread is undone at once (the automatic mark runs again after it)",
    file: "spa/src/pages/messages/MessageDetailPage.tsx",
    from: "if (!canWrite || !message || message.readAt !== null || tried.current === message.id) return;",
    to: "if (!canWrite || !message || message.readAt !== null) return;",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: an already-read message is marked again on every visit",
    file: "spa/src/pages/messages/MessageDetailPage.tsx",
    from: "if (!canWrite || !message || message.readAt !== null || tried.current === message.id) return;",
    to: "if (!canWrite || !message || tried.current === message.id) return;",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the mock's GET marks the message read",
    file: "spa/src/mock/komunikasi.ts",
    from: 'if (method === "GET") return message ? json({ item: message }) : error(404, "not_found", NOT_FOUND);',
    to: 'if (method === "GET") {\n        if (message && message.readAt === null) message.readAt = new Date().toISOString();\n        return message ? json({ item: message }) : error(404, "not_found", NOT_FOUND);\n      }',
    tests: t(MOCK),
  },

  // -------------------------------------------------------------- what the screens say
  {
    name: "komunikasi: 'Balas via Email' loses its per-subject line",
    file: "spa/src/pages/messages/model.ts",
    from: 'const line = Object.hasOwn(SUBJECT_LINE, subject) ? SUBJECT_LINE[subject as Subject] : "Re: Pesan";',
    to: 'const line = "Re: Pesan";',
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the 'Belum dibaca' pill asks for the read messages",
    file: "spa/src/pages/messages/MessagesPage.tsx",
    from: "to={`${ROUTE}?filter=unread`}",
    to: "to={`${ROUTE}?filter=read`}",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the unread dot is drawn on the read messages",
    file: "spa/src/pages/messages/MessagesPage.tsx",
    from: "const unreadRow = message.readAt === null;",
    to: "const unreadRow = message.readAt !== null;",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the counts' failure shows a made-up number (zero) instead of none",
    file: "spa/src/pages/messages/useMessageCounts.ts",
    from: "unread: result.data.unread } : null;",
    to: "unread: result.data.unread } : { total: 0, unread: 0 };",
    tests: t(MESSAGES),
  },
  {
    name: "komunikasi: the message list asks the Worker for a filter name it does not have",
    file: "spa/src/pages/messages/spec.ts",
    from: 'filters: ["filter"]',
    to: 'filters: ["state"]',
    tests: t(MESSAGES),
  },

  // --------------------------------------------------------- the announcement status is the Worker's word
  {
    name: "komunikasi: the announcement status is worked out from the dates in the browser again",
    file: "spa/src/pages/announcements/AnnouncementsPage.tsx",
    from: "cell: (row) => <StatusCell status={row.status} />,",
    to: 'cell: (row) => <StatusCell status={row.active ? (row.endsAt && Date.parse(row.endsAt) < Date.now() ? "outside_window" : "current") : "inactive"} />,',
    tests: t(ANNOUNCEMENTS),
  },
  {
    name: "komunikasi: the announcement that is shown says only 'Tampil'",
    file: "spa/src/pages/announcements/model.ts",
    from: 'current: { label: "Tampil sekarang", tone: "shown" },',
    to: 'current: { label: "Tampil", tone: "shown" },',
    tests: t(ANNOUNCEMENTS),
  },
  {
    name: "komunikasi: the mock marks every live announcement as current (a newer one never covers it)",
    file: "spa/src/mock/komunikasi.ts",
    from: 'live(row) ? (row === shown ? "current" : "superseded")',
    to: 'live(row) ? "current"',
    tests: t(MOCK),
  },
  {
    name: "komunikasi: the mock accepts a javascript: CTA URL",
    file: "spa/src/mock/resources/announcements.ts",
    from: "if (problem) fields.ctaUrl = problem;",
    to: "",
    tests: t(MOCK),
  },
];
