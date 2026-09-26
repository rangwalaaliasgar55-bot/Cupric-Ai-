# Vendor sources

| Source | Upstream | License (check upstream) | What we store |
|---|---|---|---|
| ui-lab | https://github.com/xevrion/ui-lab · https://lab.xevrion.dev | MIT | registry catalog, interaction patterns, avatar license notes |
| design-scaffold | https://github.com/xevrion/design-scaffold | MIT | scaffold ideas (already matched by Vite tokens) |
| Spectrum UI | https://github.com/arihantcodes/spectrum-ui · https://ui.spectrumhq.in | see upstream LICENSE | registry index + pull pipeline |
| React Spectrum | https://github.com/adobe/react-spectrum | Apache-2.0 | **not vendored** — architecture notes only (size + visual language) |
| Kdenlive | https://invent.kde.org/multimedia/kdenlive · xevrion GSoC widgets | GPL-2.0+ | effect ideas → FFmpeg/Arena mapping only (C++/Qt not portable) |
| Open Props / Utopia / etc. | design-systems pipeline sites | various | checklist + token rules in DESIGN.md |

## Why not full trees inside Electron

- **Adobe React Spectrum**: multi-package monorepo; shipping it doubles UI languages and installer size.
- **Kdenlive**: native C++/Qt; Cupric uses FFmpeg + HTML `__seek(t)` instead.
- **Full Spectrum UI app**: Next.js docs site + registry — we store the **index** and copy blocks on demand into tokens.

Patterns and catalogs **are** uploaded under `resources/` so agents and Library have them offline.
