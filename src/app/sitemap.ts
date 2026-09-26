import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/**
 * Two public pages. `/sky` is deliberately absent: it is not a page so much as one writer's
 * private room, and a search engine listing it would be a promise the product cannot keep.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  const lastModified = new Date();
  return [
    { url: `${origin}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/about`, lastModified, changeFrequency: "monthly", priority: 0.6 },
  ];
}
