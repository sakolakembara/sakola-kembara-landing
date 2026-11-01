// The SPA's negative checks of the page header (Dzul, 2026-11-01: a page has its title only, no description under it), in
// their own file like negative-checks-spa-switch.mjs: negative-checks-spa.mjs imports and spreads `headerSpaChecks`. Same
// rules: each check breaks ONE safeguard (the patch must stay valid code), runs the tests that must notice, expects them to
// FAIL, and the runner restores the file. Each puts back the sentence the page used to carry under its title.
//
// What is not here: the list pages built on ListPage (Blog, Tim, Laporan, Shortlink, Pengumuman, Batch). They cannot say
// anything under the title any more: `PageHeader` takes no children and `ListPage` no `description`, which the compiler
// holds (`pnpm typecheck`), so there is no valid patch to make.
//
//   node scripts/negative-checks-spa.mjs --only "header: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

export const headerSpaChecks = [
  {
    name: "header: Pesan carries its two numbers under the title again",
    file: "spa/src/pages/messages/MessagesPage.tsx",
    from: '<PageHeader title="Pesan" />',
    to: '<>\n        <PageHeader title="Pesan" />\n        <p>{counts?.total} total · {counts?.unread} belum dibaca.</p>\n      </>',
    tests: t("messages.test.tsx"),
  },
  {
    name: "header: Aktivitas explains the log under the title again",
    file: "spa/src/pages/audit/AuditPage.tsx",
    from: '<PageHeader title="Aktivitas" />',
    to: '<>\n        <PageHeader title="Aktivitas" />\n        <p>Catatan aksi admin dan kejadian sistem.</p>\n      </>',
    tests: t("audit-page.test.tsx"),
  },
  {
    name: "header: Draf dengan berkas explains itself under the title again",
    file: "spa/src/pages/applications/DraftFilesPage.tsx",
    from: '<PageHeader title="Draf dengan berkas" />',
    to: '<>\n        <PageHeader title="Draf dengan berkas" />\n        <p>Nama dan isian mereka tidak ditampilkan.</p>\n      </>',
    tests: t("pendaftaran/drafts.test.tsx"),
  },
  {
    name: "header: Pengaturan explains itself under the title again",
    file: "spa/src/pages/settings/SettingsPage.tsx",
    from: "      />\n\n      <Flash flash={notice.flash} dismiss={notice.dismiss} />",
    to: "      />\n      <p>Kelola admin yang dapat mengakses dashboard.</p>\n\n      <Flash flash={notice.flash} dismiss={notice.dismiss} />",
    tests: t("settings.test.tsx"),
  },
  {
    name: "header: Pendaftar counts its applicants under the title again",
    file: "spa/src/pages/applications/ApplicationsPage.tsx",
    from: '<PageHeader title="Pendaftar" />\n\n      {/* For who may purge',
    to: '<PageHeader title="Pendaftar" />\n      <p>Daftar pendaftar siswa Sakola Kembara. 2 pendaftar.</p>\n\n      {/* For who may purge',
    tests: t("pendaftaran/applications.test.tsx"),
  },
];
