# Phase 1.3, closed out — the timeline's undo boundary, and frames that agree

Scope: the Studio timeline's editing gestures (drag, trim, split, reorder, group
move), the undo/redo history underneath them, and the frame arithmetic that the
preview, the ruler and the exporter all share. This document is the phase
deliverable required by the brief: **found (with file/line) → changed and why →
Windows verification and observed result → still broken, incomplete or
UNVERIFIED.**

It supersedes §4 items 5 and 7 of `docs/PHASE1_STUDIO.md`, which recorded both of
these as *not done*. It also records two defects that the full release chain
caught in the previous commit (`3e00874`) — they are findings, not polish.

Baseline for "what was found": commit `3e00874` (the starting point of this
pass), which is also the commit the previous Windows run was queued against.

---

## 1. What was found

| # | Finding | Where (at `3e00874`) | Why it mattered |
| - | ------- | -------------------- | --------------- |
| T1 | **The undo boundary was a wall-clock window, not a gesture** | `src/state/useProjectStore.ts:251,257,299` — `HistoryEntry` had no notion of a gesture, and coalescing was `top.label === label && snapshot.at - top.at < COALESCE_MS` (700 ms) | Drag a clip slowly, pause to look at the frame, drag on: one gesture, **two undo steps**. Undo once and the clip sits somewhere you never put it; undo twice and it is gone. Every drag also re-snapshotted the whole project list up to 60 times a second. |
| T2 | **The playhead was not on a frame** | `src/screens/Studio.tsx:368-370` — `seek` clamped to `[0, duration]` and nothing else; `frameTimeFor` (`src/lib/studio/doc.ts:79`) clamps but does not quantise | A scrub, a shortcut or an arrow key could park the playhead between two frames — a time the exporter cannot produce. "Trim to 1.000 s" then exported 30 frames or 31 depending on where the float landed. Arrow-key stepping (`±1/fps`) accumulated float error. |
| T3 | **`S` (and the Split button, and the clip menu) failed silently** | `src/screens/Studio.tsx:498,1154,1527,2164` — all four called `splitStudioClip`, whose store implementation returns the project unchanged when `splitClipAt` yields `null` | The playhead at the clip's very start, or closer than `MIN_CLIP_SEC` to an edge: nothing happens, nothing is said. `docs/AUDIT_PHASE0.md` §C calls this class of dead keypress out by name. |
| T4 | **The head-trim direction was wrong in the new command path** (caught by a new test, not by review) | `src/lib/studio/commands.ts` (introduced in this pass) | Trimming 0.5 s off the **head** of a clip advanced the stored source in-point 0.5 s the *wrong way* (`trimInSec - cut`), so the trimmed-away seconds played in the middle of the clip. The old `trimStartTo` (`src/lib/studio/timelineOps.ts:33`) had the sign right; the reimplementation inverted it. |
| T5 | **Rounding times to milliseconds destroys frame alignment** (also caught by a test) | `src/lib/studio/commands.ts` (introduced in this pass) | Frame 209 at 30 fps is 6.966667 s. Storing it as 6.967 s is still the same frame *today*, but it breaks the invariant the renderer, ruler and exporter rely on ("a stored time is exactly `frame ÷ fps`") and would drift at 60 fps over a long timeline. |
| T6 | **Two release checks asserted on source text, not on behaviour, and one of them had been red since `3e00874`** | `scripts/check-encode-dims.mjs` (final assertion), `scripts/check-upgrades-batch3.mjs:29` | `check-encode-dims` grepped `electron/main.cjs` for the FFmpeg scale filter, which the timeline-trim work had *moved* into `electron/studio-trim.cjs` — so the chain failed on a refactor that changed nothing about the output. `check-upgrades-batch3` grepped `Studio.tsx` for `moveWithGroup(doc, id, patch)` literally. Both would have passed on a stale copy of the code and failed on a correct one. **This is why the 86-step chain is run locally before pushing, and it is the run that found them.** |
| T7 | **`voice-install.cjs` accepted a `fetchImpl` and ignored it** | `electron/voice-install.cjs:216` (accepted) vs `:99` (`await fetch(item.url, …)`) | The option was plumbed through the installer, never passed to `download`. Anything supplying a fetcher — a test, a mirror, a proxy — silently got the real network instead. A function that pretends to take a seam it does not use is worse than not having the seam. |
| T8 | **"Whisper is not written yet" was painted as a failure** | `src/app-shell/ReadinessPanel.tsx:230` (pre-pass: every install outcome rendered in `text-danger` with no distinction) | Installing Piper on a machine where Windows has no Hindi voice, or pressing the Whisper button (which correctly says "fetch it with the build or drop the files in the folder"), showed a red error. Honest instructions read as breakage, which teaches people to ignore the colour. |

