import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/site";

/**
 * Type, in two layers.
 *
 * The licensed Adobe Fonts kit (`cqu4tvx`) is the identity source and is linked in
 * <head> so its @font-face rules are parsed before first paint. The families below
 * are the fallback layer, self-hosted from `src/fonts/` — see that directory's
 * README for why they are committed rather than fetched at build time.
 *
 * Both layers are described in `globals.css`, where the stacks lead with the kit
 * face and fall through to these. Nothing here is an identity choice: these are
 * stand-ins with the same structural job (a display serif with optical sizing, a
 * geometric sans for chrome, a legible mono for instrument labels).
 */

const fraunces = localFont({
  src: [
    { path: "../fonts/fraunces-latin-normal.woff2", weight: "100 900", style: "normal" },
    { path: "../fonts/fraunces-latin-italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-fraunces",
  display: "swap",
  preload: true,
  /* Left at auto so the fallback's optical-size axis tracks the type size exactly
     as the kit face does — the two layers then differ in drawing, not in rhythm. */
  declarations: [{ prop: "font-optical-sizing", value: "auto" }],
});

const grotesk = localFont({
  src: [{ path: "../fonts/space-grotesk-latin.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-grotesk",
  display: "swap",
  preload: false,
  adjustFontFallback: "Arial",
});

const plex = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: {
    default: `${SITE_NAME} — your life, as a night sky`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["journal", "journaling app", "private journal", "night sky", "constellations", "diary"],
  authors: [{ name: "Peter" }],
  creator: "Peter",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    url: "/",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Asteria — your life, as a night sky" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image"],
  },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  themeColor: "#030409",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${grotesk.variable} ${plex.variable}`}>
      <head>
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.adobe.com" crossOrigin="anonymous" />
        {/* The licensed kit. Loaded as a stylesheet (not via next/font) because the kit
            is a hosted service that decides its own files and formats. */}
        <link rel="stylesheet" href="https://use.typekit.net/cqu4tvx.css" />
      </head>
      <body className="bg-void text-starlight antialiased">{children}</body>
    </html>
  );
}
