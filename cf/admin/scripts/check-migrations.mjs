// Fails when the Drizzle schema (src/db/schema/*) and the SQL migrations
// (migrations/) disagree, i.e. someone changed the schema without running
// `pnpm db:generate`, or edited a migration by hand.
//
//   node scripts/check-migrations.mjs        (pnpm db:drift)
//
// It runs `drizzle-kit generate` against a COPY of migrations/ in a temp
// directory, so nothing in the repository is touched: "No schema changes"
// means no drift; anything else prints the SQL that is missing and fails.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const work = mkdtempSync(join(tmpdir(), "sakem-drift-"));
const out = join(work, "migrations");
// drizzle-kit prefixes "./" to the path it is given, so it has to be relative.
const outRelative = relative(process.cwd(), out);
const config = "drizzle.drift.config.ts";
try {
  cpSync("migrations", out, { recursive: true });
  writeFileSync(
    config,
    `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "sqlite", schema: "./src/db/schema.ts", out: ${JSON.stringify(outRelative)} });\n`,
  );
  const run = spawnSync("pnpm", ["exec", "drizzle-kit", "generate", "--config", config, "--name", "drift"], { encoding: "utf8" });
  const text = run.stdout + run.stderr;
  if (run.status === 0 && text.includes("No schema changes")) {
    console.log("OK    schema and migrations agree (nothing to migrate)");
  } else {
    const created = readdirSync(out).filter((f) => f.endsWith("_drift.sql"));
    console.log("FAIL  schema and migrations disagree. Run `pnpm db:generate` and commit the result.");
    for (const file of created) console.log(`\n${readFileSync(join(out, file), "utf8")}`);
    if (created.length === 0) console.log(text);
    process.exitCode = 1;
  }
} finally {
  rmSync(config, { force: true });
  rmSync(work, { recursive: true, force: true });
}
