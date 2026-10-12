// Port of the root lib/seo.ts (Next metadata API) to plain data the Astro
// layout renders as <head> tags. Same site identity, same title template, same
// JSON-LD. Values that Next derives from `metadataBase` (relative -> absolute
// URLs) are made absolute here with `absoluteUrl()`.
//
// Source of truth stays the root file while the legacy app lives; the tests in
// tests/seo.test.ts pin the values that must not drift.

export const SITE_URL = 'https://sakolakembara.org';
export const SITE_NAME = 'Sakola Kembara';

/** How every page title reads in the browser tab: "<page> | Sakola Kembara". */
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

export const LEGAL_NAME = 'Yayasan Sakola Kembara Indonesia';
export const SITE_TAGLINE = 'Pendidikan Untuk Semua';

export const ORG_LOGO = `${SITE_URL}/images/logo-sakola-kembara.png`;
// 1200x630 share image for pages without their own (blog posts pass their cover).
export const DEFAULT_OG_IMAGE = '/og-default.jpg';

export const SOCIAL_URLS = [
  'https://instagram.com/sakolakembara',
  'https://tiktok.com/@sakolakembara',
  'https://twitter.com/sakolakembara',
  'https://youtube.com/@sakolakembara',
];

// From the root app/layout.tsx.
export const DEFAULT_TITLE = 'Sakola Kembara - Pendidikan Untuk Semua';
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

/** A page title with the site suffix ("Tim Kami | Sakola Kembara"). */
export function pageTitle(title: string): string {
  return TITLE_TEMPLATE.replace('%s', title);
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
  };
  twitter: { card: string; title: string; description: string; image: string };
}

export const ROBOTS_INDEX = 'index, follow';
export const GOOGLEBOT_INDEX =
  'index, follow, max-video-preview:-1, max-image-preview:large, max-snippet:-1';

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
    }
  | { kind: 'notfound' };

/**
 * Head data for a page, mirroring what the Next app renders:
 *  - home: the root layout's defaults (title without suffix, 1200x630 image
 *    with alt, canonical "/");
 *  - page: buildPageMetadata() (suffixed title, bare title in og/twitter,
 *    og:type website, image without dimensions);
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
        locale: 'id_ID',
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
    const title = pageTitle('Halaman tidak ditemukan');
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
        locale: 'id_ID',
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
      locale: 'id_ID',
      type: 'website',
      image: { url: image },
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      image,
    },
  };
}

/** Organization JSON-LD for the homepage. Schema.org NGO + EducationalOrganization. */
export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
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

export interface ArticleLite {
  id: string;
  title: string;
  excerpt: string;
  image?: string;
  dateISO: string;
  modifiedISO?: string;
  author?: string;
}

/** Article JSON-LD for /blog/[slug]. */
export function articleJsonLd(article: ArticleLite) {
  const url = `${SITE_URL}/blog/${article.id}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    image: [article.image ? absoluteUrl(article.image) : absoluteUrl(DEFAULT_OG_IMAGE)],
    datePublished: article.dateISO,
    dateModified: article.modifiedISO || article.dateISO,
    author: article.author
      ? { '@type': 'Person', name: article.author }
      : { '@type': 'Organization', name: SITE_NAME },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      logo: { '@type': 'ImageObject', url: ORG_LOGO },
    },
    mainEntityOfPage: url,
    inLanguage: 'id-ID',
  };
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
    inLanguage: 'id-ID',
  };
}
