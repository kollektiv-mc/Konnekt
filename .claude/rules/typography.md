---
paths:
  - "**/*.{css,scss,html,svg}"
  - "**/*.{jsx,tsx,vue,svelte,astro}"
  - "**/*.{woff,woff2,ttf,otf}"
  - "**/fonts/**"
  - "**/brand/**"
---

# Typography

A guideline, not a mandate: no project font is prescribed. When choosing one:

- Avoid the fonts that now read as AI defaults: Inter, Roboto, Open Sans, Lato,
  Arial, Geist, Geist Mono, Space Grotesk, Instrument Serif and a bare system
  stack. Keep one only where the project already uses it as its brand font.
- Avoid the generated-page treatments: one italic or coloured accent word in a
  headline, tracked ALL-CAPS eyebrow labels, monospace for small labels out of
  habit, one family for everything.
- Prefer OFL fonts (Google Fonts, Fontsource) so the files can be committed and
  self-hosted. Never commit fonts whose licence forbids redistribution (for
  example Fontshare's ITF Free Font License); load them at runtime.
- Where the font is defined, say in one line why it was chosen.
