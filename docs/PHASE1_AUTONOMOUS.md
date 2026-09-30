# Phase 1.2 — Autonomous Mode: eight real steps, locked and planned

Scope: **Autonomous Mode only** (the eight-step unattended pipeline). Phase 1.1
(AI backend) is documented in `docs/PHASE1_AI_PROVIDER.md`; nothing in this phase
touches Studio, the speech stack, or export.

Baseline commit this phase started from: `3c223e6` (head of
`arena/01a0edd4-cupric-ai` after Phase 1.1).

---

## 1. What was found

All line numbers are at `3c223e6`.

| # | Finding | Where | What was actually wrong |
| - | ------- | ----- | ----------------------- |
| F1 | **Step 2 "Lock rundown" did not lock anything** | `electron/main.cjs:1836-2050` (the step closure in `runAutomationPipeline`), step 2 inside it | It wrote `rundown.json`, then patched the *same in-memory object* back to the renderer, and reported 100%. No validation ran, no hash existed, and nothing downstream could tell a locked rundown from an edited one. A rundown with an overlap, a gap, a wrong aspect or an empty scene still reached the renderer. |
| F2 | **Step 5 "Timeline built" wrote a file nothing read** | `electron/main.cjs:1942`; `timeline-plan.json` | The five-key stub `{ winnerPath, footage, aspect, fps, quality }` was written and then *never opened again* — `grep` at `3c223e6` showed zero readers. The real timeline was derived later, inside the render, from whatever segments the renderer happened to produce. The step's name was a lie about the file's role. |
| F3 | **The render decided what to render, after the fact** | `electron/main.cjs:1702-1758` (`renderAutomationMp4`), `:1759+` (`evaluateAutomationRender`) | Segment list, order and caption windows were built inside the render function. Nothing validated the edit before ffmpeg ran, so an unrenderable plan was discovered as a failed encode. |
| F4 | **The eight steps were unreachable outside a running app** | whole closure inside `runAutomationPipeline` (`main.cjs:1836`) | Every step's logic lived inside the Electron main process. No unit test and no `scripts/check-*.mjs` could call it; the only coverage was reading the source. |
| F5 | **Steps had no ids — only indices** | `main.cjs:1836-2050` (numeric `automationStep(job, 0..7)`), `src/lib/automation/run.ts:70` (`RUN_STEP_LABELS`); the no-op step is baseline `run.ts:193-200` | The desktop passed step *numbers*; the renderer kept its own *label* strings. Two lists, no shared identity, no compile-time or test-time agreement between them. A reordered step silently mislabelled the UI. |
| F6 | **The render gate was a shape check, not a mechanical gate** | `main.cjs:1759+` | It could report "the file exists" and little else; it had no rule for even dimensions (ffmpeg fails on odd ones for H.264), no target resolution/frame-rate check against the locked rundown, and no notion of which failures are worth retrying and which are not. |
| F7 | **The browser half of the same pipeline had no lock at all** | `src/lib/automation/run.ts` step 2 | The web run reported step 2 as done without checking anything — the same no-op as F1, in the file that is exercised by tests. |
| F8 | **No test asserted that two runs of the pipeline differ** | — | "Run it 10+ times with varied inputs and confirm outputs differ meaningfully" had no counterpart in the suite. Determinism was asserted for a *single* brief only (`check-automation.mjs:69`), which cannot catch a pipeline that ignores the brief. |

`docs/AUDIT_PHASE0.md` §B2 recorded F1/F2/F4 as the phase's target. F3, F5, F6,
F7, F8 were found while fixing them.

---

## 2. What changed, and why

### 2.1 The step logic is now a real module — **new `electron/automation-steps.cjs` (402 lines)**

Pure functions, no Electron, no disk, no network, so tests and checks can call
them with real inputs:

- `STEP_DEFINITIONS` (`:26-40`) — the eight steps in order, each with an `id`
  (`workspace`, `rundown`, `lock`, `candidates`, `footage`, `timeline`, `render`,
  `review`) and a user-facing `title`/`description`. This is now the single source
  of truth for the progress UI (**fixes F5 in the main process**).
- `rundownHash` (`:48-64`) — 16-hex SHA-256 over title, duration, fps, size and
  every scene's type/copy/from/to/motion: a *content* hash, so an edited rundown is
  detectable (**fixes F1**).
