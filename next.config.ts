import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/revenue",
        destination: "/spending",
        permanent: false
      },
      {
        source: "/cost-tracking/budget-vs-actual",
        destination: "/spending",
        permanent: false
      },
      {
        source: "/cost-tracking",
        destination: "/spending",
        permanent: false
      },
      {
        source: "/profit",
        destination: "/spending/profit",
        permanent: false
      }
    ];
  }
};

export default nextConfig;
