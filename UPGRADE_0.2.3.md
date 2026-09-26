# Cupric AI v0.2.3 upgrade

Shipped on `main` for the design-system + resources + bridge pass.

## What landed

### Design system (pipeline Layers 1–5)
- `src/styles.css` — spacing, radius, shadow scales; stage background utilities
- `src/lib/motion.ts` — single soft ease + spring tokens
- `DESIGN.md` — updated source of truth (effects, bridge, omissions)

### Local video resources (on-platform generation)
- `src/lib/effects.ts` — backgrounds, transitions, captions, kinetic type, counters
- `src/lib/gradients.ts` — stage/thumbnail gradients only (chrome stays flat)
- Local planner + Arena prompts now inject flavor-matched effect cues

### Library
- New filters: **Effects**, **Backgrounds**
- Copy prompt cue / CSS to clipboard for Arena HTML and local use
- Visual gradient swatches on background cards

### Bridge / fake-logic cleanup
- `src/lib/bridge.ts` — prefer `window.cupric`, legacy `northframe`
- `App.tsx` + `gemini.ts` use `getIpc()` only
- Preload already exposes both names

### Version
- App package + sidebar: **0.2.3**

## How to run

```bash
npm install
npm run dev          # web
npm run desktop      # Electron
```

## Still open (next seams)

1. Wire Autonomous job queue end-to-end to rundown → Arena import → render services
2. Unify any remaining `NORTHFRAME_*` env mentions in Electron main to `CUPRIC_*`
3. Windows installer smoke test on clean machine
4. Optional: pull specific Spectrum empty-state / toast patterns into local components if a screen needs them

## Not vendored (by design)

Full copies of Spectrum UI, Adobe React Spectrum, Kdenlive, or the entire ui-lab site were **not** dumped into the tree — they would dual-kit the product and bloat the desktop package. Patterns were absorbed into tokens, effects, and Library resources instead.
