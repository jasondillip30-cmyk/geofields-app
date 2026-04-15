import type { NextConfig } from "next";

const nextTsconfigPath = process.env.NEXT_TSCONFIG_PATH?.trim() || "tsconfig.next.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: nextTsconfigPath
  },
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
