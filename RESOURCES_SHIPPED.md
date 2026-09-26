# Resources shipped (v0.2.4)

## In repo now

```text
resources/
  README.md
  VENDOR.md
  catalog.json
  ui-lab/
    patterns.md
    registry.compact.json   ← 40 high-value lab demos offline
  spectrum/
    index.json
    pipeline.md
  design-systems/
    pipeline.md
    checklist.md
  kdenlive/
    NOTES.md
  effects/
    logo-sting.html         ← __seek(t) templates
    quote-card.html
  backgrounds/
    stage.css
  avatars/README.md
scripts/sync-resources.mjs  ← pulls FULL upstream catalogs + avatars
public/resources/README.md
```

## Pull the heavy catalogs (run once after clone)

```bash
npm run resources:sync
```

That writes:

- `resources/ui-lab/registry.json` — **190** ui-lab entries
- `resources/spectrum/registry.full.json` — full Spectrum registry (~200KB)
- `public/resources/avatars/{ava,ben,cara,dev,fay}.svg`

Verified in this environment: 190 lab entries + Spectrum registry + 5 avatars download cleanly.

## Why not embed Adobe React Spectrum / Kdenlive trees

- React Spectrum = multi-MB monorepo + different visual system
- Kdenlive = GPL C++/Qt native code

Both are mapped in `resources/VENDOR.md` and `resources/kdenlive/NOTES.md`. Patterns land in tokens/effects; catalogs land offline via sync.

## App integration

- Library already exposes Effects + Backgrounds from `src/lib/effects.ts` + `gradients.ts`
- Arena HTML templates under `resources/effects/` for local generation
- Electron package includes `resources/**/*` and `public/resources/**/*`

## v0.4.1 — Sources catalogue, video templates, two new Lab components

### Sources pack (46 entries)

`src/lib/sources.ts` → `resources/packs/sources.json`, browsable in Library → **Sources**.

Every entry records the URL, what it gives us (`components`, `shaders`, `backgrounds`,
`illustrations`, `icons`, `motion`, `templates`, `generators`, `inspiration`, `prompts`),
whether it feeds the **app UI**, the **video generator** or both, how the material
gets here (`copy` / `registry` / `reference` / `export`), its licence, and a
**prompt cue** the Arena/Gemini brief builder can paste verbatim.

Covered: Forge UI (components, templates, illustrations), Watermelon UI, shadcn/ui,
Aceternity, Magic UI, Motion Primitives, Uiverse, Uiable, mapcn, 21st.dev, 23rd.dev
(shader gradient/fire/sky, live orb, ASCII logo, radiant lines…), Beautiful UI,
MetalForge, Astryx, Microkit, glass.samasante.com, Colorion text-effects / kinetics /
gradient-buttons, Circle Loaders, Kitbitz, 3dicons, Anime.js, Gradientool,
backgrounds.supply Gradient Lab, Animos, Cutting Mat Generator, Space Type Generator,
Book of Shapes, Tabbied, Dotforge, Ditther, Tokokino, benday, Spherium, designmd.ai,
Vibeprompts, getlayers.ai, minimal.gallery, kage.design, Refero Styles,
The Component Gallery, Appshot Gallery, saved.design.

Nothing third-party is vendored — links, licences and cues only. The Library's
"Open" button copies the cue and opens the site in the user's browser.

### Video templates pack (6 scenes)

`src/lib/videoTemplates.ts` → `resources/packs/templates.json`. The files live in
`resources/effects/` and each one is a standalone HTML scene with the render contract:

```js
window.__seek(t)                // paint second t — pure, no rAF, no CSS animation
window.__cupricSourceManifest   // duration, fps, size, beat list, credits
```

Because `__seek` is a pure function of `t`, the desktop renderer can screenshot
frame N deterministically; nothing depends on wall-clock time.

| id | scene | length |
| --- | --- | --- |
| `logo-sting` | mark snaps in, wordmark follows | 3s |
| `quote-card` | word-by-word quote on a dot field | 6s |
| `text-reveal` | blur-and-rise word stagger (Forge UI Text Reveal) | 5s |
| `progress-stack` | onboarding cards with a filling bar (Forge UI Progress Stack) | 6s |
| `stack-ripple` | notification deck fanning open on a spring | 5s |
| `mesh-drift` | looping canvas mesh gradient + title (23rd / Gradient Lab) | 8s, loops |

### Lab components

- `src/lab/components/progress-stack.tsx` — Forge UI Progress Stack, rebuilt on
  this app's tokens and `lucide-react`, so it adds no `react-icons` dependency.
- `src/lab/components/stack-ripple.tsx` — Forge UI Stack Ripple, one shared
  variant tree so all three cards fan on the same spring.

Both honour `useReducedMotion` and are registered in `src/lab/registry.ts`.

### Regenerating

```bash
npm run packs:build   # rewrites resources/packs/*.json from the TS registries
```
