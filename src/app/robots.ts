import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/**
 * A journal is private, so the parts of the app that are somebody's own sky are closed to
 * crawlers; the landing page and the About page are the public face and are explicitly open.
 * `/api/` is closed because the endpoints are signed or session-scoped, and an index of them
 * helps nobody.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/about"],
        disallow: ["/api/", "/sky"],
      },
    ],
    sitemap: `${siteOrigin()}/sitemap.xml`,
  };
}