- `validateRundown` (`:72-133`) — the render contract: scene times numeric,
  contiguous within 50 ms, 0.3–60 s each, coverage within 50 ms of the stated
  duration, no scene past the end, resolution matching the aspect (1080×1920 /
  1920×1080 / 1080×1080 / 1080×1350), supported frame rate (24/25/30/60), a beat
  type on every scene, copy ≤220 characters, and at least one scene carrying
  on-screen copy. Returns `{ ok, issues, checks }`; `checks` is what the review
  report prints so "locked" has a definition.
- `lockRundown` / `lockMatches` (`:140-172`) — schema-versioned lock record
  (hash, scene count, size, timestamp); `lockMatches` recomputes the hash and
  reports drift.
- `buildTimelinePlan` / `validateTimelinePlan` (`:177-292`) — turns the locked
  rundown plus probed footage into a **contiguous** segment list
  (`{ id, kind: 'generated'|'footage', source, durationSec, purpose, transitionIn, captions }`),
  with `totalDurationSec`, `captions.windows`, `footageUsed`, `rundownHash` and a
  `valid` flag; the validator re-checks contiguity, boundaries and both directions
  of the duration total (**fixes F2/F3**).
- `timelineArtifacts` (`:294-331`) — the two files that are actually shipped:
  `timeline.json` (the timeline the app opens) and `editing-plan.json` (per-segment
  operations with absolute `startSec`).
- `evaluateMechanicalRender` (`:335-372`) — the gate: file exists, non-empty,
  ffprobe-readable, even dimensions for H.264, frame rate matching the plan,
  resolution matching the locked size, video stream present, duration within
  tolerance of the plan, and audio-stream presence when the plan asked for it.
  `retryable` is true **only** for missing/empty/unplayable — a wrong-resolution
  encode is a code bug, not a retryable accident (**fixes F6**).
- `summarizeJob` (`:375`) — job-level roll-up used by the review writer.

### 2.2 The pipeline now uses it, step by step — `electron/main.cjs`

- `AUTOMATION_STEP` (`:28`) maps step ids to indices; every step is now addressed
  by name (`:1884 workspace`, `:1891 rundown`, `:1919 lock`, `:1942 candidates`,
  `:1978 footage`, `:1988 timeline`, `:2017 render`, `:2029 review`) and `grep`
  finds **zero** numeric `automationStep(job, N)` left (**fixes F5**).
- Step 2 (`:1919-1941`): calls `lockRundown`, throws with the named issues if the
  contract fails, warns when `lockMatches` says the rundown changed under an
  existing lock, writes `rundown.json` **and** `rundown.lock.json`, and patches
  `rundownLock` for the renderer.
- Step 5 (`:1988-2016`): builds the plan from the locked rundown + probed footage,
  refuses to continue when `validateTimelinePlan` fails, writes
  `timeline-plan.json`, `timeline.json` and `editing-plan.json`, and patches
  `timelinePlan`/`timelinePath`/`editingPlanPath`.
- `renderAutomationMp4` (`:1711`) now takes the plan and iterates
  `plannedSegments.entries()`, with a `sameFile` guard so footage metadata is only
  applied to the file it was measured on; it no longer rewrites `timeline.json`
  (the plan owns that file now) and patches `renderedSegments` /
  `renderedDurationSec` back.
- `evaluateAutomationRender` (`:1759+`) probes once and delegates the rules to the
  tested module, returning `failures[]`.
- The bounded retry (`:2038`) re-renders from the *same* plan and only when the
  gate said `retryable`.
- The review artifacts now carry `rundownLock` and `timelinePlan` (JSON) and an
  `## Edit plan` section (Markdown), so a failed run can be diagnosed from the
  report alone.

### 2.3 The browser pipeline stops lying about step 2 — `src/lib/automation/run.ts`

- New `src/lib/automation/lock.ts` (119 lines): the same contract, mirrored for
  the renderer. It cannot hash synchronously (no `crypto.subtle` sync API in a
  browser), so it returns a **verdict only** — not a lock record. That limitation
  is written at the top of the file rather than hidden.
