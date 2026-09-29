## Also shipped: a fix that proves itself, and a transcription that is paid for once

- **`gateRunner.verifyAppliedFixes`** (upstream `wcag/verify-applied.ts`) — "Fix all" now re-renders the
  document it just patched, runs the whole chain over it, and reports what actually happened: which
  proposed fixes the finding cleared, which did not hold, and whether the fix introduced an error that
  was not there before. A fix is scored analytically, so without this a patch that missed its target
  still read as an improvement. The Studio toast says which case it is, and the recheck's own failure is
  reported rather than claimed as a pass. `check-gates.mjs` 147 → 166 assertions.
- **`studio/transcriptStore.ts`** (upstream `prep/transcript-cache.ts`) — one transcription per file
  (path/size/duration/language), so the second caption run on a clip is free instead of another minutes-
  long alignment. A clip that already carries word timings gets a `drift` report when the new alignment
  disagrees (words differ, or the clip had none) rather than having its words quietly replaced; the panel
  offers **Re-transcribe** to ignore the cache, says when a stored transcript was reused, and Settings →
  *Transcriptions kept* shows the count and how often the cache saved a run. `check-auto-captions.mjs`
  48 → 82 assertions. Found and fixed a real bug while testing: the entry being written could be the one
  its own write evicted.

## Also shipped: a gate for *when* things are drawn, and a fix that proves its own scope

Three items from the reference audit's "still copyable from open-edit" list, all pure and all tested:

- **`gates.timingGate`** (upstream: `commands/expect-windows.ts`) — the chain gained a `timing` stage
  (lint → timing → safe zones → contrast → deliver). Every other gate judged *what* is drawn, so a
  caption that arrives a second late, holds after its last word, lists fewer delays than words (the
  trailing words never appear), reveals out of order, or is still up when the next one lands passed all
  of them. Errors carry a one-click fix (extend the block to fit its last word); warnings carry the
  numbers. `scripts/check-gates.mjs` 124 → 147 assertions.
- **`gateRunner.auditTimes`** (upstream: `pipeline/scripts/cut-frames.ts`) — the audit now samples the
  moments things change: clip starts and ends and every timed block's first and last reveal, with the
  remaining room filled by an even sweep. The upstream argument is kept in the function: a run that
  sampled on an even grid called its deliverable clean while the defect lived only at the cuts.
- **`studio/scopedEdit.ts`** (upstream: `commands/scoped-edit.ts`) — `diffStudioDoc(before, after,
  {allow})` names every change and flags the ones nobody asked for. Studio's "Fix all" now allows exactly
  the clips its own gate report named, and says so in the toast (or warns when the fix drifted). Covered
  by `scripts/check-scoped-edit.mjs` (34 assertions), wired into `build` and `verify`.

## Also shipped: break a montage apart at its own cuts

`src/lib/studio/shots.ts` — shot/scene detection with no model and no network: the clip's own frames
are sampled at 4 fps into a 64 px-wide canvas, the mean-absolute luma difference between consecutive
samples is thresholded adaptively (`max(0.06, median + 5 × MAD)`, with a strong-change fallback so an
obviously cut montage never reports "no cuts"), a spike must beat both neighbours, and two changes
closer than `minShotSec` collapse to the stronger one. `decompose.ts` grew two modes on top of it:

- `shots` — split where the picture changes, removing nothing (`breakAtPoints`), so a finished edit
  arrives as its own cuts and the timeline still plays back exactly as before.
- `auto` — the import path: close the pauses the voice left empty (word timings first, else the
  measured waveform) **and** split the result at the shot cuts, skipping the ones that fell inside
  removed silence instead of inventing empty pieces, and saying so in the notes.

Reachable from the timeline right-click menu (**Break at scene changes (the picture)**) and from
Studio → Pro → Auto-edit → *Break into clips* (*Shots + pauses* / *Scene changes*). Frame sampling
needs a decodable video, so `scripts/check-decompose.mjs` (now 96 assertions) covers the pure half —
`frameDifference`, `median`, `shotCutTimes`, `remapSourceTime` — plus the whole assembly with the
shots handed in, and `docs/SMOKE_WORD_TIMED_CAPTIONS.md` scenario E is the packaged-desktop check.

