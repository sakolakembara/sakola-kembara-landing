import type { Context } from "hono";
import type { Refusal } from "./refusal";

/** A refusal in the one error shape of the API: `{ error, message?, ...extra }`. Never a name, an id of someone else's row or a value the client sent. */
export function refusalResponse(c: Context, refusal: Refusal): Response {
  const body = { error: refusal.error, ...(refusal.message ? { message: refusal.message } : {}), ...refusal.extra };
  // The routes' statuses are a small closed set (src/private-files/refusal.ts).
  return c.json(body, refusal.status);
}
