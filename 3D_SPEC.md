# 3D_SPEC.md

> **Status (verified 2026-09-27).** Two places implement parts of this spec — know which one ships:
> * **Shipping in NewBrand Studio:** physics layers (`src/lib/studio/physics.ts`) — a real Rapier world (`@dimforge/rapier3d-compat`, now a declared dependency), fixed 60 Hz step, cached transforms → scrubbable and export-identical. Presets: stack, drop, explosion, dominoes. Drawn as an orthographic front view of the 3D simulation, added as a background layer ("Physics: …"). Checked by `npm run check:physics`.
> * **Not reachable from the app:** everything else below (`three` nodes, materials, lights, cameras, the `attractor` preset) lives in the vendored motion-engine editor (`src/three/renderer.ts`, `src/app/editor`), which the NewBrand app does not route to. Treat those bullets as the engine's spec, not as Studio capabilities, until they are wired into Studio.
* `three` node props: `object` (sphere, cube, torus, torusKnot, cylinder, cone, capsule, plane, icosahedron, octahedron, dodecahedron, ring, tube, text-extrude, logo-extrude, gltf), `material` preset, `lighting` preset, `camera` preset, `animation` (heroFloat, turntable, tumble, orbit, pulse, reveal), `count` (instanced arrays), colors, env intensity.
* Materials (MeshPhysicalMaterial presets): glass, frosted glass, chrome, metal, gold, silver, copper, plastic, matte, glossy, crystal, holographic, iridescent, liquid, emissive, wireframe, ceramic, carbon, pearl, obsidian.
* Lights: STUDIO, PRODUCT, CINEMATIC, NEON, RIM, SOFTBOX, DRAMATIC, DARK_LUXURY, FUTURISTIC, HOLOGRAPHIC.
* Cameras: PRODUCT, SAAS, CINEMATIC, TECH, LUXURY, MACRO, DRAMATIC, OVERHEAD, ORBIT, HERO (+ dolly/track/handheld shake as deterministic functions of t; orthographic option).
* Environment: procedural PMREM RoomEnvironment (no external HDR download).
* Physics node: Rapier world, fixed 60 Hz step, cached transforms per frame → scrubbable; presets: stack, drop, explosion, dominoes, attractor.
* Fallback: if WebGL unavailable a 2D gradient + silhouette fallback is drawn.
* Rendering: one shared offscreen WebGLRenderer, resized per node, `drawImage`d into the 2D compositor → 3D participates in transitions/effects/export.
