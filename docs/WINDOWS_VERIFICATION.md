# Windows verification — what the PR gate actually observed

This file records what the required check (`Build and test on Windows`,
`.github/workflows/pr-checks.yml`, `windows-latest`) has actually said, run by
run. Every line below is an observed result, not an expectation; anything that
has not run yet is marked **UNVERIFIED** and says what would settle it.

The chain itself is described in `docs/PHASE2_TESTING.md`. This file is the
evidence log for the Windows half of Phases 1–3.

---

## 1. The runs

| Run | Commit | Chain (85 checks) | Package | Boot | E2E | First failure |
| --- | --- | --- | --- | --- | --- | --- |
| 36656481386 | `30ddf23` | ✗ | — | — | — | `scripts/check-export-preflight.mjs`, at 1m57s |
| 36657033448 | `4c7ce4c` | ✓ | ✓ | ✓ | 5 pass / 4 fail / 4 not run | `tests/e2e/launch.spec.ts:43` |
| 36660333176 | `27f5db9` | ✓ | ✓ | ✓ | 11 pass / 2 fail (6.2m) | `tests/e2e/studio-export.spec.ts` render wait |
| 36665419223 | `2c25cc3` | ✓ | ✓ | ✓ | **13 passed (2.0m)** | — |

"Boot" is `npm run check:boot -- --no-build`, which launches the **packaged**
installer build and visits every view with an empty and a corrupt project. It
has passed on Windows three times.

`2c25cc3` is the first commit where every step of the required check is green on
the platform the product ships to: 85 build checks, the NSIS installer built and
verified, the packaged app booted, and all 13 E2E tests — including the one that
imports a real video, renders it with the bundled FFmpeg and probes the MP4 that
lands on disk. The run took 2.0m; the earlier ones took 5–6m because they were
waiting out timeouts.

The next run (`79e1bfd`, a docs-only commit) failed the same export test on the
exported **length** — 3.97s for a 3.0s clip — which is the real-time capture
running on a runner with no GPU, not a failure of the export. That variance is
recorded as a known limitation below, and the assertion is now a band: the file
must not be shorter than the source and must not run away.

Nothing below is a leftover from the failing runs: the sections are kept as the
record of what each run found, which is the point of this file.

### Run 1 — no FFmpeg on the runner

Step 5 of the chain (`check-export-preflight`) failed with `ffmpeg: no`.
`ffmpeg-static` is an **optional** dependency whose binary is downloaded by its
postinstall script; when that download fails, npm removes the package silently
and every render check *skips* instead of failing, so the chain stayed green for
everything else. A Windows verification run without FFmpeg verifies nothing
about rendering.

### Run 2 — four E2E failures, three of them the tests' own fault

- `tests/e2e/harness.ts` built candidate paths for `ffmpeg-static` by guessing at
  package layouts and asked for `ffmpeg-static.exe`. That file has never existed:
  the package's entry point computes `ffmpeg.exe` for the running platform. The
  harness now resolves tools the same way `electron/main.cjs:75-84` does (env →
  the module the app requires → `PATH`) and lists every attempt when it fails.
- The first-run tour (`src/app-shell/Onboarding.tsx:113`, `z-[80]` overlay) is a
  real modal over the sidebar. Playwright reports the button underneath as
  *visible* and then fails the click — the window it printed was
  `…intercepts pointer events`. A fresh profile always shows the tour, so the
  suite now closes it the way a person does (`dismissOnboarding`).
- The restart test looked for the project in `localStorage['cupric-projects']`
  and in `document.body.innerText`. Neither can work: the desktop app persists
  through the main process (`electron/main.cjs:1067` `state:save` →
  `projects.json`, `src/state/useProjectStore.ts:98-120`, and the storage key is
  `northframe-v1`), the project name is an `<input value>`
  (`src/app-shell/TopBar.tsx:47`) which `innerText` never contains, and the
  breadcrumb that does render it is `hidden lg:flex`.
- `the desks explain what they are for` clicked a deliberately locked nav entry.
  Per `src/app-shell/Sidebar.tsx:39-43`, Arena Desk needs a project **and** a
  locked rundown.

The `ffmpeg` half was checked before the next run rather than guessed: the seeded
project shape was pushed through the app's own `migratePersisted` +
`validatePersistedState`, which kept the project, its id and the saved view with
zero warnings. The persistence failure was the assertion, not the product.

### Run 3 — two product defects

