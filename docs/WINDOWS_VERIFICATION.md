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

"Boot" is `npm run check:boot -- --no-build`, which launches the **packaged**
installer build and visits every view with an empty and a corrupt project. It
has passed on Windows twice, which is the first real evidence that the shipped
app opens on the platform it ships to.

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

### Run 4 — one unexplained failure, now instrumented

11 passed, 2 failed. The remaining export failure reported:

```
no export result within 240s
  toasts on screen: [""]
  renderer output: []
  files under renders/: []
```

No toast, no file, no renderer error. `src/screens/Studio.tsx:1324` calls
`exportStudioInBackground` (`src/lib/studio/export.ts:283`), which waits for
`render:done` or `render:error` from the queue in `electron/main.cjs:4830`. The
export is a real-time recording (`src/screens/Studio.tsx:1854`), so a slow
software-rendered runner is a candidate — but that is a hypothesis, not a
result. See §3.

---

## 2. What that changed in the product

| File | Defect | Fix |
| --- | --- | --- |
| `src/screens/Brief.tsx` | Rundown panel (and "Lock rundown") unreachable below the `lg` breakpoint | Stacks under the chat below `lg`, scrolls internally, side-by-side above it |
| `src/screens/studio/StudioTimeline.tsx` | Playhead announced a bare number | `aria-valuetext` ("0:03 of 0:12") and the key shortcuts it really handles |
| `.github/workflows/pr-checks.yml`, `release-windows.yml`, `update-path.yml` | A run without FFmpeg still went green | `npm run ffmpeg:ensure` runs after `npm ci` and fails the build, naming every candidate and fix |
| `scripts/ensure-ffmpeg.mjs` (new) | — | Resolve → `npm rebuild ffmpeg-static` → `npm install --no-save`, then a failure that says what to do |
| `scripts/check-export-preflight.mjs` | Asserted "everything present passes" with FFmpeg absent; printed nothing about where it looked | Prints its resolution chain; asserts the complement (`FFMPEG_MISSING`) when the binary is absent; the read-only assertion skips on win32, where `chmod 0o555` cannot make a directory unwritable |
| `scripts/run-checks.mjs` | Step output went to `stdio: inherit`, so a failure existed only in a log this environment cannot read | Tails each step and emits `::error title=<step>::` annotations, which the API does return |

## 3. Open, with the reason and what would settle it

| Item | State | What settles it |
| --- | --- | --- |
| Studio export on Windows | **UNVERIFIED** — one run produced no toast, no file and no console error in 240s | The next run: the failure message now includes the app's own log (`userData/logs/<date>.log`), the on-screen export percentage and anything written under `renders/` |
| The `Brief.tsx` low-width layout and the `StudioTimeline` ARIA fix | **UNVERIFIED** — written and type-checked here, not yet run on Windows | The pushed commit's E2E run (the playhead test now reaches the ruler through the Footage Desk import) |
| Timeline clip drag / trim / split and frame-accurate preview (Phase 1.3) | **Not started** | — |
| Piper and Whisper engine bytes | **UNVERIFIED** — no network route to the artefacts exists in this environment | A Windows machine with network access, or a mirror |
| Branch protection on `main` | **Not set** — the token used here has no admin scope | `docs/PHASE2_TESTING.md` §3 |
| English + Hindi only; no screen-reader run | Known limitation | — |

## 4. How to reproduce any of this

```
gh pr checks 29                      # the required check and its annotations
gh run view <run-id> --json jobs     # per-step conclusions
gh api repos/rangwalaaliasgar55-bot/Cupric-Ai-/check-runs/<check-run-id>/annotations
```

The annotations are the channel that works: this environment can read them, and
Playwright's `github` reporter (`playwright.config.ts:26`) turns every E2E
failure into one.
