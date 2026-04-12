import type { NextConfig } from "next";

function resolveDevDistDir() {
  const rawPort = process.env.PORT?.trim();
  const normalizedPort = rawPort && /^\d+$/.test(rawPort) ? rawPort : "3000";
  return `.next-dev-${normalizedPort}`;
}

const isDevelopment = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || (isDevelopment ? resolveDevDistDir() : ".next"),
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