- `run.ts` step 2 (`:199-211`) now validates the job's rundown before anything is
  built; on failure it emits a step with `status: 'error'`, patches the job with
  `errorMessage` and the warnings, and returns `null` — it does **not** proceed to
  design or render (**fixes F7**). On success it reports `lockSummary` rather than
  a bare percentage.
- `src/tests/automation-lock-parity.test.ts` (16 tests) loads
  `electron/automation-steps.cjs` with `createRequire` and asserts the two
  implementations agree — same `ok` verdict, same issue order, same check ids —
  over 14 fixtures, so the mirror cannot silently drift.

### 2.4 Tests and checks that would have caught the original bugs

- `src/tests/automation-steps.test.ts` (17 tests): lock happy path, content-addressed
  re-lock, and rejections (overlap, coverage gap, 16:9 size on a 9:16 job, fps 23,
  a rundown with no on-screen copy anywhere, past-duration); plan contiguity and
  artifact `startSec` agreement; gate pass / retryable / non-retryable; and the
  **12-brief differential suite** — 6–30 s, 9:16/1:1/16:9, 24/30/60 fps, 2–6 scenes
  — asserting ≥9 distinct durations, ≥4 distinct scene counts, unique captions and
  unique plans, and determinism per brief (**fixes F8**).
- `scripts/check-automation-steps.mjs` (198 lines, wired into the release chain):
  step ids/titles; word-agreement with `RUN_STEP_LABELS` and zero numeric step
  reads; the pipeline order **inside the sliced `runAutomationPipeline` body**
  (lock → plan → render); the exact render call including its plan argument; the
  throw messages for both refusals; real artifacts written to a `mkdtemp` directory
  and re-read from disk; gate rules; five varied briefs producing distinct locked
  plans; and the renderer/IPC wiring (`Autonomous.tsx` step rendering + all five
  `automation:*` channels present in `electron/preload.cjs`).

**Falsifiability was tested, not assumed.** Replacing the real `lockRundown` call
with `{ ok: true, lock: { hash: 'noop', sceneCount: 0 } }` makes the check fail with
`AssertionError: inside the pipeline: lock, then plan, then render` (exit 1);
restoring it returns exit 0. Passing `null` as the render call's plan argument fails
with the same assertion. Both probes were run and reverted.

### 2.5 One rule was narrowed after a real run caught it

The first version of the contract required every scene to carry copy. The very
first full-chain run (`node scripts/run-checks.mjs`) failed at
`check-automation.mjs` — a *real* locally-planned rundown
(`planLocally` → `rundownFromPlan`, `src/lib/automation/plan.ts:125-145`) writes
copy-less visual beats, 15 of 20 scenes in the failing case. Those scenes render
fine. The rule is now: copy is optional per scene, the *rundown* must carry copy in
at least one scene, and any single scene's copy is capped at 220 characters. Both
implementations were changed together and the parity test still passes. Had the
check not existed, this over-strict rule would have blocked every real autonomous
run.

### 2.6 Deliberately not done in this phase

- The steps were **not** moved out of `main.cjs` wholesale. What is pure moved
  (`automation-steps.cjs`); what needs disk, ffmpeg or Electron stayed. Moving the
  orchestration itself into a testable runner would mean re-plumbing the IPC
  contract and the resume path, which belongs with the Phase 2 IPC integration
  tests, not here.
- `src/lib/automation/run.ts` still keeps `RUN_STEP_LABELS` as its own list of
  strings. It is now *word-identical* to `STEP_DEFINITIONS` and enforced by the
  check, but the two are still two lists. Unifying them requires the renderer to
  import a CommonJS module from `electron/`, which the Vite build cannot do without
  a shared package boundary — a Phase 2/3 refactor.

---

## 3. Verification performed, and what was observed

Run on this checkout (Linux container; see the caveat in §4 — none of this counts
as the Windows verification the brief requires):

