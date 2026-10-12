// The SPA's negative checks of the Pendaftaran area (SAKEM-082: Batch, Pendaftar, Pusat Dokumen), in their own file so
// the shared list in negative-checks-spa.mjs stays short: it imports and spreads `pendaftaranSpaChecks`. Same rules as
// there: each check breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the
// runner restores the file.
//
//   node scripts/negative-checks-spa.mjs
//
// The Worker's side (the area checks, the stale check, the legacy rules, the prefix search, the publish
// preconditions) is in negative-checks-pendaftaran.mjs.

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const BATCHES = "pendaftaran/batches.test.tsx";
const APPLICATIONS = "pendaftaran/applications.test.tsx";
const RESOURCES = "pendaftaran/resources.test.tsx";
const ANSWERS = "pendaftaran/answers.test.ts";
const MOCK = "pendaftaran/mock.test.ts";

export const pendaftaranSpaChecks = [
  // ---------------------------------------------- write affordances follow the role
  {
    name: "pendaftaran: a read-only role is offered 'Kelola' on a batch of the list",
    file: "spa/src/pages/batches/BatchesPage.tsx",
    from: 'aria-label={`${access === "write" ? "Kelola" : "Detail"} ${row.name}`}',
    to: "aria-label={`Kelola ${row.name}`}",
    tests: t(BATCHES),
  },
  {
    name: "pendaftaran: a read-only role is offered the publish and cancel buttons and 'Ubah Data' on the page of a batch",
    file: "spa/src/pages/batches/BatchDetailPage.tsx",
    from: 'const canWrite = accessTo(me, "pendaftaran") === "write";',
    to: "const canWrite = true;",
    tests: t(BATCHES),
  },
  {
    name: "pendaftaran: a read-only role gets a writable batch form",
    file: "spa/src/pages/batches/BatchFormPage.tsx",
    from: "readOnly={!canWrite}",
    to: "readOnly={false}",
    tests: t(BATCHES),
  },
  {
    name: "pendaftaran: a read-only role is offered the review of an applicant",
    file: "spa/src/pages/applications/ApplicationDetailPage.tsx",
    from: 'const canWrite = accessTo(me, "pendaftaran") === "write";',
    to: "const canWrite = true;",
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: a read-only role is offered 'Tambah Berkas', Edit and Hapus in the list of documents",
    file: "spa/src/pages/resources/ResourcesPage.tsx",
    from: 'const canWrite = accessTo(me, "pendaftaran") === "write";',
    to: "const canWrite = true;",
    tests: t(RESOURCES),
  },
  {
    name: "pendaftaran: a read-only role gets a writable document form",
    file: "spa/src/pages/resources/ResourceFormPage.tsx",
    from: "readOnly={!canWrite}",
    to: "readOnly={false}",
    tests: t(RESOURCES),
  },
  {
    name: "pendaftaran: a read-only role can still pick a file for a document",
    file: "spa/src/pages/resources/ResourceFormPage.tsx",
    from: "disabled={!canWrite}",
    to: "disabled={false}",
    tests: t(RESOURCES),
  },

  // ------------------------------------------------------- the list of applicants
  {
    name: "pendaftaran: the applicants list no longer opens on the newest batch",
    file: "spa/src/pages/applications/model.ts",
    from: 'return !params.has("batch") && !params.get("status") && !params.get("q");',
    to: "return false;",
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: 'Semua batch' of the bar is no batch at all (it would open the newest again)",
    file: "spa/src/pages/applications/ApplicationsPage.tsx",
    from: "filters: { ...next.filters, batch: next.filters?.batch || ALL_BATCHES }",
    to: "filters: { ...next.filters }",
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: the search box promises a contains instead of the start of a name or email",
    file: "spa/src/pages/applications/ApplicationsPage.tsx",
    from: 'placeholder: "Awal nama atau email"',
    to: 'placeholder: "Nama atau email"',
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: the tiles of a batch lead to the whole list instead of its status",
    file: "spa/src/pages/batches/model.ts",
    from: '`/applications?batch=${encodeURIComponent(batchId)}${status ? `&status=${status}` : ""}`',
    to: "`/applications?batch=${encodeURIComponent(batchId)}`",
    tests: t(BATCHES),
  },

  // ------------------------------------------------------------------- the review
  {
    name: "pendaftaran: picking 'Ditolak' for an accepted applicant is not shown as a revocation",
    file: "spa/src/pages/applications/model.ts",
    from: 'return current === "accepted" && selected === "rejected";',
    to: "return false;",
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: the revocation button is the ordinary one",
    file: "spa/src/pages/applications/ReviewPanel.tsx",
    from: 'revocation ? "Cabut Penerimaan" : "Simpan Perubahan"',
    to: '"Simpan Perubahan"',
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: the review is sent without the version it loaded",
    file: "spa/src/pages/applications/ReviewPanel.tsx",
    from: '{ method: "POST", json: input, ifMatch: ifMatch(application.updatedAt) }',
    to: '{ method: "POST", json: input }',
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: 'Muat ulang' of a stale review reloads nothing",
    file: "spa/src/pages/applications/ReviewPanel.tsx",
    from: "<Button variant=\"neutral\" className=\"mt-3\" onClick={onReload}>",
    to: '<Button variant="neutral" className="mt-3" onClick={() => undefined}>',
    tests: t(APPLICATIONS),
  },
  {
    name: "pendaftaran: the page of a batch does not reload after a refused publication",
    file: "spa/src/pages/batches/BatchDetailPage.tsx",
    from: "show the batch as it is now.\n      item.refetch();",
    to: "show the batch as it is now.",
    tests: t(BATCHES),
  },

  // ---------------------------------------- what an applicant typed is only text
  {
    name: "pendaftaran: any link an applicant pasted is clickable (`javascript:` runs)",
    file: "spa/src/pages/applications/answers.ts",
    from: 'return protocol === "https:" || protocol === "http:" ? value : null;',
    to: "return value;",
    tests: t(ANSWERS, APPLICATIONS),
  },
  {
    name: "pendaftaran: an Instagram name is put in the address as typed",
    file: "spa/src/pages/applications/answers.ts",
    from: "url: `https://instagram.com/${encodeURIComponent(handle)}`",
    to: "url: `https://instagram.com/${handle}`",
    tests: t(ANSWERS),
  },

  // ---------------------------------------------------------- Pusat Dokumen
  {
    name: "pendaftaran: the documents are grouped in another order than the public page's",
    file: "spa/src/pages/resources/model.ts",
    from: "const groups = CATEGORIES.map(",
    to: "const groups = [...CATEGORIES].reverse().map(",
    tests: t(RESOURCES),
  },
  {
    name: "pendaftaran: the question before deleting a document forgets its file",
    file: "spa/src/pages/resources/ResourcesPage.tsx",
    from: 'note: "File uploadnya juga akan dihapus.",',
    to: "",
    tests: t(RESOURCES),
  },
  {
    name: "pendaftaran: an uploaded document is opened from the admin's own address instead of the files domain",
    file: "spa/src/pages/resources/ResourcesPage.tsx",
    from: "uploadUrl(row.filePath, base)",
    to: "row.filePath",
    tests: t(RESOURCES),
  },
  {
    name: "pendaftaran: the form keeps the size of the old file after a new one is picked",
    file: "spa/src/pages/resources/ResourceFormPage.tsx",
    from: 'form.set("fileSize", result ? String(result.size) : "");',
    to: "",
    tests: t(RESOURCES),
  },

  // ----------------------------------------------------------------- the mock
  {
    name: "pendaftaran: the mock publishes a batch with undecided applicants",
    file: "spa/src/mock/resources/pendaftaran.ts",
    from: "if (undecided > 0) return failure(409",
    to: "if (false) return failure(409",
    tests: t(MOCK),
  },
  {
    name: "pendaftaran: the mock's search finds a name by its middle",
    file: "spa/src/mock/resources/pendaftaran.ts",
    from: "row.fullName.toLowerCase().startsWith(q)",
    to: "row.fullName.toLowerCase().includes(q)",
    tests: t(MOCK),
  },
];