## Also shipped: break an imported video into editable clips

`src/lib/studio/decompose.ts` — one clip → many ordinary clips. Three ways in,
all on existing machinery: measured pauses (`studio/speechProbe.ts` → `probeCuts`,
no transcript or model needed), pauses in the words (`autoEdit.speechCuts` with
`fillers: false`, so nothing spoken is deleted), or even pieces for footage with
no speech. `breakAtCuts` either closes the silence up (a real edit, `tightenClip`)
or splits at the pause boundaries keeping the original timing, so each pause
becomes a clip you can delete. Word timings stay on every piece in source
seconds, so captions and word-timed components keep working without
re-transcribing, and captions can be generated *before* the cut so the existing
remap carries them onto the new timeline. Reachable from Studio → Pro →
Auto-edit → *Break into clips* (preview → accept, one undo) and from the timeline
right-click menu. `scripts/check-decompose.mjs` (96 assertions, including the scene-change modes below) runs in
`build` and `verify`; `docs/SMOKE_WORD_TIMED_CAPTIONS.md` scenario D is the manual check.

## Latest: captions that follow the voice, cuts measured from the waveform, and gates that read pixels

The open-edit port (`veedstudio/open-edit`, Apache-2.0 — see
`THIRD_PARTY_NOTICES.md`) landed as four pieces, each wired into a real path in
Cupric rather than parked beside it.

### Speech layer (`src/lib/speech/`)
- `transcript.ts` — every Whisper family output (WhisperX/openai-whisper/mlx
  `segments[].words`, whisper-timestamped `text`, OpenAI verbose_json `words`,
  whisper.cpp ms offsets) maps to ONE shape. Untimed words are interpolated
  across their neighbours, words are grouped into beats (provider segments, else
  pauses), and **words in === words out** is enforced: a mapper that drops a word
  throws. A segment whose alignment failed but which still has text keeps it now
  (that sentence used to vanish).
- `probe.ts` — the measured silence detector: floor = 10th percentile of 10 ms
  windows, threshold = min(floor+12, floor+35% of the range), gaps ≥ 250 ms, and
  `speechFound: false` when the whole clip is one flat level.
- `edl.ts` — frame snapping (ceil, so a cut never clips the last frame), the cut
  planner from a probe (padding for room tone, minimum cut/keep), transcript
  retiming onto the cut timeline, and `cutsFromRanges` for the flip back.
- `captions.ts` — assigns spoken words to caption clips by overlap, wraps them
  (never dropping a word), and reports orphans and out-of-sync windows.

### Captions on the voice
- `StudioTextClip.wordDelaysMs` (clip-relative ms) is the new contract; the
  renderer reveals word n when it was *spoken*, and tints the word being said
  (karaoke) instead of spreading words evenly across the block.
- `captionsFromTranscript` breaks captions at real spoken pauses (0.35 s), not
  only at punctuation, and carries the delays. Phrase-timed engines (Windows
  Speech) get an even split rather than three identical delays.

### Cut on measured silence
- Studio → Pro → Auto-edit → **Tighten by silence**: decodes the clip, probes it,
  and hands the measured gaps to the same cut machinery the word path uses — so
  a clip that was never transcribed can still be tightened.

### Delivery gates (`src/lib/studio/gates.ts`, `gateRunner.ts`)
- WCAG 2.2 contrast measured on the actual rendered pixels (ring sampling around
  each text block, sliding one-second windows, one bad second fails the block),
  platform safe zones, and the delivery numbers when the encoder has them — one
  chain that stops at the first error and names it, with a two-correction budget.
- Studio → **Checks** → *Run delivery checks* renders the edit at audit size and
  reports findings with a measured one-click fix, plus **Fix all** as one undo
  step.
