import designMd from "../DESIGN.md?raw";

const REPO = "https://github.com/sakolakembara/sakola-kembara-landing/blob/development";

/**
 * One section of DESIGN.md as markdown, for a Foundations page: the text under
 * `heading` (e.g. "## 7. Imagery & logo" or "### Icons") up to the next
 * heading of the same or a higher level, without the heading itself. With
 * `from`, it starts at that line instead (e.g. "**Rules**"). Relative links
 * point at the repo on GitHub, so they work inside Storybook.
 */
export function designSection(heading: string, from?: string): string {
  const lines = designMd.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return `*Section "${heading}" not found in DESIGN.md.*`;
  const level = heading.match(/^#+/)?.[0].length ?? 2;
  const end = lines.findIndex(
    (line, i) => i > start && (line === "---" || (/^#+ /.test(line) && line.match(/^#+/)![0].length <= level)),
  );
  let body = lines.slice(start + 1, end === -1 ? undefined : end);
  if (from) {
    const at = body.findIndex((line) => line.startsWith(from));
    if (at !== -1) body = body.slice(at);
  }
  return body
    .join("\n")
    .trim()
    .replace(/\]\(#([^)]+)\)/g, `](${REPO}/DESIGN.md#$1)`)
    .replace(/\]\((?!https?:|mailto:)([^)]+)\)/g, `](${REPO}/$1)`);
}
