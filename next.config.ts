import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // App renders no <Image> (icons are SVG, charts are canvas/recharts) — skip the
  // image optimizer entirely. Without this, the standalone tracer bundles
  // `sharp` (an optionalDependency of next itself) and the copy step dies with
  // ENOENT on platform-specific @img/* packages on some CI hosts.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
