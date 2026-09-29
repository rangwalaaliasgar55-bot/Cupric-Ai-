# Cupric AI vs open-edit vs MoneyPrinterTurbo — evidence-based audit

Date: 2026-09-29 · Cupric AI `0.13.0` · branch `arena/01a0ecc4-cupric-ai` @ `b73f733`
References: `veedstudio/open-edit` (Apache-2.0, cloned to `/tmp/open-edit`) and
`harry0703/MoneyPrinterTurbo` (MIT © 2024 Harry, cloned to `/tmp/mpt`), both at their
default branch, read locally. Every claim below was read in the code of this checkout.

**How to read the labels.** `VERIFIED` = the code path was read and (where possible) executed by a
headless check in this repo. `PARTIAL` = it exists but only some entry points use it, or it is
fragmented. `MISSING` = no code found. `NOT VERIFIED` = it exists but this environment cannot run it
(no Electron binary, no Chromium, `vitest` not installed — see the verification log at the end).
Nothing here is inferred from README claims or from the presence of a check script.

---

## A. Executive diagnosis

### Real strengths (verified)

1. **A real editor core, not a slideshow.** `src/lib/studio/doc.ts` is the single source of truth for
   an editable `StudioDoc`; preview (`src/screens/studio/StudioPreview.tsx`) and export
   (`src/lib/studio/export.ts`) paint through the same renderer, and every mutation goes through
   `patchStudio` so a Quick Video build or an audit fix is one undo
   (`src/state/useProjectStore.ts`, `src/screens/Studio.tsx:215-248`).
2. **Desktop hardening is deliberate.** `sandbox: true`, `contextIsolation: true`,
   `nodeIntegration: false`, `webSecurity: true` (`electron/main.cjs:3061-3064`), an explicit
   renderer→main channel allowlist in `electron/preload.cjs`, and a check that turns a missing
   channel into a build error (`scripts/check-ipc-allowlist.mjs`). Zip imports are zip-slip guarded
   (`extractZipSafely`, `electron/main.cjs:3032-3045`); imported HTML is parsed, never evaluated
   (`src/lib/studio/importHtml.ts`, "anything cleverer would be evaluating code by another name").
3. **A genuine speech pipeline ported from open-edit** (Apache-2.0, attributed in
   `THIRD_PARTY_NOTICES.md`): one transcript shape for every Whisper family with a
   *words-in == words-out invariant that throws rather than losing a word*
   (`src/lib/speech/transcript.ts`, `mapWhisperTranscript`), probe → cut ranges → frame-snapped EDL
   (`src/lib/speech/probe.ts`, `src/lib/speech/edl.ts`), and captions whose per-word timings are real
   when the provider gave them (`src/lib/studio/textTools.ts:68-135`).
4. **Real delivery QA exists — in one of the two pipelines.** The autonomous desktop render probes the
   file it is about to hand over (`evaluateAutomationRender`, `electron/main.cjs:1613-1665`): exists,
   size, video stream, exact target dimensions, even dimensions, duration ≥ 85 % of the plan, frame
   rate, audio stream; one bounded retry; the result is written to `review-report.json`
   (`writeAutomationReview`, ~`electron/main.cjs:1670`). This is better than most desktop editors and
   is the strongest single piece of engineering in the repo.
5. **Degraded paths are honest.** No model → `localStudioEditPlan` / `draftScript` / rule-based text
   variants; no stock key → Picsum placeholders labelled "replace before publishing"
   (`electron/stock.cjs:87-101`); no key at all → the keyless free-brain chain; no desktop →
   "Auto-captions from audio need the desktop app … Paste a transcript below instead"
   (`src/lib/studio/autoCaptions.ts`, `transcribeClip`).
6. **Recoverability.** Three layers of crash handling (`src/lib/crashGuard.ts`), a main-process
   recovery page (`electron/main.cjs:235`), persisted-state validation with a repair toast
   (`src/state/useProjectStore.ts:845`), and project version history
   (`state:snapshotNow`/`state:listVersions`/`state:restoreVersion`).
7. **Machine verification culture.** 65 `scripts/check-*.mjs` scripts driven by
   `scripts/run-checks.mjs`, wired into `npm run build`, plus a packaged-app boot check in CI
   (`.github/workflows/release-windows.yml:52-59`). **64 of 65 pass in this environment**; the one
   failure is `check-boot.mjs`, which needs Chromium/Electron, not a missing feature.

### Biggest bottleneck (one sentence)

**Cupric has two pipelines that never meet: an editable, gated, deterministic Studio core and an
LLM/HTML generation core — and nothing in between carries provenance or task state, so how truthful
the result is depends on which door the user walked in.**

Evidence:
- `Project` keeps `studio?: StudioDoc` (typed) next to `production?: unknown` ("normalised on read",
  `src/types/project.ts:175-178`) — the production/automation world has no contract.
