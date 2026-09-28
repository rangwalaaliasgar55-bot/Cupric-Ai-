# Transitions.dev — attribution

- Source: https://transitions.dev (creator: Jakub Antalik)
- Patterns used: **Thinking states** ("Status line shimmers, then swaps to the next", `transitions-p28`)
  and **Matrix dot loader** ("16-dot matrix pulses in four patterns", `transitions-p33`). Both are free
  (non-Pro) copy-code snippets on the site.
- Inspected: 2026-09-28.

## Licence status

The site publishes these snippets for copy-paste use but **does not state a licence** (checked on the home
page on 2026-09-28). So:

1. Cupric ships **original re-implementations**, not the snippet code:
   - `src/lib/studio/loaders.ts`: a pure, deterministic frame-function model used by the Studio preview,
     export, and Library thumbnails.
   - `src/components/loaders/ThinkingStates.tsx` and `MatrixLoader.tsx`: live UI components that use
     Cupric tokens.
   The timing model, delay tables (`CORNERS`, `RING`, `INNER`, `TWINKLE`) and keyframe percentages are
   treated as the design spec being reproduced.
2. The two `*.reference.jsx` files here are the snippets exactly as the user supplied them. They are kept
   for attribution and comparison only. The app never imports or executes them, and they are not part of
   the renderer bundle.
3. Before redistributing the reference files in a public release, get the author's confirmation
   (contact on transitions.dev). You can delete them without affecting the app.

Changes relative to the upstream behaviour:
- Wall-clock timers and CSS `animation` are replaced by functions of clip-local time, so preview and export
  match.
- Colours default to DESIGN.md tokens (`--color-muted`, `--color-text`, `--color-panel-alt`, `--color-accent`)
  instead of the upstream greys.
- Added props: speed, loop, shimmer on/off, easing presets, reduced-motion export, backdrop, and size.
