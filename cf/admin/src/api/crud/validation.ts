import type { Context } from "hono";
import { z } from "zod";
import { keyForPath, kindOfKey } from "../../uploads/key";
import type { UploadKind } from "../../uploads/kinds";
import { invalidJson, jsonRequired, tooLarge, validationError } from "./errors";

// Reading and checking a request body (docs/cloudflare/admin-crud.md#11-validation-zod-with-numbers).
// One order, so every resource answers the same thing to the same mistake:
//   415 not JSON  ->  413 too large  ->  400 invalid_json  ->  400 invalid (the schema)

/** Largest JSON body a resource accepts unless it asks for more. A `JSON.parse` of this costs about 1 to 2 ms of CPU. */
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/** The words zod uses when a rule has no message of ours: they must never reach the form in English. */
const ZOD_DEFAULT = /^(Invalid |Too small|Too big|Unrecognized|Input not)/;

export const FALLBACK_MESSAGES = {
  required: "Wajib diisi.",
  invalid: "Isian belum benar.",
} as const;

export interface FieldIssues {
  /** `{ name: message }`, the first message per field; a nested name is a dotted path. */
  fields: Record<string, string>;
  /** Problems that belong to the whole form (an issue with an empty path). */
  form?: string;
}

/** Turns zod's issues into the API's `fields`. Messages written in the schema pass through; zod's own English defaults become a generic Indonesian line. */
export function fieldsOf(error: z.ZodError): FieldIssues {
  const fields: Record<string, string> = {};
  let form: string | undefined;
  for (const issue of error.issues) {
    const name = issue.path.map(String).join(".");
    let message = issue.message;
    if (ZOD_DEFAULT.test(message)) {
      // `received undefined` is a missing field; anything else is a wrong value.
      message = issue.code === "invalid_type" && /received undefined/.test(message) ? FALLBACK_MESSAGES.required : FALLBACK_MESSAGES.invalid;
    }
    if (name === "") form ??= message;
    else if (!(name in fields)) fields[name] = message;
  }
  return form === undefined ? { fields } : { fields, form };
}

/**
 * The JSON body of a write, checked against `schema`. Returns the parsed value, or the Response to return
 * (415, 413, 400): `if (!body.ok) return body.response;`.
 *
 * The size is checked on the declared `Content-Length` first (a browser always sends it for a JSON string)
 * and again on the text, so a body without the header cannot slip through.
 */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S, options: { maxBytes?: number } = {}): Promise<ParsedBody<z.output<S>>> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return { ok: false, response: jsonRequired(c) };

  const declared = c.req.header("content-length");
  if (declared !== undefined && /^\d{1,15}$/.test(declared) && Number(declared) > maxBytes) return { ok: false, response: tooLarge(c, maxBytes) };

  const text = await c.req.text().catch(() => null);
  if (text === null) return { ok: false, response: invalidJson(c) };
  if (text.length > maxBytes) return { ok: false, response: tooLarge(c, maxBytes) };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: invalidJson(c) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const { fields, form } = fieldsOf(parsed.error);
    return { ok: false, response: validationError(c, fields, form) };
  }
  return { ok: true, data: parsed.data };
}

// -------------------------------------------------------------- upload paths

/** The static paths of files that predate the admin (the legacy `public/` folders). They keep working in a row. */
const LEGACY_STATIC_PATH = /^\/(?:blog\/images|files|images|reports|resources)\/[A-Za-z0-9._\-/]+$/;

/** True for a path a row may hold: an upload of one of `kinds`, or (unless `legacy` is false) a legacy static path. */
export function isAllowedFilePath(value: string, kinds: readonly UploadKind[], legacy = true): boolean {
  const key = keyForPath(value);
  if (key) {
    const kind = kindOfKey(key);
    return kind !== null && kinds.includes(kind);
  }
  return legacy && LEGACY_STATIC_PATH.test(value) && !value.includes("..");
}

/**
 * A schema for a field that holds a file path (docs/cloudflare/admin-crud.md#10-files-upload-references).
 * It checks the SHAPE and the kind folder (a team photo field cannot be pointed at a report), not that the
 * object exists: a dangling path shows a broken image, and the references registry
 * (src/uploads/references.ts) is what stops a file in use from being deleted.
 */
export function uploadPath(kinds: readonly UploadKind[], message = "Berkas tidak valid. Unggah ulang berkasnya.") {
  return z
    .string()
    .trim()
    .max(500, message)
    .refine((value) => isAllowedFilePath(value, kinds), { message });
}
