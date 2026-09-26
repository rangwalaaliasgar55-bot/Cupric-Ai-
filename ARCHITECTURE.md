# ARCHITECTURE.md

```
APPLICATION        src/app/*  (showcase, editor, docs, API routes)
DESIGN SYSTEM      src/themes  (tokens, palettes, fonts)
MOTION SYSTEM      src/core/{easing,spring,interpolation,keyframes,animation} + src/motion/presets
TIMELINE SYSTEM    src/core/timeline (tweens, sequences, stagger, repeat, labels, markers)
COMPOSITION        src/core/{schemas,scene-graph,serialization} (VideoDoc → Scene → Node)
2D RENDERER        src/render/canvas (text, shapes, backgrounds, particles, ui, charts, devices, logos, captions)
3D RENDERER        src/three (Three.js scene builder, materials, lights, cameras, Rapier physics)
EFFECT PIPELINE    src/effects (post stack, transitions, WebGL shaders)
VIDEO RENDERER     src/video (player loop, Mediabunny export, audio analysis, captions, templates)
REGISTRY / AI      src/registry, src/ai (search, recommend, generate*)
```

## Data flow (single source of truth)
```
Editor state (VideoDoc JSON)  ──►  evaluate(doc, frame)  ──►  Canvas compositor ──► Player preview
          ▲                                                           │
          │ schema-driven inspector                                   └──► Mediabunny encoder ──► MP4 / WebM / PNG
AI generateVideo() / templates / import JSON
```
There is exactly **one** implementation of every animation: a pure function of
`(node props, frame, fps, seed)`. The player, editor, thumbnails and exporter all call the same
`renderFrame()`.

## Determinism contract
* No `Date.now()` / `Math.random()` in render code — `mulberry32(seed)` + hash-based noise.
* Particles are closed-form; physics is fixed-step and cached per frame; audio is pre-analysed.
* Async resources (images, fonts, physics wasm, audio) are loaded by `prepareDoc()` before export
  (equivalent of Remotion's `delayRender`).

## Registry
Every asset = `{ id, name, category, kind, description, tags, schema, defaults, capabilities,
performance, tier }`. The inspector, docs, AI search and gallery are generated from it.

## Security
Imported JSON is validated with Zod, unknown node types are rejected, URLs are sanitised
(`https:`, `data:image/*`, `blob:` and same-origin only). Shaders are *trusted presets only*;
templates cannot carry code.

## Verification (what is tested, `npx vitest run`)
* Unit: easings, springs, seeded RNG/noise, color parsing, timeline (labels, stagger, callbacks, repeat/yoyo, color tweens).
* Scene graph: spans/overlaps, addressable paths (`hero.headline`), split, export→import round trip.
* Security: invalid JSON, unknown node types and `javascript:` URLs rejected/sanitized.
* Motion: every entrance preset settles to identity and is deterministic.
* Templates: every template × {16:9, 9:16, 1:1, 4:5} validates; portrait uses stacked layout (not crop).
* AI: the success-test prompt yields 7 scenes / ~25 s; platform→aspect detection; library auto-selection.
* Render: the real compositor renders every template and every registered asset preview through a recording
  Canvas2D mock; frame determinism verified by identical draw-call logs for the same frame.

## Success-test matrix (built with existing engine pieces — no new engine code needed)
| Deliverable | How |
|---|---|
| SaaS launch video | `buildTemplate("productLaunch")` |
| AI product ad | `aiLaunch`, `futuristicAd`, or `generateVideo({prompt})` |
| Cinematic logo reveal | `logoRevealCinematic` / logo node (30 styles) + letterbox/grain effects |
| 3D product commercial | `techKeynote` / `product3d` scene (Three.js + materials + camera presets) |
| YouTube intro | `youtubeIntro` |
| YouTube Shorts | `shortsHook` (9:16, kinetic + highlight captions) |
| Animated dashboard | `ui:dashboard` / `ui:browser` nodes |
| Kinetic typography | 63 typography presets, `kinetic` story scene |
| Animated chart | 30 chart kinds × 5 animation modes |
| Particle background | 34 particle presets |
| Futuristic AI visualization | `aiProcessing` scene (holographic 3D core + energy particles + radial grid) |
| Landing hero | text + background/shader + `three` node; DOM micro-interactions via Motion |
| Product demo | `cursorDemo`, `dashboard`, `automation` UI |
| Mobile app ad | `appPromo`, `fintechApp` (device mockups) |
| Corporate presentation | `corporatePresentation` |
| Data visualization | `dataStory`, `financeReport` |
| 3D glass object | `three` node, material `glass`/`crystal`/`frostedGlass` |
| Holographic UI | `holographic` material/text fill + `hologram` shader + `holoGrid` |
| Cinematic transition sequence | 53 transitions (lensFlareCut, lightSweep, camera, whip …) |
| Complete 30-second video | any template with `duration: 30`, export MP4 from the editor |

## Known limitations (honest)
* Video encoding is client-side (WebCodecs). Browsers without WebCodecs get an explicit error; there is no server render farm.
* Canvas `ctx.filter` (blur/grade effects) needs Chrome/Edge/Firefox/Safari 18+; elsewhere those filters are skipped.
* 3D "rotateX/rotateY" on 2D layers is an affine approximation (scale by cosine), not true perspective.
* Lottie/Rive import and a Remotion adapter are designed-for but not bundled (licensing/scope).