- `scripts/check-speech.mjs` (101 assertions) and `scripts/check-gates.mjs`
  (124) run headless in `npm run build`; `check-renderer` proves the caption
  reveal on the paint calls; `check-auto-captions` proves the delays.

### Still open (see `UPGRADE_PLAN.md`)
- Fast export (WebCodecs/FFmpeg) so the gates can run on a file rather than a
  canvas; Playwright CI lane; design goldens; Piper voiceover in the agent.

## Latest: autonomous runs, the design engine, and fonts that load

An autonomous job no longer needs the desktop app to finish, and the app no
longer paints a fallback face while claiming a font was applied.

### Autonomous agent — one pipeline, both environments
- `src/lib/automation/{plan,run,report}.ts`: the eight desktop steps run *in the
  app* — offline deterministic planner (`planLocally` over the Opus catalogue +
  UI resources) → locked rundown → three-direction design battle → timeline →
  render on the shared Studio renderer → machine-checked review report.
- The web build used to stop at step one ("desktop only"). It now produces the
  same artefacts: a rendered preview, editable Studio clips, the battle and the
  report. `runAutomationLocally` in the store owns the state; cancel, resume and
  the guided review gate all work with no Electron.
- Desktop keeps its own FFmpeg pipeline, but `automation:start` now normalises
  the rundown the renderer planned and starts from it instead of a placeholder.
  A desktop run that fails can be finished in-app with **Finish in Studio**.
- New in the UI: the candidate battle with scores and reasons, the scene-by-scene
  storyboard (stage, face, accent, timing), the rendered video with a download,
  and the full review report.
- Media already in the project is assigned to planned shots by file name, so a
  run designs *around your footage* instead of planning placeholders (`reused`
  counts the clips that made it in; the step log says so).

### Design engine (`src/lib/studio/design.ts`)
- `DESIGN_DIRECTIONS` = typography-led / composition-led / atmosphere-led. Each
  designs the same plan: per-scene stage, contrast-checked ink, safe areas,
  eyebrow/headline/support hierarchy, one accent per scene, real transitions.
- `designAll` runs all three, scores them (`designScore`), and commits the
  winner — wired into the autonomous run, `ProductionPlanner` and a new Studio
  panel ("Design engine"). The user can pin one direction instead of the battle.
- The score rewards contrast, safe-area compliance, hierarchy, stage/accent
  variety and legible sizes, and reports the reasons to the UI.

### Fonts (the "suggested fonts don't work" bug)
- `ensureFont` actually loads bundled and user faces (`document.fonts.load` +
  `check`) before anything claims a font was applied; the emphasis face is
  planned and loaded with the headline face; `Noto Sans Devanagari` and `Hind`
  are recognised as bundled; a failed download is retried the moment a font file
  is added; a face that cannot load raises `FONT_MISSING_EVENT`, which App.tsx
  turns into a toast with the Fontshare link.
- Exports verify every face first and warn (toast) instead of baking the
  fallback into the file.
- Checks: `check:framecn-fonts` (728 assertions) covers the new rules;
  `check:automation` (73 assertions) covers planning, media binding, the battle,
  the pinned direction, the full eight-step run with an injected render, the
  guided gate, cancel, report truth and the UI/store wiring.

### Still to eyeball in a real browser
- The local render step needs `MediaRecorder`; in the sandbox it is stubbed. On
  a real machine, run an Auto Draft job on a short brief and watch the preview
  appear in the job card.
- Fontshare zips: add one with "Add fonts" and confirm the family appears in the
  text inspector without a reload (the failure cache is cleared on import).

## Latest: framecn, fonts, cursor v2
- `check:framecn-fonts` has 721 assertions, and every framecn component is server-rendered in the check.
- Not verified in a real browser. Eyeball these:
  - shader components (WebGL) recording in the Studio;
  - Add fonts with a real Fontshare zip;
  - the cursor Auto style swapping arrow to hand.
