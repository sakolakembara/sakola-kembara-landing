import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Legacy WordPress category permalinks. The old site used these as URL
// prefixes for individual posts (e.g. /cerita/<slug>/) AND as archive
// pages (e.g. /cerita/). Both map into the unified /blog namespace.
// Source of truth for category list: scripts/lib/blog-pipeline.mjs →
// mapSakemPath() and the CATEGORY_MAP in scripts/scrape-blog.mjs.
const WP_BLOG_CATEGORIES = [
  "cerita",
  "education",
  "news",
  "tips",
  "testimonials",
  "career",
  "kiat-kiat",
] as const;

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // Match the blog image upload cap in app/(admin)/admin/blog/actions.ts.
      bodySizeLimit: "5mb",
    },
  },
  images: {
    remotePatterns: [
      // Legacy WordPress blog images (referenced from migrated markdown).
      {
        protocol: "https",
        hostname: "sakolakembara.org",
        pathname: "/wp-content/uploads/**",
      },
      // Unsplash placeholders — used as hero / program / team / testimonial
      // fallbacks until real photography lands (see roadmap Phase 8).
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      // Partner logos hosted on Wikimedia (e.g. ITB).
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        pathname: "/wikipedia/**",
      },
    ],
  },
  async redirects() {
    return [
      // Legacy category-prefixed post permalinks → unified /blog/<slug>.
      ...WP_BLOG_CATEGORIES.map((cat) => ({
        source: `/${cat}/:slug`,
        destination: "/blog/:slug",
        permanent: true,
      })),
      // Legacy category archive pages → /blog index.
      ...WP_BLOG_CATEGORIES.map((cat) => ({
        source: `/${cat}`,
        destination: "/blog",
        permanent: true,
      })),
      // Old CTA destinations still linked from external sites, QR codes on
      // print collateral, and Instagram bio links.
      { source: "/daftar", destination: "/gabung-siswa", permanent: true },
      { source: "/apply", destination: "/gabung-siswa", permanent: true },
      // "About" page rename — public team page took over.
      { source: "/tentang-kami", destination: "/tim", permanent: true },
      { source: "/about", destination: "/tim", permanent: true },
      // Internal rename done earlier this branch.
      { source: "/impact-reports", destination: "/laporan", permanent: true },
      {
        source: "/impact-reports/:path*",
        destination: "/laporan",
        permanent: true,
      },
      // WordPress paginated archives (e.g. /blog/page/3/) → /blog?page=3.
      {
        source: "/blog/page/:page",
        destination: "/blog?page=:page",
        permanent: true,
      },
      // Common WP entry points that should not 404 at cutover.
      { source: "/feed", destination: "/blog", permanent: true },
      { source: "/feed/:path*", destination: "/blog", permanent: true },
      { source: "/index.php", destination: "/", permanent: true },
    ];
  },
};

// withSentryConfig wraps the build so error stack traces get source-mapped
// on the Sentry side. When SENTRY_AUTH_TOKEN + org/project are set at build
// time, sourcemaps upload automatically; otherwise the wrap is a no-op.
export default withSentryConfig(nextConfig, {
  // These are only used at build time for sourcemap upload — safe to leave
  // as literals in the repo. They must match the Sentry project you point
  // NEXT_PUBLIC_SENTRY_DSN at.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Keep upload behavior off unless explicitly enabled. Local dev builds
  // shouldn't try to auth against Sentry.
  disableLogger: true,
  sourcemaps: {
    // Only upload when we have a token; otherwise Sentry SDK skips silently.
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