- Quick Video's history lives outside the store (`localStorage['cupric.quickVideo.history']` and
  `…settings` in `src/screens/production/QuickVideoPanel.tsx:28-29`), while automation jobs live in
  the store (`src/state/useProjectStore.ts:168`), and Studio scenes in the doc. Three histories.
- Pre-render gates (`src/lib/studio/gates.ts`, `runGates` `:665`) are wired to the Studio audit
  button (`src/screens/Studio.tsx:215-248`) and to `check-gates.mjs` — not to Quick Video, not to the
  autonomous render (which uses the unrelated ffprobe gate above).
- Quick Video's subtitles are timed **proportionally** by construction
  (`timeSubtitles`, `src/lib/production/quickVideo.ts:190`) and the composed clips carry no word
  timings, while Studio's auto-captions do (`StudioProPanel.tsx:534-535` → `captionsForClip` →
  `captionDelays` → `wordDelaysMs` → the `word-reveal` renderer path). Same product, two truths.

### Three most important differences from each reference

**vs open-edit (Apache-2.0 CLI/skill):**
1. *One transcript shape everywhere.* open-edit's rule is that every provider writes one shape and
   word delays are derived "by construction". Cupric ported the mapper, but only Studio's
   auto-captions consume real timings; Quick Video still guesses (`quickVideo.ts:190`).
2. *One gate chain that stops at the first named failure* (lint → verify → contrast → record → mux,
   `docs/FLOW.md:32` upstream, ≤2 fix cycles per gate). Cupric has the machinery
   (`gates.ts`, `GATE_BUDGET = 2` at `gates.ts:730`) but two divergent gate chains and no single
   entry point.
3. *Retime, don't re-transcribe.* open-edit moves existing per-word timings onto the snapped edit
   timeline (`retime-transcript`). Cupric's clip-relative `wordDelaysMs` gives the same property for
   free (`src/types/project.ts:497-506`) — but nothing re-derives timings after a silence cut, so the
   property is untested outside Studio.

**vs MoneyPrinterTurbo (MIT, Python/Streamlit):**
1. *Subtitles from ASR are a first-class mode.* MPT runs the ASR pass with `word_timestamps=True` and
   can burn word-by-word cues (`app/services/subtitle.py:59-131`,
   `subtitle_display_mode = "sentence" | "word_by_word"`, `config.example.toml:687`; driven from
   `app/services/task.py:610-636`). Quick Video has no word-level path at all — that is exactly the
   gap this PR closes.
2. *One orchestration entry point per topic with a durable task object.* MPT's `task.py` owns
   state/steps/history for the whole run. Cupric splits this across `src/lib/automation/run.ts`,
   `src/lib/production/engine.ts` and the Quick Video panel, each with its own state shape.
3. *Batch variations as a first-class knob.* Both have it (`variantSeeds`/`buildQuickVariants` in
   `quickVideo.ts:224-245` saving variants as Studio scenes) — this one is a genuine parity, not a gap.

---

## B. Comparison matrix

Confidence: **High** = read the code and ran a headless check; **Med** = read the code, not executed;
**Low** = read partially. Cupric evidence is `file:line` / function.

