// Port of the root lib/seo.ts (Next metadata API) to plain data the Astro
// layout renders as <head> tags. Same site identity, same JSON-LD values.
// Values that Next derives from `metadataBase` (relative -> absolute
// URLs) are made absolute here with `absoluteUrl()`.
//
// Source of truth for the identity stays the root file while the legacy app
// lives; the tests in tests/seo.test.ts pin the values that must not drift.
//
// Where this file departs from the root on purpose (SAKEM-090, the SEO parity
// run against the live WordPress site on 2026-10-13: the target is what Google
// already knows, not what the Next app would have said):
//   - the title suffix and the home title follow the live pages;
//   - the document language is `id-ID` (and og:locale `id_ID`);
//   - every indexable page carries ONE JSON-LD @graph shaped like the live
//     site's (Organization, WebSite, WebPage, BreadcrumbList; BlogPosting and
//     Person for an article), built here and nowhere else;
//   - an article is og:type "article" with its publication times.
// docs/cloudflare/seo-audit.md ("Parity fixes of 2026-10-13") has the numbers.

export const SITE_URL = 'https://sakolakembara.org';
export const SITE_NAME = 'Sakola Kembara';

export const LEGAL_NAME = 'Yayasan Sakola Kembara Indonesia';
export const SITE_TAGLINE = 'Pendidikan Untuk Semua';

/**
 * How every page title reads in the browser tab: "<page> - Yayasan Sakola Kembara Indonesia".
 * That is the live WordPress pattern (hyphen, legal name) for every page and for 33 of its 86 articles; the other 53
 * articles have no suffix there (an SEO-plugin setting per post), which the parity tool reports as info.
 */
export const TITLE_TEMPLATE = `%s - ${LEGAL_NAME}`;

/** The language of the documents: <html lang>, JSON-LD `inLanguage`. The live site says "en-US" on Indonesian text. */
export const SITE_LANGUAGE = 'id-ID';
/** Open Graph's spelling of the same locale. */
export const OG_LOCALE = 'id_ID';

export const ORG_LOGO = `${SITE_URL}/images/logo-sakola-kembara.png`;
// 1200x630 share image for pages without their own (blog posts pass their cover).
export const DEFAULT_OG_IMAGE = '/og-default.jpg';

export const SOCIAL_URLS = [
  'https://instagram.com/sakolakembara',
  'https://tiktok.com/@sakolakembara',
  'https://twitter.com/sakolakembara',
  'https://youtube.com/@sakolakembara',
];

// From the root app/layout.tsx; the title with the live site's comma ("Sakola Kembara, Pendidikan Untuk Semua").
export const DEFAULT_TITLE = 'Sakola Kembara, Pendidikan Untuk Semua';
export const DEFAULT_DESCRIPTION =
  'Membuka pintu pendidikan tinggi untuk setiap anak Indonesia. Program bimbingan belajar gratis dan pendampingan intensif untuk siswa dari daerah terpencil dan keluarga kurang mampu.';
const HOME_OG_DESCRIPTION =
  'Membuka pintu pendidikan tinggi untuk setiap anak Indonesia melalui program bimbingan belajar gratis.';
const HOME_TWITTER_DESCRIPTION = 'Membuka pintu pendidikan tinggi untuk setiap anak Indonesia.';
export const KEYWORDS = [
  'Sakola Kembara',
  'Yayasan Sakola Kembara',
  'pendidikan',
  'beasiswa',
  'bimbel gratis',
  'UTBK',
  'PTN',
  'perguruan tinggi',
  'pemerataan pendidikan',
  'Indonesia',
  'nonprofit',
];
export const THEME_COLOR = '#122E76';

/** A page title with the site suffix ("Tim Kami - Yayasan Sakola Kembara Indonesia"). */
export function pageTitle(title: string): string {
  // A function, so that a `$&` or `$1` inside a title is text and not a replacement pattern.
  return TITLE_TEMPLATE.replace('%s', () => title);
}

/** Relative path (or URL) -> absolute URL on the canonical host. */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/**
 * Serialize a JSON-LD payload for safe embedding inside a <script> tag.
 * Escapes `<` (so a string containing "</script>" cannot close the tag) and
 * U+2028 / U+2029. Same function as the root lib/seo.ts.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

export interface SeoImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface SeoData {
  /** Final <title> text. */
  title: string;
  description: string;
  /** Absolute canonical URL, or null (404 pages have none). */
  canonical: string | null;
  /** Value of <meta name="robots"> and <meta name="googlebot">. */
  robots: string;
  googlebot: string | null;
  og: {
    title: string;
    description: string;
    url: string | null;
    siteName: string;
    locale: string;
    type: string;
    image: SeoImage;
    /** Only on an article: og:type is "article" and these become article:published_time, article:modified_time, article:section. */
    article?: { published: string; modified: string; section?: string };
  };
  twitter: { card: string; title: string; description: string; image: string };
}

export const ROBOTS_INDEX = 'index, follow';
export const GOOGLEBOT_INDEX =
  'index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1';

/** One step of a breadcrumb trail: its name and its path ("/blog"). */
export interface Crumb {
  name: string;
  path: string;
}

