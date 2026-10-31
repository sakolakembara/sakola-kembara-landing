// The SPA's negative checks of the Laporan, Tim and Shortlink screens (SAKEM-082), in their own file so the shared list
// in negative-checks-spa.mjs stays short: it imports and spreads `kontenMiscSpaChecks`. Same rules as there: each check
// breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores
// the file.
//
//   node scripts/negative-checks-spa.mjs
//
// The Worker's side (the area checks, the stale check, the rules of the target and the click's isolation) is in
// negative-checks-konten-misc.mjs. What the kit checks for every screen (the read-only affordances in `ListPage` and
// `FormShell`, the unsaved guard, the submit lock) is in negative-checks-spa-crud.mjs; the checks below break the same
// kind of thing in the screens' own files, and in the shared list once more with these screens' tests.

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const REPORTS = "reports.test.tsx";
const TEAM = "team.test.tsx";
const SHORTLINKS = "shortlinks.test.tsx";
const MOCK = "mock-konten.test.ts";

export const kontenMiscSpaChecks = [
  // ---------------------------------------------- write affordances follow the role
  {
    name: "konten: a read-only role is offered the create button, Edit and Hapus on the three lists",
    file: "spa/src/components/crud/ListPage.tsx",
    from: 'const canWrite = access === "write";',
    to: "const canWrite = true;",
    tests: t(REPORTS, TEAM, SHORTLINKS),
  },
  {
    name: "konten: a read-only role gets a writable report form",
    file: "spa/src/pages/reports/ReportFormPage.tsx",
    from: 'const canWrite = accessTo(me, "konten") === "write";',
    to: "const canWrite = true;",
    tests: t(REPORTS),
  },
  {
    name: "konten: a read-only role gets a writable team form (and may add rows)",
    file: "spa/src/pages/team/TeamFormPage.tsx",
    from: 'const canWrite = accessTo(me, "konten") === "write";',
    to: "const canWrite = true;",
    tests: t(TEAM),
  },
  {
    name: "konten: a read-only role gets a writable shortlink form",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: 'const canWrite = accessTo(me, "konten") === "write";',
    to: "const canWrite = true;",
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: a role that cannot create is offered the empty report form",
    file: "spa/src/pages/reports/ReportFormPage.tsx",
    from: "if (!id && !canWrite) return <ForbiddenPage />;",
    to: "",
    tests: t(REPORTS),
  },
  {
    name: "konten: a role that cannot create is offered the empty team form",
    file: "spa/src/pages/team/TeamFormPage.tsx",
    from: "if (!id && !canWrite) return <ForbiddenPage />;",
    to: "",
    tests: t(TEAM),
  },
  {
    name: "konten: a role that cannot create is offered the empty shortlink form",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: "if (!id && !canWrite) return <ForbiddenPage />;",
    to: "",
    tests: t(SHORTLINKS),
  },

  // ---------------------------------------------- the screens are registered, and the mock obeys the area
  {
    name: "konten: the Laporan screen is not registered (the placeholder shows)",
    file: "spa/src/pages/screens/konten.ts",
    from: "    index: ReportsPage,",
    to: "    index: undefined,",
    tests: t(REPORTS, MOCK),
  },
  {
    name: "konten: the mocked reports are open to every persona",
    file: "spa/src/mock/resources/reports.ts",
    from: '  area: "konten",',
    to: '  area: "umum",',
    tests: t(MOCK),
  },

  // ---------------------------------------------- Laporan: the file
  {
    name: "konten: a report's file can be replaced from the edit form (the upload field shows there)",
    file: "spa/src/pages/reports/ReportFormPage.tsx",
    from: "        {item ? (\n          <div className=\"flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4\">",
    to: "        {false ? (\n          <div className=\"flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4\">",
    tests: t(REPORTS),
  },
  {
    name: "konten: an update of a report sends the file again",
    file: "spa/src/pages/reports/model.ts",
    from: "  return { title: values.title, description: values.description, category: values.category, year: values.year };",
    to: "  return { title: values.title, description: values.description, category: values.category, year: values.year, filePath: values.filePath, fileSize: Number(values.fileSize) };",
    tests: t(REPORTS),
  },
  {
    name: "konten: a new report is saved without the size of its file",
    file: "spa/src/pages/reports/model.ts",
    from: '    fileSize: values.fileSize === "" ? null : Number(values.fileSize),',
    to: "    fileSize: null,",
    tests: t(REPORTS),
  },
  {
    name: "konten: the PDF link of a report does not say it opens another tab safely (rel removed)",
    file: "spa/src/pages/reports/ReportsPage.tsx",
    from: '      rel="noopener noreferrer"\n      aria-label={`Buka PDF ${row.title}`}',
    to: "      aria-label={`Buka PDF ${row.title}`}",
    tests: t(REPORTS),
  },

  // ---------------------------------------------- Tim: the rows of the histories
  {
    name: "konten: blank education rows are sent (the row with no institution is not dropped)",
    file: "spa/src/pages/team/model.ts",
    from: '  return rows.filter((row) => row.institution.trim() !== "").map((row) => ({ institution: row.institution.trim(), degree: orNull(row.degree), year: orNull(row.year) }));',
    to: "  return rows.map((row) => ({ institution: row.institution.trim(), degree: orNull(row.degree), year: orNull(row.year) }));",
    tests: t(TEAM),
  },
  {
    name: "konten: a row's error lands on the wrong row when a blank row came before it",
    file: "spa/src/pages/team/TeamFormPage.tsx",
    from: "  return rows.map((row) => (kept(row.value) ? next++ : null));",
    to: "  return rows.map((_, index) => index);",
    tests: t(TEAM),
  },
  {
    name: "konten: the unsaved guard ignores the rows of the histories",
    file: "spa/src/pages/team/TeamFormPage.tsx",
    from: "dirty={form.dirty || historiesChanged}",
    to: "dirty={form.dirty}",
    tests: t(TEAM),
  },
  {
    name: "konten: a save that changed nothing but the blank rows keeps them on screen",
    file: "spa/src/pages/team/TeamFormPage.tsx",
    from: "key={`${item.item?.updatedAt ?? \"new\"}:${saves}`}",
    to: "key={`${item.item?.updatedAt ?? \"new\"}`}",
    tests: t(TEAM),
  },
  {
    name: "konten: an empty display order is sent as 0",
    file: "spa/src/pages/team/model.ts",
    from: '  const order = values.displayOrder.trim() === "" ? null : Number(values.displayOrder);',
    to: "  const order = Number(values.displayOrder);",
    tests: t(TEAM),
  },
  {
    name: "konten: the list of the team shows the photos from this host, not the public files domain",
    file: "spa/src/pages/team/TeamPage.tsx",
    from: "src={storedFileUrl(member.image, base, siteUrl)}",
    to: "src={member.image}",
    tests: t(TEAM),
  },

  // ---------------------------------------------- Shortlink: the address, the copy, the red state
  {
    name: "konten: the copy button says it copied without copying",
    file: "spa/src/components/crud/CopyButton.tsx",
    from: "      await navigator.clipboard.writeText(url);\n",
    to: "",
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: the copy button says it copied when the copy failed",
    file: "spa/src/components/crud/CopyButton.tsx",
    from: '    } catch {\n      setState("failed");',
    to: '    } catch {\n      setState("copied");',
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: a link's target opens in the same tab and hands over the opener (target and rel removed)",
    file: "spa/src/pages/shortlinks/ShortlinksPage.tsx",
    from: '<a href={row.targetUrl} target="_blank" rel="noopener noreferrer"',
    to: "<a href={row.targetUrl}",
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: the slug box does not turn red for a refused slug",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: "aria-invalid={fields.slug ? true : undefined}",
    to: "",
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: a rename is saved without saying that the old address stops working",
    file: "spa/src/pages/shortlinks/ShortlinkFormPage.tsx",
    from: 'text: renamed ? `Shortlink berhasil disimpan. Slug lama /${item.slug} tidak lagi aktif.` : "Shortlink berhasil disimpan."',
    to: 'text: "Shortlink berhasil disimpan."',
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: a new shortlink starts switched off",
    file: "spa/src/pages/shortlinks/model.ts",
    from: "active: item?.active ?? true,",
    to: "active: item?.active ?? false,",
    tests: t(SHORTLINKS),
  },
  {
    name: "konten: the active count is told when the page holds only some of the links",
    file: "spa/src/pages/shortlinks/ShortlinksPage.tsx",
    from: 'const everyLink = list.status === "ready" && list.total === list.items.length;',
    to: 'const everyLink = list.status === "ready";',
    tests: t(SHORTLINKS),
  },
  // ---------------------------------------------- files that predate the admin (a path of the public site)
  {
    name: "konten: the team list draws a legacy photo ('/images/team/...') from the admin's own host, where it collapses",
    file: "spa/src/pages/team/TeamPage.tsx",
    from: "src={storedFileUrl(member.image, base, siteUrl)}",
    to: 'src={member.image.startsWith("/uploads/") ? storedFileUrl(member.image, base, siteUrl) : member.image}',
    tests: t(TEAM),
  },
  {
    name: "konten: the reports list opens a legacy file ('/reports/...') from the admin's own host",
    file: "spa/src/pages/reports/ReportsPage.tsx",
    from: "href={storedFileUrl(row.filePath, base, siteUrl)}",
    to: 'href={row.filePath.startsWith("/uploads/") ? storedFileUrl(row.filePath, base, siteUrl) : row.filePath}',
    tests: t(REPORTS),
  },
  {
    name: "konten: the report form links a legacy file to the admin's own host",
    file: "spa/src/pages/reports/ReportFormPage.tsx",
    from: "href={storedFileUrl(item.filePath, base, siteUrl)}",
    to: 'href={item.filePath.startsWith("/uploads/") ? storedFileUrl(item.filePath, base, siteUrl) : item.filePath}',
    tests: t(REPORTS),
  },
];
