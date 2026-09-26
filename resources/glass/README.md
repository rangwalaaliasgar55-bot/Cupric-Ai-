# Liquid glass pack

The material itself lives in code, not here:

| File | Role |
|---|---|
| `src/lib/glass.ts` | Parameters, the six presets, the generated displacement map, CSS helpers. One source of truth. |
| `src/components/glass/GlassSurface.tsx` | DOM path — `backdrop-filter: blur() saturate()` plus an SVG `feImage`/`feDisplacementMap` per channel, blended with `feBlend screen` for chromatic dispersion. Falls back to a plain frost when `backdrop-filter` is unsupported or the user prefers reduced transparency. |
| `src/components/glass/index.tsx` | `GlassPanel`, `GlassButton`, `GlassLens` (drag + arrow keys), `GlassDock`. |
| `src/lib/studio/glass.ts` | Canvas path used by the Studio preview **and** the export: blurred magnifying bulge, additive hue-rotated fringe, tint, inner glow, travelling specular, hairline rim. |
| `resources/packs/glass.json` | Generated manifest the Library reads (`npm run packs:build`). |

## Why two implementations rather than one library

`backdrop-filter` samples the *compositor's* backdrop. A `<canvas>` recorded by
`MediaRecorder` has no such backdrop, and over a playing `<video>` Chromium
renders it black. Any glass that must appear in an exported video therefore has
to be composited into the canvas. Since a second glass system would drift from
the first, the parameters are shared and only the drawing differs.

## Presets

| id | Character |
|---|---|
| `hero` | Crisp, dispersive — for glass over footage. |
| `portfolio` | Subtle, low chroma — over stills and screenshots. |
| `plaque` | Thick slab, wide bezel, heavy rim. |
| `liquid` | Maximum bend and a hot rim. |
| `frost` | No displacement at all, text-safe. |
| `lens` | Small circular magnifier, draggable in the DOM. |

Credits and the original write-ups are listed in `resources/VENDOR.md`.
