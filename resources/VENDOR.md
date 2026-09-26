# Vendor sources

| Source | Upstream | License (check upstream) | What we store |
|---|---|---|---|
| ui-lab | https://github.com/xevrion/ui-lab · https://lab.xevrion.dev | MIT | **fully vendored**: 190 components in `src/lab/components`, `registry.json`, avatars in `public/avatars` |
| design-scaffold | https://github.com/xevrion/design-scaffold | MIT | scaffold ideas (already matched by Vite tokens) |
| Spectrum UI | https://github.com/arihantcodes/spectrum-ui · https://ui.spectrumhq.in | see upstream LICENSE | registry index + pull pipeline |
| React Spectrum | https://github.com/adobe/react-spectrum | Apache-2.0 | **not vendored** — architecture notes only (size + visual language) |
| Kdenlive | https://invent.kde.org/multimedia/kdenlive · xevrion GSoC widgets | GPL-2.0+ | effect ideas → FFmpeg/Arena mapping only (C++/Qt not portable) |
| Open Props / Utopia / etc. | design-systems pipeline sites | various | checklist + token rules in DESIGN.md |
| React Bits | https://github.com/DavidHDev/react-bits | MIT + Commons Clause v1.0 | metadata links + original Cupric-native editable storyboards; no upstream source redistribution or ported collection |
| Skiper UI | https://skiper-ui.com | free commercial use with required attribution; per-entry credits may also apply | attributed catalog + original editable Cupric Studio storyboards; no upstream assets |
| Remotion packages | https://github.com/remotion-dev/remotion/tree/main/packages | package-specific Remotion/MIT terms | metadata links only beyond dependencies already declared in `package.json`; license review required |
| html-video | https://github.com/nexu-io/html-video | Apache-2.0 | content-graph, source-ingestion and renderer-adapter architecture reference; no runtime copied |

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

## React Bits, Skiper UI, and Remotion intake (0.7.0)

- **React Bits:** all 209 entries discovered from the upstream component registry are indexed in `resources/react-bits/catalog.json`. The Commons Clause forbids redistributing the components themselves, including a bundled or ported collection, so Cupric does not copy upstream source. Each reference now also supplies an original Cupric-native Studio storyboard made solely from ordinary editable text clips, local animations, tracks and keyframes. The Studio agent may translate any named reference into the same safe native operations.
- **Skiper UI:** all 106 entries supplied in the intake list are indexed. Because free use requires attribution, every pack item retains `Skiper UI · gxuri.me`; individual page credits must be checked before using upstream imagery. Cupric's entries are original editable text/media storyboards rendered by the deterministic Studio engine. The scroll-text and video-player references are included as `skiper31` and `skiper67`.
- **Remotion:** all 137 current `packages/` directories are indexed alongside the existing templates, fonts, and skills. The root Remotion License restricts derivative editor redistribution and some organizations require a company license. Therefore new package entries are metadata with an explicit `license-review` gate; no monorepo source was copied. Existing npm dependencies remain governed by their package terms.

## PanelUI (panel-ui/PanelUI)

- Upstream: <https://github.com/panel-ui/PanelUI> — `panelui-native`, MIT,
  Copyright (c) 2026 Khalid Abdi (licence copied to
  `resources/panelui/LICENSE.upstream.txt`).
- **Why the code is not vendored:** PanelUI is React Native / Expo
  (`react-native-reanimated`, `expo-blur`, `uniwind`). None of it renders in
  Cupric's DOM + canvas renderer, so copying the source would produce 135 files
  that cannot be imported. Pretending otherwise would be the worst outcome.
- **What is vendored:** `resources/panelui/registry.json` — all 135 components
  and 21 chart visualisations with the upstream behaviour descriptions, plus
  `theme.upstream.css`, their semantic token sheet. Both feed the Library's
  PanelUI pack and the generation prompt.
