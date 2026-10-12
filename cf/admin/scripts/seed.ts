// Fills the LOCAL D1 database (the one `wrangler dev` and
// `wrangler d1 migrations apply --local` use, under .wrangler/state) with dummy
// rows for every table.
//
//   pnpm db:migrate:local     # once, and after a new migration
//   pnpm db:seed:local        # wipes the local tables, then inserts the sample data
//
// Local only, by construction: it opens the database through wrangler's
// local platform proxy with remote bindings switched off, so it cannot reach a
// Cloudflare account. It needs no login and no token. The data is in
// scripts/seed-data.ts.
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { DEV_PASSWORD, SEED_USERS, seed } from "./seed-data";

const persistTo = process.argv.includes("--persist-to") ? process.argv[process.argv.indexOf("--persist-to") + 1] : undefined;

// Same meaning as `wrangler d1 ... --persist-to`: wrangler keeps D1 under <dir>/v3, getPlatformProxy wants that path itself.
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: "wrangler.jsonc",
  persist: persistTo ? { path: join(persistTo, "v3") } : true,
  remoteBindings: false,
});

try {
  const { counts, password } = await seed(proxy.env.DB);
  console.log("Seeded the local database:");
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table.padEnd(22)} ${count}`);
  console.log("\nAccounts (all share one password):");
  for (const u of SEED_USERS) {
    const areas = u.role === "editor" ? (u.areas.length > 0 ? `areas: ${u.areas.join(", ")}` : "areas: none") : "";
    console.log(`  ${u.role.padEnd(12)} ${u.email.padEnd(36)} ${areas}${u.emailVerified ? "" : "  (email not verified)"}`);
  }
  console.log(
    password === DEV_PASSWORD
      ? "\nPassword: DEV_PASSWORD in scripts/seed-data.ts (a fake, local only). Set SEED_PASSWORD to use another."
      : "\nPassword: the value of SEED_PASSWORD.",
  );
} finally {
  await proxy.dispose();
}
