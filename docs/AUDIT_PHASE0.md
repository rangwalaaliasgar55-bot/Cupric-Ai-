# Cupric AI — Phase 0 audit (full repository)

**Date:** 2026-09-29
**Repository:** `rangwalaaliasgar55-bot/Cupric-Ai-` @ `eb0fbe37` (branch `arena/01a0edd4-cupric-ai`, shallow clone, 1 commit, 0 local tags)
**Auditor:** Arena Agent Mode session (Linux container, Node v22.22.3, npm 10.9.8)
**Target product:** Windows 10/11 Electron desktop app
**Rule applied throughout:** nothing is called "working" unless it was executed and observed. Anything that needs the Windows GUI is marked **UNVERIFIED**.

> **Environment honesty statement.** The audit, the fixes and every test in this document were run in a Linux container. There is **no Windows machine, no Electron binary (the download CDN is blocked here) and no headless Chrome** in this environment. Therefore:
> * Everything that is a pure Node/TypeScript/ffmpeg behaviour **was really executed** and is reported with its observed output.
> * Everything that needs the Electron runtime (windowing, IPC in the real process, NSIS installer, GPU canvas, SAPI/Piper/Whisper binaries, Windows-signed installer) is **UNVERIFIED** and is labelled as such. No claim in this document is inferred from "the code looks right".

---

## 0. Verification ledger — what was actually executed during this audit