| # | Dimension | Cupric AI | open-edit | MoneyPrinterTurbo | Confidence |
|---|---|---|---|---|---|
| 1 | Transcript contract | `VERIFIED` one shape, word-count invariant, throws instead of dropping words (`src/lib/speech/transcript.ts`, `mapWhisperTranscript`); provenance (`interpolated`, `reordered`) returned but **not persisted onto clips** | one `transcript.json` shape per provider, written into the run dir (`cli/src/prep/*`) | faster-whisper output consumed directly, sentence or word mode (`app/services/subtitle.py:59-131`) | High |
| 2 | Word timing in the *default* caption path | `PARTIAL` Studio auto-captions are word-timed (`StudioProPanel.tsx:534`, `autoCaptions.ts` `captionsForClip`/`wordsToTimeline` honour trim+speed); **Quick Video subtitles are proportional and unlabelled** (`quickVideo.ts:190`, `buildQuickDoc` `:256` writes no `wordDelaysMs`) | word delays derived from `word-timings.json` for the compiled recipe | word-level mode available from the same ASR pass (`word_level` flag) | High |
| 3 | Edit / retime semantics | `VERIFIED` clip-relative `wordDelaysMs` survives drag/split (`src/types/project.ts:497-506`); `edl.ts` `snapToFrames` ceils edges, `retime` moves words by majority overlap | `apply-edl` + `retime-transcript` on the snapped grid | cut/merge of clips; captions re-burned per render | High |
| 4 | Delivery gates | `PARTIAL` rich pre-render gates in `src/lib/studio/gates.ts` (lint → safezones → contrast → loudness → deliver, first-failure stop, `GATE_BUDGET 2`), **wired only to Studio's audit button**; post-render ffprobe QA exists **only** for autonomous renders (`main.cjs:1613`) | one chain, run from the CLI, stops at the first named failure (`docs/FLOW.md:32`) | no delivery gates; render errors surface as task failure | High |
| 5 | Paid-call approval + cost | `MISSING` model calls happen on action (Studio "plan edits", Quick Video script, production planner) with no quote or confirm; the only approval is the production plan (`engine.ts:74` `approved:false`, `nextAction.ts:22-24`, `production/types.ts:115`) | one spend gate during FOOTAGE with the quoted cost in the same yes (`docs/FLOW.md:25`) | none (user owns all keys) | High / Med |
| 6 | Task state, retry, cancel, resume | `PARTIAL` automation: `automation:start/cancel/resume/approveStep/rejectStep` + `resumeAutomationJob` (`useProjectStore.ts:456`); renders: pause/resume/cancel/reveal + `retryRender` (`useProjectStore.ts:774`); Quick Video: no resume, failures only written to `localStorage` history | run dir + `--resume`; a charged job is collected, never re-paid | task state machine + task list | High |
| 7 | Job history artefacts | `PARTIAL` autonomous runs write `review-report.json` + rundown + manifest next to the MP4 (`writeAutomationReview`); Quick Video tasks are localStorage-only; Studio exports write the file and a render-queue event but no report | run dir with chapters, transcripts, timings, manifest | `storage/tasks/*.json` | Med |
| 8 | Offline / degraded fallbacks | `VERIFIED` offline edit planner, offline script draft, keyless free-brain chain, Picsum placeholders, paste-a-transcript captions | requires its engine binary + providers | degrades to failure | High |
| 9 | Caching / replay / determinism | `PARTIAL` stock search cache 24 h (`electron/stock.cjs`), speech-probe cache per `mediaId:range:opts` (`studio/speechProbe.ts`), seeded Quick Video (`mulberry32`, `variantSeeds`) and design triples; no render-input hash, no replay of a failed run, design goldens still on the `UPGRADE_PLAN.md` do-first list | deterministic recipe generation "zero tokens", re-runs from the run dir | caches downloads only | Med |
| 10 | Batch variations | `VERIFIED` `buildQuickVariants` → live timeline + every variant saved as a Studio scene; "export every scene" | chapters/remix | `video_count` + batch | High |
| 11 | Collaboration | `PARTIAL` ReviewRoom: local device preview, local time-coded notes, optional Twilio token entered by the user; the screen says plainly that notes are local and cross-device needs a deployed service (`src/screens/ReviewRoom.tsx:258`) | not a collaboration tool (agent-first, single operator) | none | High |
| 12 | Release / CI | `PARTIAL` one workflow, unsigned NSIS on `v*` tags, packaged boot check across every view, artifact + `latest.yml` upload (`release-windows.yml`); no macOS/Linux job at all | npm CLI package, published to npm | Docker + pip | High |
| 13 | Security of imports/keys | `VERIFIED` zip-slip guard, HTML parsed not evaluated, sandbox+contextIsolation, IPC allowlist check; keys live in `userData/settings.json` plain (`readSettings`, `main.cjs:270`) — **no `safeStorage` usage found** | engine binary is a separate licensed download; login-based | keys in `config.toml` | High |
| 14 | Localisation | `VERIFIED` English + Hindi paths (language detection in the production engine, `voice:tts` language resolution, Piper) | English docs/CLI | zh-first, multi-language config | Med |
| 15 | Doc accuracy | `DRIFT` `THIRD_PARTY_NOTICES.md:27` maps upstream `cli/src/commands/check-delivery.ts` to `src/lib/speech/delivery.ts` — **that file does not exist**; delivery findings actually live in `src/lib/studio/gates.ts` (`DeliveryFindings` `:472`). `ARCHITECTURE.md:42` documents `npx vitest run` as verification, but `vitest` is not in `package.json` dependencies and cannot run (see log) | – | – | High |

### The six investigation questions, answered directly

