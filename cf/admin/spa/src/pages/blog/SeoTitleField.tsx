import { Field, Input } from "~/components/ui/field";
import { cn } from "@/lib/cn";
import type { FieldBinding } from "./MetaDescriptionField";
import { cleanSeoTitle, LIMITS, SEO_TITLE_IDEAL } from "./rules";

// The "Judul SEO" field of the blog form (SAKEM-109): the title a search result and a shared link show, used as written
// (the site adds no suffix). Optional; empty means the page keeps "Judul - Yayasan Sakola Kembara Indonesia". The Worker
// validates (plain text, at most `LIMITS.seoTitleMax` characters, docs/cloudflare/admin-blog.md); this only counts what the
// Worker would store and says, in words and not by colour alone, how that compares with what a result shows.

const HINT = "Judul yang tampil di hasil pencarian dan saat dibagikan, dipakai apa adanya. Kosongkan untuk memakai Judul.";

type Tone = "neutral" | "ok" | "warn" | "over";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-gray-500",
  ok: "text-success-fg",
  warn: "text-warning-fg",
  over: "text-danger-fg",
};

/** What the counter says. `over` is a text the Worker will refuse: longer than the hard limit (there is no stored exception). */
export function describeSeoTitleCount(length: number): { text: string; tone: Tone } {
  const count = length.toLocaleString("id-ID");
  const { min, max } = SEO_TITLE_IDEAL;
  if (length > LIMITS.seoTitleMax) return { text: `${count} karakter, melebihi maksimal ${LIMITS.seoTitleMax}`, tone: "over" };
  const guide = `${count} karakter (disarankan ${min}-${max}, maksimal ${LIMITS.seoTitleMax})`;
  if (length === 0) return { text: guide, tone: "neutral" };
  if (length > max) return { text: `${guide}. Bagian akhir bisa terpotong di hasil pencarian.`, tone: "warn" };
  if (length < min) return { text: guide, tone: "warn" };
  return { text: guide, tone: "ok" };
}

interface Props {
  /** `form.field("seoTitle")`. */
  field: FieldBinding;
  error?: string;
}

export function SeoTitleField({ field, error }: Props) {
  const { text, tone } = describeSeoTitleCount(cleanSeoTitle(field.value).length);
  const countId = `${field.id}-count`;
  const describedBy = `${field.id}-${error ? "error" : "hint"} ${countId}`;
  return (
    <Field label="Judul SEO" id={field.id} error={error} hint={HINT}>
      <Input type="text" {...field} aria-describedby={describedBy} />
      <div id={countId} className={cn("mt-1.5 text-xs", TONE_CLASS[tone])}>
        {text}
      </div>
    </Field>
  );
}
