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
| `cli/src/commands/check-delivery.ts` | `src/lib/studio/gates.ts` | delivery findings and loudness targets: `DeliveryFindings`, `LOUDNESS_TARGET` and the sampled-frame contrast policy. There is no separate `src/lib/speech/delivery.ts`; an earlier revision of this table named a file that was never created. |
| `cli/src/safe-zone.ts` | `src/lib/studio/safeZone.ts` | the platform-safe area, one definition, used by the design engine and the gate. |
| `cli/src/wcag/policy.ts`, `windows.ts`, `treat.ts` | `src/lib/studio/gates.ts` | WCAG 2.2 thresholds (AA/AAA, large-text rule), the sliding one-second window policy, and the analytic evaluation of a fix against already-sampled background colours. Cupric samples its own rendered frames instead of the engine's statistics file. |
| `cli/src/commands/expect-windows.ts` | `src/lib/studio/gates.ts` (`timingGate`) | the gate for *when* something is drawn: a reveal past the block's end, fewer delays than words, out-of-order delays, a long hold, a late reveal, two blocks sharing screen time. Upstream derives the same assertions from a manifest's `verify.expect` block; Cupric reads them from the clip's own word timings. |
| `cli/src/commands/readiness.ts` | `src/lib/readiness.ts`, `src/lib/readinessFacts.ts`, `src/app-shell/ReadinessPanel.tsx` | what is present versus missing, each miss with its remedy, the optional ones marked, read-only and no network. Cupric reads its own facts (`media:status`, `voice:status`, `settings:get`, `stock:keyStatus`) and adds the two project checks upstream has no equivalent of: clips whose file is not loaded, and an edit with nothing on the timeline. |
| `cli/src/commands/measure-placement.ts` | `src/lib/studio/placement.ts` | where the picture is empty: motion between two instants, detail in the middle frame and Cb/Cr skin as the fallback; the subject and head boxes; the safe-zone bands; and the calmest one. Upstream leaves the placement decision to the author and prints the numbers; Cupric adds `decidePlacement`/`planCaptionPlacement` so the decision can be applied as one undo step — and refuses to move anything when no subject was found, saying so. |
| `cli/src/prep/transcript-cache.ts` | `src/lib/studio/transcriptStore.ts` | one transcription per source file, and a guard so a fresh alignment never silently replaces the words a clip already carries (upstream protects a retimed transcript from being overwritten). Cupric keeps word timings in source seconds, so the check is a word-by-word comparison with a time tolerance, reported as `drift` instead of applied. |
| `cli/src/commands/scoped-edit.ts` | `src/lib/studio/scopedEdit.ts` | proving an edit changed only what it was asked to: a diff of two document revisions with an allow-list, because both revisions are valid and only the diff shows the 40 ms a caption was not supposed to move. Cupric's Studio "Fix all" allows exactly the clips its gate report named. |
| `cli/src/wcag/verify-applied.ts` | `src/lib/studio/gateRunner.ts` (`verifyAppliedFixes`) | re-measuring the document a fix produced, because a fix is scored analytically and a patch that missed its target would still be reported as an improvement. Upstream's promotion gate is structural (the block exists, the rules target measured text); Cupric re-runs the whole chain over the patched document and reports the findings that cleared, the ones that did not, and any error the fix introduced. |
| `pipeline/scripts/cut-frames.ts` | `src/lib/studio/gateRunner.ts` (`auditTimes`) | sampling frames at the moments things change — clip edges and word reveals — instead of an even sweep. Upstream's argument (a defect at a cut survives a uniform grid) is quoted in the function. |
| `cli/src/commands/creative-log.ts` | `src/lib/studio/creativeLog.ts` | what has already been tried on a piece of footage: a per-source log of rejected looks (each with a reason — a list without reasons cannot tell a later pass what to avoid) and the last accepted one, plus the history as prompt-ready prose. Cupric keys it by the file (falling back to the media handle, then the clip name), persists it in `localStorage` with a corrupt store preserved rather than overwritten, and adds two things upstream has no equivalent of: an attempt can name one of the design engine's directions, so a rejected direction is skipped by the next battle (`designAll({ avoid })`), and the brief is attached to the model prompt in `aiText.requestTextVariants` for text that sits over that footage. |
| `cli/src/commands/concat-chapters.ts` | `electron/assembly.cjs` (`concatList`, `shapeDiff`, `planConcat`, `concatArgs`) | joining gated renders by stream copy, with the shape of every part probed first because a mismatch produces a file that plays for one part and then glitches. Upstream refuses on any difference; Cupric's rundown render has a legitimate re-encode fallback (a hardware encoder that failed part-way), so a mismatch re-encodes onto one set of parameters and reports which part disagreed and how — the silent `-c copy` glitch is gone either way. |
| `cli/src/commands/mix-audio.ts` | `electron/assembly.cjs` (`mixGraph`, `mixArgs`) | one soundtrack out of many pieces: `role: voice \| music \| sfx \| ambience`, `atSec`, gain and fades, `amix` with `normalize=0`, and a bed ducked by the narration bus itself via `sidechaincompress` with the key padded to the film's length (an unpadded key cut the bed at the last word). The graph is built as text so it can be asserted before it runs. |
| `cli/src/commands/mux-audio.ts` | `electron/assembly.cjs` (`parseLoudnormSummary`, `measurementFromSummary`, `decideLoudnorm`, `loudnessPlan`, `muxArgs`) | laying a track onto a picture at delivery loudness, from a one-pass measurement: a linear gain when it reaches the target inside the true-peak ceiling, loudnorm's dynamic normaliser when it does not (named as the different processing decision it is), or nothing with a stated reason. The picture decides the length — never `-shortest`, which let a short mix truncate a film and exit 0. Cupric wires the decision into the Studio MP4 export and shows which correction ran in the export toast; `encoders.loudnormArgs` remains for callers that want the old fixed filter. |
| `cli/src/commands/apply-edl.ts`, `cli/src/edl.ts` | `electron/assembly.cjs` (`parseEdl`, `snapToFrames`, `snapRanges`, `inputSeeks`, `buildEdlGraph`, `decideColour`, `edlArgs`, `edlProblems`) | assembling the kept ranges of an EDL in one encode, with every edge snapped UP to its source's frame grid (so picture, sound and a retimed transcript land on the same instants) and every join crossfaded by two linear fades that sum to unity. Colour is one value for the whole output or a refusal. Ported and verified against real files; no UI surface calls it yet, and the audit names the intended call site. |

