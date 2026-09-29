# Third-party notices

Cupric AI ships and adapts code and content from other projects. Each entry names
what was taken, where it lives, and the licence it is used under. Full licence
texts are kept beside the material.

## veedstudio/open-edit — Apache-2.0

- **Upstream:** https://github.com/veedstudio/open-edit (Copyright 2026 VEED LIMITED)
- **Licence:** Apache License 2.0 — `resources/open-edit/LICENSE`
- **Upstream notice:** `resources/open-edit/NOTICE` (retained verbatim)
- **Not used:** the `veed-engine-cli` renderer binary, the VEED account/credits
  APIs and the Fabric generation routes. They are covered by a different
  (PolyForm Shield) licence and are not part of Cupric.

**What was ported** (TypeScript, re-implemented against Cupric's own document
model and runtime):

| Upstream | Cupric | Notes |
| --- | --- | --- |
| `cli/src/prep/whisper-mapper.ts` | `src/lib/speech/transcript.ts` | whisper-family JSON → word-timed transcript. Reworked to take any Whisper-family payload from a file picker or IPC instead of a CLI path, and to expose the chunking as options. |
| `cli/src/prep/transcript-types.ts` | `src/lib/speech/transcript.ts` | the on-disk transcript shape, kept so a Cupric transcript is interchangeable with one the CLI wrote. |
| `cli/src/prep/synth-word-timings.ts` | `src/lib/speech/transcript.ts` | per-beat word reveal delays, real times with an even-split fallback and the completeness guard. |
| `cli/src/commands/speech-probe.ts` | `src/lib/speech/probe.ts` | measured noise floor, adaptive threshold, onset/decay and gap detection. Decoding now happens through WebAudio in the renderer and FFmpeg on the desktop, so the maths is the same on both. |
| `cli/src/edl.ts` | `src/lib/speech/edl.ts` | edit decision list types, validation and the frame-grid snapping rule. |
| `cli/src/commands/retime-transcript.ts` | `src/lib/speech/edl.ts` | moving word timings onto the timeline a cut produced, with the majority-overlap rule and dropped-word accounting. |
| `cli/src/commands/check-delivery.ts` | `src/lib/speech/delivery.ts` | delivery reporting shape: container facts, picture-offset sampling and EBU R128 loudness parsing. |
| `cli/src/safe-zone.ts` | `src/lib/studio/safeZone.ts` | the platform-safe area, one definition, used by the design engine and the gate. |
| `cli/src/wcag/policy.ts`, `windows.ts`, `treat.ts` | `src/lib/studio/gates.ts` | WCAG 2.2 thresholds (AA/AAA, large-text rule), the sliding one-second window policy, and the analytic evaluation of a fix against already-sampled background colours. Cupric samples its own rendered frames instead of the engine's statistics file. |

Modifications are described in each file's header. Cupric's version is a
derivative work under the same licence.

## awesome-opus-5-5-videos (opus55 catalogue) — MIT

`resources/opus55/` — see `resources/opus55/LICENSE`. Linked media and quoted
third-party material are not vendored.

## framecn — MIT

`src/lab/framecn/` — vendored components, licence at `src/lab/framecn/LICENSE`.
`resources/packs/framecn.json` records them with attribution.

## xevrion UI Lab, panelui, uselayouts

Vendored component sources with their upstream licence files preserved beside
them (`resources/panelui/LICENSE.upstream.txt`, `resources/uselayouts/LICENSE`).

## Fonts

Bundled families are SIL OFL (Fontsource). Fontshare families are **not**
shipped: Cupric only links to them and imports files the user downloads
themselves. See `src/lib/studio/fontStyles.ts`.

## WebCodecs / muxer

Not vendored. If a muxer library is added for the frame-exact export path, add
its licence here before shipping.
