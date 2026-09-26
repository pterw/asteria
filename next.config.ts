import type { NextConfig } from "next";

/**
 * Build configuration.
 *
 * Security headers live in `src/proxy.ts` rather than here, because they must be present on
 * responses the framework would otherwise return untouched (a 403 from the edge, a streamed
 * page, a route-handler error). Declaring them twice would be two sources of truth for one
 * policy.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  /**
   * The embedded database (PGlite) loads a WebAssembly build of PostgreSQL from disk at
   * runtime. Bundling it would try to inline both the JS and the `.wasm`; leaving it
   * external means it is resolved from `node_modules` when — and only when — the Postgres
   * driver is not in use.
   */
  serverExternalPackages: ["@electric-sql/pglite"],

  experimental: {
    // Server Actions parse their arguments through this ceiling; the product's largest
    // payload is an import of 500 moments, which is well inside 512 KB.
    serverActions: { bodySizeLimit: "512kb" },
  },

  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [360, 480, 640, 828, 1080, 1200, 1600, 1920, 2560, 3840],
  },

  async headers() {
    return [
      {
        // Fingerprinted by the framework, so these can be cached for as long as the
        // fingerprint holds. Everything else is negotiated per request.
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
