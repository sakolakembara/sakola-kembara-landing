// The SPA's negative checks of Aktivitas and Pengaturan (SAKEM-082), in their own file so the shared list in
// negative-checks-spa.mjs stays short: it imports and spreads `sistemSpaChecks`. Same rules as there: each check
// breaks ONE safeguard in the source, runs the tests that must notice, expects them to FAIL, and the runner restores
// the file.
//
//   node scripts/negative-checks-spa.mjs
//
// The Worker's side (the super_admin guard, the cursor and its tie-break, the allow-list of a row's details, the
// last super_admin) is in negative-checks-sistem.mjs.

const t = (...names) => names.map((name) => `spa/test/${name}`).join(" ");

const LABELS = "audit-labels.test.ts";
const AUDIT = "audit-page.test.tsx";
const SETTINGS = "settings.test.tsx";
const MOCK = "sistem-mock.test.ts";

export const sistemSpaChecks = [
  // ------------------------------------------- no action reaches the page without words
  {
    name: "sistem: a declared action has no label (admin.deactivate)",
    file: "spa/src/lib/audit.ts",
    from: '  "admin.deactivate": "Admin dinonaktifkan",\n',
    to: "",
    tests: t(LABELS, AUDIT),
  },
  {
    name: "sistem: a declared action has no label (upload.create, written by the new uploads)",
    file: "spa/src/lib/audit.ts",
    from: '  "upload.create": "Berkas diunggah",\n',
    to: "",
    tests: t(LABELS, AUDIT),
  },
  {
    name: "sistem: a declared resource type has no label (media)",
    file: "spa/src/lib/audit.ts",
    from: '  media: "Berkas unggahan",\n',
    to: "",
    tests: t(LABELS, AUDIT),
  },
  {
    name: "sistem: the action filter offers fewer actions than the Worker declares",
    file: "spa/src/lib/audit.ts",
    from: '  "upload.delete",\n  "user.email_verified",',
    to: '  "user.email_verified",',
    tests: t(LABELS),
  },

  // ------------------------------------------- Sistem is hidden from everyone but a super_admin
  {
    name: "sistem: Aktivitas is in the menu of every role",
    file: "spa/src/lib/nav.ts",
    from: '{ path: "/audit", label: "Aktivitas", icon: "activity", section: "sistem" },',
    to: '{ path: "/audit", label: "Aktivitas", icon: "activity", section: "umum" },',
    tests: t(AUDIT, "sidebar.test.tsx", "nav.test.ts"),
  },
  {
    name: "sistem: Pengaturan is in the menu of every role",
    file: "spa/src/lib/nav.ts",
    from: '{ path: "/settings", label: "Pengaturan", icon: "settings", section: "sistem" },',
    to: '{ path: "/settings", label: "Pengaturan", icon: "settings", section: "umum" },',
    tests: t(AUDIT, "sidebar.test.tsx", "nav.test.ts"),
  },
  {
    name: "sistem: a page of the Sistem area opens for a role that may not (no 403 page)",
    file: "spa/src/components/RequireAuth.tsx",
    from: 'return accessTo(me, section) === "none" ? <ForbiddenPage /> : <Outlet />;',
    to: "return <Outlet />;",
    tests: t(AUDIT, SETTINGS, "routes.test.tsx"),
  },

  // ------------------------------------------- Aktivitas: the cursor and the address bar
  {
    name: "sistem: 'Berikutnya' goes back to the first page (the cursor is not in the link)",
    file: "spa/src/pages/audit/AuditPage.tsx",
    from: '<Link to={{ search: searchFor(list.nextCursor) }} rel="next" className={LINK}>',
    to: '<Link to={{ search: searchFor("") }} rel="next" className={LINK}>',
    tests: t(AUDIT),
  },
  {
    name: "sistem: applying a filter keeps the old cursor (the list would start in the middle of another list)",
    file: "spa/src/pages/audit/AuditPage.tsx",
    from: "to: query.to, ...next }",
    to: "to: query.to, cursor: query.cursor, ...next }",
    tests: t(AUDIT),
  },
  {
    name: "sistem: a hand-edited address is sent to the Worker as it is (an action that is not offered)",
    file: "spa/src/pages/audit/model.ts",
    from: 'action: (FILTER_ACTIONS as readonly string[]).includes(action) ? action : "",',
    to: "action,",
    tests: t(AUDIT),
  },

  // ------------------------------------------- Pengaturan: the last super_admin is surfaced, the guards of the form
  {
    name: "sistem: the refusal to deactivate the last super_admin is not shown in the dialog",
    file: "spa/src/pages/settings/useAdminAction.tsx",
    from: "setError(describeFailure(result).message);",
    to: "setError(null);",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: after a final refusal the dialog still offers the same question again",
    file: "spa/src/pages/settings/useAdminAction.tsx",
    from: "setFinal(result.code !== undefined && FINAL.has(result.code));",
    to: "setFinal(false);",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: the form does not show the role field's error when the last super_admin cannot step down",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: '<Field group hideLabel label="Peran" required error={fields.role}>',
    to: '<Field group hideLabel label="Peran" required>',
    tests: t(SETTINGS),
  },
  {
    name: "sistem: the edit form saves without If-Match",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: '{ method: "PUT", json: toUpdateBody(values), ifMatch: ifMatch(item.updatedAt) }',
    to: '{ method: "PUT", json: toUpdateBody(values) }',
    tests: t(SETTINGS),
  },
  {
    name: "sistem: leaving the form after an invitation that could not be mailed is stopped by the unsaved-changes guard",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: "save.succeededRef.current = true;\n      navigate(ROUTE,",
    to: "navigate(ROUTE,",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: an admin may deactivate themselves from the list",
    file: "spa/src/pages/settings/SettingsPage.tsx",
    from: "} else if (row.id === me.id) {",
    to: "} else if (false) {",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: a second invitation can be sent while one is on its way",
    file: "spa/src/pages/settings/SettingsPage.tsx",
    from: "disabled: resending !== null,",
    to: "disabled: resending === row.id,",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: the row's secondary actions are back in the row, in a line of buttons (no menu)",
    file: "spa/src/pages/settings/SettingsPage.tsx",
    from: "<RowMenu name={row.email} items={menuItems(row)} />",
    to: "null",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: a viewer or a super_admin saves with the areas that were ticked while they were an editor",
    file: "spa/src/pages/settings/model.ts",
    from: 'return values.role === "editor" ? AREAS.filter((area) => values[area] === true) : [];',
    to: "return AREAS.filter((area) => values[area] === true);",
    tests: t(SETTINGS),
  },
  {
    name: "sistem: a new admin is always sent with a password, even an empty one (an invitation never happens)",
    file: "spa/src/pages/settings/model.ts",
    from: '...(values.password !== "" ? { password: values.password } : {}),',
    to: "password: values.password,",
    tests: t(SETTINGS),
  },

  // ------------------------------------------- the mock follows the Worker's rules
  {
    name: "sistem: the mock answers Sistem to a role that is not a super_admin",
    file: "spa/src/mock/handlers/sistem.ts",
    from: 'if (accessOf("sistem") === "none") return error(403, "forbidden");',
    to: "",
    tests: t(MOCK),
  },
  {
    name: "sistem: the mock lets the last super_admin step down",
    file: "spa/src/mock/handlers/sistem.ts",
    from: "if (form.role !== row.role && wouldLeaveNoSuperAdmin(row)) {",
    to: "if (false) {",
    tests: t(MOCK),
  },
  {
    name: "last-super-admin: the mock counts an invitation nobody opened as another super_admin who can sign in",
    file: "spa/src/mock/handlers/sistem.ts",
    from: "const canSignIn = (row: AdminRow) => row.role === \"super_admin\" && !row.deactivated && row.hasAccount;",
    to: "const canSignIn = (row: AdminRow) => row.role === \"super_admin\" && !row.deactivated;",
    tests: t(MOCK),
  },

  // ------------------------------------------- an admin never has to verify an address (SAKEM-089)
  {
    name: "email-twice: a password with a different second address is sent anyway",
    file: "spa/src/pages/settings/model.ts",
    from: 'return values.password !== "" && values.email.trim().toLowerCase() !== values.emailConfirm.trim().toLowerCase();',
    to: "return false;",
    tests: t(SETTINGS),
  },
  {
    name: "no-verify: the mock leaves an admin made with a password unverified, so not Aktif and not another super_admin",
    file: "spa/src/mock/handlers/sistem.ts",
    from: "      hasAccount: !invited || accepted,\n      deactivated: false,\n      emailVerified: !invited || accepted,",
    to: "      hasAccount: accepted,\n      deactivated: false,\n      emailVerified: accepted,",
    tests: t(MOCK),
  },
  {
    name: "no-verify: the mock says an admin made with a password was mailed a verification email",
    file: "spa/src/mock/handlers/sistem.ts",
    from: "...(invited ? { email: { sent: true, kind: \"invite\" } } : {}) }",
    to: "email: { sent: true, kind: invited ? \"invite\" : \"verification\" } }",
    tests: t(MOCK),
  },
  {
    name: "no-verify: the mock fails the invitation's email for an admin made with a password too",
    file: "spa/src/mock/handlers/sistem.ts",
    from: "if (invited && local === \"email-gagal\")",
    to: "if (local === \"email-gagal\")",
    tests: t(MOCK),
  },
  {
    name: "no-verify: the form's notice for an admin made with a password still says a verification email went out",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: '"Admin bisa langsung masuk dengan password yang kamu isi."',
    to: "`Email verifikasi dikirim ke ${values.email.trim()}.`",
    tests: t(SETTINGS),
  },
  {
    name: "no-verify: the password field still tells the person that the admin must verify the email first",
    file: "spa/src/pages/settings/AdminFormPage.tsx",
    from: "Jika diisi, admin langsung bisa masuk dengan password itu tanpa verifikasi email, jadi pastikan emailnya benar dan sampaikan password-nya langsung ke admin.",
    to: "Jika diisi, admin tetap harus membuka email verifikasi dulu sebelum bisa masuk.",
    tests: t(SETTINGS),
  },

  // ------------------------------------------- the confirm buttons of Nonaktifkan and Aktifkan kembali (SAKEM-087)
  {
    name: "last-super-admin: the confirm of Nonaktifkan is the primary (blue) button again",
    file: "spa/src/pages/settings/SettingsPage.tsx",
    from: "    destructive: true,\n",
    to: "",
    tests: t(SETTINGS),
  },
  {
    name: "last-super-admin: the confirm of Aktifkan kembali is red (a way back made to look like a loss)",
    file: "spa/src/pages/settings/SettingsPage.tsx",
    from: '    confirmLabel: "Aktifkan kembali",\n    pendingLabel: "Mengaktifkan...",\n',
    to: '    confirmLabel: "Aktifkan kembali",\n    pendingLabel: "Mengaktifkan...",\n    destructive: true,\n',
    tests: t(SETTINGS),
  },
  {
    name: "sistem: the mock's email search is a substring",
    file: "spa/src/mock/handlers/sistem.ts",
    from: 'q === "" || row.email.startsWith(q)',
    to: 'q === "" || row.email.includes(q)',
    tests: t(MOCK),
  },
];
