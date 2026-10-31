// The SPA's negative checks of moving from page to page (SAKEM-115: no false number while a page is on its way, nothing
// added later under everything else, no blank frame on Pendaftar, a page that opens at its top), in their own file like
// negative-checks-spa-boot.mjs: negative-checks-spa.mjs imports and spreads `switchSpaChecks`. Same rules: each check
// breaks ONE safeguard (the patch must stay valid code), runs the tests that must notice, expects them to FAIL, and
// the runner restores the file.
//
//   node scripts/negative-checks-spa.mjs --only "switch: "

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const SWITCH = "page-switch.test.tsx";
const APPLICATIONS = "spa/src/pages/applications/ApplicationsPage.tsx";
const COUNTS = "spa/src/pages/messages/useMessageCounts.ts";

export const switchSpaChecks = [
  // ---------------------------------------------- descriptions that count
  {
    name: "switch: a description that counts the list says '0 ...' until the list is there",
    file: "spa/src/components/crud/ListPage.tsx",
    from: '(list.status === "loading" ? <DescriptionSkeleton /> : description(list))',
    to: "description(list)",
    tests: t(SWITCH),
  },
  {
    name: "switch: the Pesan line with the two numbers is added when they arrive, moving everything under it",
    file: "spa/src/pages/messages/MessagesPage.tsx",
    from: "!settled && <DescriptionSkeleton />",
    to: "null",
    tests: t(SWITCH),
  },
  {
    name: "switch: the Pesan counts that failed leave a grey line for ever",
    file: "spa/src/pages/messages/MessagesPage.tsx",
    from: "!settled && <DescriptionSkeleton />",
    to: "<DescriptionSkeleton />",
    tests: t(SWITCH),
  },
  {
    name: "switch: the Pesan counts are not kept, so every visit starts without them",
    file: COUNTS,
    from: "if (next) keepRead(COUNTS_PATH, next, version);",
    to: "void version;",
    tests: t(SWITCH),
  },
  {
    name: "switch: the count of Pendaftar says '0 pendaftar' until the applicants are there",
    file: APPLICATIONS,
    from: '{list.status === "loading" ? (',
    to: "{false ? (",
    tests: t(SWITCH),
  },

  // ---------------------------------------------- Pendaftar
  {
    name: "switch: Pendaftar shows a single line of text while the batches load (the page is built after it)",
    file: APPLICATIONS,
    from: 'if (batches.status === "loading") return <PendaftarLoading />;',
    to: 'if (batches.status === "loading") return <PageHeader title="Pendaftar" />;',
    tests: t(SWITCH),
  },
  {
    name: "switch: the page is blank for the frame in which the address gets the newest batch",
    file: APPLICATIONS,
    from: "        <PendaftarLoading />\n        <Navigate",
    to: "        <Navigate",
    tests: t("page-switch-pendaftar.test.tsx"),
  },
  {
    name: "switch: the batches are not kept, so every visit waits for them before the applicants are asked for",
    file: APPLICATIONS,
    from: "if (result.ok) keepRead(BATCHES_PATH, result.data, version);",
    to: "void version;",
    tests: t(SWITCH),
  },
  {
    name: "switch: the loading page's search and filters can be used (nothing to choose from yet)",
    file: APPLICATIONS,
    from: '<fieldset disabled className="contents">',
    to: '<fieldset className="contents">',
    tests: t(SWITCH),
  },

  // ---------------------------------------------- a page opens at its top
  {
    name: "switch: a page opens where the last one was left (a long list scrolled halfway down the next page)",
    file: "spa/src/components/Shell.tsx",
    from: "if (main.current) main.current.scrollTop = 0;",
    to: "void main;",
    tests: t(SWITCH),
  },
];