| Question | Verdict | Where the evidence is |
|---|---|---|
| 1. Transcript truth — does inaccurate timing reach the final video? | **Yes, today.** Quick Video's subtitles are proportional (`quickVideo.ts:190` `timeSubtitles`, `buildQuickDoc` wrote no `wordDelaysMs`) and were indistinguishable from real ones. Studio's auto-captions were already word-timed (`StudioProPanel.tsx:534` → `autoCaptions.ts` `captionsForClip`). Fixed in this PR: one planner, provenance on every caption. | §B1, §B2, §E (first PR) |
| 2. Workflow cohesion — one durable model, or duplicated logic? | **Duplicated.** Three histories (store automation jobs, localStorage Quick Video tasks, Studio scenes) and `Project.production?: unknown`. Studio doc is the only shared artefact. Plan: `ProductionRecord` (§D1). | §B6, §B7, §D |
| 3. Delivery quality — what exists but is not wired into delivery? | **`runGates` and the post-render ffprobe QA.** Gates run from Studio's audit button and `check-gates.mjs` only; `evaluateAutomationRender` (`main.cjs:1613`) inspects only autonomous renders, while Studio MP4 export checks existence and size (`executeStudioMp4Job`, `main.cjs:3408-3455`). Wiring that *is* complete: loudness (`doc.loudnessTarget` → `encoders.loudnormArgs` at `main.cjs:3436`) and ducking (`mixGainAt` = volume/fades × `duckAt`, applied per frame in preview `StudioPreview.tsx:140` and baked into the recording in export `export.ts:234`, so the desktop MP4 inherits it). Found while checking: `gainAutomation` (`audioMix.ts:47`) has no callers. | §B4, §B9, backlog 2 |
| 4. Repeatability — deterministic fixtures, cache, resume? | **Partial.** Caches exist (stock 24 h, speech probe per `mediaId:range:opts`), builds are seeded and pure, autonomous runs write a machine-readable `review-report.json`. Missing: cost estimates, spend approval, render-input hashing, replay of failed runs, and design goldens (still a `UPGRADE_PLAN.md` item). | §B5, §B9, backlog 4/7 |
| 5. Collaboration & release — is local review honest? | **Honest.** `ReviewRoom.tsx:258` states notes are local and cross-device needs a deployed authenticated service; Twilio tokens are user-supplied and never stored. CI is Windows-only, unsigned NSIS, with a packaged boot check; key storage is `userData/settings.json` with no `safeStorage`. macOS/Linux: no evidence. | §B11, §B12, §B13 |
| 6. Product focus — sprawl or value? | **Two duplicated browse surfaces plus a 199-entry lab.** `src/lab/**` is 4.8 MB / 199 registry entries, `MotionEngine.tsx` offers showcase/templates/gallery, `Library` is a third place to look; consolidate rather than delete (backlog 8). Everything else found in the audit is used by a real flow. | §B, backlog 8 |

Unknowns (stated honestly): macOS/Linux packaging has no evidence in the repo (Windows-only workflow);
Electron runtime behaviour (packaged app, updater, auto-launch) could not be executed here; the
`vitest` suites `src/tests/core.test.ts` and `src/tests/system.test.ts` exist but **cannot run in this
environment** and are therefore unverified, not "passing".

---

## C. Ranked backlog (≤8, smallest vertical slice first)

Each item: impact → effort → dependencies → risks → acceptance criteria.

### 1. Caption timing truth: real word timings reach Quick Video, and every caption says where its timing came from (this PR)
- **Impact:** the single most visible quality difference in the default flow (`Quick Video → Studio → Render`); a caption that lands on the spoken word instead of evenly across a block.
- **Effort:** small (one shared timing function + one opt-in transcription step + provenance field).
- **Dependencies:** existing `speech/transcript.ts`, `studio/textTools.ts`, `studio/autoCaptions.ts`, `production/quickVideo.ts`.
- **Risks:** an extra offline Whisper pass per Quick Video run (opt-in, cancellable); phrase-timed engines (Windows Speech) must be labelled, not silently "fixed"; a word-count mismatch must fall back, never drop a word.
- **Acceptance criteria:** with real words, every produced caption has `wordDelaysMs.length === text token count`, delays strictly non-decreasing and inside the clip; with phrase timings the clip is labelled approximate; with no timings the clip is labelled estimated and the timing still covers the narration; nothing regresses when no timings are available.

### 2. One gate chain for every export (including post-render verification)
- **Impact:** today a Studio MP4 can be delivered with no file inspection while an autonomous render is probed (`main.cjs:1613` vs `executeStudioMp4Job` `main.cjs:3408-3455`).
- **Effort:** medium. **Dependencies:** `gates.ts`, `gateRunner.ts`, `electron/main.cjs`, Render screen.
- **Risks:** double-reporting; probe failures on odd containers; latency.
- **Acceptance:** Studio desktop export runs `evaluateAutomationRender`-equivalent checks and writes a report next to the MP4; `runGates` runs once per delivery from any entry point (Quick Video, Studio, automation) and the UI shows the same report object.

### 3. Persisted production record (`Project.production` typed, versioned)
- **Impact:** resume, honest status, one history instead of three.
- **Effort:** medium-large. **Dependencies:** `types/project.ts`, `useProjectStore.ts`, `migrate.ts`/`projectSchema.ts`, all production screens.
- **Risks:** migration of existing saves; `partialize` list must grow deliberately.
- **Acceptance:** a job survives app restart with per-stage status/attempts/artefacts; `validatePersistedState` repairs a corrupt record without losing the project.

