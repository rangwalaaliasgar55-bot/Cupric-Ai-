# TECHNOLOGY_DECISIONS.md

## Selection matrix
| Capability | Candidates | Selected | Why |
|---|---|---|---|
| React UI framework | Next.js App Router, Vite SPA | **Next.js 16** (given) | Fullstack: API routes + Postgres persistence for projects/presets. |
| UI primitives | shadcn, Radix, Base UI, React Aria, Ark | **Radix (`radix-ui`)** | Accessible (focus mgmt, keyboard, ARIA), unstyled, tree-shakeable; shadcn is a styling layer over it — we own our own styles. |
| UI animation (DOM) | Motion, GSAP, React Spring | **Motion** | MIT, React-native API, WAAPI acceleration. GSAP excluded by license (⚑ editor = visual animation builder). |
| Complex timeline | GSAP timeline, Motion sequences, custom | **Custom deterministic timeline (`src/core/timeline`)** | Must be a *pure function of time* for scrubbing/export; must serialize to JSON; must be engine-swappable. ~400 LOC beats any dependency here. |
| Video composition | Remotion, Motion Canvas, HyperFrames, custom | **Custom canvas compositor + scene graph** | Single renderer drives preview, editor and export → no duplicate implementations. Remotion's licensing + Chromium render farm conflict with "works locally, no mandatory service". Scene graph is frame-based and Remotion-compatible (see VIDEO_SPEC adapter notes). |
| Video rendering/encoding | Remotion renderer, FFmpeg, FFmpeg.wasm, MediaRecorder, Mediabunny | **Mediabunny (WebCodecs)** | Frame-exact offline encoding (not real-time capture like MediaRecorder), MP4 (H.264) + WebM (VP9, alpha), MPL-2.0, zero server. |
| 3D | Three, R3F, Babylon, PlayCanvas | **Three.js (imperative, frame-driven)** | Scenes are data (scene graph nodes) rendered at arbitrary frame and composited into the video canvas. R3F's value (React reconciliation of an interactive tree) doesn't apply to a frame-addressed renderer; it remains a compatible optional adapter. |
| 3D animation | GSAP, Theatre.js, R3F useFrame | **Our timeline + presets** | Same keyframe engine as 2D → one motion language. |
| Physics | Rapier, Jolt, cannon-es, Ammo, Matter | **Rapier 3D (compat build)** | Deterministic stepping → frame-cached simulation that can be scrubbed and rendered. Lazy-loaded only when a physics node exists. |
| Particles | Three Points, custom WebGL, canvas | **Closed-form deterministic particles on Canvas2D** | Each particle's state is an analytic function of (seed, t) → seekable without re-simulation; thousands of particles with no React nodes. |
| Shaders | Three ShaderMaterial, raw WebGL, WebGPU | **Raw WebGL2/1 fullscreen runner** | 120-line runner, no Three needed for 2D shader backgrounds; trusted GLSL presets only (security boundary). |
| Vector animation | SVG, Lottie, Rive | **Canvas paths + SVG path strings** | Path drawing/morphing implemented with resampling; Lottie/Rive documented as future importers. |
| Smooth scrolling | Lenis, native | **Native** | Not needed for the product; avoids a dependency. |
| Icons | Lucide, Phosphor, Heroicons | **Lucide** | ISC, tree-shakeable, consistent 24px grid. |
| Charts | Recharts, visx, ECharts, custom | **Custom canvas charts** | Frame-deterministic, same easing system, exportable to video. |
| Video timeline UI | Remotion timeline template (paid), custom | **Custom** | Tracks/items model follows Remotion's documented timeline architecture (tracks → items with `from`/`durationInFrames`). |
| Audio | Web Audio, Remotion `<Audio>` | **Web Audio (OfflineAudioContext analysis)** | Deterministic per-frame band envelopes (bass/mid/treble/beat) precomputed from decoded audio or generated from BPM. |
| Editor | Custom, Theatre studio (AGPL), Polotno (commercial) | **Custom schema-driven editor** | Inspector generated from asset schemas. |
| Validation | Zod, Valibot | **Zod v4** | Import/export JSON validation. |
| Tests | Vitest, Jest | **Vitest** | ESM/TS native, fast. |

## Dependency ledger
| Dependency | Why / what it provides | Why not our own | Cost | License | Maintenance | Alternatives |
|---|---|---|---|---|---|---|
| three | WebGL PBR renderer, geometries, materials | Years of engine work | ~600 KB min (lazy on 3D pages) | MIT | very active | Babylon, PlayCanvas |
| @dimforge/rapier3d-compat | Deterministic rigid-body physics | Writing a physics engine is out of scope | ~1.5 MB wasm (dynamic import) | Apache-2.0 | active | Jolt, cannon-es |
| mediabunny | WebCodecs muxing to MP4/WebM | Container muxing is subtle | ~60 KB used (dynamic import) | MPL-2.0 | very active | FFmpeg.wasm |
| motion | DOM micro-interactions in showcase/editor | Mature, accessible, reduced-motion aware | ~18 KB for used APIs | MIT | very active | anime.js |
| radix-ui | Accessible Dialog/Tabs/Tooltip/Slider | a11y primitives are hard | tree-shaken | MIT | active | Base UI, React Aria |
| lucide-react | Icons | — | per-icon | ISC | active | Phosphor |
| zod | Schema validation of imported JSON | — | ~15 KB | MIT | active | Valibot |
| vitest | Tests | — | dev only | MIT | active | Jest |

## "Best library for the job" policy (implemented in `src/ai/library-selector.ts`)
| Task | Route |
|---|---|
| simple React interaction | Motion (`motion.*`) or CSS |
| complex / scrubbable timeline | core timeline |
| typography (char/word/line) | core text engine (`splitText`) |
| SVG/path morphing | core path resampler (`morphPaths`) |
| 3D | Three.js layer |
| 3D physics | Rapier layer |
| video composition | scene graph + canvas compositor |
| export | Mediabunny |
| accessible UI | Radix |
| GPU visuals | WebGL shader runner |
