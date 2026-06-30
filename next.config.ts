import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
};

export default nextConfig;
