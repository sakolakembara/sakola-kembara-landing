import { describe, expect, test } from "vitest";
import { applicationStatus } from "@/lib/db/schema/student-applications";
import { AUDIT_LABEL, auditHref, KNOWN_RESOURCE_TYPES, RESOURCE_TYPE_LABEL } from "@/lib/audit-labels";

describe("audit labels", () => {
  test("every application status change has a label", () => {
    for (const status of applicationStatus) {
      expect(AUDIT_LABEL[`application.${status}`]).toBeTruthy();
    }
    expect(AUDIT_LABEL["application.revoke"]).toBe("Penerimaan dicabut");
  });

  test("every resource type in the filter has a label", () => {
    for (const type of KNOWN_RESOURCE_TYPES) {
      expect(RESOURCE_TYPE_LABEL[type]).toBeTruthy();
    }
  });

  test("labels the actions that used to show as raw codes", () => {
    expect(AUDIT_LABEL["contact_message.read"]).toBe("Pesan dibaca");
    expect(AUDIT_LABEL["batch.publish_results"]).toBe("Hasil batch dipublikasikan");
    expect(AUDIT_LABEL["student.register"]).toBe("Akun siswa dibuat");
  });
});

describe("auditHref", () => {
  test("links batches and applications to their admin pages", () => {
    expect(auditHref("batch.update", "batch", "b1")).toBe("/admin/batches/b1");
    expect(auditHref("application.accepted", "application", "a1")).toBe("/admin/applications/a1");
  });

  test("has no link for deleted rows, rows without an id, or student accounts", () => {
    expect(auditHref("blog.delete", "blog", "x")).toBeNull();
    expect(auditHref("batch.update", "batch", null)).toBeNull();
    expect(auditHref("student.register", "user", "u1")).toBeNull();
  });
});
