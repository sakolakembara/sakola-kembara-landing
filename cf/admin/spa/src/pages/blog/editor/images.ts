import { uploadFile } from "~/lib/crud/upload-client";
import { checkUploadFile } from "~/lib/crud/upload-kinds";
import { altFromFileName } from "../rules";

/** A picture the editor was given (pasted, dropped, picked): uploaded as a blog image, then ready to be written into the text. */
export type PictureOutcome = { ok: true; path: string; alt: string } | { ok: false; message: string };

const IMAGE_TYPE = /^image\//;

/** The pictures among some files (a paste or a drop can carry other things; those are the browser's business). */
export const picturesIn = (files: Iterable<File> | ArrayLike<File> | null | undefined): File[] => Array.from(files ?? []).filter((file) => IMAGE_TYPE.test(file.type));

/** Checks a file with the Worker's own words, uploads it, and answers the path to write and the alt text made from its name. */
export async function uploadPicture(file: File): Promise<PictureOutcome> {
  const problem = checkUploadFile(file, "blog-image");
  if (problem) return { ok: false, message: problem };
  const outcome = await uploadFile({ kind: "blog-image", file });
  if (!outcome.ok) return { ok: false, message: outcome.message };
  return { ok: true, path: outcome.result.path, alt: altFromFileName(file.name) };
}
