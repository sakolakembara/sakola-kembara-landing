import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { API_PATH } from "~/pages/blog/form";
import { meBody, renderApp, respond, stubApi } from "./helpers";
import { takeConsoleProblems } from "./setup";

// When the editor's file cannot be loaded (offline, a deploy replaced it, a bug in it), a plain box takes its place:
// the text is Markdown, so the person can still write and save, and nothing is lost. The editor is a separate file that
// BodyEditor loads when it is first shown, so this is a case that really happens (the SPA's other files load with the
// page, this one later). Here the file fails as it would on a broken connection.

vi.mock("~/pages/blog/editor/RichEditor", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("the editor could not be loaded", () => {
  test("a plain box says so, takes the Markdown, and what is written in it is saved as it would have been", async () => {
    const user = userEvent.setup();
    const api = stubApi({
      "GET /api/me": respond(meBody("editor", ["konten"])),
      [`POST ${API_PATH}`]: respond({ item: { id: "new-id", updatedAt: "2026-10-31T00:00:00.000Z" } }, 201),
    });
    renderApp("/blog/new");
    expect(await screen.findByText(/Editor belum bisa dimuat/)).toBeTruthy();
    expect(takeConsoleProblems().length).toBeGreaterThan(0); // React reports the failure it caught, as it should
    const box = screen.getByLabelText("Isi Artikel") as HTMLTextAreaElement;
    expect(box.tagName).toBe("TEXTAREA");

    await user.type(screen.getByLabelText("Judul"), "Cara Belajar");
    await user.type(screen.getByLabelText(/^Excerpt/), "Ringkasan tentang cara belajar yang efektif.");
    await user.click(box);
    await user.paste("## Mulai\n\nIsi artikel yang cukup panjang untuk lolos batas lima puluh karakter.");
    await user.click(screen.getByRole("button", { name: "Buat Artikel" }));
    await waitFor(() => expect(api.count(`POST ${API_PATH}`)).toBe(1));
    expect(api.last(`POST ${API_PATH}`)?.body).toMatchObject({ contentMarkdown: "## Mulai\n\nIsi artikel yang cukup panjang untuk lolos batas lima puluh karakter." });
  });

  test("the count and the preview still work: they do not depend on the editor", async () => {
    const user = userEvent.setup();
    stubApi({ "GET /api/me": respond(meBody("editor", ["konten"])), [`POST ${API_PATH}/preview`]: respond({ html: "<p>Pratinjau tetap ada.</p>" }) });
    renderApp("/blog/new");
    await screen.findByText(/Editor belum bisa dimuat/);
    takeConsoleProblems();
    await user.click(screen.getByLabelText("Isi Artikel"));
    await user.paste("Teks yang cukup untuk dihitung.");
    expect(screen.getByText(/31 karakter \(maksimal/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pratinjau" }));
    expect(await screen.findByText("Pratinjau tetap ada.")).toBeTruthy();
  });
});
