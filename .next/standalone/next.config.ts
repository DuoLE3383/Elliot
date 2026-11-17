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
  // Belt & suspenders with images.unoptimized: keep sharp + its platform-native
  // @img/* optional packages out of the standalone output. Some CI hosts
  // (bun install --production) don't install every @img/* platform variant, and
  // the tracer then dies with `ENOENT copyfile …/@img/sharp-libvips-*/README.md`.
  outputFileTracingExcludes: {
    "*": ["./node_modules/sharp/**", "./node_modules/@img/**"],
  },
};

export default nextConfig;