### 4. Spend visibility and one explicit approval for paid calls
- **Impact:** users currently cannot see that a button spends money; open-edit quotes cost in the same yes (`docs/FLOW.md:25`).
- **Effort:** medium. **Dependencies:** every model call site (`studio:planEdits`, Quick Video script, production planner), settings key store.
- **Risks:** blocking legitimate free/local calls; wrong estimates (must be labelled an estimate, never a quote).
- **Acceptance:** before a paid call the UI shows provider/model/estimated tokens-cents and requires one confirm; local/offline providers bypass; the run record stores the estimate and the actual outcome.

### 5. Retime across edits instead of re-transcribing
- **Impact:** tightening by silence after captions currently leaves caption timings untouched.
- **Effort:** medium. **Dependencies:** `speech/edl.ts`, `studio/autoEdit.ts`, `StudioProPanel` tighten action.
- **Acceptance:** after a silence cut, word timings are moved by the same mapping as clip start/duration; a split caption keeps per-word sync; a test proves a word on the cut boundary is dropped and counted.

### 6. Aspect/duration assertions and safe-zone coverage for every entry point
- **Impact:** `subtitlePosition: 'custom'` (`quickVideo.ts` `subtitleY`) can place text outside the social-UI clear zone and only Studio's audit would notice.
- **Effort:** small-medium. **Dependencies:** `studio/safeZone.ts`, `gates.ts`, Quick Video settings.
- **Acceptance:** building a Quick Video doc with a custom Y outside the safe box raises a named finding at build time; the check runs headless.

### 7. Render resume + input-hash replay for failed jobs
- **Impact:** a cancelled render restarts from zero today; the stock/speech caches prove the pattern works.
- **Effort:** medium. **Dependencies:** render job state, `electron/main.cjs` queue, `studio:progress`.
- **Acceptance:** a cancelled render resumes from its last completed stage; a re-run with identical inputs reuses cached probe/stock results and reports which steps were replayed.

### 8. Consolidate the browse surfaces (Lab vs MotionEngine vs Library)
- **Impact:** three places to browse inserts; `src/lab/registry.ts` alone holds 199 entries and `src/lab/**` is 4.8 MB.
- **Effort:** medium (UI only, no data loss). **Dependencies:** `Lab.tsx`, `MotionEngine.tsx`, `Library.tsx`, `studio/ComponentsPanel.tsx`.
- **Acceptance:** one browse surface with filters that reach the existing registry; no dead entry points; the other two become deep links into it. (Distinguish real value: this removes choice paralysis, it is not "another preset".)

---

## C-bis. Shipped after the audit: breaking a clip into editable pieces (Studio)

The audit's "workflow cohesion" finding was about the *contract*; this was the missing *capability*
on the Studio side, and it reuses the ported cut machinery instead of adding any: `src/lib/studio/decompose.ts`
turns one imported video/audio clip into ordinary clips three ways — measured pauses (`speechProbe.probeClip`
→ `probeCuts`, no transcript, no model), pauses in the words (`autoEdit.speechCuts` with
`fillers: false`, so nothing spoken is deleted), or even pieces for footage with no speech — and either
closes the silence up (`tightenClip`, a real edit) or keeps the original timing and splits at the pause
boundaries. Word timings stay in source seconds on every piece, so captions and word-timed components
keep working without re-transcribing, and the captions can be generated *before* the cut so the existing
remap carries them. Reachable from Pro → Auto-edit → *Break into clips* (preview → accept) and from the
timeline right-click menu (one undo). Covered by `scripts/check-decompose.mjs` (96 assertions after
the scene-change modes below) in the `build` and `verify` chains, and by scenario D of
`docs/SMOKE_WORD_TIMED_CAPTIONS.md`. This is backlog item 5's practical half; the remaining half is
re-deriving timings when a *user* cut (not a probe or a shot) moves them.

## C-ter. Shipped after the audit: the shots

Scenario D above covered speech. A montage has no speech to break on, so the second half of "import a
video and take it apart" is the picture itself: `src/lib/studio/shots.ts` samples the clip's own frames
(four per second, 64 px wide, no model and no network) and thresholds the mean-absolute luma difference
between consecutive samples adaptively (`max(0.06, median + 5 × MAD)`, with a strong-change fallback so an
obviously cut montage never reports "no cuts"; a spike must beat both neighbours, and changes closer
than `minShotSec` collapse to the stronger one). `decompose.ts` gained two modes that consume it:

- `shots` — `breakAtPoints` cuts the clip where the picture changes and removes **nothing**, so an
  imported edit arrives as its own shots and the timeline still plays back identically.
- `auto` — the import path: close the pauses the voice left empty (word timings first, else the measured
  waveform via `probeClip`/`probeCuts`), then split the *result* at the shot cuts, mapping the survivors
  through `remapSourceTime` and reporting the ones that fell inside removed silence instead of creating
  empty pieces.

