import { makeStatusMap } from "~/components/crud/StatusTag";
import { BLOG_CATEGORIES } from "./rules";

// What the blog screens share: the status tags and the category options. The types, the paths, the list's spec and
// the form's values are in form.ts (pure, so the Worker's contract test can import them); they are re-exported here.
export * from "./form";

export const STATUS = makeStatusMap({
  published: { label: "Terbit", tone: "green" },
  draft: { label: "Draf", tone: "gray" },
});

export const CATEGORY_OPTIONS = BLOG_CATEGORIES.map((value) => ({ value, label: value }));
