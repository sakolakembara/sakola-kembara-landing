// The size gate of the portal Worker (docs/cloudflare/portal-architecture.md, 4.2): bundles it the way a deploy would
// (`wrangler deploy --dry-run -c wrangler.portal.jsonc`, nothing is uploaded, no account is used) and fails when the
// script is over its gzip budget, or over the 3 MiB compressed limit of the Free plan.
//
//   node scripts/check-portal-worker-size.mjs        (pnpm check:portal-worker)
//
// The design hoped for 350 KiB gzip. The build measured 490.78 KiB at P1a, and that is the FLOOR of this stack, not the
// portal's own code: better-auth (with kysely and zod, which it brings) is most of it, and the admin Worker, which
// also carries the blog and the public API, is 641 KiB. So the budget is the measured size plus about 10%: a file of
// the portal's own cannot add much, but an import of the blog's markdown libraries, or of the admin's code, would be
// noticed here (and by test/portal-foundation-config.test.ts, which names those imports).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUDGET_GZIP_KIB = 540;
const CEILING_GZIP_KIB = 3 * 1024;

// Wrangler refuses a config whose assets directory is missing. The SPA build normally fills it; the size of the script
// does not depend on it, so a stub stands in when there is no build, and is removed again.
const assets = "dist/portal-spa";
const stubbed = !existsSync(assets);
if (stubbed) {
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, "index.html"), "<!doctype html><title>portal spa stub for the size check</title>");
}
const out = mkdtempSync(join(tmpdir(), "sakem-portal-size-"));
try {
  const run = spawnSync("pnpm", ["exec", "wrangler", "deploy", "--dry-run", "-c", "wrangler.portal.jsonc", "--outdir", out], {
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
  });
  const text = run.stdout + run.stderr;
  const match = text.match(/Total Upload:\s*([\d.]+) KiB \/ gzip:\s*([\d.]+) KiB/);
  if (run.status !== 0 || !match) {
    console.log("FAIL  the dry run did not give a size (is wrangler.portal.jsonc valid?)");
    console.log(text);
    process.exitCode = 1;
  } else {
    const raw = Number(match[1]);
    const gzip = Number(match[2]);
    const verdict = gzip > CEILING_GZIP_KIB ? "over the 3 MiB limit of the Free plan" : gzip > BUDGET_GZIP_KIB ? `over the budget of ${BUDGET_GZIP_KIB} KiB` : null;
    console.log(`${verdict ? "FAIL" : "OK  "}  portal Worker ${raw.toFixed(2)} KiB, gzip ${gzip.toFixed(2)} KiB (budget ${BUDGET_GZIP_KIB}, limit ${CEILING_GZIP_KIB})${verdict ? `: ${verdict}` : ""}`);
    if (verdict) process.exitCode = 1;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
  if (stubbed) rmSync(assets, { recursive: true, force: true });
}
