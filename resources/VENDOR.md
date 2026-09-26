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

## Liquid glass (0.4.0)

No third-party glass package is installed. The public write-ups below describe
the same technique (a generated displacement map + chromatic offset + rim and
specular), and Cupric implements it once in `src/lib/glass.ts` so that a single
parameter set drives both the DOM material and the canvas one.

| Reference | What we took |
|---|---|
| https://agpallav.com/liquid-glass (`liquid-glass-web-react`) | The parameter vocabulary — size, strength, chroma, curvature, bezel, blur, glow, edge, specular angle — and the insight that shape changes regenerate the map while strength/chroma/blur are pure filter updates. |
| https://liquefy-ui.com (`@liquefy-ui/react`, MIT) | Material knobs worth exposing (veil, refraction, frost, rim glow, iridescence) and the idea of an agent-readable registry, which `resources/packs/` mirrors. |
| https://glass-lens-react.vercel.app (MIT) | The three render paths, and the crucial constraint: `backdrop-filter` over a playing video goes black, so the Studio must composite glass on the canvas. `src/lib/studio/glass.ts` does exactly that. |

Nothing was copied verbatim; the presets (`hero`, `portfolio`, `plaque`,
`liquid`, `frost`, `lens`) are expressed in Cupric tokens.

## Why not full trees inside Electron

- **Adobe React Spectrum**: multi-package monorepo; shipping it doubles UI languages and installer size.
- **Kdenlive**: native C++/Qt; Cupric uses FFmpeg + HTML `__seek(t)` instead.
- **Full Spectrum UI app**: Next.js docs site + registry — we store the **index** and copy blocks on demand into tokens.

Patterns and catalogs **are** uploaded under `resources/` so agents and Library have them offline.
