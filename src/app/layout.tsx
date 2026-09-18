import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, Space_Grotesk } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  /* Fraunces' character lives in its custom axes: WONK gives the italic its
     swashed, hand-cut glyphs and SOFT rounds the terminals. Without listing
     them next/font ships a weight-only variable file and the italic reads as
     an ordinary slanted serif. */
  axes: ["opsz", "SOFT", "WONK"],
  variable: "--font-fraunces",
  display: "swap",
});

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Asteria — your life, as a night sky",
    template: "%s · Asteria",
  },
  description:
    "A journal for the quiet hours. Capture one small moment each night — Asteria turns it into a star, and your days into constellations.",
};

export const viewport: Viewport = {
  themeColor: "#030409",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${grotesk.variable} ${plex.variable}`}>
      {/* Adobe Fonts kit cqu4tvx — the licensed type source. Linked in <head> so the kit's
          @font-face rules are parsed before first paint; globals.css maps the kit faces onto
          --font-display / --font-sans / --font-mono, with the self-hosted next/font families
          above kept as fallbacks. */}
      <head>
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.adobe.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://use.typekit.net/cqu4tvx.css" />
      </head>
      <body className="bg-void text-starlight antialiased">
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