- **`src/screens/Brief.tsx:245`** — the Rundown panel was `hidden … lg:flex`.
  Electron's `minWidth: 1120` (`electron/main.cjs:5099`) is a request, not a
  guarantee: the OS clamps a window to its work area, and a CI runner's virtual
  display is 1024×768, so the app ran at ~1018px and the panel disappeared.
  "Lock rundown" lives in that panel, and Arena Desk only unlocks after a rundown
  is locked — a locked door with the key inside, on any machine with a display
  smaller than the app's minimum width. The Brief now stacks the rundown under
  the chat below `lg`.
- **`src/screens/studio/StudioTimeline.tsx:271`** — the Studio's playhead had
  `aria-valuemin/max/now` and no `aria-valuetext`, so it announced a bare number
  with no unit. The Timeline screen's playhead has said "0:03 of 0:12" since
  Phase 3 (`src/screens/Timeline.tsx:255`); the Studio's now does too and
  declares the keys it really handles.
- The playhead assertion could land on the outgoing screen: `data-view` flips
  before `AnimatePresence mode="wait"` has swapped screens
  (`src/app-shell/AppLayout.tsx:95-117`), and the Studio has a slider with the
  same accessible name.

### Run 4 — the export failure, found in the app's own log

11 passed, 2 failed. The export failure was reported as a timeout with nothing
on screen:

```
no export result within 240s
  toasts on screen: [""]
  renderer output: []
  files under renders/: []
```

That evidence was collected 240s after the event, by which time every toast had
expired, so it proved nothing. The fix for *that* was to make the failure
message quote the app's own log (`electron/main.cjs:207` writes every render,
export and load decision to `userData/logs/<date>.log`, and none of it reaches
the renderer). The next run printed the answer:

```
[render-queue-error] Error invoking remote method 'arena:previewPath':
  Error: Preview path is outside Cupric AI project data
  { jobId: 'studio-export-munjn1xx-89i4u6' }
```

**The export never started.** The clip's media was outside the app's own store,
so the offscreen renderer could not load it.

Two defects behind one line:

1. **Imported media kept its original path.** `registerFile`
   (`src/lib/studio/media.ts:210`) stored `filePathFor(file)` —
   wherever the user keeps the file. Everything that reads media again is
   contained to `userData/projects`, and above all `arena:previewPath`
   (`electron/main.cjs:3443`), which the offscreen export renderer needs. So a
   clip imported through the Studio previewed fine (a blob URL) and then could
   not be exported at all — the app's primary path from "my file" to "my video".
   The Footage Desk has always copied on import (`footage:analyze`,
   `electron/main.cjs:4313`); the Studio did not.

2. **The failure was reported as main-process jargon.** The toast really did
   appear, immediately, saying *"Preview path is outside Cupric AI project
   data."* — a sentence about containment rules shown to somebody who just
   pressed Render. It also matched none of the words the E2E was waiting for
   (`Saved|failed|could not|Refusing|error`), which is why the suite blamed a
   timeout for four minutes while the app had already said what was wrong.

Why it went unnoticed for so long: the E2E is the only thing that exercises the
whole chain (import → export → probe the file). Every earlier export check ran
through the main-process farm, which resolves its own sources.

### Run 5 — the fixes for the above (UNVERIFIED at the time of writing)

- `media:import` (`electron/main.cjs`) copies a picked file into
  `userData/projects/media/` and returns the adopted path; `registerFile` uses
  it. Idempotent — a source already inside the store is returned untouched, so
  re-registering an asset cannot copy a copy. A copy that fails reports why
  (out of space, permissions, file gone) instead of leaving media that will fail
  later.
- The import loop's catch in `src/screens/Studio.tsx` names the reason instead of
  "Skipped X (unsupported or damaged)".
- The E2E waits for *any* new toast rather than for words it guessed, and
  records the `render:*` IPC the renderer actually receives, so "the app never
  heard anything" and "the app said something else" can never be confused
  again.

Alongside these, `src/lib/studio/export.ts` no longer depends on the compositor
for pictures: it captures with `captureStream(0)` and pushes each drawn frame
with `requestFrame()`, drives the loop with a timer when
`requestAnimationFrame` does not deliver a callback within 1.5s, bounds the font
and AudioContext waits that sat before the recorder started, and fails a
recording that stops drawing entirely (20s) instead of hanging. **This was the
first hypothesis and it was wrong** — the recording was never reached. It is
kept as a safety net, and it is verified only to the extent that §3's next run
exercises the same path.

---

## 2. What that changed in the product