- Refresh framecn: `gh repo clone shadcn-labs/framecn /tmp/framecn -- --depth 1 && node scripts/vendor-framecn.mjs /tmp/framecn && node scripts/build-packs.mjs`

## Latest: Motion kit (3D, shapes, cursor, fonts, rich captions)
- Covered in MOTION_KIT.md. Check: `check:shapes-cursor-3d` (221 assertions, in the build).
- Not verified in a real browser yet (no headless browser in the sandbox). Eyeball the 3D projection seams, the rich-caption line heights, and the cursor on a recorded component.

# NEXT_SESSION.md — Cupric AI implementation status

## Current status (v0.4.0)

Shipped earlier (0.2.x): Gemini/OpenCode IPC, key storage, Arena ZIP/HTML import,
footage analysis, timeline MP4 render, persistence, updater foundation, Windows
packaging, effects + gradient packs, design tokens.

### New in 0.3.0 — make the video here

- **Studio** (`src/screens/Studio.tsx`, `src/lib/studio/*`) — a CapCut-style
  editor inside the app: multi-track timeline, drag to move/restack, edge trim,
  split at playhead (⌘/Ctrl+B), duplicate, delete, snapping, zoom, scrub,
  real playback with audio, and a WebM export recorded from the same renderer
  the preview uses.
- Clip kinds: video, image, text (6 animations + Hormozi / standard / minimal
  caption styles + lime highlight word), background, and UI Lab overlays.
- 10 canvas-painted backgrounds shared with the Library (`gradients.ts` is now
  a view over `studio/backgrounds.ts`, not a duplicate list).
- **UI Lab** (`src/screens/Lab.tsx`, `src/lab/*`) — all 190 components from
  lab.xevrion.dev vendored and running locally, searchable by category, with
  "Send to Studio" to rasterise one onto the timeline.
- **Chat on free models** — `src/lib/opencode.ts` adds a browser-side
  OpenAI-compatible client (OpenCode 4096 / Ollama 11434 / LM Studio 1234 /
  llama.cpp 8080 auto-probe, OpenRouter `:free`), and the Ask panel now saves
  settings in the web build instead of silently doing nothing.
- React upgraded to 19 (the vendored lab uses `inert`, `<style href>` and
  React 19 ref semantics).

### Bugs fixed in this pass

| Bug | Fix |
|---|---|
| App did not typecheck (`askGeminiChat` returned `unknown` into `ChatMsg`) | typed IPC boundary + `satisfies ChatMsg` |
| Autonomous run in the browser marked every step **done** without doing anything | reports "desktop only" and points at Studio |
| `desktopAwareStorage` and 6 screens read `window.northframe` only | everything goes through `getBridge()` / `getIpc()` |
| Footage upload invented a file name (`raw-clip-482.mp4`) | neutral label until the picker returns the real name |
| Local planner faked 0.7–1.5s of "thinking" latency | removed |
| `gradients.ts` and the Studio kept two drifting background lists | one source of truth |
| `render:copyToDownloads` toast claimed success on failure and read a missing field | reports the real error/path |
| `nextFreeStart` returned an occupied slot (found during smoke tests) | gap must actually fit the clip |
| `resources/catalog.json` pointed at a non-existent `ui-lab/registry.json` | generated from the vendored registry (190/190) |

### New in 0.4.0 — glass, packs, voice, MP4

- **Liquid glass** — one material (`src/lib/glass.ts`) driving a DOM path
  (`src/components/glass/GlassSurface.tsx`: backdrop-filter + SVG
  `feDisplacementMap` per channel) and a canvas path
  (`src/lib/studio/glass.ts`) so glass survives into the exported video.
  Six presets; new **glass clip** kind (panel/lens, four motions, label).
- **New motion** — transitions now 10 (`blur`, `iris`, `push-up`,
  `glass-wipe`, `liquid-dissolve`, `lens-sweep` added) and text animations 9
  (`shimmer`, `glass-rise`, `liquid-wave` added), all listed in one registry
  (`src/lib/studio/transitions.ts`) that the inspector and Library read.
