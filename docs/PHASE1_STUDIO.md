# Phase 1.3 — Studio / Timeline: one renderer, one history, one strip that shows its source

Scope: the Studio editor (document, renderer, export, history) and the project
**Timeline** screen. Autonomous Mode is `docs/PHASE1_AUTONOMOUS.md`; the AI layer
is `docs/PHASE1_AI_PROVIDER.md`.

Baseline commit this phase started from: `430265a` (after Phase 1.2).

---

## 1. What was found

| # | Finding | Where (at `430265a`) | Why it mattered |
| - | ------- | -------------------- | --------------- |
| G1 | **"Preview and export use the same renderer" was an argument, not a test** | `src/screens/studio/StudioPreview.tsx:155`, `src/lib/studio/export.ts:241,:433` | Nothing failed if the two call sites drifted. The claim sat in three doc comments and zero assertions. |
| G2 | **The export source set was a copy-pasted literal, twice** | `src/lib/studio/export.ts:162-167` and `:429-435` | The same three-line object literal was written out in the recorder and again in the still capture. A change to one (say, adding a resolver) would silently not reach the other. |
| G3 | **The preview and the exporter clamped the playhead differently** | preview drew raw `t`; exporter drew `Math.min(elapsed, duration)` | With a playhead past the end of a shortened doc, the preview showed a frame the exported file can never contain. |
| G4 | **A mutation that changed nothing still consumed an undo step** | `src/state/useProjectStore.ts:285-297` (`updateProject`) | `settleStudioClip` on an already-settled clip, `removeStudioClip` with an id that is not there, `setClipDuration` on an unknown id — each pushed a history entry, wiped the redo branch, and made the next Undo appear to do nothing once. `docs/AUDIT_PHASE0.md` §B4 called the history "fully working"; it was working, but not on no-ops. |
| G5 | **The undo audit covered 13 mutations, not all of them** | `scripts/check-undo-audit.mjs` | The timeline mutations (`addTimelineClip`, `setClipDuration`, `moveTimelineClip`, `removeTimelineClip`), `settleStudioClip` and `commitProduction` were un-audited. |
| G6 | **The Timeline screen's playhead played nothing** | `src/screens/Timeline.tsx` (415 lines) | The strip drew clips, a ruler and a rAF playhead with **no picture**: pressing Play ran a counter over a Gantt chart. `docs/AUDIT_PHASE0.md` §B5 asked for "a real composited preview or fold it into Studio". |
| G7 | **A local file in the browser build produced a black rectangle** | `src/components/VideoPreview.tsx:29-33` | With no IPC and a non-browser path the component set the *path* as the `<video>` src, which cannot load — the user saw a black frame and no explanation. |
| G8 | **macOS-only window chrome in a Windows-only product** | `electron/main.cjs:4744-4767` (`vibrancy`, `titleBarStyle`, `trafficLightPosition`, transparent background), `src/App.tsx:32-36`, `src/styles.css:228-241` | Dead code on the only platform this ships for, plus a platform conditional around `BrowserWindow` that no Windows test can ever exercise. |

---

## 2. What changed and why

### 2.1 One export source set, and the preview/export parity check — **new `scripts/check-preview-parity.mjs` (171 assertions)**

- `src/lib/studio/sources.ts` now exports **`exportSources()`** (`:50`): full-resolution media, and `overlay`/`sticker` **the same function objects** the preview uses. The two inline literals in `export.ts` are gone (**fixes G2**).
- The parity check bundles the real renderer and drives it with a recording 2D context, then renders five real documents (title, multi-clip with hidden/muted/rotated clips, graded+masked+keyframed, transitions in and out, glass over text) at six playheads through **both configurations** and compares:
  - the full draw-call trace, argument for argument, at the same canvas size — this is the "same frame" claim, now executed (**fixes G1**);
  - every word painted, in order (captions);
  - every media/overlay/sticker request with its sub-second local time;
  - the geometry at export size against the preview size, scaled, with pixel arguments within 0.05 px and multipliers/angles exact (resolution independence);
  - the source-set identity claims (`overlay`/`sticker` identical, `media` deliberately not).
