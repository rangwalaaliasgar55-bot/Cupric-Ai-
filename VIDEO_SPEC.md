# VIDEO_SPEC.md
* `VideoDoc { version, id, name, width, height, fps, durationInFrames, theme, scenes[], tracks[], audio[], captions[] }`
* `Scene { id, name, type (story type), from, durationInFrames, transitionIn?, background, nodes[] }`
* Node types: text, shape, background, particles, ui, chart, device, image, logo, three, physics, caption, group, effect.
* Timing: every node has `timing { start, duration }` in **frames relative to its scene**.
* Aspect ratios: 16:9, 9:16, 1:1, 4:5, 4:3, custom. Templates use `layout(aspect)` to produce alternate layouts (row vs stacked), not crops.
* Transitions: scene-to-scene, rendered by drawing outgoing & incoming scenes into two offscreen canvases and compositing with a transition function `(ctx, a, b, progress, params)`.
* Export: `renderVideo({ doc, format: 'mp4'|'webm', width, height, fps, range, alpha, onProgress })` → Blob via Mediabunny `CanvasSource`. PNG frame export via `canvas.toBlob`. JSON export/import with Zod validation.
* Remotion adapter (optional, not installed due to licensing): a Remotion `<Composition component={DocComposition}>` would call `useCurrentFrame()` → `renderFrame(ctx, doc, frame)`; no engine changes required.
* Audio: tracks with volume/fade/trim/offset/loop are previewed via Web Audio; exported video is currently **video-only** (audio muxing is a documented next step).
* Captions: SRT / VTT / JSON parsed into caption cues rendered by caption styles (basic, word-by-word, karaoke, highlight, kinetic, social, youtube).
