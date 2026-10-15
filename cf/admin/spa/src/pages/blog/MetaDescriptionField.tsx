import type { ChangeEvent } from "react";
import { Field, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { cleanMetaDescription, LIMITS, META_DESCRIPTION_IDEAL } from "./rules";

// The "Deskripsi meta" field of the blog form (SAKEM-094): the text a search engine shows under the title. Optional;
// empty means the site uses the Excerpt. The Worker is the one that validates (plain text, at most
// `LIMITS.metaDescriptionMax` characters, docs/cloudflare/admin-blog.md); this only counts what the Worker would
// store and says, in words and not by colour alone, how that compares with what a result shows.

const HINT = "Tampil di bawah judul pada hasil pencarian. Kosongkan untuk memakai Excerpt.";

type Tone = "neutral" | "ok" | "warn" | "over";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-gray-500",
  ok: "text-success-fg",
  warn: "text-warning-fg",
  over: "text-danger-fg",
};

/**
 * What the counter says. `over` is only for a text the Worker will refuse: longer than the hard limit AND not the one
 * the article already has (the Worker lets a stored description stay as it is, whatever its length, so an imported one
 * of 560 characters is a reason to warn, not an error).
 */
export function describeCount(length: number, kept: boolean): { text: string; tone: Tone } {
  const count = length.toLocaleString("id-ID");
  const { min, max } = META_DESCRIPTION_IDEAL;
  if (length > LIMITS.metaDescriptionMax && !kept) return { text: `${count} karakter, melebihi maksimal ${LIMITS.metaDescriptionMax}`, tone: "over" };
  const guide = `${count} karakter (disarankan ${min}-${max}, maksimal ${LIMITS.metaDescriptionMax})`;
  if (length === 0) return { text: guide, tone: "neutral" };
  if (length > max) return { text: `${guide}. Bagian akhir bisa terpotong di hasil pencarian.`, tone: "warn" };
  if (length < min) return { text: guide, tone: "warn" };
  return { text: guide, tone: "ok" };
}

interface Props {
  /** `form.field("metaDescription")`: the id and name are the field's, so the error summary can link to it. */
  field: { id: string; name: string; value: string; onChange: (event: ChangeEvent<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>) => void };
  error?: string;
  /** The description the article had when it was loaded ("" for none): a text equal to it is never refused for its length. */
  stored: string;
}

export function MetaDescriptionField({ field, error, stored }: Props) {
  const cleaned = cleanMetaDescription(field.value);
  const { text, tone } = describeCount(cleaned.length, cleaned === stored);
  // `Field` describes the control by its hint (or its error); the counter is added to that, so it is read on focus.
  const countId = `${field.id}-count`;
  const describedBy = `${field.id}-${error ? "error" : "hint"} ${countId}`;
  return (
    <Field label="Deskripsi meta" id={field.id} error={error} hint={HINT}>
      <Textarea rows={3} {...field} aria-describedby={describedBy} />
      <div id={countId} className={cn("mt-1.5 text-xs", TONE_CLASS[tone])}>
        {text}
      </div>
    </Field>
  );
}