| Command | Observed result |
| ------- | --------------- |
| `npx vitest run src/tests/automation-steps.test.ts` | `✓ 17 passed` in 20 ms |
| `npx vitest run src/tests/automation-lock-parity.test.ts` | `✓ 16 passed` in 8 ms |
| `npm test` | `Test Files 6 passed (6)`, `Tests 100 passed \| 1 skipped (101)`, 3.32 s |
| `npx tsc --noEmit` | clean, no output |
| `node --check electron/automation-steps.cjs` | `SYNTAX_OK` (also run after each of the four `main.cjs` patches) |
| `node scripts/check-automation-steps.mjs` | exits 0: `automation steps check passed — 8 named steps, 5 varied briefs locked and planned, artifacts consistent on disk, gate rules enforced` |
| `node scripts/check-automation.mjs` | exits 0: `check:automation passed — 73 assertions, 8-step pipeline, 3-direction battle` |
| `node scripts/run-checks.mjs` | `BUILD PASSED: all 78 checks` (the chain grew from 77 to 78 by adding `check-automation-steps.mjs` after `check-automation.mjs`) |
| Negative probe 1 — fake `lockRundown` | `AssertionError: inside the pipeline: lock, then plan, then render`, exit 1; reverted, exit 0 |
| Negative probe 2 — `null` plan argument at the render call | `AssertionError: inside the pipeline: lock, then plan, then render`, exit 1; reverted, exit 0 |
| Differential suite (part of the 17 tests) | 12 briefs → 12 distinct hashes, ≥9 distinct durations, ≥4 distinct scene counts; same brief planned twice is byte-identical |

What "real work" means in those runs: `check-automation-steps.mjs` writes actual
`rundown.json`, `rundown.lock.json`, `timeline.json` and `editing-plan.json` files
into an OS temp directory, reads them back, and asserts the on-disk segment
`startSec` values add up to the plan total — it is not a source-text assertion
alone.

---

## 4. Still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED on Windows — the desktop pipeline has never been executed here.**
   This container is Linux and the Electron binary cannot be downloaded in it
   (`RequestError: unable to verify the first certificate`; `NODE_TLS_REJECT_UNAUTHORIZED=0`
   does not help, and no Chrome/chromium/xvfb is available). Everything above
   exercises the step module, the browser run, the checks and the type checker.
   It does **not** prove that `automation:start` reaches the end of the eight steps
   on Windows, that ffmpeg renders the planned segments, or that the gate passes a
   real MP4.
   *Verification required on Windows:* open the app → Autonomous → run a job on a
   real brief → confirm eight step rows advance with real per-step detail →
   inspect `rundown.json`, `rundown.lock.json`, `timeline-plan.json`,
   `timeline.json`, `editing-plan.json` in the job folder → confirm the exported
   MP4 plays and that the review report lists the lock and the edit plan.
2. **UNVERIFIED: "run 10+ times with varied real inputs".** The 12-brief
   differential suite runs the *pure* planner and step module, and the check runs
   five varied briefs through lock+plan. That is 12 (unit) + 5 (check) varied
   inputs with real outputs, but **no** run of the desktop pipeline end to end, and
   no real video rendered. Ten end-to-end desktop runs on Windows are still owed.
3. **UNVERIFIED: `evaluateMechanicalRender` against a real encode.** Its rules are
   tested on synthetic probe payloads (`check-automation-steps.mjs` group 5) and by
   the 17 unit tests. It has never seen ffprobe output from a real Cupric render.
4. **Partially verified: the bounded retry.** The retry path is exercised only by
   reading its call site (the check pins the plan argument it passes). A real
   retryable failure (missing output file) has not been induced on Windows.
5. **Two step-name lists still exist** (§2.6). The parity between
   `RUN_STEP_LABELS` (`src/lib/automation/run.ts:70`) and `STEP_DEFINITIONS`
   (`electron/automation-steps.cjs:28`) is enforced by word matching, which is
   weaker than sharing the data. Step **ids** are still absent from the renderer's
   list.
6. **`autonomyStep`-level persistence is unchanged.** Each step persists its own
   artifact, but there is no per-step checkpoint that lets a killed app resume
   mid-pipeline: the resume logic still re-runs from the first unfinished step.
7. **The AI draft of the rundown still falls back to the deterministic template**
   (`fallbackRundownForJob`) when no provider is configured — honest in the review
   report, but the "refine the rundown with a model" path is only as good as the
   Phase 1.1 provider layer, which is itself UNVERIFIED on Windows.
8. **Cosmetic leftovers noticed and not fixed in this phase:**
   `electron/main.cjs` still exposes a stock-photo `keylessAvailable` flag
   (~`:759`) whose name now collides with the removed keyless *brain*;
   `electron/free-brain.cjs:15` carries a comment claiming keyless endpoints are
   still in use.
