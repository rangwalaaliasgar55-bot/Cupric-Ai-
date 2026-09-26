# Vendor sources

| Source | Upstream | License (check upstream) | What we store |
|---|---|---|---|
| ui-lab | https://github.com/xevrion/ui-lab · https://lab.xevrion.dev | MIT | **fully vendored**: 190 components in `src/lab/components`, `registry.json`, avatars in `public/avatars` |
| design-scaffold | https://github.com/xevrion/design-scaffold | MIT | scaffold ideas (already matched by Vite tokens) |
| Spectrum UI | https://github.com/arihantcodes/spectrum-ui · https://ui.spectrumhq.in | see upstream LICENSE | registry index + pull pipeline |
| React Spectrum | https://github.com/adobe/react-spectrum | Apache-2.0 | **not vendored** — architecture notes only (size + visual language) |
| Kdenlive | https://invent.kde.org/multimedia/kdenlive · xevrion GSoC widgets | GPL-2.0+ | effect ideas → FFmpeg/Arena mapping only (C++/Qt not portable) |
| Open Props / Utopia / etc. | design-systems pipeline sites | various | checklist + token rules in DESIGN.md |

## ui-lab: what changed in 0.3.0

The catalogue is no longer a reference list — the components run inside the app
(**UI Lab** screen) and can be snapshotted onto the Studio timeline.

- Code: `src/lab/components/*.tsx` (190 files, unmodified except imports)
- Metadata: `src/lab/registry.ts`, mirrored to `resources/ui-lab/registry.json`
- Next.js APIs replaced by local shims in `src/lab/shims/`
  (`next/image` → `<img>`, `next/font/google` → self-hosted stacks)
- Tokens: `--lab-*` in `src/styles.css`, scoped to `.lab-canvas`
- Requires React 19 (`inert`, `<style href>`), which the app now uses

## Why not full trees inside Electron

- **Adobe React Spectrum**: multi-package monorepo; shipping it doubles UI languages and installer size.
- **Kdenlive**: native C++/Qt; Cupric uses FFmpeg + HTML `__seek(t)` instead.
- **Full Spectrum UI app**: Next.js docs site + registry — we store the **index** and copy blocks on demand into tokens.

Patterns and catalogs **are** uploaded under `resources/` so agents and Library have them offline.
