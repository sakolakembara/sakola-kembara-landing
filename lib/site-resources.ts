import "server-only";
import { asc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  resourceCategory,
  siteResources,
  type ResourceCategory,
  type SiteResource,
} from "@/lib/db/schema";
import { RESOURCE_CATEGORY_ORDER } from "@/lib/site-resources-config";

async function readAll(): Promise<SiteResource[]> {
  return db
    .select()
    .from(siteResources)
    .orderBy(
      asc(siteResources.category),
      asc(siteResources.displayOrder),
      asc(siteResources.createdAt),
    );
}

const getCached = unstable_cache(() => readAll(), ["site-resources-all"], {
  tags: ["site-resources"],
});

function hydrate(row: SiteResource): SiteResource {
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function getAllResources(): Promise<SiteResource[]> {
  const rows = await getCached();
  return rows.map(hydrate);
}

/** Grouped by category, in canonical UI order (empty categories omitted). */
export async function getResourcesByCategory(): Promise<
  { category: ResourceCategory; items: SiteResource[] }[]
> {
  const all = await getAllResources();
  const map = new Map<ResourceCategory, SiteResource[]>();
  for (const cat of resourceCategory) map.set(cat, []);
  for (const row of all) {
    const bucket = map.get(row.category);
    if (bucket) bucket.push(row);
  }
  return RESOURCE_CATEGORY_ORDER.filter(
    (cat) => (map.get(cat)?.length ?? 0) > 0,
  ).map((cat) => ({ category: cat, items: map.get(cat) ?? [] }));
}