- **Backgrounds 10 → 17**, including mesh gradients and animated liquid ones,
  each with a CSS twin and a canvas twin.
- **Resource packs** — `resources/packs/*.json` generated by
  `npm run packs:build`, fetched from the repo's raw URL at runtime, cached in
  IndexedDB by "Download all", with a same-origin fallback served by a small
  Vite middleware. `src/lib/packs.ts` + `src/screens/library/PackBrowser.tsx`.
- **Voice commands** — `src/lib/voice.ts` (pure grammar + Web Speech listener)
  wired to a Studio mic button; every command runs the same store action the
  buttons do.
- **MP4 on desktop** — `studio:exportMp4` in `electron/main.cjs` transcodes the
  MediaRecorder WebM to H.264 with FFmpeg; the button only appears when the
  bridge is present.
- **One-click hand-offs** — Footage Desk "Edit in Studio" and Arena Desk
  "Send to Studio" (`src/lib/studio/handoff.ts`).
- **Ambient app backdrop** + translucent sidebar/top bar
  (`src/app-shell/AppBackdrop.tsx`), disabled under reduced motion.
- **`npm run check:renderer`** — headless renderer smoke test (272 assertions)
  now part of `npm run build`.

## Open work

- [ ] Autonomous queue → full rundown / import / render orchestration
- [ ] Autonomous queue → full rundown / import / render orchestration
- [ ] Electron main: standardize env overrides to `CUPRIC_FFMPEG_PATH` / `CUPRIC_FFPROBE_PATH`
- [ ] Clean Windows 11 installer smoke test outside the sandbox
- [ ] Per-clip audio track UI (volume automation, music bed)
- [ ] WebGL path for the DOM glass (current DOM path is SVG filters only)
- [ ] Packs: signed/versioned updates instead of always trusting the branch head

## Human-in-the-loop Arena workflow

Unchanged: generate prompt → user pastes into arena.ai/code → vote → import winner.

## Media binaries

If `ffmpeg-static` fails to download, set:

```bash
CUPRIC_FFMPEG_PATH=C:\path\to\ffmpeg.exe
CUPRIC_FFPROBE_PATH=C:\path\to\ffprobe.exe
```

## Master-prompt progress (2026-09-27 session)

Done, each with a `check:*` script chained into `npm run build`:
2.13 component length + recorded shelf · 2.14 legibility scrim · 2.24 HW encoding (NVENC/QSV/VideoToolbox → libx264) ·
2.25/2.30 photo previews, HEIC + EXIF · 2.26 autosave snapshots + restore · 2.27 diagnostic report · 2.28 sandboxed capture ·
2.29 schema migration · 2.31 undo re-audit (`check:undo`, runs against the real store) · 1.10 offline voice (Whisper → Windows Speech).

Needs a hardware pass: 1.10 on Windows (`npm run whisper:fetch`, then speak), and 2.24 on NVENC/QSV/Apple machines.

Still open: 2.1–2.12, 2.15–2.23, verify 1.4 and 1.8, Part 4. `editOps.ts` still caps agent recordSec at 6.
The web-build-only Arena capture paths (`captureArenaThumbnail`, `captureArenaFrame`) still use same-origin iframes.

Third-party licenses: heic2any/libheif is LGPL-3.0 (dynamically loaded JS/wasm, unmodified).
whisper.cpp and the ggml models are MIT. Both are fetched and bundled with attribution, not rebranded.


## Master-prompt progress — Part 2 remainder (same day, second pass)

