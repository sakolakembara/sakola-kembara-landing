import { AUDIT_LABEL } from "@/lib/audit-labels";
import { describe, expect, test } from "vitest";
import { DECLARED_ACTIONS, DECLARED_RESOURCE_TYPES } from "../../src/audit/lists";
import { ACTION_OPTIONS, activityHref, activityLabel, FILTER_ACTIONS, FILTER_RESOURCE_TYPES, NEW_ACTION_LABEL, NEW_RESOURCE_LABEL, RESOURCE_OPTIONS, resourceLabel } from "~/lib/audit";

// The words of the Aktivitas page (docs/cloudflare/admin-sistem.md). The Worker declares every action and resource
// type it can write (src/audit/lists.ts, checked against src/db/audit.ts by the compiler); this file is the other
// half: none of them may reach the page without a label, and the filters offer exactly those lists.

describe("every declared action has a label", () => {
  test.each(DECLARED_ACTIONS.map((action) => [action]))("%s", (action) => {
    const label = activityLabel(action);
    expect(label, `${action} has no label: add it to NEW_ACTION_LABEL in spa/src/lib/audit.ts`).not.toBe(action);
    expect(label.trim()).not.toBe("");
    expect(AUDIT_LABEL[action] ?? NEW_ACTION_LABEL[action]).toBe(label);
  });

  test("no two declared actions share a label (the select would offer two identical lines)", () => {
    const seen = new Map<string, string>();
    for (const action of DECLARED_ACTIONS) {
      const label = activityLabel(action);
      expect(seen.get(label), `${action} and ${seen.get(label)} are both "${label}"`).toBeUndefined();
      seen.set(label, action);
    }
  });

  test("a label of the new table is for a declared action the legacy table lacks: no dead word, no shadowed legacy one", () => {
    for (const action of Object.keys(NEW_ACTION_LABEL)) {
      expect((DECLARED_ACTIONS as readonly string[]).includes(action), `${action} is not declared`).toBe(true);
      expect(AUDIT_LABEL[action], `${action} already has its legacy label`).toBeUndefined();
    }
  });

  test("the legacy wording is used as it is", () => {
    expect(activityLabel("announcement.create")).toBe("Pengumuman dibuat");
    expect(activityLabel("application.revoke")).toBe("Penerimaan dicabut");
    expect(activityLabel("admin.create")).toBe("Admin ditambahkan");
    expect(activityLabel("user.password_reset")).toBe("Password diatur ulang");
  });

  test("what the new Worker added, in the legacy style", () => {
    expect(activityLabel("upload.create")).toBe("Berkas diunggah");
    expect(activityLabel("upload.delete")).toBe("Berkas unggahan dihapus");
    expect(activityLabel("admin.deactivate")).toBe("Admin dinonaktifkan");
    expect(activityLabel("admin.reactivate")).toBe("Admin diaktifkan kembali");
    expect(activityLabel("admin.invite_resend")).toBe("Undangan admin dikirim ulang");
  });

  test("a name that is not declared still reads: the legacy label if there is one, else as it is", () => {
    expect(activityLabel("admin.delete")).toBe("Admin dihapus");
    expect(activityLabel("report.upload")).toBe("File laporan diunggah (lama)");
    expect(activityLabel("something.new")).toBe("something.new");
  });
});

describe("every declared resource type has a label", () => {
  test.each(DECLARED_RESOURCE_TYPES.map((type) => [type]))("%s", (type) => {
    expect(resourceLabel(type), `${type} has no label`).not.toBe(type);
  });

  test("the new one, and the legacy names that older rows still hold", () => {
    expect(NEW_RESOURCE_LABEL.media).toBe("Berkas unggahan");
    expect(resourceLabel("media")).toBe("Berkas unggahan");
    expect(resourceLabel("blog_post")).toBe("Blog");
    expect(resourceLabel("student_application")).toBe("Pendaftar");
    expect(resourceLabel("mystery")).toBe("mystery");
  });
});

describe("the filters offer exactly what the Worker declares", () => {
  test("the SPA's action list is the Worker's, name for name", () => {
    expect([...FILTER_ACTIONS].sort()).toEqual([...DECLARED_ACTIONS].sort());
    expect(FILTER_ACTIONS).toHaveLength(new Set(FILTER_ACTIONS).size);
  });

  test("the SPA's resource type list is the Worker's, name for name", () => {
    expect([...FILTER_RESOURCE_TYPES].sort()).toEqual([...DECLARED_RESOURCE_TYPES].sort());
  });

  test("the options carry the labels, in the legacy order: the keys in order for the actions", () => {
    expect(ACTION_OPTIONS.map((option) => option.value)).toEqual([...DECLARED_ACTIONS].sort());
    expect(ACTION_OPTIONS.every((option) => option.label === activityLabel(option.value))).toBe(true);
    expect(RESOURCE_OPTIONS.map((option) => option.label)).toEqual(["Pendaftar", "Batch", "Pengumuman", "Laporan", "Blog", "Anggota tim", "Pesan", "Admin", "Akun", "Berkas Pendaftaran", "Shortlink", "Berkas unggahan", "Berkas pendaftar"]);
  });
});

describe("where a row links to", () => {
  test("an admin row opens that admin's edit form, as the legacy table did", () => {
    expect(activityHref("admin.update", "admin_user", "u1")).toBe("/settings/u1/edit");
  });
  test("an upload, a user and a deletion have nowhere to go", () => {
    // An applicant's file: the row names the file, which has no page of its own (the purge row names the application and does link).
    expect(activityHref("application_file.view", "application_file", "f1")).toBeNull();
    expect(activityHref("application_file.purge", "application", "a1")).toBe("/applications/a1");
    expect(activityHref("upload.create", "media", "m1")).toBeNull();
    expect(activityHref("user.password_reset", "user", "u1")).toBeNull();
    expect(activityHref("upload.delete", "media", "m1")).toBeNull();
  });
});
