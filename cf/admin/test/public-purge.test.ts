import { afterEach, describe, expect, test, vi } from "vitest";
import { articleTag } from "../src/public/cache";
import { createContentChangeNotifier, notifyContentChanged, planPurge, STALENESS_SECONDS, ttlOnlyPurger, type ContentChange, type ContentPurger, type PurgePlan } from "../src/public/purge";
import fixtureSource from "../../web/scripts/fixture-api.mjs?raw";
import { addAnnouncement, addPost, addReport, addResource, addTeam, internalFetch } from "./public-helpers";

// "Content changed": which public URLs and cache tags an admin save makes
// stale, and the hook that hands them to a purger. No Cloudflare API is
// called anywhere in these tests: the default purger does nothing, and the
// others here are recorders.

afterEach(() => vi.restoreAllMocks());

function recorder(): ContentPurger & { plans: PurgePlan[] } {
  const plans: PurgePlan[] = [];
  return {
    name: "recorder",
    plans,
    async purge(plan) {
      plans.push(plan);
    },
  };
}

describe("what a change makes stale", () => {
  test.each([
    [{ area: "team" }, { paths: ["/api/public/team"], tags: ["team"] }],
    [{ area: "reports" }, { paths: ["/api/public/reports"], tags: ["reports"] }],
    [{ area: "resources" }, { paths: ["/api/public/resources"], tags: ["resources"] }],
    [{ area: "announcement" }, { paths: ["/api/public/announcements/current"], tags: ["announcement"] }],
    [{ area: "blog" }, { paths: ["/api/public/blog", "/api/public/blog?page=1"], tags: ["blog"] }],
  ] as [ContentChange, PurgePlan][])("%j", (change, expected) => {
    expect(planPurge(change)).toEqual(expected);
  });

  test("a saved article also names its own URL and tag", () => {
    expect(planPurge({ area: "blog", slug: "contoh-artikel" })).toEqual({
      paths: ["/api/public/blog", "/api/public/blog?page=1", "/api/public/blog/contoh-artikel"],
      tags: ["blog", "blog-contoh-artikel"],
    });
  });

  test("every index page that exists is named, within a sane bound", () => {
    expect(planPurge({ area: "blog", listPages: 3 }).paths).toEqual(["/api/public/blog", "/api/public/blog?page=1", "/api/public/blog?page=2", "/api/public/blog?page=3"]);
    expect(planPurge({ area: "blog", listPages: 0 }).paths).toHaveLength(2);
    expect(planPurge({ area: "blog", listPages: 10_000 }).paths).toHaveLength(2 + 99);
  });

  test("the paths are the ones the consumer's fixture server serves (cf/web builds its cache key as `${CONTENT_API_URL}${path}`)", () => {
    for (const area of ["team", "reports", "resources"] as const) {
      const [path] = planPurge({ area }).paths;
      expect(fixtureSource, `${path} in cf/web/scripts/fixture-api.mjs`).toContain(`'${path}'`);
    }
  });

  test("every path and tag the plan names exists: the URL answers 200 and the response carries the tag", async () => {
    await addTeam();
    await addReport();
    await addResource();
    await addAnnouncement();
    await addPost({ slug: "contoh-artikel", featured: true });
    const changes: ContentChange[] = [{ area: "team" }, { area: "reports" }, { area: "resources" }, { area: "announcement" }, { area: "blog", slug: "contoh-artikel", listPages: 1 }];
    for (const change of changes) {
      const plan = planPurge(change);
      const tagsSeen = new Set<string>();
      for (const path of plan.paths) {
        const res = await internalFetch(path);
        expect(res.status, path).toBe(200);
        for (const tag of (res.headers.get("cache-tag") ?? "").split(",")) tagsSeen.add(tag.trim());
      }
      // Every tag of the plan is on at least one response it purges, so a tag purge reaches them.
      for (const tag of plan.tags) expect(tagsSeen, `${tag} for ${JSON.stringify(change)}`).toContain(tag);
    }
  });

  test("an article's response carries its own tag and the list's", async () => {
    await addPost({ slug: "satu" });
    expect((await internalFetch("/api/public/blog/satu")).headers.get("cache-tag")).toBe(`${articleTag("satu")},blog`);
  });

  test("states the bound of the TTL-only option", () => {
    expect(STALENESS_SECONDS).toEqual({ typical: 60, worstCase: 360 });
  });
});

describe("the hook", () => {
  test("hands the plan to the purger after the save, through waitUntil", async () => {
    const purger = recorder();
    const pending: Promise<unknown>[] = [];
    const notify = createContentChangeNotifier(() => purger);

    const plan = notify({ area: "reports" }, (p) => pending.push(p));
    expect(plan).toEqual({ paths: ["/api/public/reports"], tags: ["reports"] });
    // It is not run inline: the caller's response does not wait for it.
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(purger.plans).toEqual([plan]);
  });

  test("a purger that fails never fails or delays the save, and the log has no URL", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: ContentPurger = {
      name: "failing",
      async purge() {
        throw new TypeError("could not reach https://api.example.test/zones/secret-zone-id/purge_cache");
      },
    };
    const pending: Promise<unknown>[] = [];
    const notify = createContentChangeNotifier(() => failing);
    expect(() => notify({ area: "team" }, (p) => pending.push(p))).not.toThrow();
    await expect(Promise.all(pending)).resolves.toBeDefined();
    const logged = spy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain("[purge] failing failed (TypeError)");
    expect(logged).not.toContain("secret-zone-id");
    expect(logged).not.toContain("api.example.test");
  });

  test("a purger that throws synchronously is contained too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throwing: ContentPurger = {
      name: "throwing",
      purge() {
        throw new Error("boom");
      },
    };
    const pending: Promise<unknown>[] = [];
    createContentChangeNotifier(() => throwing)({ area: "team" }, (p) => pending.push(p));
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });

  test("the default purger waits for the TTL: it calls nothing, not even fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("no outbound request is allowed here");
    });
    expect(ttlOnlyPurger.name).toBe("ttl-only");
    const pending: Promise<unknown>[] = [];
    notifyContentChanged({ area: "blog", slug: "x", listPages: 2 }, (p) => pending.push(p));
    await Promise.all(pending);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
