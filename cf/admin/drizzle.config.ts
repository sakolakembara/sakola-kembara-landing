import { defineConfig } from "drizzle-kit";

// Generates SQL migrations for D1. Apply them with wrangler, not drizzle-kit:
//   pnpm db:migrate:local
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
