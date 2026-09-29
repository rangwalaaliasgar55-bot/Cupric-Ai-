# Cupric AI — upgrade plan

Written after the autonomous-run / design-engine / font work on
`arena/01a0ecc4-cupric-ai`. Every item names the files it touches, why it matters
and roughly what it costs. **Effort**: S ≈ a day, M ≈ a week, L ≈ a month of
evenings. **Impact**: what the user actually notices.

Ordered by impact ÷ effort. The first six are what I would do next.

---

## Do first (this week)

### 1. Frame-accurate, much faster export — WebCodecs instead of real-time MediaRecorder · S–M · ★★★

The Studio renders by playing the timeline in real time through `MediaRecorder`
(`src/lib/studio/export.ts:149`), so a 3-minute video costs 3 minutes and an
overloaded machine can drop frames. The ported prototype has the *shape* of the
solution — `src/video/export.ts` is explicitly "frame-exact offline rendering
(not real-time capture)" with MP4/WebM/alpha/SRT — but it imports `mediabunny`
as a package that is not a dependency, and `src/shims/mediabunny.ts` is only a
stub that returns empty blobs. So this is a real, bounded piece of work.

- Add `exportStudioFast()` that steps `src/lib/studio/renderer.ts` frame by frame
  and feeds `VideoEncoder` → muxer (add `mediabunny`, or raw WebCodecs +
  `mp4-muxer` — check the licence of whichever you pick before shipping); keep
  `MediaRecorder` as the fallback for browsers
  without WebCodecs (Safari < 17) and as the "live" preview recorder.
- Expected: 10–50× faster export, exact frame timings, alpha and MP4 in-browser,
  and unattended background renders become practical.
- Also: export SRT/VTT captions from the same pass, and a "still frame at t".

### 2. A browser test lane in CI · M · ★★★