---

## 2. What changed and why

### 2.1 A real command layer — `src/lib/studio/commands.ts` (new, pure)

`applyTimelineCommand(doc, command, { playhead, pps })` is `(doc, command) →
{doc, changed, reason?}` with no store, no React and no I/O. The commands are
`move`, `move-group`, `trim` (start/end), `patch`, `split`, `delete` (with and
without ripple), `reorder-tracks`, `settle`.

- **The merge key is the gesture itself.** `commandMeta()` returns
  `{ label, mergeKey }` where `mergeKey` is the gesture id the timeline mints per
  pointer-down (`newGesture`). The store's `updateProject` now takes that key and
  merges **only** on an exact match (`src/state/useProjectStore.ts:317-319`), so a
  drag is one undo step whether it lasts 200 ms or four seconds, with or without
  a pause, and the next drag can never fold into it. The old wall-clock window
  survives for edits that have no gesture (a slider, a repeated button press),
  where "the same thing again, quickly" remains the best available guess — and it
  no longer applies to any timeline drag.
- **Every command explains a no-op.** `same(doc, reason)` carries the sentence
  the person needs ("Put the playhead at least 0.2s inside the clip to split
  it."), and `runTimelineCommand` raises it as a toast for unsolicited commands
  (`src/state/useProjectStore.ts:737-766`). Gesture commands stay silent, because
  a drag that has not moved yet fires dozens of them a second. **Fixes T3.**
- **Grouped moves stay grouped.** `move-group` routes through the existing
  `moveWithGroup` (`src/lib/studio/editTools.ts:36`), sharing the same gesture, so
  dragging one member of a group is one step — not one step per member.
- **Dragging a clip's head to the left is source-aware.** The old path clamped
  `trimInSec` at zero and extended the clip anyway, producing a clip whose first
  second repeated one frame. The command refuses past the available source
  ("There is no more source before this point.") and never allows a negative
  start. **Fixes T4's neighbourhood**, reported honestly as a behaviour change:
  a clip with no head room can no longer be extended leftwards.
- **Times are stored at microsecond resolution**, matching `frames.ts` — not
  rounded to milliseconds. **Fixes T5.**

### 2.2 Frames — `src/lib/studio/frames.ts` (new, pure)

`frameOf`, `timeOfFrame`, `lastFrame`, `snapToFrame`, `stepFrames`,
`snapDurationToFrames`, `formatFrame`. A time is `frame ÷ fps`, rounded once.

- `seek` in Studio now snaps (`src/screens/Studio.tsx:378-381`), so **the preview
  draws the frame the playhead is on** — `frameTimeFor` was already doing the
  clamping, and the playhead is now the only input it can receive a fractional
  value from.
- Arrow keys step integer frame indices (`stepFrames`), so holding Right cannot
  drift; Shift still jumps a second.
- The transport readout shows `frame N` next to the time, and a trim's duration is
  snapped up to a whole frame and never below `MIN_CLIP_SEC`.
- **Fixes T2.**

### 2.3 The timeline emits commands — `src/screens/studio/StudioTimeline.tsx`

`onPatchClip`/`onSettleClip` are gone. One prop, `onCommand`, carries the command
and its gesture. The pointer-move handler no longer re-derives snapping by hand:
it hands the pointer's time to the command and lets `snapTime` + `snapToFrame`
decide, which retires the last second implementation of snapping on this path.
`src/screens/Studio.tsx:2091` routes to `runTimelineCommand(projectId, command,
{ playhead: time, pps })`. **Fixes T1.**

### 2.4 Speech engines: the seam is real, the guidance is not an error

- `electron/voice-install.cjs` now passes `fetchImpl` into `download` and uses it
  (`:99`). **Fixes T7.**
- `ReadinessPanel` distinguishes `manual` outcomes (instructions: a Windows voice
  to add through Settings, whisper.cpp to fetch with the build) from real
  failures, in colour and in `role`. Both are still surfaced; only the meaning
  changed. **Fixes T8.**
- **`scripts/check-speech-live.mjs` (new)** does what no other voice check could:
  it downloads the real Piper engine and voice with the app's own installer, runs
  `piper.exe` through the app's own `tts.piperCommand`, parses the WAV it produced
  (RIFF/WAVE, 16-bit PCM, declared sample rate, duration from the byte count) and
  requires a longer sentence to produce more audio. With `--with-whisper` it also
  fetches whisper.cpp and the quantized model and transcribes the audio Piper just
  made, checking the words came back. It is Windows-only **because the product
  is**, and it says so instead of skipping quietly.

### 2.5 The checks now follow the code — and Phase 4's checks run in the gate

- `check-encode-dims.mjs` and `check-upgrades-batch3.mjs` assert on **behaviour**:
  the real FFmpeg argv from `studioTrim.mp4Args(...)` (including the `-t` cut to
  the timeline and the even-size filter), and the real routing (`Studio` →
  `runTimelineCommand` → `move-group` → `moveWithGroup`). **Fixes T6.**
- `check:install` gained an explicit `--unsigned-build` mode: it **inverts** the
  signature assertions instead of skipping them (an unsigned build must be
  unsigned, and must not declare a publisher the updater cannot verify), so
  install → version readback → boot on every view → uninstall → no leftovers is
  now asserted on **every pull request**, not only in the release workflow.
- `update-path.yml` now also runs on `pull_request`, building the pull request's
  own checkout as the "to" version (the `workflow_dispatch` path is unchanged and
  now accepts an empty `to_tag`). It is deliberately **not** the required status
  check: a signed installation updating to an unsigned pull-request build can
  legitimately fail signature verification, and that is a finding about the
  release process, not about the change under review.

---

## 3. Verification performed, and what was observed

Everything below ran in this workspace (Linux, no Electron binary, no browser);
the Windows column marks what still needs the runner.

| Command | Observed result |
| ------- | --------------- |
| `npx vitest run src/tests/timeline-commands.test.ts` | **25 passed.** Includes the two failures that found T4 and T5 before the fixes: `expected 1.5 to be close to 2.5` (head trim moved the in-point the wrong way) and `expected 6.967 to be close to 6.966666666666667` (millisecond rounding off a frame boundary). |
| `npx vitest run src/tests/timeline-history.test.ts` | **6 passed**, driving the **real store** (in-memory storage shim, no browser). The load-bearing one: 180 pointer events one frame apart with a deliberate 750 ms pause in the middle → `past.length` grows by exactly **1**; one `undo()` returns the clip to `6.0 s / track 0`; `redo()` puts it back on the last frame of the drag. |
| `npx vitest run` (all suites) | `Test Files 16 passed (16)`, `Tests 256 passed \| 1 skipped (257)` — was 225 passing before this pass. |
| `npx tsc --noEmit` | clean, no output. |
| `node scripts/check-studio-surfaces.mjs` | initially **failed**: `AssertionError: S must split the selected clip` — the check matched the literal call `splitStudioClip`. Rewritten to assert the routing (the shortcut reaches a `kind: 'split'` command), which is a stronger claim; passes. |
| `node scripts/check-upgrades-batch3.mjs` | initially **failed**: `timeline drags route through group move` (grep on the moved call site). Rewritten as above; `23 assertions passed`. |
| `node scripts/check-encode-dims.mjs` | initially **failed** on `3e00874` (see T6). Now asserts the produced argv; passes, including `['-t', '3.000']` and the even-size filter. |
| `CUPRIC_FFMPEG_PATH=… CUPRIC_FFPROBE_PATH=… node scripts/run-checks.mjs` | `BUILD PASSED: all 86 checks` — with the real FFmpeg and ffprobe, so `check:studio-trim` (32 assertions, 3 real encodes) ran in full rather than in its no-FFmpeg half. |
| `node scripts/check-speech-live.mjs` (this container) | **exits 1 by design**: `check:speech-live FAILED — this check installs and runs the Windows speech engines… running on linux`. Reported as the honest outcome; it is wired into the Windows workflow below. |

### What the Windows run for this commit has to prove (queued, not yet observed)

| Step | What it proves |
| ---- | -------------- |
| `Type-check, unit tests and release checks` | all 86 checks, including the three rewritten ones, on Windows |
| `Package Windows installers` → `Install, run and uninstall the built installer` | Phase 4's acceptance test in the gate: silent install, `FileVersion` read back off the installed exe, boot on every view, uninstall, no leftovers, no Start-Menu shortcut — with the signature assertions inverted for a certificate-less pull request |
| `Speech engines end to end` | the real Piper download → real `piper.exe` synthesis → parsed WAV → whisper.cpp transcript, on the platform this ships for |
| `End-to-end suite` | the existing 13 Playwright flows (import → scan → Apply edit → render → ffprobe), now against the command-layer timeline |

**Nothing in this pass has been observed running on Windows yet.** The status is
UNVERIFIED until that run's results are recorded in
`docs/WINDOWS_VERIFICATION.md`.

---

## 4. Still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED on Windows — all of it.** The drag/trim/split behaviour, the
   single-undo-step-per-gesture property in the running app, the frame-snapped
   playhead in the real preview, the installed-app check and the live speech
   download have **not** run on Windows. Everything above is the real modules, the
   real store and the real files driven headlessly.
   *Verification required:* the queued run; then, by hand: drag a clip slowly with
   a pause, press Ctrl+Z once and confirm the whole drag reverses; drag the left
   edge of a clip and watch the frame counter; press `S` with the playhead outside
   the clip and confirm the toast explains why.
2. **"Frame-accurate preview" is bounded by the export, and the export is a
   real-time capture.** The preview and the exporter share the renderer and now
   the same frame arithmetic, but the export is `MediaRecorder` capturing a canvas
   at wall-clock time (`src/lib/studio/export.ts:183-207`), so the *encoder* is not
   frame-indexed and its frame timing cannot be. A WebCodecs `VideoEncoder` with
   explicit frame timestamps is the only way to make the file itself frame-exact;
   that is a change to the export contract, not to the timeline, and it is not
   done here. **Do not read "frame-accurate preview" as "frame-accurate export".**
3. **The undo stack is still snapshot-based underneath.** The command layer gives
   each gesture a name and a boundary; it does not replace the history engine
   (which is deliberately hard to get wrong — every mutation is undoable because
   nothing has to remember to record itself). `HISTORY_LIMIT` is 80 steps and
   snapshots are structural-sharing, so the memory argument holds, but a
   ten-minute drag still costs up to one snapshot per frame at 60 Hz. Measured
   nowhere; if it becomes a problem, the fix is throttling snapshots inside a
   gesture, not a rewrite.
4. **The live speech check depends on two third-party hosts** (github.com release
   assets, huggingface.co). It is in the required pull-request workflow, so a
   transient outage there fails the check; the failure text names the URL and the
   status so it cannot be mistaken for a speech problem. Re-running the job is the
   remedy. Not yet observed passing on any runner.
5. **Piper/Whisper engine bytes remain UNVERIFIED until that run.** The download
   path itself is real and now tested for the first time by `check:speech-live`;
   the earlier UNVERIFIED status was "no network route from this container", and
   that reason still applies *here* — the evidence will come from the Windows
   runner.
6. **`p-retry` was not added** (briefed in Phase 1.1). `electron/ai-providers.cjs`
   implements its own bounded backoff with `RETRY_BACKOFF_MS` and classifies
   statuses, and `check-ai-providers.mjs` exercises it; swapping in a dependency
   would change no behaviour and no assertion. Stated rather than silently skipped.
7. **Grouped moves are still all-or-nothing.** A group dragged against a track
   ceiling clamps as a whole (`editTools.ts:42-44`); there is no per-member
   release. Unchanged from before this pass, and not exercised by a test.
8. **Frame arithmetic is 30/60 fps only** (`StudioDoc.fps` is `30 | 60`), and
   `snapToFrame` clamps to the document, so a timeline whose content is shorter
   than its longest clip shows the last drawable frame. That is the intended
   behaviour and it is asserted; recording it here so it is not mistaken for a
   bug later.
