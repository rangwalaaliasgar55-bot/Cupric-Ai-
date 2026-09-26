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

## v0.4.2 — PanelUI catalogue, 30 more sources, speak-a-brief

### PanelUI pack (172 entries)

`resources/panelui/registry.json` → `resources/packs/panelui.json`.
Every component and chart from <https://github.com/panel-ui/PanelUI> (MIT), with
the upstream behaviour notes, grouped as `components`, `ai-components`,
`charts`, `form`, `hooks`, `utilities`, `integrations`, `customization`,
`reference`. Their `theme.upstream.css` token sheet is vendored next to it.

**The source code is deliberately not copied.** PanelUI is React Native / Expo
(reanimated, expo-blur, uniwind); it cannot mount in Cupric's DOM renderer. What
is useful — the behaviour rules, the accessibility modes, the copy — is what we
took. See `resources/VENDOR.md`.

### Sources pack: 46 → 76 entries

Added: PanelUI, React Bits, LottieFiles, Rive, Iconify, unDraw, Blush, Storyset,
Pexels Videos, Pixabay Videos, Mixkit, Coverr, Uppbeat, Freesound, Fontsource,
Coolors, mesh-gradient generators, Three.js, React Three Fiber, **CSS 3D
transforms**, Poly Haven, Kenney, Sketchfab, reactvideoeditor/remotion-templates,
designcombo/react-video-editor, OpenCut, OpusClip, Web Speech API, Pipecat,
LiveKit Agents.

Two entries carry a deliberate *negative* recommendation, because the catalogue
is only useful if it says what not to use:

- **Three.js** — in-app only. A model cannot author a 150KB library into a
  self-contained Arena HTML file, so generated scenes use **CSS 3D transforms**
  instead: `perspective` + `rotateX/Y/Z` + `translateZ` are pure functions of
  `t`, weigh nothing, and stay inside the deterministic `__seek(t)` contract.
- **Pipecat / LiveKit Agents** — recorded as "not adopted, and why": they solve
  duplex conversation (~450–600ms round trips). Cupric records one instruction
  and renders; the Web Speech API already covers that.

### Speak a brief, get a video

`VoiceListener` gained a `dictation` mode (no grammar parsing — a brief is prose,
and the command grammar would discard it) plus `speak()` / `stopSpeaking()`
helpers over `SpeechSynthesisUtterance`. On the Autonomous screen: **Speak the
brief** dictates into the brief box, "start as soon as I stop speaking" fires
`startAutomationJob()` on the first final phrase of four words or more, and
status is spoken back on each job transition (done / error / waiting-for-user).

The command grammar also learned `make a video about …`, so the Studio mic can
hand a whole sentence to the same pipeline.

Files: `src/lib/voice.ts`, `src/screens/Autonomous.tsx`, `src/screens/Studio.tsx`.

## v0.4.3 — Studio motion, checks and history

**Lottie stickers.** `lottie-web` 5.13, canvas renderer, driven by
`goToAndStop(frame)` so a sticker is a pure function of the timeline and the
export cannot drift from the preview. Four built-in stickers are authored in
`scripts/build-stickers.mjs` (readable source, generated JSON in
`resources/lottie/`): Pulse ring, Check pop, Arrow nudge, Live dot. Imported
`.json` files are supported; images and expressions are not.

**Per-clip motion.** Rotation (with a preview handle that snaps to 15° on
Shift and to right angles within 3°), keyframes on position/size/rotation/
opacity with four easings, a three-node colour grade (balance → contrast →
look, five presets), and masks: rectangle, ellipse, luma key, and an imported
matte for object-aware work.

**Document checks.** `src/lib/studio/lint.ts` runs next to the Export button:
text outside the title-safe area, captions colliding on one track, unreadable
type sizes, lost media, empty masks, unusable imported stickers, holes in the
timeline, over-length projects. Each one has a one-click fix where a fix exists.

**Undo and redo.** Every project mutation, not only timeline edits — the store
funnels them all through one place, so coverage is structural rather than a
list someone has to maintain. Drags coalesce into one step; ⌘Z / ⇧⌘Z.

**Editor shortcuts.** J/K/L shuttle, I/O trim to the playhead, space, arrows
(frame) and shift-arrows (second), ⌘B split, delete.

**Critique → repair.** A generated candidate that fails the render contract is
sent back to the model with its own failures quoted at it, up to two rounds, and
a repair is only accepted if it scores better. Recorded in `voting-report.json`.

**macOS vibrancy.** A real `vibrancy: 'under-window'` material with inset
traffic lights, not a CSS imitation.

**Checks in the build.** `npm run build` now runs the renderer check (326
assertions), the voice and error-copy check (34), and a scrub performance
profile that fails if per-frame renderer work exceeds its budget or starts
growing faster than the clip count.