Both are reachable from Pro → Auto-edit → *Break into clips* (*Shots + pauses*, *Scene changes*) and from
the timeline right-click menu (**Break at scene changes (the picture)**). Frame sampling needs a
decodable video, so `scripts/check-decompose.mjs` (now 96 assertions) covers the pure half —
`frameDifference`, `median`, `shotCutTimes`, `remapSourceTime` — and the whole assembly with the shots
handed in (98 assertions); `docs/SMOKE_WORD_TIMED_CAPTIONS.md` scenario E is the packaged-desktop check.
Still open from backlog item 5: a *user* cut (not a probe or a shot) does not re-derive word timings.

What "editable" does **not** include, and no amount of splitting will change: anything burned into the
pixels (baked-in captions, logos, watermarks, a picture-in-picture) and audio that arrived mixed into a
single stream. Breaking an imported file gives you its pieces, not its layers; removing a burned-in
caption needs paint-out/inpainting, which Cupric does not have and this audit does not claim.

## D. Architecture plan

Goal: keep the Studio core and the automation engine exactly where they are, and give them **one
shared contract** instead of a rewrite. Extend, do not replace.

### D1. Data contracts (additive, versioned)

```ts
// src/types/project.ts (existing, extended)
export type StudioTimingSource = 'word' | 'phrase' | 'even'
export type StudioWord = { word: string; start: number; end: number; source?: StudioTimingSource }
StudioTextClip.timingSource?: StudioTimingSource | null   // where wordDelaysMs came from
StudioMediaClip.words?: StudioWord[] | null               // already exists (source seconds)

// new: the production record, replacing `Project.production?: unknown`
export interface ProductionStage {
  id: 'intake' | 'brief' | 'research' | 'plan' | 'assets' | 'voice' | 'captions' | 'timeline' | 'render' | 'review'
  status: 'idle' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled'
  startedAt?: string; endedAt?: string; attempts: number
  artefacts: Array<{ kind: 'doc' | 'audio' | 'transcript' | 'report' | 'file'; path?: string; inDoc?: string }>
  error?: string | null
  /** hash of the inputs this stage consumed — the replay key */
  inputsHash?: string
}
export interface ProductionRecord {
  version: 1
  kind: 'quick' | 'brief' | 'autonomous'
  topic: string; settings: unknown; stages: ProductionStage[]
  spend: Array<{ at: string; provider: string; model?: string; estimateCents?: number; actualCents?: number; approved: boolean }>
}
Project.production?: ProductionRecord
```

Transcript contract stays `src/lib/speech/transcript.ts` (`Transcript`, `chunks[].words[]`, absolute
seconds). Provenance travels **with the caption clip** (`timingSource`) and **with the word list**
(`source`), so a reread after any edit still knows what was real.

### D2. Stage boundaries and adapter interfaces

```
intake ─ brief ─ research ─ plan ─ assets ─ voice ─ captions ─ timeline ─ render ─ review
                                     │        │          │           │
                            SourceAdapter  VoiceAdapter TranscriptAdapter EditEngine
```

| Boundary | Adapter | Existing module to extend |
|---|---|---|
| assets | `SourceAdapter` (`search`, `fetch`, `offline`) | `electron/stock.cjs`, `src/lib/sources.ts`, Picsum fallback |
| voice | `VoiceAdapter` (`synth`, `import`, `duration`) | `src/lib/voice.ts` `synthesizeVoiceover`, `electron/tts.cjs` |
| captions/transcript | `TranscriptAdapter` (`transcribe(path) → {words, timing, engine}`) | `src/lib/studio/autoCaptions.ts` `transcribeClip`, `src/lib/speech/transcript.ts` |
| cut/probe/retime | `EditEngine` (`probe`, `ranges`, `retimeWords`) | `src/lib/speech/probe.ts`, `edl.ts`, `studio/autoEdit.ts` |
| gates | `GateChain` (`run(doc, opts) → GateReport`) | `src/lib/studio/gates.ts` `runGates`, `gateRunner.ts` |
| render | `Renderer` (`web` MediaRecorder / `desktop` ffmpeg) | `src/lib/studio/export.ts`, `electron/main.cjs` |
| QA | `DeliveryCheck` (`verify(outputPath, spec) → Report`) | `evaluateAutomationRender` (`main.cjs:1613`) — promote it to a shared, exported helper |

Rule: adapters are pure/typed where possible; the renderer keeps working with `window`-free modules
(the existing check scripts are the proof this is possible).

### D3. Persisted task states, failure/retry/cancel

- One stage table per job, persisted in the store (`partialize` gains `projects` only — the record is
  *inside* each project, so it needs no new key) and mirrored to disk by the existing
  `state:save`/`state:snapshotNow` path.
- Retry: per-stage `attempts`, capped at 2 like `GATE_BUDGET` (`gates.ts:730`); a failed stage
  (attempts exhausted) stops the run with a named reason instead of continuing.
