# RESEARCH.md — Ecosystem survey (conducted for this build)

This document records what was investigated before any dependency was locked. Findings that
changed the architecture are marked **⚑**.

## 1. Animation engines (DOM / JS)
| Library | License | Findings |
|---|---|---|
| **Motion** (motion.dev, ex Framer Motion) v13 | MIT | Hybrid WAAPI + JS engine, React-first (`motion.*`, layout animations, gestures), vanilla `animate()` usable outside React. Open source, well maintained. |
| **GSAP** 3.13+ | Custom "Standard No-Charge" license | Free incl. SplitText/MorphSVG/DrawSVG since Apr 2025. **⚑ The license prohibits use "in tools that allow users to build visual animations without code" that compete with Webflow, and Webflow may terminate it.** This project *is* a visual animation builder (editor + template system), so GSAP cannot be a core dependency. |
| React Spring | MIT | Good physics springs, but maintenance cadence slowed; springs are easy to solve analytically for frame-determinism. |
| anime.js v4 | MIT | Solid, small; overlaps with Motion. |
| Auto Animate / React Transition Group / Popmotion | MIT | Narrow scope or legacy (Popmotion folded into Motion). |

## 2. Motion graphics / video frameworks
| Library | License | Findings |
|---|---|---|
| **Remotion** | Custom (free ≤3 employees, company license above) | Best-in-class React video: `<Player>`, `<Composition>`, `<Sequence>`, `renderMedia()`. **⚑ Server rendering needs headless Chromium + FFmpeg; company license needed for most commercial teams.** |
| Motion Canvas | MIT | Generator-based, own canvas renderer, *not* React; great for explainers. |
| HyperFrames | Apache-2.0 | New HTML→video framework; young. |
| Theatre.js | Apache-2.0 core / AGPL studio | Keyframe editor for R3F; release cadence slowed since 2023. |
| **Mediabunny** | MPL-2.0 | Pure TS media toolkit (successor of mp4-muxer/webm-muxer). **⚑ WebCodecs encoding of a `<canvas>` straight to MP4/WebM in the browser, including alpha (VP9)** — no server, no FFmpeg. |
| FFmpeg.wasm | LGPL/GPL | 25 MB+ wasm, slow; superseded by WebCodecs for our use case. |

## 3. 3D
| Library | License | Findings |
|---|---|---|
| **Three.js** r186 | MIT | De-facto WebGL engine, WebGPURenderer maturing, PBR `MeshPhysicalMaterial` (transmission, IOR, clearcoat, iridescence, sheen). |
| React Three Fiber v9 / Drei | MIT | React 19 compatible reconciler for Three. Excellent for *interactive* React scenes. |
| Babylon.js / PlayCanvas | Apache / MIT | Full engines; heavier, less React-idiomatic. |
| Spline | Proprietary runtime | Hosted editor, not deterministic/frame-addressable. |

## 4. Physics
| Engine | License | Findings |
|---|---|---|
| **Rapier** (`@dimforge/rapier3d-compat`) | Apache-2.0 | Rust→WASM, fast, **cross-platform deterministic** stepping (critical for video), joints, impulses, CCD. |
| Jolt (jolt-physics.js) | MIT | Very fast, larger API surface, less JS ecosystem. |
| cannon-es | MIT | Pure JS, lightly maintained. Ammo.js: heavy emscripten Bullet port. Matter.js: 2D only. |

## 5. Vector animation
Lottie (lottie-web MIT, dotLottie) and Rive (MIT runtime) both require authoring in external tools
(After Effects / Rive editor). They are *import formats*, not generators; documented as future
importers, not bundled.

## 6. UI primitives
Radix (MIT, `radix-ui` monopackage), Base UI (MIT, v1), React Aria (Apache-2.0), Ark UI (MIT),
shadcn/ui (copy-and-own over Radix). All accessible.

## 7. Community registries (reference only — no code copied)
| Source | License notes |
|---|---|
| Magic UI | MIT |
| Aceternity UI | free components + paid "Pro" — not copied |
| React Bits | MIT + Commons Clause (no resale) — not copied |
| 21st.dev | per-component licenses — not copied |
| shadcn community registries | vary per registry |

We studied public demos for *ideas* (aurora, beams, spotlight, marquee, number tickers,
bento grids) and re-implemented them originally as deterministic canvas/WebGL renderers.

## 8. Other
Icons: Lucide (ISC). Charts: Recharts/visx/ECharts are DOM/time-driven and not frame-addressable;
charts must be deterministic per frame → custom canvas chart renderers. Smooth scroll: Lenis (MIT)
vs native — native CSS scroll is sufficient for the showcase; not installed. Validation: Zod v4 (MIT).
Testing: Vitest (MIT).