/** What an article page knows about its article, beyond the title, description, path and cover every page has. */
export interface ArticleSeo {
  /** Publication day, "2026-05-21". Only a day is stored, so only a day is written: no time of day is invented. */
  dateISO: string;
  /** Last edit, a day; defaults to the publication day. */
  modifiedISO?: string;
  author?: string;
  category?: string;
  /** Size of the cover file, when known (both or neither). */
  imageWidth?: number | null;
  imageHeight?: number | null;
}

export type SeoInput =
  | { kind: 'home' }
  | {
      kind: 'page';
      /** Page title WITHOUT the site suffix; the template is applied. */
      title: string;
      description: string;
      /** Canonical path, e.g. "/blog/<slug>". */
      path: string;
      /** Cover image (path or URL); defaults to the share image. */
      ogImage?: string;
      /** An article: og:type "article" and a BlogPosting in the JSON-LD graph. */
      article?: ArticleSeo;
      /** The trail for BreadcrumbList; default: Beranda, then this page. */
      crumbs?: readonly Crumb[];
      /** schema.org type of the page node; default WebPage (the blog index is a CollectionPage, like the live archives). */
      pageType?: 'WebPage' | 'CollectionPage';
    }
  | {
      kind: 'notfound';
      /** Title WITHOUT the site suffix, for a 404 page that says something more specific than the default (`/daftar` without a shortlink). */
      title?: string;
    };

/**
 * Head data for a page, mirroring what the Next app renders:
 *  - home: the root layout's defaults (title without suffix, 1200x630 image
 *    with alt, canonical "/");
 *  - page: buildPageMetadata() (suffixed title, bare title in og/twitter,
 *    og:type website, image without dimensions); an article is og:type
 *    "article" with its times, like the live pages, and its cover's size;
 *  - notfound: suffixed title, noindex (Next adds noindex on not-found).
 */
export function buildSeo(input: SeoInput): SeoData {
  if (input.kind === 'home') {
    return {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      canonical: absoluteUrl('/'),
      robots: ROBOTS_INDEX,
      googlebot: GOOGLEBOT_INDEX,
      og: {
        title: DEFAULT_TITLE,
        description: HOME_OG_DESCRIPTION,
        url: absoluteUrl('/'),
        siteName: SITE_NAME,
        locale: OG_LOCALE,
        type: 'website',
        image: { url: absoluteUrl(DEFAULT_OG_IMAGE), width: 1200, height: 630, alt: SITE_NAME },
      },
      twitter: {
        card: 'summary_large_image',
        title: DEFAULT_TITLE,
        description: HOME_TWITTER_DESCRIPTION,
        image: absoluteUrl(DEFAULT_OG_IMAGE),
      },
    };
  }

  if (input.kind === 'notfound') {
    const title = pageTitle(input.title ?? 'Halaman tidak ditemukan');
    return {
      title,
      description: DEFAULT_DESCRIPTION,
      canonical: null,
      robots: 'noindex',
      googlebot: null,
      og: {
        title,
        description: DEFAULT_DESCRIPTION,
        url: null,
        siteName: SITE_NAME,
        locale: OG_LOCALE,
        type: 'website',
        image: { url: absoluteUrl(DEFAULT_OG_IMAGE) },
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description: DEFAULT_DESCRIPTION,
        image: absoluteUrl(DEFAULT_OG_IMAGE),
      },
    };
  }

  const image = absoluteUrl(input.ogImage || DEFAULT_OG_IMAGE);
  const article = input.article;
  const sized = article && input.ogImage && article.imageWidth && article.imageHeight;
  return {
    title: pageTitle(input.title),
    description: input.description,
    canonical: absoluteUrl(input.path),
    robots: ROBOTS_INDEX,
    googlebot: GOOGLEBOT_INDEX,
    og: {
      title: input.title,
      description: input.description,
      url: absoluteUrl(input.path),
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      type: article ? 'article' : 'website',
      image: sized ? { url: image, width: article.imageWidth!, height: article.imageHeight! } : { url: image },
      ...(article
        ? { article: { published: article.dateISO, modified: article.modifiedISO || article.dateISO, ...(article.category ? { section: article.category } : {}) } }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      image,
    },
  };
}

// ---------------------------------------------------------------- JSON-LD

/** The Organization fields (schema.org NGO + EducationalOrganization), without @context: shared by the graph and the standalone block. */
function organizationFields() {
  return {
    '@type': ['NGO', 'EducationalOrganization'],
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    alternateName: SITE_TAGLINE,
    url: SITE_URL,
    logo: ORG_LOGO,
    description:
      'Organisasi nirlaba yang menyediakan bimbingan belajar gratis untuk persiapan UTBK dan masuk perguruan tinggi bagi siswa dari keluarga kurang mampu di seluruh Indonesia.',
    foundingDate: '2021',
    sameAs: SOCIAL_URLS,
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Bandung',
      addressRegion: 'Jawa Barat',
      addressCountry: 'ID',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'contact@sakolakembara.org',
      contactType: 'general',
      availableLanguage: ['Indonesian'],
    },
  };
}