- **Falsifiability was tested, not assumed.** Three probes were run and reverted:
  1. `exportSources()` resolving the proxy → `AssertionError: the export resolver asks for the original file`;
  2. the exporter drawing `elapsed` instead of `frameTimeFor(...)` → `AssertionError: the exporter draws the shared frame time`;
  3. `frameTimeFor` no longer clamping → `AssertionError: FAIL: a playhead past the end lands on the last frame`.

### 2.2 One frame-time function — `src/lib/studio/doc.ts:79`

`frameTimeFor(doc, t)` clamps the playhead to the document duration. `StudioPreview.tsx:158` and `export.ts:237` both draw through it, so the preview can no longer show a frame the file will not contain (**fixes G3**). The check executes the function (inside/after/negative/empty-doc) rather than only grepping for it.

### 2.3 No-op mutations are no longer edits — `src/state/useProjectStore.ts`

- `updateProject` (`:285`) now applies the mutation first and **returns the unchanged state when the mutation returns the same project object** (`:296`). That is the contract the studio helpers already used (`settleClip` returns the same doc; `moveTimelineClip` returns `p`). No history entry, no redo-branch wipe (**fixes G4**).
- The paths that violated the contract were fixed too: `removeStudioClip` (deleting an id that is not there), `updateStudioClip` (unknown clip), `removeTimelineClip` (nothing removed), `setClipDuration` (unknown id, or a resize that snaps back to the same length).

### 2.4 The undo audit now covers every mutation, and the no-op rule — `scripts/check-undo-audit.mjs`

16 mutations each asserted to be exactly one undo step with undo/redo round-trips, plus **3 no-op cases asserted to add no step and keep the redo branch**, on top of the existing "recordings never hijack Undo" case. New coverage: `settleStudioClip` (no-op and real), `commitProduction`, and the four **timeline** mutations (**fixes G5**). The audit prints its own count: *"16 mutations each exactly one undo step, 3 no-ops add none…"*.

The store fix was required to pass it — before the fix the audit failed with
`AssertionError: delete a clip id that does not exist: no undo step for a no-op — 14 !== 13`.

### 2.5 The Timeline screen shows the source it points at — `src/screens/Timeline.tsx`

Decision on the second editor (**fixes G6**): the Timeline is **not** the Studio document — it is the project-level strip of Arena pieces and footage clips that the render queue consumes (`timelineSources()` in `useProjectStore.ts:131`). Folding it into Studio would delete a working screen and change what the render queue reads; giving it the *compositor* would mean inventing a mapping from `TimelineClip` to `StudioClip` that no feature uses. What it was missing was honesty about what it points at, so `TimelinePreview` (`:285`) now shows, for the clip under the playhead:

- **footage with a real file** — an actual `<video>` seeked to the in-clip time, with a "12.3s in clip" readout;
- **Arena pieces** — the truth: Arena assets are generated HTML, so there is no still to seek; the panel says so and offers **Open Arena Desk** (the screen that can render it);
- **a footage clip with no file yet** — "upload it in Footage Desk", with the button;
- **a clip whose asset was deleted** — says so instead of rendering nothing;
- **a file that will not decode** — the error is shown (`:368`), not swallowed;
- **no clip under the playhead** — "scrub onto a clip".

The URL rules are shared, not re-implemented: `useLocalMediaUrl` was extracted from `VideoPreview.tsx` and is used by both.

### 2.6 A local path in the browser build now says so — `src/components/VideoPreview.tsx`

With no IPC and a non-browser path, the component sets an explicit error ("Local files can only be previewed in the desktop app.") instead of handing a filesystem path to a `<video>` (**fixes G7**).

### 2.7 Windows-only window — `electron/main.cjs`, `src/App.tsx`, `src/styles.css`

The macOS vibrancy branch, the transparent background, `titleBarStyle`/`trafficLightPosition`, the renderer's `vibrancy` dataset flag and the `html[data-vibrancy='on']` CSS are gone (**fixes G8**). `check-studio-surfaces.mjs` now asserts their **absence** (`assert.doesNotMatch(main, /darwin/)`, no macOS-only chrome, no Linux branch, no vibrancy flag, no vibrancy CSS) so they cannot come back.

---

## 3. Verification performed, and what was observed

