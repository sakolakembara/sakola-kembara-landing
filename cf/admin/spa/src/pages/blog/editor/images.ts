import { submitUpload } from "~/lib/crud/upload-client";
import { altFromFileName } from "../rules";

/** A picture the editor was given (pasted, dropped, picked): uploaded as a blog image, then ready to be written into the text. */
export type PictureOutcome = { ok: true; path: string; alt: string } | { ok: false; message: string };

/** Checks a file with the Worker's own words, makes it smaller, uploads it, and answers the path to write and the alt text made from its name. */
export async function uploadPicture(file: File): Promise<PictureOutcome> {
  const outcome = await submitUpload({ kind: "blog-image", file });
  if (!outcome.ok) return { ok: false, message: outcome.message };
  return { ok: true, path: outcome.result.path, alt: altFromFileName(file.name) };
}