- Cancel: the existing `automation:cancel` + render `cancel` flags are hoisted to the record.
- Resume: a stage whose `status === 'done'` and whose `inputsHash` is unchanged is skipped and
  reported as replayed; everything downstream of a changed input is re-run (today only the
  automation path has any of this, via `automation:resume`).

### D4. How the existing screens consume the same core

- **Brief / Autonomous / Quick Video / Arena import** all produce the same artefact: a
  `StudioDoc` + `ProductionRecord`. Quick Video already ends in `patchStudio` — it gains the record
  instead of a localStorage history.
- **Studio** reads the doc; new provenance badges make `timingSource`/`words` visible where the user
  edits them.
- **Render/Library** read the record's render stage and artefacts (`review-report.json` etc.).
- **ReviewRoom** stays a local review surface; the record's `review` stage holds local notes, and the
  screen's existing honesty line about cross-device sync stays true until a hosted service exists.

---

## E. Phased implementation plan

| Phase | Contents | Files | Tests |
|---|---|---|---|
| 0 (this PR) | Caption timing truth: shared plan function, provenance on caption clips, opt-in real timings in Quick Video, Studio badge | `src/lib/studio/textTools.ts`, `src/lib/production/quickVideo.ts`, `src/lib/studio/autoCaptions.ts`, `src/types/project.ts`, `src/screens/production/QuickVideoPanel.tsx`, `src/screens/studio/StudioInspector.tsx` | `scripts/check-auto-captions.mjs` extended (21 → 48 assertions) + `docs/SMOKE_WORD_TIMED_CAPTIONS.md` |
| 1 | One gate chain for every export + post-render verification for Studio jobs | `src/lib/studio/gates.ts`, `gateRunner.ts`, `electron/main.cjs`, `src/screens/Render.tsx` | extend `check-gates.mjs`, new probe-report check |
| 2 | `ProductionRecord` v1 persisted; Quick Video/automation/Brief write it; `Project.production` typed | `src/types/project.ts`, `src/state/{useProjectStore,migrate,projectSchema}.ts`, production screens | `check-production.mjs` + migration test |
| 3 | Spend estimate + one approval; retime-across-edits | model call sites, `src/lib/speech/edl.ts`, `studio/autoEdit.ts` | new check for both |
| 4 | Resume/replay by `inputsHash`; batch variants UI on the record | render queue, production runner, Quick Video panel | replay check |
| 5 | Browse-surface consolidation; macOS/Linux only if a real target appears | `src/screens/{Lab,MotionEngine,Library}.tsx` | renderer checks |

**Migrations.** Phase 0 is additive and needs none: `timingSource` and extra `words` fields are
optional, `validatePersistedState` (`src/state/projectSchema.ts`) keeps unknown-but-optional fields,
and `QuickVideoSettings` keeps `kind: 'cupric.quickVideo'` at v1 because the new flag is optional.
Phase 2 migrates `Project.production` from `unknown` to `ProductionRecord` with a normaliser
(`normaliseProductionRecord`, `migrate.ts` `fromVersion` bump) and a repair warning through the
existing load-report toast.

### First PR (implemented now): "word-timed captions, one contract, labelled approximations"

Scope, exactly:

1. `src/lib/studio/textTools.ts` — factor the timing/grouping half of `captionsFromTranscript` into an
   exported pure `planCaptionLines(...)` and add `captionDelaysWithSource(...)` so the caller can tell
   whether delays are real (`word`), phrase-stamped (`phrase`) or an even split (`even`).
   `captionsFromTranscript` keeps its exact current behaviour and now stamps `timingSource` on the
   clips it returns.
2. `src/types/project.ts` — `StudioTimingSource` + optional `StudioTextClip.timingSource`.
3. `src/lib/studio/autoCaptions.ts` — `transcribeClip` unchanged for callers; `captionsForClip` passes
   the transcription's declared timing (`word` | `phrase`) so phrase engines are labelled, and
   re-timing words that came back out of order is reported instead of silently kept.
4. `src/lib/production/quickVideo.ts` — `buildQuickDoc`/`buildQuickVariants` accept an optional
   `words` list (seconds) plus its `timing`; with words, subtitles are built from `planCaptionLines`
   (real boundaries: pauses, punctuation, char budget) and carry per-word delays; without words the
   existing proportional path is untouched but every caption clip is labelled `timingSource: 'even'`.
5. `src/screens/production/QuickVideoPanel.tsx` — new setting `wordTimings` (default on, desktop only,
   disabled with an explanation in the browser build): after the offline voiceover is registered, the
   panel transcribes it through the same `transcribeClip` entry point Studio uses, passes the words
   into the build, and reports which path produced the subtitles (never silently). A failed
   transcription falls back to the labelled estimate and says why.
