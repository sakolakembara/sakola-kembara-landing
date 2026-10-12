import { getResourcesByCategory } from "@/lib/site-resources";
import { CACHE_CONTENT, publicJson } from "@/lib/public-api/http";
import { toPublicResource } from "@/lib/public-api/serializers";
import type { ResourcesResponse } from "@/lib/public-api/types";

// Runtime-only; see the note in ../team/route.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  // Flattened in the page's order: categories as /gabung-siswa/docs lists
  // them, then the admin's manual order inside each category.
  const groups = await getResourcesByCategory();
  return publicJson<ResourcesResponse>(
    { resources: groups.flatMap((g) => g.items).map(toPublicResource) },
    CACHE_CONTENT,
  );
}