| # | Command | Result (observed) |
|---|---|---|
| 1 | `npm ci` (with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`) | exit 0, 731 packages, `node_modules` 1.0 GB. Without the flag it **fails**: `electron install.js` → `RequestError: unable to verify the first certificate` (sandbox TLS to the Electron release CDN). |
| 2 | `npx tsc --noEmit` | exit 0, no diagnostics (the repo type-checks). |
| 3 | `node scripts/run-checks.mjs --continue` (the same chain `npm run build` uses, 74 steps) | **`BUILD PASSED: all 74 checks`**, including `vite build` (`✓ built in 30.27s`). |
| 4 | `npm i --no-save vitest@3` then `npx vitest run src/tests/core.test.ts` | **19 passed / 19** in 39 ms — with a *real* test runner the existing tests do pass. |
| 5 | `npx vitest run src/tests/system.test.ts` | **12 passed, 1 skipped** (the `WRITE_CATALOG`-gated catalog writer) in 2.4 s. |
| 6 | `npx --no-install vitest run` (the command `docs/AUDIT_2026-09-29_REFERENCES.md:555` documents) | fails: `vitest` is not a dependency (`npx canceled due to missing packages`). |
| 7 | `node scripts/check-renderer.mjs` | `renderer check passed — 366 frames/assertions, 21 backgrounds, 10 transitions, 10 animations, 6 glass presets`. |
| 8 | `node scripts/check-speech.mjs` | `speech check passed — 101 assertions`. |
| 9 | `node scripts/check-voice.mjs` | `voice and error-copy check passed — 54 assertions (15 false-positive guards)`. |
| 10 | `node scripts/check-encoders.mjs` | `encoders check: no FFmpeg binary here — selection logic only` then `passed` (it found no ffmpeg because none is installed system-wide). |
| 11 | `node scripts/check-decompose.mjs` | `decompose check passed — 98 assertions`. |
| 12 | `npm i --no-save @ffmpeg-installer/ffmpeg` | real `ffmpeg version N-47683-g0e8eb07980-static` (GPL build) obtained from the npm registry → real media operations are executable here; `ffprobe` is already present via `ffprobe-static`. |
| 13 | `gh release list / gh release view / gh api` | release + tag + workflow history (section D). |
| 14 | `node scripts/check-boot.mjs` (attempted understanding only) | requires Electron or Chrome; **neither is obtainable in this sandbox** → not run. |

Everything below that is not in this table is a **static** finding (file contents), and is labelled as such.

---

## A. Fake-logic scan

### A1. The test framework is a no-op — tests cannot fail as the app is wired (critical)

* `src/shims/vitest.ts` (whole file) exports `describe/it/test/beforeAll/expect` where **`expect()` returns an object whose matchers are empty functions** (`toBe: (other) => {}`, `toBeCloseTo: (n, digits) => {}` …) and `obj.not = obj`. Any assertion routed through this module silently passes.
* `vite.config.ts` (alias block, `'vitest': …/src/shims/vitest.ts`) points the app's Vite pipeline at that shim.
* `package.json` has **no `vitest` dependency and no `test` script**. `vitest.config.ts` includes `src/**/*.test.ts` but aliases only `@`.
* The two real test files (`src/tests/core.test.ts`, `src/tests/system.test.ts`) import `"vitest"`.
* **Net effect until now:** `npm run build` runs 74 checks, none of which run these tests; `npx vitest` cannot run because vitest is not installed; and any accidental run through the app's Vite config would pass vacuously.
* **Observed counter-evidence:** with a real vitest installed the tests genuinely pass (ledger #4/#5), so the tests themselves are real work — the *infrastructure* around them is what is fake.

### A2. Stubbed third-party libraries that the app treats as real

* `src/shims/mediabunny.ts` — a hand-written stand-in for the Mediabunny WebCodecs muxer: `Output.finish()` and `CanvasEncoder.finish()` return `new Blob([])` (0 bytes), `getFirstEncodableVideoCodec()` always returns `'avc1'`, `addFrame()/start()/finalize()` are empty. `vite.config.ts` aliases `mediabunny` to it.
  * Consumers: `src/video/export.ts` (`canEncode`, `renderVideo` — dynamic `await import("mediabunny")`), reachable from `src/components/AssetGallery.tsx` (live, mounted by the Motion Engine screen), `src/components/editor/Editor.tsx`, `src/components/TemplatePlayground.tsx`, `src/app/docs/page.tsx`.
  * Consequence: the "render to MP4/WebM" path in that (legacy) editor returns a silent empty file or throws on missing stub members — **UI-only fake**, never a real encode.
* `src/shims/radix-ui.tsx` — a 33-line reimplementation of Radix `Dialog`/`Tabs` that renders plain `<div>`s. It has no focus trap, no `Escape` handling, no `aria-modal`, no roving tab focus, and no data-state, yet `src/components/AssetGallery.tsx:3` styles it as if it were Radix (`data-[state=active]:…` never matches). **Accessibility/behaviour fake** in a live surface.
* `src/shims/next/*` — `next/link`, `next/navigation` (hash-based router), `next/server` (`NextResponse`). These keep the dead Next.js tree compiling; they are not a product surface.

### A3. Dead Next.js application tree with a hardcoded "success" API (fake responses)

* `src/app/` (17 files) is a Next.js App Router tree that the Electron/Vite app never mounts (`src/main.tsx` renders `./App` directly). It ships in the repo and would run if anyone executed it as the Next app it was written as.
* `src/app/api/render/route.ts:8-33` is the clearest fake in the repo: comment `// Simulate deterministic server-side render job orchestration`, then it fabricates `jobId = job_${Date.now()}_${Math.random()…}`, a hardcoded `estimatedFrames = 240`, returns `success: true, status: 'queued'` and a `downloadUrl` (`/api/render/download?jobId=…`) **for a route that does not exist**. No render happens, ever.
* Other `src/app/api/*` routes (`ai/generate`, `generate`, `compositions`, `projects`, `presets`, `assets`, `registry`, `health`) are the same class: an unused second backend.

### A4. Hardcoded localhost ports — **partly exonerated**

The ports the brief calls out (`:11434`, `:1234`, `:4096`, `:8080`, `:1337`) exist as **presets with real detection**, not as blind assumptions:

* `electron/free-brain.cjs:39-44` probes OpenCode `:4096` → Ollama `:11434` → LM Studio `:1234` → `127.0.0.1:8080` with a 900 ms timeout, and `electron/main.cjs:87` `AI_DISCOVERY_TIMEOUT_MS = 1500`; failures are dropped, never assumed to work.
* `src/lib/opencode.ts:31-38` and `src/app-shell/AskPanel.tsx:76-80` are labelled presets ("click Load live list after the server is running"), and `ai:testConnection` exists (`electron/main.cjs:2149`).
* **Real problem in this area:** when nothing answers, the failure is collapsed into a single soft notice (`free-brain.cjs` → `notice: 'offline brain'`, plus the `429 free brain queue is longer than this request can wait` throw at `main.cjs:2588`). There is no typed error taxonomy and no per-cause UI/retry — see B1.

### A5. Empty / near-empty catch blocks (rule-2 violations)

Counted with `grep -o "catch {}"`:

| File | `catch {}` count | Notes |
|---|---|---|
| `electron/main.cjs` | **30** | e.g. `:1391` silently swallows a failure to update automation progress; `:614` swallows OpenCode model listing; `:1098`, `:2449`, `:2494`, `:2533` swallow `webContents.send` failures; `:3247-3250`, `:3862`, `:4246`, `:4269`, `:4278`, `:4353`, `:4553`, `:4602`, `:4610`, `:4641` in the render/update paths. |
| `electron/project-history.cjs` | 5 | `:111`, `:161`, `:170` — autosave snapshot failures are invisible to the user. |
| `src/lib/crashGuard.ts` | 2 | `:125`, `:129` |
| `src/lib/render.ts` | 1 | `:419` |
| `src/app-shell/ErrorBoundary.tsx` | 1 | `:31` (boundary logging itself) |
| `src/lib/studio/htmlTemplateCapture.ts` | 1 | `:72` `catch (e) {}` around `document.fonts.ready` |
| Presentation layer | several | `src/components/Player.tsx:104`.catch(()=>{})` on an audio-mix failure, `src/lab/**` (vendored), `src/components/Alert`-style UI |

Some of these are defensible (a `webContents.send` to a window that just closed). They are still rule-2 violations as written, and the two that matter for users are the automation-progress swallow (`main.cjs:1391`) and the autosave snapshot swallow (`project-history.cjs`).

### A6. `Math.random()` used for fake work — **mostly exonerated, two real hits**

* Legitimate (id/uniqueness): `electron/main.cjs` job/uid generation, `src/core/scene-graph.ts:10`, `src/lib/utils.ts:4`, `src/app/api/render/route.ts` (dead code).
* **Real finding:** `src/core/registry/motion-registry.ts:180` — `opacity: 0.85 + Math.random() * 0.15` inside a registry preview, i.e. random jitter in something the app presents as a deterministic preview.
* Acceptable, deliberate: `src/three/particles/ParticleGalaxy.tsx:66-72` (particle scatter, a visual effect, not a score/claim), `src/lab/**` (vendored), `src/lib/progress.ts:224` (seeded when captured, `Math.random` only in the live "UI Lab" demo).
* **No instance was found of `Math.random()` faking success, failure, scores or measurements.** The verification scripts actively *reject* it (`scripts/check-agent-code.mjs` asserts an agent snippet using `Math.random` is refused, and the generated-motion contract bans it).

### A7. `setTimeout`/`setInterval` used to fake processing

| Location | Verdict |
|---|---|
| `src/app-shell/TopBar.tsx:38` | **FAKE.** The header shows "Saving…" then "All changes saved" from a 700 ms `setTimeout` fired on any `projects` change. The real write is an async `state:save` IPC (`useProjectStore.ts:98-104`) whose promise is only `console.error`-ed on failure. The indicator can therefore say "saved" for a write that failed. |
| `src/lib/render.ts:212` (`seekVideo`) and `src/lib/studio/media.ts:391` (`seekTo`) | **Not fake.** Both attach a real `seeked` listener and use a 400/500 ms timer only as a hang backstop (documented: "A missing keyframe can swallow `seeked`; never hang the export on it"). Correct engineering; keep. |
| `src/lib/automation/run.ts:84` | `sleep` exists but is only called as `await sleep(0)` (`:233`) — a yield, not a fake delay. |
| `src/lib/studio/componentRecorder.ts:220` | `sleep` used to pace frame capture at the requested fps — real work pacing, not fake. |
| `src/screens/Brief.tsx:101-104`, `ArenaDesk.tsx:349`, `ReviewRoom.tsx:288`, `HomeProject.tsx:166`, `Studio.tsx:324` | Copy-tick/flash timers and a 250 ms phrase debounce. Fine. |
| `src/components/loaders/ThinkingStates.tsx`, `MatrixLoader`, `ThinkingStates` | Animation timers for loaders; the page content they sit next to is real async work. |

There is **no** "100 ms fake loading then fake success" pattern in the app's business logic.

### A8. Tests that stand up fake binaries instead of the real thing (rule: must be replaced)

* `scripts/check-tts-languages.mjs:36-72` writes **fake `espeak-ng` and `piper` executables** (Node scripts with a shebang that emit an 80-byte WAV header) and asserts against them. Its own comment admits the real engines "aren't in CI", and the spawn half is skipped on Windows (`process.platform !== 'win32'`), i.e. exactly the platform the product ships on never runs it.
* `scripts/check-local-voice.mjs:86-104` writes a **fake `whisper-cli` shell script** (`while [ $# -gt 0 ]…`) and asserts the discovery/args/cleanup contract against it. Same platform guard.
* `scripts/check-automation.mjs:109+` drives the pipeline with `fakeRender` returning a canned result.
* `scripts/check-encoders.mjs:23` builds a `fake({ listed, works })` ffmpeg runner rather than executing ffmpeg (it does fall back to the real binary when `CUPRIC_FFMPEG_PATH` is set — verified, ledger #10/#12 — but the default chain never touches a real encoder).
* Real engines **are** supported by the code (`electron/tts.cjs` Piper/System.Speech/espeak-ng; `electron/voice-engines.cjs` whisper.cpp + Windows Speech), but they are **not bundled** and no test in this repo ever runs one.

### A9. Hardcoded/canned outputs presented as generated content — mostly honest fallbacks

* `electron/main.cjs:1167 fallbackRundownForJob()` — a deterministic rundown from the brief (duration regex, style line). Used by the autonomous pipeline **step 1** as an intentionally instant first pass; a model polish is queued immediately after (`:1726 generateRundown(...)`). The UI copy says "Instant rundown ready; live polish queued". **Honest**, but it means an autonomous run with no model configured produces template copy, not generated copy — and nothing in the UI says "no model: this is the template" at that point.
* `electron/main.cjs:1176 candidateHtmlForRundown()` — deterministic HTML candidate (3 palettes) used when candidate generation fails. Same class: honest fallback, labelled in warnings.
* `src/lib/gemini.ts` (`askGeminiLocal`, `geminiChatLocal`) — deterministic planner replies, returned with `source: 'local'` and a `fallbackReason`, and the chat path appends "No live model is connected…". The file even documents the previous silent-downgrade bug as fixed. **Honest.**
* `electron/main.cjs:1559 renderAutomationMp4` writes `timeline.json` / `editing-plan.json` — these are real artefacts, but the "timeline" is the concatenation of rendered segments, not an editable timeline handed back to the editor.
* **Step 2 of the autonomous pipeline is a no-op** (`main.cjs:1741-1747`): "Locking the generated rundown" writes the same `rundown.json` that step 1 already wrote. It is a label, not work.
* **Step 5 is a stub** (`main.cjs:1795-1801`): "Building timeline and edit plan" writes `{ winnerPath, footage, aspect, fps, quality }` to `timeline-plan.json` — not a timeline, and nothing consumes that file; the real timeline is rebuilt later inside `renderAutomationMp4`.

### A10. Buttons/controls wired to nothing — none found

* `grep -rn "onClick={() => {}}\|onClick={noop}" src` → **no matches**.
* The 12 nav items, the run/pause/cancel buttons, the desk actions and the render queue all call real store actions or IPC. The one "wired to a fake" class that does exist is the AssetGallery/legacy-editor export path in **A2** (real button → stubbed muxer), and the fake `src/app/api/render` route in **A3** (no button reaches it in the desktop app).

### A11. Placeholder content — declared, not hidden

* `src/components/StockBrowser.tsx:26` labels the Picsum provider "Picsum placeholders — Seeded placeholders for drafts and mood boards; **replace before publishing**". `:128` repeats "Picsum is draft-only". `src/lib/seed.ts` states "No fake projects: first launch starts clean". These are honest.

### A12. TODO/FIXME/HACK inventory

* Only 13 occurrences repo-wide, all inside vendored/ported surfaces: `src/lab/components/kanban-board.tsx`, `src/lab/components/scribble-checkbox.tsx`, `src/lab/framecn/pipeline-journey/index.tsx`, `src/lab/registry.ts`, `src/lib/studio/motionDirector.ts`. No TODO in `electron/`, `src/lib/studio/*`, or the screens.

---

## B. Feature inventory

Legend: **Fully working** = real implementation + real verification available; **Partial** = real but has a named gap; **UI-only fake** = the surface exists, the effect does not happen; **Broken**.

| # | Feature | What it claims | Real state | Files | Root cause of any breakage | Fix required |
|---|---|---|---|---|---|---|
| B1 | AI Brain (chat, rundown, ask) | Live Gemini / OpenAI-compatible / local / keyless replies | **Partial** | `electron/free-brain.cjs`, `main.cjs:2130-2990`, `src/lib/gemini.ts`, `src/lib/opencode.ts`, `src/app-shell/AskPanel.tsx` | Works, but: no `AIProvider` interface; errors collapse to `notice:'offline brain'` or a 429 string (`main.cjs:2588`); one keyless third-party endpoint (Pollinations, `free-brain.cjs:35`) whose anonymous replies carry ads that are stripped by regex (`stripSponsored`); two parallel provider chains (renderer `gemini.ts` + main `liveAiChat`) that can drift; no typed retry UI per cause | Phase 1.1: provider interface + adapters (OpenAI/Anthropic/local) + typed error taxonomy surfaced in UI; delete `stripSponsored`; one routing table |
| B2 | Autonomous run (8 steps) | Unattended plan → rundown → design → timeline → render | **Partial** | `electron/main.cjs:1696-1870`, `src/lib/automation/{plan,run,report}.ts`, `src/screens/Autonomous.tsx` | Real steps, resumable, per-step progress, real artefacts, manual-Arena gate; but step 2 is a no-op, step 5 writes an unused stub JSON, the rundown is a deterministic template until/unless a model answers, and the step logic lives in a 4,663-line `main.cjs` closure (not testable pure functions). No test runs the desktop pipeline end to end | Phase 1.2: extract the 8 steps into pure, unit-tested functions in `src/lib/automation`, make steps 2/5 real (lock = validated snapshot; timeline = actual editable timeline written back), persist after each step, verify N runs differ |
| B3 | Studio editor (clips, keyframes, effects, masks, captions) | CapCut-style editing on a canvas compositor | **Fully working (code) / UNVERIFIED (runtime)** | `src/screens/Studio.tsx` (2,229), `src/screens/studio/*` (23 files), `src/lib/studio/*` (86 files: `renderer.ts` 1,591, `editOps.ts` 1,095, `gates.ts` 930) | Real compositor proven by `check-renderer.mjs` (366 assertions), real decompose (`check-decompose.mjs`, 98), real gates/edit-ops tests. Preview and export both call `drawStudioFrame` | Phase 1.3: preview↔export parity test, explicit undo/redo audit over every studio mutation, verify on Windows |
| B4 | Undo/redo | Editor history | **Fully working (code)** | `src/state/useProjectStore.ts:169-360` | Snapshot-based history with labels, coalescing for drags, redo branch dropped on new edits, non-user patches propagated into snapshots, capped at `HISTORY_LIMIT`. **Not** a command-pattern stack (the brief's assumption), but real | Phase 1.3: keep; add tests that every studio action pushes exactly one step |
| B5 | Studio timeline (drag/trim/split/reorder) | Direct manipulation | **Partial** | `src/screens/studio/StudioTimeline.tsx`, `src/lib/studio/doc.ts`, `timelineOps.ts`, `splitClipAt` | Real pointer drag (`move`, `trim-start`, `trim-end`), snapping and settle-to-undo exist. The separate **Timeline screen** (`src/screens/Timeline.tsx`) draws a Gantt strip with a playhead and **no picture preview** — it is a second, thinner editor | Phase 1.3/3: either give the Timeline screen a real composited preview or fold it into Studio |
| B6 | Export (Studio WebM/MP4) | Real file on disk | **Partial** | `src/lib/studio/export.ts`, `main.cjs:3555-3600` (`studio:exportMp4`), `main.cjs:3990-4130` (ffmpeg) | Browser path = real-time `MediaRecorder` capture of the real compositor (documented choice: frame-stepping would desync audio). Desktop path = hidden renderer + real FFmpeg, `loudnorm` measured, `render:progress` streamed. **No frame-exact encode**; `MAX_RENDER_DURATION_SEC` caps length | Phase 1.6: progress is already real (see B7); add disk/permission preflight + post-export playback verification in the test suite |
| B7 | Render queue progress | Accurate progress | **Fully working (code)** | `main.cjs:4052` (`-progress pipe:2 -nostats`), `:4063-4073` (`ffmpegProgressSeconds` → units), `:4189` (`pct = (completed+current)/total*92`), `:3559` (`studio:progress`) | Progress comes from parsed ffmpeg output and real per-frame capture counts — not a timer. `renderFootageInterval` reports units per interval; arena segments report one unit per captured frame | Phase 1.6: verify against a real long render and add a regression test that a stalled encode does not advance |
| B8 | Arena Desk | Import a generated piece, take it apart | **Fully working (code)** | `src/screens/ArenaDesk.tsx`, `src/lib/arena.ts`, `src/lib/studio/importHtml.ts`, `handoff.ts` | Real zip/HTML import, real `parseGeneratedHtml` → storyboard clips, real "open builder + copy prompt" via `arena:openBuilder` (clipboard content verified, `main.cjs:1540`) | Phase 1.5: in-app explanation of what the desk is for (onboarding), Windows verification |
| B9 | Footage Desk | Upload, analyse (silence), caption | **Fully working (code)** | `src/screens/FootageDesk.tsx`, `main.cjs:1500-1540` (`silencedetect`), `writeAss` (`main.cjs:3916`) | Real ffmpeg `silencedetect` with user settings persisted through `settings:set`; captions rendered to real ASS subtitles with three styles | Phase 1.4: verify caption timing on real speech; replace fake-engine tests |
| B10 | TTS / captions / dictation | Offline voice + word-timed captions | **Partial (UNVERIFIED on Windows)** | `electron/tts.cjs`, `electron/voice-engines.cjs`, `src/lib/speech/*`, `src/lib/voice.ts`, `src/lib/studio/autoCaptions.ts` | Real engines are *called* correctly (Piper discovery, Windows SAPI by culture with a refusal instead of reading Hindi in an English voice, whisper.cpp with `-ml 1 -sow -oj` word timings, Windows Speech fallback). No bundled engine; CI tests use fake binaries; the Windows spawn path has never been executed by a test | Phase 1.4 + 2: real-engine tests on Windows, in-app install/download actions, verify 5+ real files |
| B11 | Motion Engine / gallery | 900+ motion assets, templates, previews | **Partial** | `src/screens/MotionEngine.tsx`, `src/components/AssetGallery.tsx`, `src/engine-showcase/*`, `src/registry`, `src/core/registry` | Catalogs are real data with real renderers (catalog test asserts ≥100 motion, ≥50 typography, ≥50 transitions…). But the gallery's dialog/tabs run on the **radix-ui shim** (A2) and its video export path runs on the **mediabunny stub** (A2) | Phase 1/3: real Radix primitives, remove or implement the stubbed muxer, delete the dead Next tree |
| B12 | Library (resource packs) | Offline catalogs, apply to a piece | **Fully working (code)** | `src/screens/Library.tsx`, `src/lib/packs.ts`, `resources/packs/*`, `vite.config.ts` resource middleware | Packs are served from `resources/` by the dev/preview middleware with a path-escape guard; application path tested by `check-resource-apply.mjs` | Phase 3: onboarding copy for what a "pack" is |
| B13 | Brief (chat + rundown + lock) | Draft, edit, lock the rundown | **Fully working (code)** | `src/screens/Brief.tsx`, `useProjectStore` (`patchRundown`, `lockRundown`), `src/lib/automation/plan.ts` | Real editing, real lock that gates Arena Desk, real async polish event (`ai:rundownPolished`) | Phase 3: state coverage (empty/loading/error) audit |
| B14 | UI Lab | Component zoo | **Partial (vendored)** | `src/lab/**` (315 components + ~150 framecn) | Real components, vendored; hosted in its own screen. `@paper-design/shaders-react` (PolyForm Shield) is used here — see C | Decide product status; swap restricted-licence shaders |
| B15 | Review Room | Reviewer comments on a render | **Fully working (code)** | `src/screens/ReviewRoom.tsx`, `main.cjs:895-910` (`review:add/list/resolve`) | Real JSON round-trip with `logLine` audit; verified statically (`check-production.mjs`) | Windows verification |
| B16 | Update / packaging | Auto-update, installer | **Partial** | `electron/main.cjs:4400-4480`, 4645, `package.json` build block, `.github/workflows/release-windows.yml` | Real `electron-updater` wiring (auto-download, 4-hourly check, quit-and-install, `updater:install` exposed). **Installer is unsigned** (`CSC_IDENTITY_AUTO_DISCOVERY: 'false'` in the workflow, no signing config in `package.json`) | Phase 4: code signing, clean-VM install test, real version-to-version update test |
| B17 | Legacy Next.js surface | Server API + gallery pages | **UI-only fake / dead** | `src/app/**` (17 files) | Never mounted by the desktop app; `api/render` fabricates success (A3) | Delete or explicitly quarantine |

---

## C. Dependency & licensing audit

### C1. Blocking / decision-required licences

| Component | Where | Licence | Assessment |
|---|---|---|---|
| `@paper-design/shaders-react` | production dependency; used by vendored shaders `src/lab/framecn/shader-*` | **PolyForm Shield 1.0.0** (verified: `node_modules/@paper-design/shaders-react/LICENSE`) | **Conflicts with the "professional/commercial product" goal as written.** PolyForm Shield forbids using the software to provide a product that competes with the licensor, and restricts distribution/modification. An explicit written decision (or replacement with original shaders) is required before shipping commercially. |
| `remotion`, `@remotion/player` | production dependency; used by `src/components/MotionCompositionPlayer.tsx` (Arena Desk preview), `src/lib/sources.ts` | **Remotion License** (verified text in `node_modules/remotion/LICENSE.md`) | Free for individuals and for-profit organisations with **≤3 employees**; a **paid company licence is required** for larger for-profit organisations. Since the product targets commercial shipping, this must be budgeted or replaced. |
| `ffmpeg-static` / `ffprobe-static` (shipped in the installer via `asarUnpack`) | `package.json`, `electron/main.cjs:64-76` | GPLv3-class builds (the npm-reachable `@ffmpeg-installer` build used for the audit is `--enable-gpl`; FFmpeg static builds are GPL) | Shipping GPL binaries inside a proprietary installer is a distribution decision that must be documented (licence text, source offer, no static linking into the app — it is invoked as a separate process). Needs an explicit decision in Phase 5. |
| `resources/packs/react-bits.json`, `resources/VENDOR.md:54` | catalog data | MIT **+ Commons Clause** (upstream React Bits) | Correctly handled: only metadata/links are shipped, no upstream source. Keep the rule enforced by a check. |
| Kdenlive (`resources/kdenlive/NOTES.md`) | reference notes | GPL-2.0+ | Ideas/mapping only, no code copied — as documented. |

### C2. Ported code (Apache-2.0, clean)

* `resources/open-edit/LICENSE` (Apache-2.0) + `NOTICE` retained verbatim; `THIRD_PARTY_NOTICES.md` carries a per-file port table (transcript mapper, speech probe, EDL, delivery/WCAG gates, readiness, placement, transcript cache, scoped edit, verify-applied, cut-frames, creative log, concat/mix/mux/apply-EDL in `electron/assembly.cjs`). The VEED `veed-engine-cli` binary, account APIs and Fabric routes are explicitly **not** used (they are PolyForm Shield) — that exclusion is correct and should stay enforced.
* `apply-edl` is ported and has **no UI call site** (`docs/AUDIT_2026-09-29_REFERENCES.md:501`) — a licence-clean but unused capability.

### C3. Everything else (no conflict found)

MIT/Apache-2.0/ISC/BSD as usual: `three`, `motion`, `zustand`, `zod`, `lucide-react` (ISC), `lottie-web`, `jszip` (MIT *or* GPL-3.0 — the MIT arm is used), `adm-zip`, `canvas-confetti` (ISC), `simple-icons` (CC0), `@dimforge/rapier3d-compat` (Apache-2.0), `drizzle-orm` (Apache-2.0), `pg` (MIT), `video.js` (Apache-2.0), `twilio-video` (BSD-3), `@google/generative-ai` (Apache-2.0), `thinking-orbs` (MIT), `heic2any` (package declares MIT; `NEXT_SESSION.md:357` claims the bundled libheif is LGPL-3.0 — **verify the wasm's provenance before shipping**).
* Fonts: only SIL OFL families are bundled (Fontsource); Fontshare faces are linked, not shipped. Consistent with the notices.
* `resources/` contains vendored reference material with upstream licence files beside it (`panelui`, `uselayouts`, `framecn`, `opus55`). Spot-checked `framecn`/`opus55` licences present. A full per-directory sweep of the ~25 resource directories is still pending (Phase 5 remainder).

---

## D. Release hygiene

### D1. Release bursts (multiple releases per hour)

From `gh release list` (21 releases) intersected with the tag list (22 tags):

* `v0.2.0` 05:21 → `v0.2.1` 05:32 (**11 min**) → `v0.2.2` 06:37.
* `v0.7.0` 13:02 → `v0.7.1` 13:18 → `v0.7.2` 13:31 → `v0.7.3` 14:23 → `v0.7.4` 14:31 → `v0.7.5` 14:41 → `v0.7.6` 15:12 (**7 releases in 2 h 10 min, three of them within 18 minutes**).
* `v0.14.0` 17:21:38 → `v0.14.1` 17:41:12 (**20 min**).

### D2. CI state at tagging time (33 workflow runs)

* `Release v0.9.0` push run → **failure** (2026-09-27 10:27), release published later.
* `v0.13.0`: three consecutive **failures** 10:24 → 10:32 → 10:38 before the green run at 10:45 that produced the release.
* `Release v0.14.0` → **failure** (09-28 16:58) → `Fix the Windows-only release failure` **failure** (17:08) → success (17:14) → `Release v0.14.1` success (17:32).
* `v0.15.0`: `Trigger verified v0.15.0 installer build from release branch` → **failure** (09-29 15:19) → `Upload verified installer assets to prepared v0.15.0 draft` success (15:28) → release published 15:36.
* The single workflow is `Release Windows installer` (`v*` tags + manual dispatch). **There is no PR workflow**: nothing runs on pull requests, so a red build can be merged; the guard-rails only fire at release time.

### D3. Version drift (the README/version-sync requirement in Phase 4 is genuinely unmet)

* Latest release: **v0.15.0** (2026-09-29T15:36Z). Its tag carries `package.json` 0.15.0 (verified via the API) — good.
* **The README inside v0.15.0 still advertises 0.13.0 installers** (`README.md:48-49` on that tag: `Cupric-AI-Setup-0.13.0.exe`, `Cupric-AI-0.13.0-x64-Portable.exe`). The same text is on `main` today.
* `main` (this checkout) is at `package.json` 0.13.0 while the v0.15.0 tag commit is **4 commits ahead of main** — the released tree is not on `main`.
* Tags vs releases are inconsistent: `v0.12.0` exists as a tag with **no release** (`gh release view v0.12.0` → "release not found"); there is **no `v0.3.0` tag at all**; release notes files exist only for 0.9.0, 0.10.1 and 0.13.0 (`RELEASE_NOTES_*.md`) while 0.14/0.15 shipped with auto-generated notes.
* Installer assets are large (~234 MB setup + ~234 MB portable per release) and the newest release has **0 downloads** on every asset.

### D4. What the release pipeline gets right

`run-checks.mjs` replays the real `build` chain step by step with `::error` annotations, electron-builder runs with `--publish never`, artifacts are asserted (exactly one setup exe, >10 MB) before `gh release upload`, and a packaged-app boot check (`check:boot --no-build`) is wired for the Windows runner. That scaffolding is real and was verified green here (ledger #3) — the problem is cadence and drift, not absence.

---

## E. Phase 0 deliverable

### 1. What was found
Sections A–D above, with file:line references. The headline items:

1. **Fake test infrastructure** (`src/shims/vitest.ts` + `vitest` missing from `package.json` + no `test` script + no PR CI) — the repo's own audit already recorded that `npx vitest run` cannot run; the shim means even a successful run through the Vite config could not fail. The tests themselves are real and pass with a real runner (ledger #4/#5).
2. **Stubbed libraries in live code paths** (`src/shims/mediabunny.ts` → empty video Blobs reachable from AssetGallery/legacy editor; `src/shims/radix-ui.tsx` → dialogs/tabs without accessibility or real state).
3. **A fabricated API route** in the dead Next.js tree (`src/app/api/render/route.ts` returns `success: true` with a nonexistent download URL).
4. **Fake save indicator** (`src/app-shell/TopBar.tsx:38`) decoupled from the real `state:save` promise.
5. **Two no-op/stub steps inside the flagship autonomous pipeline** (step 2 "lock", step 5 "build timeline"), plus its logic living untested inside `electron/main.cjs`.
6. **30 empty `catch {}` blocks in `electron/main.cjs`** (plus 5 in `project-history.cjs`), two of which hide real failures (automation progress, autosave snapshots).
7. **Tests that prove things with fake binaries** (`check-tts-languages.mjs`, `check-local-voice.mjs`, `check-automation.mjs`) — precisely the pattern the brief forbids.
8. **Licence conflicts**: `@paper-design/shaders-react` is **PolyForm Shield 1.0.0** and is a shipped dependency; `remotion` requires a paid company licence above 3 employees; the bundled ffmpeg/ffprobe static builds are GPL-class.
9. **Release drift**: 7 releases in 2 h 10 min, red release builds immediately before tags, no PR CI, README advertising 0.13.0 while v0.15.0 shipped, an orphan `v0.12.0` tag, no `v0.3.0`, and a released commit 4 commits ahead of `main`.
10. **Corrections to the brief's assumptions**, stated because they matter for the fix plan: localhost ports **are** detected (not assumed); render progress **is** real (parsed ffmpeg output, not a timer); undo/redo **does** exist (snapshot stack, not command pattern); no no-op `onClick` handlers were found; `Math.random` is not used to fake success.

### 2. What was changed
**Nothing during the audit itself** — this document is the Phase 0 output and no source file was edited while it was being written.

Immediately after the audit closed, the first finding (§A1) was fixed, because every later phase depends on a test suite that can actually fail:

* `package.json` — added `vitest ^3.2.7` to `devDependencies`; added `"test": "vitest run"`; the release chain now runs `node scripts/check-test-runner.mjs && npm run test` between `tsc --noEmit` and `check-bridge`.
* `vite.config.ts` — removed the `'vitest': src/shims/vitest.ts` alias (with a comment recording why).
* `src/shims/vitest.ts` — **deleted** (its `expect()` matchers were empty functions).
* `scripts/check-test-runner.mjs` — new guard: `vitest` must resolve to the real package, `vitest` must be a devDependency, `npm test` must exist and be part of `npm run build`, no alias may redirect the specifier, and no file under `src/` may re-implement `expect`.
* `.github/workflows/pr-checks.yml` — new Windows-only workflow on `pull_request`: `npm ci` → `node scripts/run-checks.mjs` → `electron-builder --win --publish never` → installer assertions → packaged-app boot check on every view.

### 2b. How that change was verified (same session)

| Step | Observed |
|---|---|
| `npm test` (real Vitest) | `Test Files 2 passed (2)`, `Tests 31 passed | 1 skipped (32)` |
| Negative probe: temporary failing test added | `Test Files 1 failed | 2 passed`, exit code **1** (the runner can fail) |
| Negative probe: alias restored temporarily | `scripts/check-test-runner.mjs` → `test-runner check FAILED: vite.config.ts aliases the `vitest` specifier`, exit 1; restored afterwards |
| Full chain `node scripts/run-checks.mjs` | `✓ 4/76 node scripts/check-test-runner.mjs`, `✓ 5/76 npm run test`, **`BUILD PASSED: all 76 checks`**, exit 0 |

Still **UNVERIFIED**: the new workflow has not executed on GitHub (it needs a pull request and a Windows runner), and branch protection requiring the check could not be enabled from this session (`gh api … /branches/main/protection` → `403 Resource not accessible by integration`). A repo admin must tick *Settings → Branches → main → Require status checks → "Build and test on Windows"* for merging to be blocked on it.

### 3. How it was verified
See the ledger (§0). In short: the full 74-step release check chain **passes** on this checkout (`BUILD PASSED`), `tsc --noEmit` is clean, both existing test files pass under a real Vitest, five behaviour checks were run individually, and the release/tag/workflow history was read from the GitHub API. Findings marked "(static)" are read from source, and each is quoted with its file and line so it can be re-checked.

### 4. What is still unverified / broken (honest list)
* **Every Windows behaviour**: installer, SmartScreen, SAPI/Piper/Whisper engines, GPU canvas, packaged preload/IPC, auto-update. No Windows machine and no Electron binary in this environment. **UNVERIFIED.**
* **All GUI behaviour**: `check:boot` (every view, empty/corrupt fixtures, forced crash) needs Electron or Chrome; both downloads are blocked here. **UNVERIFIED.**
* **Real-media renders**: ffmpeg and ffprobe are available now, but no render of a real project has been attempted here yet (that is Phase 1/2 work).
* The `heic2any`/libheif licence question, and a per-directory licence sweep of all ~25 `resources/` directories. **PENDING.**
* `apply-edl` remains ported-but-unreachable; step 5's `timeline-plan.json` remains unconsumed — both confirmed by the repo's own audit and re-confirmed here.

---

## F. Phase 1 plan (what happens next, in this order)

1. **AI provider layer (B1).** Introduce `AIProvider` with typed results and the error taxonomy (`NO_KEY_CONFIGURED`, `RATE_LIMITED`, `NETWORK_ERROR`, `INVALID_RESPONSE`, `TIMEOUT`), adapters for OpenAI, Anthropic and local OpenAI-compatible servers (Ollama/LM Studio/llama.cpp), settings screen wiring, retry actions in the UI. Delete `stripSponsored` and the third-party keyless default. Unit-test every adapter with a real HTTP mock at the transport boundary.
   **→ Done, in `docs/PHASE1_AI_PROVIDER.md`** (2026-09-29): `electron/ai-providers.cjs` + `electron/ai-provider-config.cjs`, the four new IPC handlers, `src/app-shell/ProviderSettings.tsx`, `stripSponsored` deleted, `KEYLESS_ENDPOINTS` emptied, 36 unit tests plus a 37-assertion real-HTTP check, and the release chain at **77 checks** (`BUILD PASSED`). Windows GUI verification is still outstanding and is listed step by step in that document.
2. **Autonomous pipeline (B2).** Extract the eight steps out of `main.cjs` into pure functions with real inputs/outputs, make steps 2 and 5 real (validated lock; an actual editable timeline written back to the project), keep per-step persistence, and add a test that runs the pipeline N times on varied briefs and asserts the outputs differ in content, not just in ids.
   **→ Done, in `docs/PHASE1_AUTONOMOUS.md`** (2026-09-29): `electron/automation-steps.cjs` (named steps, validated lock with a content hash, a real validated timeline plan the render now follows, a mechanical render gate), `src/lib/automation/lock.ts` + the parity test for the browser half, 33 new unit tests including a 12-brief differential suite, and `scripts/check-automation-steps.mjs` proving the pipeline order by reading the real function body (falsifiable: two negative probes recorded in the document). The release chain is now at **78 checks** (`BUILD PASSED`), `npm test` at **100 passed \| 1 skipped**. Windows verification is still outstanding and is listed step by step in that document.
3. **Studio/timeline gaps (B3/B5).** Preview↔export parity test, one-undo-step-per-action test, and a decision on the second Timeline screen.
   **→ Done, in `docs/PHASE1_STUDIO.md`** (2026-09-29): `exportSources()` (one export source set, no duplicated literals), `frameTimeFor()` (one clamp shared by preview and export), `scripts/check-preview-parity.mjs` (171 assertions rendering the real renderer through both configurations, three negative probes recorded), the no-op undo fix in `useProjectStore` with the audit grown to 16 mutations + 3 no-op cases, the Timeline preview panel (real source seek, honest states), and the macOS window chrome removed (`check-studio-surfaces` now enforces Windows-only window code). Release chain at **79 checks** (`BUILD PASSED`), `npm test` at **100 passed \| 1 skipped**. Windows verification still outstanding — listed in that document.
4. **Speech/voice (B10).** Replace the fake-binary tests with real-binary tests run on Windows, add install/download actions and honest blockers in the UI.
5. **Export hardening (B6/B7).** Disk-space/permission/codec preflight with distinct messages, post-export probe + playback assertion in tests.
6. **Then** the licensing decisions (C1) before any commercial packaging, and Phase 3 (design system) / Phase 4 (signing, clean-VM, version-sync gate) afterwards.
