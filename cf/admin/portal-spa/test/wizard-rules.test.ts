import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// What the wizard's SOURCE must never do, read from the files (the runtime tests prove what it does; this proves what it
// cannot): the privacy of a child's application and the weight of the first load. A new file under `src/lib/wizard` or
// `src/pages/daftar` is held to the same rules without being listed here.

const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.resolve(here, "../src");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

const wizard = [...walk(path.join(src, "lib/wizard")), ...walk(path.join(src, "pages/daftar"))];
const rel = (file: string) => path.relative(src, file);
const code = (file: string) =>
  readFileSync(file, "utf8")
    // Comments say what a rule is; only code can break it.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the wizard's source", () => {
  test("there are files to read", () => {
    expect(wizard.length).toBeGreaterThan(20);
    expect(wizard.map(rel)).toEqual(expect.arrayContaining(["lib/wizard/use-wizard.ts", "lib/wizard/persist.ts", "pages/daftar/Wizard.tsx", "pages/daftar/steps/Documents.tsx"]));
  });

  test.each([
    ["console", /\bconsole\s*\./],
    ["a debugger statement", /\bdebugger\b/],
    ["session storage", /sessionStorage/],
    ["a cookie", /document\.cookie/],
    ["IndexedDB", /indexedDB/],
    ["a beacon or an analytics call", /sendBeacon|gtag\(|posthog|Sentry|analytics|dataLayer/],
    ["a request that does not go through the API seam", /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource/],
  ])("never uses %s", (_name, pattern) => {
    for (const file of wizard) expect(code(file), rel(file)).not.toMatch(pattern);
  });

  test("never puts anything into an address: no query string, no location, no navigation with data", () => {
    for (const file of wizard) {
      expect(code(file), rel(file)).not.toMatch(/URLSearchParams|useSearchParams|window\.location|location\.(search|href|hash)|history\.(push|replace)State|useNavigate|navigate\s*\(|setSearchParams/);
    }
  });

  test("never reads a file's bytes: the file is the field's (FileSlotField), and goes straight to the Worker", () => {
    for (const file of wizard) {
      expect(code(file), rel(file)).not.toMatch(/FileReader|\.arrayBuffer\s*\(|\.stream\s*\(|readAsDataURL|readAsText|createObjectURL|\.slice\(\s*0\s*,\s*\d+\s*\)\s*\.text|new\s+Blob/);
    }
  });

  test("keeps the application in the browser in one file only, under the key the shared module makes", () => {
    for (const file of wizard) {
      const text = code(file);
      if (rel(file) === "lib/wizard/persist.ts") {
        expect(text).toMatch(/localStorage/);
        expect(text).toMatch(/localDraftKey\(/);
        expect(text).toMatch(/readLocalDraft\(/);
        expect(text).toMatch(/writeLocalDraft\(/);
      } else {
        expect(text, rel(file)).not.toMatch(/localStorage/);
      }
    }
  });

  test("keeps zod out of the wizard: the plain rules are enough, and the first load must not pay for a schema library", () => {
    for (const file of wizard) {
      expect(code(file), rel(file)).not.toMatch(/from\s+["']zod|application-form\/schemas/);
    }
  });

  test("calls the Worker only through `api()`, so the mock and the tests can stand in for it", () => {
    const callers = wizard.filter((file) => /from\s+["'](?:@shared\/spa\/api|(?:\.\.\/)+shared\/spa\/api)["']/.test(code(file))).map(rel);
    expect(callers).toEqual(["lib/wizard/api.ts", "lib/wizard/config.ts"]);
  });

  test("the wizard's page is the only part of it the first load imports, and it imports nothing but the lazy loader", () => {
    const app = readFileSync(path.join(src, "App.tsx"), "utf8");
    expect(app).toMatch(/import \{ DaftarRoute \} from "\.\/pages\/daftar\/DaftarRoute"/);
    expect(app).not.toMatch(/pages\/daftar\/(?!DaftarRoute)/);
    expect(app).not.toMatch(/lib\/wizard/);
    const route = code(path.join(src, "pages/daftar/DaftarRoute.tsx"));
    expect(route).toMatch(/lazy\(\(\) => importWithRetry\(\(\) => import\("\.\/DaftarPage"\)\)\)/);
    // The route file itself imports no other part of the wizard.
    expect(route.match(/^import .* from "[^"]+";$/gm)?.filter((line) => /\.\/|~\/lib\/wizard/.test(line) && !/LoadState/.test(line))).toEqual([]);
  });
});