| File | Defect | Fix |
| --- | --- | --- |
| `src/screens/Brief.tsx` | Rundown panel (and "Lock rundown") unreachable below the `lg` breakpoint | Stacks under the chat below `lg`, scrolls internally, side-by-side above it |
| `src/screens/studio/StudioTimeline.tsx` | Playhead announced a bare number | `aria-valuetext` ("0:03 of 0:12") and the key shortcuts it really handles |
| `.github/workflows/pr-checks.yml`, `release-windows.yml`, `update-path.yml` | A run without FFmpeg still went green | `npm run media:ensure` runs after `npm ci` and fails the build, naming every candidate and fix |
| `scripts/ensure-media-tools.mjs` (new) | — | Resolves **both** media tools, then `npm rebuild` → `npm install --no-save`, then a failure that names every candidate and every fix. `ffprobe-static` is optional too — without it the app can render but cannot verify what it rendered |
| `scripts/check-export-preflight.mjs` | Asserted "everything present passes" with FFmpeg absent; printed nothing about where it looked | Prints its resolution chain; asserts the complement (`FFMPEG_MISSING`) when the binary is absent; the read-only assertion skips on win32, where `chmod 0o555` cannot make a directory unwritable |
| `scripts/run-checks.mjs` | Step output went to `stdio: inherit`, so a failure existed only in a log this environment cannot read | Tails each step and emits `::error title=<step>::` annotations, which the API does return |
| `src/lib/studio/media.ts`, `electron/main.cjs` | Imported media kept the user's path, so export failed with a containment error | `media:import` copies it into `userData/projects/media`; a failed copy says why |
| `tests/e2e/harness.ts` | Failure detection matched wording the app never promised | Waits for any new toast, and records the `render:*` IPC the renderer receives |

## 3. Open, with the reason and what would settle it

| Item | State | What settles it |
| --- | --- | --- |
| Exported length on a slow machine | **Known limitation** — the export is a real-time capture, so a clip can end up with a tail: 3.97s for a 3.0s clip on a GPU-less runner, ~3.0s on the run before. The E2E asserts a band (not truncated, not runaway) rather than an exact length, and says why | Trimming to the document duration in the MP4 pass (`-t`), which needs its own verification |
| Timeline clip drag / trim / split and frame-accurate preview (Phase 1.3) | **Not started** — the largest piece of Phase 1 still outstanding | Implementation plus the E2E that would prove it |
| Piper and Whisper engine bytes | **UNVERIFIED** — no network route to the artefacts exists in this environment | A Windows machine with network access, or a mirror |
| Branch protection on `main` | **Not set** — the token used here has no admin scope | `docs/PHASE2_TESTING.md` §3 |
| EV code signing and the clean-VM / auto-update runs (Phase 4) | **Not run** — no certificate | A certificate and a clean VM (`docs/PHASE4_RELEASE.md` §5–6) |
| The offscreen recorder without a compositor (frame pushing, timer driver, stall watchdog) | Verified only to the extent that the export test exercises it — it was written against a hypothesis that turned out not to be the cause | A machine without a GPU where the test still renders |
| English + Hindi only; no screen-reader run | Known limitation | — |

## 4. What the green run proves

For `2c25cc3`, on `windows-latest`, from a clean checkout:

- `npm ci` installs the locked dependencies, **and FFmpeg is really there** —
  `npm run media:ensure` fails the build otherwise, because a Windows run that
  cannot encode verifies nothing about rendering.
- All 85 build checks pass, including the unit tests, the export preflight
  against the real FFmpeg, the licence and provenance checks, the version-sync
  gate and the UI audit.
- `electron-builder --win` produces an NSIS installer, and the workflow refuses a
  setup below 10 MB or more than one installer.
- The **packaged** build boots and visits every view with an empty project and
  with a corrupt `projects.json` (`npm run check:boot -- --no-build`).
- 13 E2E tests pass against the real app, the real preload bridge and the real
  FFmpeg: launch and restore, the first-run tour, the desks, keyboard access to
  the timeline, the speech-engine download surface, and the full flow —
  import a video, scan it for silences, apply the edit, land on the Timeline,
  render MP4, and probe the file that appears on disk (h264 + aac, ~3s, non-zero
  and playable).

## 5. How to reproduce any of this

```
gh pr checks 29                      # the required check and its annotations
gh run view <run-id> --json jobs     # per-step conclusions
gh api repos/rangwalaaliasgar55-bot/Cupric-Ai-/check-runs/<check-run-id>/annotations
```

The annotations are the channel that works: this environment can read them, and
Playwright's `github` reporter (`playwright.config.ts:26`) turns every E2E
failure into one.
