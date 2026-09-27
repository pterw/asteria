# Bundled fallback faces

These files are the *fallback* half of Asteria's type system. The identity faces
arrive from the licensed Adobe Fonts kit (`cqu4tvx`, linked in `src/app/layout.tsx`);
what lives here is what renders when that kit is blocked, slow, or simply not
available — offline development, a locked-down network, a browser with third-party
requests blocked.

They are committed rather than fetched at build time on purpose:

- `next/font/google` requires network access during `next build`. A build that
  needs the public internet to succeed is a build that cannot be reproduced
  offline, in CI with egress rules, or behind a corporate proxy. That is exactly
  how this project's build was found failing.
- Self-hosting removes a third-party request from the critical path and takes
  `fonts.googleapis.com` off the CSP allowlist.

## Provenance

Extracted from the Fontsource packages pinned in `devDependencies` (they are build
inputs, not runtime dependencies — Next.js fingerprints the files during build):

| File | Source package | Face |
|---|---|---|
| `fraunces-latin-normal.woff2` | `@fontsource-variable/fraunces` | Fraunces, `wght` + `opsz` axes, upright |
| `fraunces-latin-italic.woff2` | `@fontsource-variable/fraunces` | Fraunces, `wght` + `opsz` axes, italic |
| `space-grotesk-latin.woff2` | `@fontsource-variable/space-grotesk` | Space Grotesk, `wght` axis |
| `ibm-plex-mono-400.woff2` | `@fontsource/ibm-plex-mono` | IBM Plex Mono 400 |
| `ibm-plex-mono-500.woff2` | `@fontsource/ibm-plex-mono` | IBM Plex Mono 500 |

All three families are licensed under the SIL Open Font License 1.1, which permits
redistribution. Fraunces (Phaedra Charles, Flavia Zimbardi), Space Grotesk
(Florian Karsten, derived from Space Mono by Colophon Foundry) and IBM Plex Mono
(Mike Abbink for IBM) retain their upstream copyrights; the full licence text ships
with each Fontsource package under `node_modules/<package>/LICENSE`.

## Replacing them

If the licensed kit ever becomes the only source, delete this directory and the
`next/font/local` block in `src/app/layout.tsx`, then remove `var(--font-*)` from
the stacks in `src/app/globals.css`. Nothing else refers to these files.
