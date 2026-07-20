import type { NextConfig } from "next";

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

export default nextConfig;