| Command | Observed result |
| ------- | --------------- |
| `node scripts/check-preview-parity.mjs` | exits 0: `preview/export parity check passed — 171 assertions across 5 documents, preview 720x405 vs export 1920x1080` |
| Negative probe — proxy media in the export set | `AssertionError: the export resolver asks for the original file`; reverted, exit 0 |
| Negative probe — exporter draws raw `elapsed` | `AssertionError: the exporter draws the shared frame time`; reverted, exit 0 |
| Negative probe — `frameTimeFor` stops clamping | `AssertionError: FAIL: a playhead past the end lands on the last frame`; reverted, exit 0 |
| `node scripts/check-undo-audit.mjs` | exits 0: `undo audit passed — 16 mutations each exactly one undo step, 3 no-ops add none, recordings never hijack Undo, shelf/legibility/timeline/production covered` |
| Same audit **before** the store fix | `AssertionError: delete a clip id that does not exist: no undo step for a no-op — 14 !== 13` (the failing observation that drove §2.3) |
| `node scripts/check-studio-surfaces.mjs` | exits 0: `…Timeline preview and the Windows-only window are enforced` |
| `node scripts/check-ui-audit.mjs` | exits 0: `ui-audit passed — 82 files; remaining recorded debt: none` |
| `npx tsc --noEmit` | clean, no output |
| `npm test` | `Test Files 6 passed (6)`, `Tests 100 passed \| 1 skipped (101)` |
| `node scripts/run-checks.mjs` | `BUILD PASSED: all 79 checks` (was 78; `check-preview-parity` added to the chain right after `check-renderer`) |

---

## 4. Still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED on Windows — none of this ran in the app.** The container is
   Linux, the Electron binary cannot be downloaded here, and no browser is
   available. Everything above is the real renderer, the real store and the real
   files, driven headlessly. It does **not** prove the Studio looks right, that
   the Timeline preview plays smoothly, or that a recorded export matches the
   preview pixel for pixel through MediaRecorder.
   *Verification required on Windows:* open a project → scrub and play the Studio
   preview → export a WebM/MP4 → compare a paused preview frame with the same
   timestamp in the exported file → Timeline → play → confirm the preview panel
   follows the playhead and shows the right source; delete a footage file and
   confirm the "no local file" state.
2. **UNVERIFIED: MediaRecorder is not part of the parity check.** The check
   compares the *frames drawn*, not the encoded video. Encoder rounding, frame
   timestamps and audio sync remain untested here (Phase 1.6 territory).
3. **The parity comparison covers 5 documents.** Real projects have video, audio,
   Lottie overlays, component recordings, 3D rows and LUTs; media/overlay/sticker
   were *stubbed* in the parity run (their resolvers are identity-checked, not
   pixel-checked) because decoding real files needs a browser.
4. **The Timeline preview plays the source, not the composition.** It shows one
   clip's file at a time — no transitions between strip clips, no captions, no
   grade: the strip's clips are render *sources*, not a composited sequence. If
   the intent is for the Timeline to be a second editor, that decision is still
   open; it is written down in §2.5 rather than left implicit.
5. **Not done in this phase:** the frame-accurate preview the brief asks for
   (WebCodecs) — the Studio preview is still the compositor drawn per animation
   frame, and the export is still a real-time MediaRecorder capture. Replacing
   that changes the export contract and belongs with Phase 1.6.
6. **`@dnd-kit`/`react-dnd` were not added.** The Studio timeline's drag/trim/
   split already work on pointer events with pointer capture, snapping and
   one-step coalescing, and the undo audit covers them; adding a dependency would
   not change behaviour this phase can verify.
7. **Command-pattern undo was not adopted.** The history is snapshot-based
   (`docs/AUDIT_PHASE0.md` §B4), capped at `HISTORY_LIMIT`, coalescing drags into
   one step. Commands would be a rewrite of every mutation for an identical user
   outcome; the audit now enforces the property that actually matters (exactly one
   step per change, none per non-change).
8. **Remaining non-Windows code paths** (`electron/tts.cjs:87,102,105` macOS/Linux
   voice branches, `electron/encoders.cjs:21` `h264_videotoolbox`,
   `scripts/check-tts-languages.mjs` / `check-encoders.mjs` asserting them) were
   **not** removed in this phase: they are on the path Phase 1.4 rewrites, and
   deleting them now would only break the checks that still describe them.
