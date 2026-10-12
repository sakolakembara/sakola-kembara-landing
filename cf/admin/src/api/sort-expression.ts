import type { SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * A SQL expression where the CRUD kit's sort whitelist asks for a column.
 *
 * The kit sorts by one column and then by `id` (docs/cloudflare/admin-crud.md#3). Two lists of this area must
 * come out in the order the PUBLIC page shows them, which is more than one column (the team: category, then the
 * manual order, then creation; the reports: year, then upload time), and the legacy admin lists were in that
 * order. One expression that sorts the same way does it without touching the kit. `asc()` and `desc()` take an
 * expression as readily as a column, which is all the kit does with the value; the cast only satisfies its type.
 * If the kit ever widens the whitelist's type to `AnySQLiteColumn | SQL`, this file goes away.
 *
 * The expressions are text sorts of fixed-width pieces, over a table that stays small (a few dozen rows), so
 * the plan is a scan and a sort, which is fine at that size (see "D1 budget" in docs/cloudflare/admin-konten.md).
 */
export function asSortKey(expression: SQL): AnySQLiteColumn {
  return expression as unknown as AnySQLiteColumn;
}
