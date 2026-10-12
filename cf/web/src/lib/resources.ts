// Documents for /gabung-siswa/docs: the payload of GET ${CONTENT_API_URL}/api/public/resources
// (shape and order: docs/cloudflare/content-api.md), the category constants ported from the root
// lib/site-resources-config.ts, and the grouping of the root lib/site-resources.ts.

import { externalHref, fileHref, isRecord, listOf, loadContent, str, type ContentCallOptions, type ContentSource } from './content-api';

export const RESOURCE_CATEGORY_ORDER = ['panduan', 'berkas-pendaftaran', 'berkas-marketing', 'tutorial', 'lainnya'] as const;
export type ResourceCategory = (typeof RESOURCE_CATEGORY_ORDER)[number];

export const RESOURCE_CATEGORY_LABEL: Record<ResourceCategory, string> = {
  panduan: 'Panduan Pendaftaran',
  'berkas-pendaftaran': 'Berkas Pendaftaran',
  'berkas-marketing': 'Berkas Marketing',
  tutorial: 'Tutorial',
  lainnya: 'Lainnya',
};

export const RESOURCE_CATEGORY_DESCRIPTION: Record<ResourceCategory, string> = {
  panduan: 'Panduan lengkap, poin-poin penting, dan alur pendaftaran Sakola Kembara.',
  'berkas-pendaftaran':
    'Template surat izin, surat penghasilan, SKTM, dan berkas lain yang perlu diunggah calon siswa.',
  'berkas-marketing':
    'Poster, twibbon, caption Instagram, dan bahan promosi lain yang wajib dibagikan calon siswa.',
  tutorial:
    'Video atau artikel pendek untuk membantu calon siswa menyiapkan berkas (mis. token listrik PLN).',
  lainnya: 'Dokumen tambahan yang tidak masuk kategori di atas.',
};

export const RESOURCE_CONTENT_TYPES = ['file', 'url', 'text'] as const;
export type ResourceContentType = (typeof RESOURCE_CONTENT_TYPES)[number];

/**
 * One document as the API returns it. Exactly one of `filePath`, `externalUrl` and `bodyText` is
 * meant to be set, matching `contentType`; the card shows the action of its own type only, and
 * none when that field is missing or unusable (same as the legacy page).
 */
export interface Resource {
  id: string;
  title: string;
  description: string | null;
  category: ResourceCategory;
  contentType: ResourceContentType;
  /** Root-relative path (or an absolute http(s) URL), used as the link target as it is. */
  filePath: string | null;
  /** Bytes. */
  fileSize: number | null;
  externalUrl: string | null;
  bodyText: string | null;
}

export const RESOURCES_PATH = '/api/public/resources';

/**
 * Turn an API payload into resources. Tolerant by design: an entry with no id, title, known
 * category or known content type is dropped; a file path or link that is not a safe URL is
 * nulled (the card then has no action), never rendered. Null when the payload is not a list.
 */
export function parseResourcesPayload(payload: unknown): Resource[] | null {
  const list = listOf(payload, 'resources');
  if (!list) return null;

  const resources: Resource[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const title = str(raw.title);
    const category = (RESOURCE_CATEGORY_ORDER as readonly string[]).includes(String(raw.category))
      ? (raw.category as ResourceCategory)
      : null;
    const contentType = (RESOURCE_CONTENT_TYPES as readonly string[]).includes(String(raw.contentType))
      ? (raw.contentType as ResourceContentType)
      : null;
    if (!id || !title || !category || !contentType) continue;
    const size = raw.fileSize;
    resources.push({
      id,
      title,
      description: str(raw.description),
      category,
      contentType,
      filePath: fileHref(raw.filePath),
      fileSize: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null,
      externalUrl: externalHref(raw.externalUrl),
      bodyText: str(raw.bodyText),
    });
  }
  return resources;
}

/**
 * Group by category in the canonical order (empty categories omitted, an unknown category was
 * already dropped by the parser). The order inside a category is the payload's, i.e. the
 * admin's manual order.
 */
export function groupResourcesByCategory(resources: Resource[]): { category: ResourceCategory; items: Resource[] }[] {
  const byCategory = new Map<ResourceCategory, Resource[]>(RESOURCE_CATEGORY_ORDER.map((c) => [c, []]));
  for (const r of resources) byCategory.get(r.category)?.push(r);
  return RESOURCE_CATEGORY_ORDER.filter((c) => byCategory.get(c)!.length > 0).map((category) => ({
    category,
    items: byCategory.get(category)!,
  }));
}

export interface ResourcesResult {
  /** Null: the API is down and nothing is cached (the page shows its degraded state). */
  resources: Resource[] | null;
  source: ContentSource;
}

export async function loadResources(opts: ContentCallOptions<Resource[]>): Promise<ResourcesResult> {
  const { data, source } = await loadContent<Resource[]>({ ...opts, path: RESOURCES_PATH, parse: parseResourcesPayload });
  return { resources: data, source };
}