Every bug the user reported ("suggested fonts do nothing", "the agent doesn't
run") was invisible to the 62 node checks because they never open the app.
`check-boot.mjs` exists but cannot run in a bare sandbox.

- GitHub Actions job with Playwright + Chromium: boot the app, add a text clip,
  click a suggested look, assert the canvas pixels change; run a short Auto Draft
  autonomous job against a 6-second brief; export a 3-second WebM and assert
  duration/size.
- This is the only way the next "it doesn't work" gets caught before the user
  sees it.

### 3. Golden-image tests for the design engine · S · ★★★

`designScenes`/`designAll` are pure and deterministic — perfect for snapshots.

- The renderer already runs headlessly in node against a recording stub
  (`scripts/check-renderer.mjs`), so this is an extension, not new infrastructure:
  swap the stub for a real raster (e.g. `@napi-rs/canvas` plus a tiny
  `document.fonts`/`Image` shim), render one frame per designed scene into
  `resources/goldens/`, diff in CI with a small tolerance, and fail on drift.
- Add a score floor per brief ("no type-led direction may score below 70") so
  design quality can only go up.

### 4. Audio for autonomous runs · M · ★★★

The local pipeline is silent. The plan already carries narration/voiceover
intent (`src/lib/automation/plan.ts`) and the app already has offline TTS paths
(`src/lib/voice.ts`, `electron/tts.cjs`, `voice-engines.cjs`).

- Music bed: bundle 6–10 royalty-free loops, pick by tone, duck under the
  voiceover (`ducking` exists on `StudioDoc:848`, and the renderer already honours
  it).
- Voiceover: Piper is wired on desktop (`electron/tts.cjs` searches
  `CUPRIC_PIPER_*`, `<userData>/piper`, `vendor/piper` — the models simply are not
  vendored yet, so shipping one voice is the missing step). The web build can
  start with SpeechSynthesis for drafts and move to a WASM voice later.
- Word-level timing so `word-reveal`/`kinetic` text follows the voice, plus
  caption burn-in and SRT export from the same lines.

### 5. Finish the font story · S–M · ★★

Fonts now load and report correctly, but three gaps remain.

- **Variable axes in the UI**: `readFontMeta` already parses `fvar`; expose
  weight/optical-size sliders per face and store the axis values on the clip.
- **Per-script fallback chains**: Devanagari/Hinglish lines should always fall
  back to Noto Sans Devanagari → Hind → system, never to a Latin face. Today the
  chain is implicit.
- **Subsetting on export**: embed only the glyphs used per family so a font-heavy
  edit doesn't produce a 40 MB file.
- Test the real path once: add a Fontshare zip with "Add fonts" and confirm the
  family appears without a reload (the failure cache is now cleared on import).

### 6. Job durability + "Run doctor" · S · ★★

An autonomous run currently lives in memory; a crash, reload or quit loses it.

- Persist `automationJobs` (they already carry `rundown`, `winnerPath`,
  `renderEvaluation`) and resume interrupted runs on launch — desktop first,
  web second via IndexedDB.
- Add one button that writes a support bundle: logs, FFmpeg/encoder list, font
  readiness report, plan/report JSON, machine specs. Support without this is
  guesswork.

---

## Next (2–6 weeks)

### 7. Autonomous agent, second generation · L · ★★★

- **Cut on the beat**: BPM/onset analysis on the chosen music, then re-time scene
  boundaries to it (`plan.shots` timing is the single lever).
- **Structural variety, not just art direction**: the three candidates share one
  shot list today. Vary beat structure (hook-first vs proof-first), shot count and
  pacing per candidate, then score.
- **Model-in-the-loop critique**: ask the configured model to critique the
  *design report* (JSON) rather than an HTML blob — cheaper, faster, and it can
  actually change `designScenes` inputs.
- **Series mode**: lock a design system (type scale, palette roles, motion
  curves) on a project and produce episode N+1 in the same look.
- **Batch/scheduled runs**: queue five briefs overnight, one report per run.

### 8. Design system per project · M · ★★★

Right now each run invents its look. Give a project a persistent design system
and the output stops feeling random.

- Tokens on `brandKit`: type scale, spacing unit, motion curve, accent roles,
  caption style, grade preset, safe margins.
- The design engine reads tokens first, its own taste second.
- A **Design lint** panel in the Studio (contrast, safe area, overflow, mixed
  scales, more than N type families) so a human edit can't quietly wreck it.
- Expand the craft library: 6–8 more scene layouts, kinetic type recipes per
  role, grade presets that match the tone.

### 9. Studio architecture & performance · M · ★★

- `src/screens/Studio.tsx` is 2054 lines; split it into panes (timeline,
  transport, export, inspector host) with the store as the only shared channel.
- Slice `src/state/useProjectStore.ts` (863 lines) by domain; keep one store,
  several reducers, selectors typed per slice.
- Renderer: cache text layout per clip revision (measuring is the hot path in
  scrub) and reuse an offscreen canvas per track.
- Add a perf budget to CI: scrub p95 frame time on a 30-clip edit, export
  frames-per-second. You already have `check-scrub-perf.mjs`; make it a gate.

### 10. Repository hygiene · M · ★★

The ported prototype is still in the tree and nothing imports it: `src/app`,
`src/core`, `src/editor`, `src/graphics`, `src/motion`, `src/registry`,
`src/render`, `src/renderer`, `src/templates`, `src/themes`, `src/three`,
`src/ui`, `src/tests` (~9.4k lines, plus a 534-line Next-style `src/app` tree).
It inflates typecheck/lint time, confuses both humans and coding agents, and hides
the one valuable piece (`src/video/export.ts` — see item 1). Move it to `prototype/` or delete it after the export path is
ported, and add a CI check that `src/**` modules are reachable from `src/main.tsx`.

### 11. Desktop hardening · M · ★★

- Code-sign the NSIS installer and add an update channel (stable/beta) with delta
  packages; `electron-updater` is already wired.
- Encoder fallback ladder (`electron/encoders.cjs`) deserves a real-hardware
  test matrix: NVENC/QSV/AMF/VideoToolbox/software, one failed step each.
- Crash-safe render farm: the background render process should resume segments,
  not restart the film.
- Opt-in diagnostics with a clear consent screen; today `diagnostics.ts` and
  `logLine` are local-only, which is good — keep it that way by default.

### 12. Offline intelligence · M–L · ★★

- `whisper.cpp` (bundled, no download) for real auto-captions in both web (WASM)
  and desktop; `check-auto-captions.mjs` already assumes the UX.
- Use the 300-case Opus catalogue for retrieval, not just rules: local embeddings
  + a ranking pass so "which of these 300 cases is this brief closest to" feeds
  the plan (currently keyword tags).
- OCR for screenshots/app footage so a product demo can be auto-labelled.

---

## Later

- **Multi-aspect in one pass**: render 16:9 / 9:16 / 1:1 from one designed edit
  with per-aspect safe-area reframing, then package platform presets.
- **Review workflow**: comments on the timeline, share-link review, approval
  state that feeds the autonomous gate (today the gate is a single checkbox).
- **Collaboration/cloud** (optional, and a different security posture — a project
  sync service, brand-kit sharing, team libraries).
- **Plugin API** for the vendored component libraries (`src/lab`, framecn) so new
  components can be dropped in without touching the renderer.
- **Mobile/responsive**: the preview is desktop-first; a read-only review and
  approve flow on a phone is a cheap, high-value slice.

---

## Guardrails (do not trade these away)

- Never automate public votes or scrape Arena; the manual gate stays manual.
- Never report a quality pass that did not happen — the render gate must stay
  mechanical (`src/lib/automation/report.ts`, `evaluateAutomationRender`).
- Fontshare stays link-out; user fonts stay local (IndexedDB) and are never
  redistributed.
- Every vendored resource keeps its licence and attribution (framecn MIT,
  opus55 MIT notice, Fontsource OFL).

## Metrics worth watching

1. Time from brief to first playable video (target: < 90 s on a laptop).
2. Render wall-clock ÷ video duration (target: < 0.2 with item 1).
3. Design score distribution per week (median should climb, not just the max).
4. Share of autonomous runs that need a human edit afterwards.
5. Crash-free sessions and "run stopped" toasts per release.
