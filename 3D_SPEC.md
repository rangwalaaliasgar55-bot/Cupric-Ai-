# 3D_SPEC.md
* `three` node props: `object` (sphere, cube, torus, torusKnot, cylinder, cone, capsule, plane, icosahedron, octahedron, dodecahedron, ring, tube, text-extrude, logo-extrude, gltf), `material` preset, `lighting` preset, `camera` preset, `animation` (heroFloat, turntable, tumble, orbit, pulse, reveal), `count` (instanced arrays), colors, env intensity.
* Materials (MeshPhysicalMaterial presets): glass, frosted glass, chrome, metal, gold, silver, copper, plastic, matte, glossy, crystal, holographic, iridescent, liquid, emissive, wireframe, ceramic, carbon, pearl, obsidian.
* Lights: STUDIO, PRODUCT, CINEMATIC, NEON, RIM, SOFTBOX, DRAMATIC, DARK_LUXURY, FUTURISTIC, HOLOGRAPHIC.
* Cameras: PRODUCT, SAAS, CINEMATIC, TECH, LUXURY, MACRO, DRAMATIC, OVERHEAD, ORBIT, HERO (+ dolly/track/handheld shake as deterministic functions of t; orthographic option).
* Environment: procedural PMREM RoomEnvironment (no external HDR download).
* Physics node: Rapier world, fixed 60 Hz step, cached transforms per frame → scrubbable; presets: stack, drop, explosion, dominoes, attractor.
* Fallback: if WebGL unavailable a 2D gradient + silhouette fallback is drawn.
* Rendering: one shared offscreen WebGLRenderer, resized per node, `drawImage`d into the 2D compositor → 3D participates in transitions/effects/export.