6. `src/screens/studio/StudioInspector.tsx` — read-only "Word timing" row for text clips: real word
   times / phrase times (approximate) / estimated from the script.
7. `scripts/check-auto-captions.mjs` — headless coverage of every rule above (no new build step: the script already runs in the `build` chain).
8. `THIRD_PARTY_NOTICES.md` — record the adapted upstream files; fix the `src/lib/speech/delivery.ts`
   drift found in §B15.
9. `docs/SMOKE_WORD_TIMED_CAPTIONS.md` — the packaged-desktop smoke scenario (cannot be executed in
   this environment: no Electron binary).

**Packaged-desktop smoke scenario (documented; not executed here).** Install `Cupric-AI-Setup-0.13.0.exe`,
open a project, Production → Quick Video, topic + subtitles on, "Real word timings" on, run all:
expect the log to name Whisper as the timing source; open the timeline in Studio, select a caption,
confirm `Word timing: real word times (whisper)` and that words reveal on the voice; re-run with
"Real word timings" off and confirm the badge says estimated; export MP4 and confirm the caption lands
on the same word in the file. Failure path: delete the voice file, re-run, and confirm the run reports
the transcription error and still builds labelled-estimate captions.

---

## F. Do not copy

**Licence / binary walls**
- open-edit's render engine: `veed-engine-cli` is a prebuilt binary from
  `veedstudio/weave-renderer-public-releases` under **PolyForm Shield 1.0.0** and is explicitly
  excluded by `resources/open-edit/NOTICE`. Its artefacts (`template.wv`, recipe modules that compile
  *for* that engine) are not portable and must never be vendored.
- open-edit's VEED account/login flow and its credit model (`~4 credits a second`, `docs/FLOW.md:25`)
  are a hosted product: borrow the *idea* of a quoted spend approval, never the integration.
- Do not port open-edit's "runs outside any sandbox" assumption; Cupric is an Electron app with a
  different threat model (`ARCHITECTURE.md:37`).
- MoneyPrinterTurbo's code is MIT © 2024 Harry and already attributed (`THIRD_PARTY_NOTICES.md`), but
  its Streamlit UI, `config.toml` shape and long provider list are Python/desktop-Web specific: keep
  adapting the *orchestration pattern* only (`quickVideo.ts` header documents exactly which upstream
  files each function came from).

**Privacy / secrets**
- Never bundle provider keys, Twilio tokens or Arena credentials; keys stay in
  `userData/settings.json` / environment (`main.cjs` `readSettings`, `geminiApiKey`), and the
  `picks`/settings exports must keep stripping `apiKey` (the existing sanitizer does).
- `safeStorage` is **not** used today; if keys are ever encrypted, migrate rather than add a parallel
  store.

**Features Cupric already implements — do not "add" again**
- Topic → script → voice → footage → subtitles → music → compose pipeline, settings export/import,
  task history, batch variants (`buildQuickVariants`), stock search with cache/attribution, ducking
  with own music volume, aspect presets, subtitle position/size/colour/style, offline degraded paths.
- Local Whisper auto-captions, silence tightening, probe/EDL cuts, frame snapping, project version
  history, render pause/resume/cancel/retry, crash recovery, IPC allowlist enforcement, zip-slip and
  HTML-import hardening, packaged boot check in CI.
- Area-network "arena" flow: voting happens on arena.ai by a human and import requires
  `window.__seek(t)` (`main.cjs:3146`). Keep the manual handoff; do not "automate" the vote.

**Claims not to make**
- Do not call the browser WebM draft an MP4 (`src/lib/studio/export.ts` `pickMimeType` + desktop
  conversion via `executeStudioMp4Job`).
- Do not present the production engine as autonomous: approval is manual by design
  (`production/types.ts:115`, `nextAction.ts:22-24`).
- Do not state that `src/tests/*.test.ts` pass: `vitest` is not installed in this checkout, so those
  suites are unverified. Do not claim macOS/Linux support: the only workflow is Windows.

---

## Appendix — verification log for this audit

| Command | Result |
|---|---|
| `for f in scripts/check-*.mjs; node $f` | **64 / 65 pass**; only `check-boot.mjs` fails (needs Chromium/Electron — not available here) |
| `npx tsc --noEmit` | clean |
| `npx eslint src electron --quiet` | clean (last run in the previous session, unchanged files) |
| `npx vitest run` | **cannot run** — `vitest` is not installed (`ERR_MODULE_NOT_FOUND`); `src/tests/{core,system}.test.ts` are unverified |
| Packaged app / updater / installer | **not executed** — no Electron binary in this environment (`npm install` with `--ignore-scripts`, no Chrome/Electron download possible) |
| Upstream repos | read locally at their default branches (`/tmp/open-edit` Apache-2.0, `/tmp/mpt` MIT © 2024 Harry) |
