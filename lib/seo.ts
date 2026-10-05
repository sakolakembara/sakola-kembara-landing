import type { Metadata } from "next";

// Canonical site identity — single source of truth for SEO surfaces.
export const SITE_URL = "https://sakolakembara.org";
export const SITE_NAME = "Sakola Kembara";
export const LEGAL_NAME = "Yayasan Sakola Kembara Indonesia";
export const SITE_TAGLINE = "Pendidikan Untuk Semua";

export const ORG_LOGO = `${SITE_URL}/images/logo-sakola-kembara.png`;
// 1200×630 share image for pages without their own (programs and blog posts
// pass their cover photo instead). JPEG because it carries a photo: ~80 KB vs
// ~330 KB as PNG, and WhatsApp drops large previews.
export const DEFAULT_OG_IMAGE = "/og-default.jpg";

export const SOCIAL_URLS = [
  "https://instagram.com/sakolakembara",
  "https://tiktok.com/@sakolakembara",
  "https://twitter.com/sakolakembara",
  "https://youtube.com/@sakolakembara",
];

/**
 * Serialize a JSON-LD payload for safe embedding inside a <script> tag.
 *
 * `JSON.stringify` is safe for JSON itself, but a string field containing the
 * literal substring "</script>" would close the surrounding tag and allow XSS.
 * Escaping `<` to its JSON unicode form `<` preserves parse semantics
 * while removing any character that can terminate a script tag. Also escapes
 * U+2028 / U+2029 which are valid JSON but break ECMAScript parsing.
 *
 * Use this for every `dangerouslySetInnerHTML` JSON-LD insertion. Defensive
 * even when the input is currently fully developer-controlled.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Build a per-page Metadata object. Relative `path` is prefixed by metadataBase from app/layout.tsx. */
export function buildPageMetadata({
  title,
  description,
  path,
  ogImage,
}: {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
}): Metadata {
  const images = ogImage ? [{ url: ogImage }] : [{ url: DEFAULT_OG_IMAGE }];
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "id_ID",
      type: "website",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  };
}

/** Organization JSON-LD for the homepage. Schema.org NGO + EducationalOrganization. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": ["NGO", "EducationalOrganization"],
    name: SITE_NAME,
    legalName: LEGAL_NAME,
    alternateName: SITE_TAGLINE,
    url: SITE_URL,
    logo: ORG_LOGO,
    description:
      "Organisasi nirlaba yang menyediakan bimbingan belajar gratis untuk persiapan UTBK dan masuk perguruan tinggi bagi siswa dari keluarga kurang mampu di seluruh Indonesia.",
    foundingDate: "2021",
    sameAs: SOCIAL_URLS,
    address: {
      "@type": "PostalAddress",
      addressLocality: "Bandung",
      addressRegion: "Jawa Barat",
      addressCountry: "ID",
    },
    contactPoint: {
      "@type": "ContactPoint",
      email: "contact@sakolakembara.org",
      contactType: "general",
      availableLanguage: ["Indonesian"],
    },
  };
}

interface BlogArticleLite {
  id: string;
  title: string;
  excerpt: string;
  image?: string;
  dateISO: string;
  modifiedISO?: string;
  author?: string;
}

/** Article JSON-LD for /blog/[id]. */
export function articleJsonLd(article: BlogArticleLite) {
  const url = `${SITE_URL}/blog/${article.id}`;
  const image = article.image
    ? article.image.startsWith("http")
      ? article.image
      : `${SITE_URL}${article.image}`
    : `${SITE_URL}${DEFAULT_OG_IMAGE}`;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    image: [image],
    datePublished: article.dateISO,
    dateModified: article.modifiedISO || article.dateISO,
    author: article.author
      ? { "@type": "Person", name: article.author }
      : { "@type": "Organization", name: SITE_NAME },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: ORG_LOGO },
    },
    mainEntityOfPage: url,
    inLanguage: "id-ID",
  };
}

/** EducationalOccupationalProgram JSON-LD for /program/[id]. */
export function programJsonLd(program: { id: string; title: string; description: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOccupationalProgram",
    name: `${program.title} — Bimbingan Belajar Kembara`,
    description: program.description,
    url: `${SITE_URL}/program/${program.id}`,
    provider: {
      "@type": "NGO",
      name: SITE_NAME,
      url: SITE_URL,
      logo: ORG_LOGO,
    },
    educationalProgramMode: "blended",
    occupationalCategory: "Higher Education Preparation",
    inLanguage: "id-ID",
  };
}