New subsystems, all covered by `npm run check:pro` (193 assertions, chained into `build`):
- 2.1 Q/W trim-to-playhead, Shift+Delete ripple, [ ] slip, Alt+, / . roll (`timelineOps.ts`)
- 2.2 custom bezier ease + curve editor (`curves.ts`, `CurveEditor.tsx`). On-canvas keyframe drag was already shipped (record mode).
- 2.3 lift/gamma/gain wheels, .cube LUTs, histogram/waveform/vectorscope (`color.ts`, Pro tools → Scopes)
- 2.4 auto-ducking (the same gain in preview and export), BS.1770 LUFS maths, loudnorm on MP4 export. Timeline waveforms were already shipped.
- 2.5 text presets, captions from a transcript, 9:16 social-UI safe guide
- 2.6 blend modes, chroma key with spill
- 2.7 markers (M, ; '), snapping, "All sizes" export queue. **Video proxies NOT done**; photo proxies are done.
- 2.8 / 2.10: the Studio already used Library's PackBrowser; the timeline is now a drop target (files + resource cards).
- 2.9 suggestions with preview → accept (`suggestions.ts`)
- 2.11 12 new agent ops; the component recordSec cap of 6 s is removed
- 2.12 AI rewrites with a labelled rule-based fallback
- 2.15 device mockups · 2.16 product-photo presets · 2.17 auto grade · 2.18 kinetic words · 2.19 collage ·
  2.20 testimonial grid (placeholders only; export blocks unfilled ones) · 2.21 before/after · 2.22 logo reveals ·
  2.23 build-from-assets (product/startup/business)
- 1.4 track reorder: verified as already shipped. 1.8: added 1 s / 4 s backoff; the rest was verified as already shipped.
- Part 4: `resourceLinks.ts` licence check (blocks CapCut/DaFont/paid marketplaces/social posts; GitHub licence lookup; rights confirmation for unknown sources; Credits on the doc)

Still open: video proxies; real Whisper word timestamps for captions (the API accepts `words`, but voice:transcribe returns text only);
Windows hardware pass for 1.10/2.24; web-only Arena capture paths still use same-origin iframes.

## Session: proxies, timed captions, Arena sandbox, component director
- **2.7 Video proxies**:
  - `electron/proxies.cjs` defines the rules: 540p, GOP 12, cached by path, size and mtime.
  - `media:proxy` / `media:proxyDelete` IPC.
  - `src/lib/studio/proxy.ts` auto-makes proxies on import (Auto/Always/Off).
  - The preview draws `previewVideo`; export always reads the original.
  - Controls live in the Inspector "Preview proxy" box.
  - `check:proxies` runs a real FFmpeg transcode.
- **Auto-captions with timing**:
  - `voice:transcribeMedia` extracts audio with FFmpeg, then runs Whisper `-ml 1 -sow -oj`, which gives per-word timing.
  - The fallback, Windows Speech, gives per-phrase timing, and the UI says so.
  - `src/lib/studio/autoCaptions.ts` maps source time to timeline time through trim and speed.
  - `check:captions`. Whisper itself has not been run here (no model can be downloaded in the sandbox).
- **Arena web capture sandboxed**:
  - `openSandboxedScene()` in `htmlTemplateCapture.ts` is now the only way to create an iframe.
  - The thumbnail (`browserMedia.ts`) and browser render (`render.ts`) both use it.
  - `inlineBlobAssets()` inlines the zip assets.
  - `check:sandbox` fails if any other file creates an iframe.
- **Component director**:
  - `src/lib/studio/componentDirector.ts` decides when, which, how and where from the text cues. It emits `addComponent` ops.
  - It's surfaced as a suggestion and in the Pro tools "Smart components" section.
  - `check:director`.
- The real-machine checklist is in `HARDWARE_TEST_PLAN.md`.

## Editor upgrades batch (formats · context menu · scenes/variables · events/API · auto-edit · Phone Studio)
Studied openvideodev/react-video-editor and sambowenhughes/a-react-video-editor (no code copied; ideas re-implemented on Cupric's pure doc model).
- Formats: 4:5 feed, 720p–2160p (Ultra HD), channel presets (`formats.ts`) with length warnings.
- Per-clip context menu + hotkeys (copy/cut/paste/duplicate/split/arrange/flip/hide/mute/lock) — `clipActions.ts`, `ClipContextMenu.tsx`. Locked clips refuse with a reason.
- Output pass `resolve.ts` (hidden, muted, `{{variables}}`) shared by preview + export.
- Scenes + Variables panels (`scenes.ts`); event bus `studioEvents.ts`; scripting API `window.cupricStudio` (`studioApi.ts`), mutations go through validated ops.
- Auto-edit (`autoEdit.ts`, pure): beat detection + snap cuts, tighten speech (fillers/pauses), smart reframe, pacing. Analysis via WebAudio/canvas in `autoEditAnalysis.ts`.
- Phone Studio (`phone.ts`): coloured frame/bezel/island mockup, 6 motions, product/lock-screen/social animated screens, screenshot scroll; ProPanel section + `phoneDesign` agent op. Ratings/likes are blank unless typed by the user.
- Check: `npm run check:editor-upgrades` (141 assertions).
Hardware follow-up: verify beat analysis on long MP3s and reframe on real 4K footage on Windows.

## Session: import / tracking / physics / reach / reskin (commits 38e2c58 → HEAD)

**Done, with checks passing:**
- **Multi-file ZIP import** (`check:source-project`, 38 assertions):
  - Chapter maps become one named clip per chapter; scene components become overlays; keyframe arrays become Studio keyframes.
  - The audio engine maps to the audio track; WebGL/particle scenes map to a background layer; palette, fps, duration and fonts go to the doc.
  - An unknown project shape gets an explicit refusal message.
- **Object-tracked masks** (`check:mask-track`): per-frame tracking.
- **Physics:** real Rapier physics layers (`check:physics`). 3D_SPEC status has been corrected.
- **Resource reach** (`check:resource-reach`):
  - `electron/resource-context.cjs` searches every non-font, non-voice pack (1661 items across 16 packs) and gives each scene a beat.
  - Beats: opener → mesh/particles; stat → count-up; testimonial/logo → marquee/stagger; gallery → native scroll; CTA → magnetic/spotlight.
  - Each scene gets a background, main and accent layer. The candidate prompt carries the scene plan.
- **UI library pack** (`resources/packs/ui-libraries.json`, carried through by build-packs):
  - Mantine (128 items, MIT) plus Pixel Perfect UI (301) and Sora UI (7). Pixel Perfect and Sora UI have no verified license, so they are link-only.
- **The 8 SaaS primitives** now all exist as Lab components: bento-grid and mesh-gradient were added, and both are in `resources/ui-lab/registry.json`.
- **Editor:**
  - Slide trim (Alt+[ / Alt+]).
  - Nested sequences: Scenes → "Nest at playhead"; flattened in `resolveForOutput`, so preview and export agree.
  - Already present: scopes, proxies, ripple/roll/slip, and the multi-aspect export queue.
- **Voice:**
  - Offline Whisper, falling back to Windows Speech.
  - A spoken brief now needs a yes (spoken or clicked) before a job starts.
- **Reskin:**
  - Geist Variable UI font, Mantine heading scale, sheen surfaces (`.cu-panel`), restyled Button/Card/EmptyState/Segmented/nav, and Library/Autonomous/Studio headers.
  - Documented in DESIGN.md.

**Still open (be honest with users):**
- **Voice** still needs a hands-on pass on Windows hardware (see HARDWARE_TEST_PLAN.md).
- **Nested sequences:**
  - A sequence clip has no dedicated inspector (placement uses the generic fields).
  - The nested content is a snapshot of the saved scene. Use "Overwrite" on the scene to refresh it.
- **Export queue:** runs jobs in sequence in the renderer, not in a separate background process.
- **Reskin:**
  - The shared primitives and headers are restyled.
  - Many one-off inline class strings in the Studio sub-panels still use the older flat look.
  - It has not been visually checked, because there is no headless browser in the sandbox.
- **Optional ideas not started:** speed ramping UI, one-click repurpose, TTS voiceover, Brand Kit panel, batch variants.
  - Auto-captions already exist.

## Session: finder, essentials, creative tools, Studio panel reskin

- **Resource Finder** (`src/lib/resourceFinder.ts`, `check:finder`):
  - Lives at the top of the pack browser.
  - Takes a plain-language description and maps it to intents, with stemming and one-typo fuzzy matching.
  - Searches all 17 packs, returns results in a fixed order with at most 6 per pack, and explains every match.
- **Essentials pack:**
  - Framer Motion, GSAP, Inter, Geist, Satoshi, Simple Icons, Logo.dev, Lucide.
  - Also Fontsource, Phosphor, Tabler, unDraw, LottieFiles, Pexels, Mixkit, Coolors.
  - Every entry carries its url and license. The curated file is carried through by build-packs.
- **Bugs fixed:**
  - Duplicate PanelUI ids (panelui-index ×3, panelui-icons ×2).
  - 21 ambiguous background names; chrome variants are now labelled "(app chrome)".
  - `check:resources` now enforces unique ids.
- **Creative tools** (`src/lib/studio/creativeTools.ts`, `StudioCreativePanel.tsx`, `check:creative`):
  - Speed ramps: 5 presets with continuous source footage; later clips on the track ripple.
  - Repurpose reframe: text size is held against the short side, and text is kept in the safe area. "All sizes" now uses it.
  - Brand Kit: colours, font and logo on the project. Text colour is picked for contrast, the logo is stamped once, and the background changes only when asked.
  - Simple Icons: logo lookup via the CDN (online only).
  - Batch variants: saved as scenes, with an "Export every scene" batch.
  - Offline TTS voiceover (`electron/tts.cjs`, IPC `voice:tts`): Windows SAPI, macOS `say`, eSpeak NG. Text goes in via env/stdin only.
- **Studio panel reskin:** new `.cu-section`, `.cu-input` and `.cu-chip` classes applied across Inspector, ClipProFields, ProPanel, Timeline and drawers; the side drawers have gradient surfaces.

**Open:**
- **TTS:** not run on real OS voices here (no Windows/macOS in the sandbox). The command shapes are tested.
- **Visuals:** no visual review of the reskin (no headless browser).
- **Scene batch:** the "Export every scene" batch renders one scene after another in the renderer.

## Agent kit (ObsidianUI + smarter component use)
- `src/lab/obsidian/`: `ob-flip-text`, `ob-text-stream`, `ob-click-spark`, `ob-marquee-band` — Cupric re-implementations of ObsidianUI (MIT, gitlab.com/Atharvsinh-codez/ObsidianUI) ideas, pure functions of the stage clock. V-Prism / Liquid Metal were skipped (three.js + postprocessing + GLTF; framecn shaders already cover the look). The rest of ObsidianUI is shadcn UI or web-only interaction (hover, drag, scroll).
- `src/lab/propConfigs.ts`: the ONE prop registry (framecn + ob). Every non-shader component gets a universal `fontFamily` prop; `FramecnStage` applies it with scoped CSS that keeps monospace text mono.
- Agent: `setComponentProps` op (edit words/colours/font inside a placed component, re-records); `addComponent.track`; category-aware default motion (self-animating components only fade); `addText` without motion eases on/off; `INTENT_PICKS` + `COMPONENT_USE` lead the catalogue by intent; prompt has COMPONENT PLAYBOOK, TYPOGRAPHY & COLOUR, SMOOTHNESS sections.
- Check: `npm run check:agent-kit`.

## v0.10.0 — motion-board set
- `src/lab/obsidian/board.tsx`: mb-chart-morph, mb-masked-type, mb-elastic-type, mb-shutter-reveal, mb-search-results.
  These are Cupric originals written after a user-pasted motion board. That board had no licence, so no code, fonts or images were copied.
  All share `cycleAt(t)` (forward 2.2 s → hold 4.4 s → return 1.4 s, pure).
- The agent prompt (main.cjs) now teaches that timing grammar. Intent picks include the mb-* slugs, and check-agent-kit covers them.
- Not yet built from the board: button→player, card→workspace, tabs, dashboard zoom, dock, glass lens, spring stack, text reflow, perspective, flowing paths, particle logo.