Modifications are described in each file's header. Cupric's version is a
derivative work under the same licence. The ported behaviour is covered by
`scripts/check-gates.mjs` (including the timing gate), `scripts/check-speech.mjs`
`scripts/check-scoped-edit.mjs`, `scripts/check-readiness.mjs`,
`scripts/check-placement.mjs`, `scripts/check-creative-log.mjs` and
`scripts/check-assembly.mjs` — the last of which runs the concat, mix, mux and
EDL argv against a real FFmpeg when one is present and reads the files back with
ffprobe (it says so and skips that half when none is, or when the build is too
old for the options these graphs use).

Built on the ported pieces, but Cupric's own code (not taken from open-edit):
`src/lib/studio/textTools.ts` `planCaptionLines` / `captionDelaysWithSource` —
the single caption planner both Studio's auto-captions and the Quick Video
pipeline use — and `StudioTimingSource` in `src/types/project.ts`, which records
whether a caption's per-word delays are real word times (`word`), phrase-level
stamps spread evenly (`phrase`) or estimates (`even`). Upstream's equivalent
guarantee is that word delays come from `word-timings.json`; Cupric keeps the
provenance with the clip so a caption that was never transcribed cannot claim
precision it does not have.

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

## Replaced engine packages — nothing shipped (Phase 5)

Two runtime dependencies were **removed** rather than shipped, because their
licences restrict commercial use. They are not in `package.json`, not in
`package-lock.json`, and not imported anywhere; `scripts/check-licences.mjs`
enforces all three.

### @paper-design/shaders-react — PolyForm Shield 1.0.0 (removed, not used)

The 18 Lab shader components (`fc-shader-*`) previously rendered through this
package. PolyForm Shield restricts using the software in a competing product and
restricts redistribution, so it cannot ship in a commercial build. The effects
were re-implemented from scratch in `src/lib/shaders/fields.ts`,
`src/lib/shaders/render.ts` and `src/lab/framecn/shader-kit.tsx`. **No Paper
Design source, shader code or asset is included** — the effect *names* and prop
*shapes* match what the vendored wrappers exposed, and the images are Cupric's
own. See `docs/PHASE1_LICENSING.md` Decision 1.

### Remotion (`remotion`, `@remotion/player`) — Remotion License (removed, not used)

Free only for individuals and organisations of up to three employees; a paid
company licence is required above that. The single usage — the Arena Desk rundown
preview — is now `src/components/MotionCompositionPlayer.tsx`, which is Cupric
code (a `requestAnimationFrame` clock, our own `springValue` from
`src/core/math.ts`, real transport controls). The Remotion-derived **resource
catalogue** (`resources/packs/remotion.json`) remains as metadata with
attribution; it contains no Remotion source and no Remotion runtime. See
`docs/PHASE1_LICENSING.md` Decision 2.

## heic2any (HEIC import) — MIT wrapper over LGPL-3.0 wasm

`heic2any` is MIT, but the WebAssembly inside it is compiled from **libheif**,
which is **LGPL-3.0-or-later**. Distributing it therefore carries an LGPL
obligation: the licence text and the corresponding source of libheif must travel
with the build. Upstream source: https://github.com/strukturag/libheif ;
the wasm in `node_modules/heic2any/dist/` is the build being redistributed.

**Status:** recorded here and asserted by `scripts/check-licences.mjs`; the
licence text is **not yet included in a packaged installer** and the position has
not had legal review. `docs/PHASE1_LICENSING.md` §4 lists the two clean
resolutions (ship the text plus corresponding source, or drop HEIC import).

## FFmpeg and ffprobe — GPL-class static builds

`ffmpeg-static` and `ffprobe-static` ship GPLv3-class static builds inside the
installer and are invoked as separate processes (`asarUnpack`); nothing links
against them. Required with every distribution, per Phase 4 packaging:

- the FFmpeg licence text (GPLv2/v3 as the build declares) in the installer's
  licence folder;
- the corresponding-source offer or link for the exact build shipped.

**Status:** recorded here; not yet verified inside a packaged build.