/** Organization JSON-LD as a block of its own. Schema.org NGO + EducationalOrganization (the root lib/seo.ts has the same). */
export function organizationJsonLd() {
  return { '@context': 'https://schema.org', ...organizationFields() };
}

/** The `@id` of the organization and of the site: every page of the graph points at them. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Name of a person for an `@id`: lower case, words joined by hyphens, accents and punctuation dropped. */
const personSlug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'penulis';

/** What the trail of a page is when the page does not say: the home page, then the page. Home has none (a trail of one is not a trail). */
function defaultCrumbs(title: string, path: string): Crumb[] {
  return [
    { name: 'Beranda', path: '/' },
    { name: title, path },
  ];
}

/**
 * The structured data of a page: ONE @graph, shaped like the live WordPress site's (which an SEO plugin wrote), made of
 * what this site really knows and nothing invented:
 *
 *   - Organization, the one of the home page (NGO + EducationalOrganization), on every page, so a `publisher` has
 *     something to point at; WebSite, with the legal name the live site has as `name` and the brand as `alternateName`;
 *   - WebPage (CollectionPage for the blog index), with its BreadcrumbList (a page whose trail would have one step, the
 *     home page, has none: Google needs two);
 *   - on an article: BlogPosting (the type the live site uses; headline, description, cover as an ImageObject, the two
 *     dates as days, author, publisher, section) and the author as a Person (a name: there is no author page).
 *
 * The 404 page has none. Program pages add their own EducationalOccupationalProgram block next to this one.
 */
export function buildGraph(input: SeoInput): { '@context': string; '@graph': object[] } | null {
  if (input.kind === 'notfound') return null;

  const home = input.kind === 'home';
  const path = home ? '/' : input.path;
  const title = home ? DEFAULT_TITLE : input.title;
  const description = home ? DEFAULT_DESCRIPTION : input.description;
  const url = absoluteUrl(path);
  const pageId = `${url}#webpage`;
  const article = home ? undefined : input.article;

  const crumbs = home ? [] : (input.crumbs ?? defaultCrumbs(title, path));
  const breadcrumb =
    crumbs.length >= 2
      ? {
          '@type': 'BreadcrumbList',
          '@id': `${url}#breadcrumb`,
          itemListElement: crumbs.map((crumb, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: crumb.name,
            item: absoluteUrl(crumb.path),
          })),
        }
      : null;

  const cover = article
    ? {
        '@type': 'ImageObject',
        '@id': `${url}#primaryimage`,
        url: absoluteUrl((!home && input.ogImage) || DEFAULT_OG_IMAGE),
        ...(article.imageWidth && article.imageHeight && !home && input.ogImage ? { width: article.imageWidth, height: article.imageHeight } : {}),
      }
    : null;
  const person = article?.author
    ? { '@type': 'Person', '@id': `${SITE_URL}/#/person/${personSlug(article.author)}`, name: article.author }
    : null;

  const graph: object[] = [
    { '@id': ORG_ID, ...organizationFields() },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: `${SITE_URL}/`,
      name: LEGAL_NAME,
      alternateName: SITE_NAME,
      inLanguage: SITE_LANGUAGE,
      publisher: { '@id': ORG_ID },
    },
    {
      '@type': !home && input.pageType ? input.pageType : 'WebPage',
      '@id': pageId,
      url,
      name: title,
      description,
      inLanguage: SITE_LANGUAGE,
      isPartOf: { '@id': WEBSITE_ID },
      ...(home ? { about: { '@id': ORG_ID } } : {}),
      ...(breadcrumb ? { breadcrumb: { '@id': breadcrumb['@id'] } } : {}),
      ...(article && cover
        ? {
            primaryImageOfPage: { '@id': cover['@id'] },
            datePublished: article.dateISO,
            dateModified: article.modifiedISO || article.dateISO,
          }
        : {}),
    },
  ];
  if (breadcrumb) graph.push(breadcrumb);
  if (article && cover) {
    graph.push({
      '@type': 'BlogPosting',
      '@id': `${url}#blogposting`,
      headline: title,
      description,
      image: cover,
      datePublished: article.dateISO,
      dateModified: article.modifiedISO || article.dateISO,
      author: person ? { '@id': person['@id'] } : { '@id': ORG_ID },
      publisher: { '@id': ORG_ID },
      inLanguage: SITE_LANGUAGE,
      mainEntityOfPage: { '@id': pageId },
      isPartOf: { '@id': pageId },
      ...(article.category ? { articleSection: article.category } : {}),
    });
    if (person) graph.push(person);
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** EducationalOccupationalProgram JSON-LD for /program/[id] (used when the program pages are ported). */
export function programJsonLd(program: { id: string; title: string; description: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'EducationalOccupationalProgram',
    name: `${program.title} — Bimbingan Belajar Kembara`,
    description: program.description,
    url: `${SITE_URL}/program/${program.id}`,
    provider: { '@type': 'NGO', name: SITE_NAME, url: SITE_URL, logo: ORG_LOGO },
    educationalProgramMode: 'blended',
    occupationalCategory: 'Higher Education Preparation',
    inLanguage: SITE_LANGUAGE,
  };
}
