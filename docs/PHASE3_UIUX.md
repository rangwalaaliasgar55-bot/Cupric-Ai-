# Phase 3 — UI/UX: what was found, what changed, and what is still unverified

Same four-part structure as the Phase 0/1/2 reports. Phase 3 as briefed covered
the design system, the four screen states, first-run onboarding, keyboard and
ARIA (the timeline specifically), navigation, dead-end buttons and destructive
confirmations. This round also carried Phase 1.4's remaining item — the "engine
not installed" dead end — because it is the same defect in a different place.

---

## 1. What was found

Reconnaissance first, because most of what Phase 3 asks for either already
existed or was missing for a specific reason.

| Finding | Where | Why it matters |
| --- | --- | --- |
| Design tokens already existed and were coherent: palette, type scale, radii, shadows, easings | `src/styles.css:45–91` | Phase 3 is *adoption* here, not invention. Inventing a second system would have been the actual bug. |
| A real focus ring already existed (box-shadow, not outline) | `src/styles.css:233` | The problem was not the ring, it was controls that never received it. |
| **No first-run explanation of anything existed** | the whole app shell; only `src/screens/GettingStarted.tsx`, a project checklist keyed `cupric.gettingStarted.dismissed` | A new person met twelve sidebar entries with no statement of what the app is for. |
| **The timeline's seek slider was unreachable by keyboard** | `src/screens/Timeline.tsx:203` — `role="slider"`, `tabIndex={-1}` | ARIA present, keyboard absent: the worst combination, because it looks accessible in a tree dump. |
| Clips were `role="button"` with only Delete bound | `src/screens/Timeline.tsx:492–505` | No reorder without a pointer; no announcement of anything. |
| The timeline had no live region at all | `src/screens/Timeline.tsx` (whole file) | The screen's entire content is a picture: a ruler, coloured blocks, a playhead. |
| No loading/error kit; screens hand-rolled spinners or, worse, said nothing | `src/components/EmptyState.tsx` was the only state component | "Loading" and "failed" were both routinely rendered as an empty area. |
| **A failed review-note load was indistinguishable from an empty room** | `src/screens/ReviewRoom.tsx:86` — `.catch(() => setComments([]))` | A silent swallow of exactly the kind Phase 0's rules forbid. |
| No in-app statement of purpose for Arena Desk or Footage Desk | `src/screens/ArenaDesk.tsx`, `src/screens/FootageDesk.tsx` | Both look like file browsers; the difference between them lived only in the README. |
| **"Engine not installed" was a sentence with no action** | `src/lib/voice.ts:260,344`; `src/lib/readiness.ts:136` ("run npm run whisper:fetch…") | Advice addressed to a developer, shown to a person using an installed app. |
| A test that fabricated speech engines | `scripts/check-tts-languages.mjs` (wrote fake `espeak-ng`/`piper` executables onto `PATH`) | Phase 1.4 asked for it to go; it had also been hiding a real defect (below). |
| Destructive actions already arm before firing | `src/screens/HomeProject.tsx:172–177` | Kept as-is; verified rather than rebuilt. |

Two of these were **real defects found by the new checks during this phase**, not
by reading:

* `scripts/check-tts-languages.mjs`, with no PowerShell reachable, produced
  *"Add a Hindi voice (Settings → …)"* for a Hindi request — because the code
  chose the "wrong language" message before checking whether the engine had
  started at all. Following that advice would have changed nothing.
* `scripts/check-ui-audit.mjs` (pre-existing gate) failed the first build of this
  phase's install button: a `disabled` control with no explanation. That is a
  dead end wearing a grey hat, and it was caught by a gate, not by review.

---

## 2. What changed, and why

### 2.1 Design system: adopted, and now enforced

No new tokens. What is new is `scripts/check-phase3-ui.mjs` — 96 assertions over
the source the app actually ships, wired into the release chain (84 steps now):

* every screen and component **styles with tokens**: a hex value inside
  `className`, `style`, `fill` or `stroke` fails the build. (Hex inside preset
  *data* — a palette a preset renders — is untouched; that is the value, not a
  styling decision.)
* one icon set: `lucide-react` only.
* any `outline: none` must be accompanied by another focus indicator in the same
  rule. `styles.css` passes this today: `.cu-input:focus` swaps the ring for an
  accent border.
* `motion-reduce` variants required on loading motion.

### 2.2 The four states, as a kit

`src/components/ScreenStates.tsx` (new): `LoadingState`, `ErrorState`,
`ScreenState`. The rules it encodes:

* **a percentage only when one exists.** `pct={null}` renders the honest
  indeterminate bar. `NaN` and `Infinity` are treated as "unknown", not rounded
  into a number.
* **an error always has a way forward** — a retry, or an explicit `nextStep`.
  Given neither, the card says so out loud rather than sitting there.
* technical detail goes in a collapsed `<details>` *after* the plain sentence.
* `role="status"` / `role="alert"`, and `motion-reduce:animate-none`.

Adopted in `src/screens/ReviewRoom.tsx`, replacing the silent `.catch`: the load
is now one callable function with `loading`/`error`/`ready` state, a logged
failure (`rlog.error`), a human message, a **Load again** button that re-runs the
same call, and a next step ("Your notes are still on the machine — nothing was
deleted").

### 2.3 First-run onboarding

`src/lib/onboarding.ts` (the rule and the copy, pure) plus
`src/app-shell/Onboarding.tsx` (the dialog):

* four cards — Studio, Autonomous Mode, Arena Desk, Footage Desk — each saying
  what it is for *and* when to reach for it, each with a button that navigates to
  that screen. No card is a dead end.
* shown on a genuinely fresh install only. Somebody who already has projects gets
  the flag recorded silently instead of a welcome mat over their work.
* unreadable storage means **no dialog**, because a modal that reappears every
  launch with no way to stop it is worse than one that never appears.
* a real modal: focus moved in, Tab held inside, Escape closes, backdrop closes,
  and **dismissal is never blocked**.
* reachable again any time from the command palette ("Quick tour of Cupric").

### 2.4 The timeline without a mouse

* the playhead slider is `tabIndex={0}` with `aria-label="Playhead"`,
  `aria-valuetext` ("0:03 of 0:12"), and `aria-keyshortcuts`. Left/Right move one
  frame, Shift+arrows one second, Home/End the ends, PageUp/PageDown five seconds.
* clips are a labelled `role="list"` of `role="listitem"` blocks, each announcing
  its position ("clip 2 of 7"); **Alt+Left/Right reorders** through the same store
  command the drag path uses, so undo and persistence behave identically.
* Delete removes a clip and the toast offers **Undo**, wired to the existing
  command stack.
* one `aria-live="polite"` channel (`data-timeline-announcer`) reports what the
  picture cannot: playhead movement, reorders, removals.

### 2.5 The desks explain themselves

`src/components/ScreenPurpose.tsx` (new) — one line of purpose plus the first
step, dismissible per screen and remembered. Mounted on Arena Desk and Footage
Desk with copy that names the difference between them.

### 2.6 Navigation and dead ends

* the palette gains "Quick tour of Cupric" under Help.
* `check-phase3-ui.mjs` asserts `HomeProject` still confirms before deleting and
  that the readiness panel branches on `result.ok`.

### 2.7 Phase 1.4: installing a speech engine for real

* `electron/voice-install.cjs` (new) — the actual download. Streams to
  `<dest>/<name>.part`, renames only when complete, verifies `Content-Length`
  when the server sends one, verifies the files on disk afterwards
  (`piper.exe`), and reports failures with the URL, the HTTP status and the OS
  error verbatim. Cancellation is per-window and removes the partial file.
* **PyArmor coordinates are checked, not guessed**: `piper_windows_amd64.zip`,
  22,477,236 bytes, from the pinned tag `2023.11.14-2` (confirmed against the
  published release metadata from this machine). The voice models come from
  `rhasspy/piper-voices` on HuggingFace — **that host is not reachable from this
  container, so those URLs are UNVERIFIED** and the UI surfaces the real HTTP
  status if they have moved.
* `safeEntryTarget` guards every archive entry: absolute paths, UNC paths, `..`
  and `.` segments are refused by name. This is its own tested function because
  AdmZip normalises `..` while *writing*, which means a test that only builds
  archives cannot exercise the guard.
* `voice:engines` / `voice:install` IPC, `voice:install:progress` events, and a
  real install button in the readiness panel showing received bytes against
  `Content-Length` — or "the server did not report a total size" when it did not.
* **Nothing is bundled.** Piper, its espeak-ng data (GPLv3) and whisper.cpp are
  fetched on request into the user's own folder. That is also the licence-clean
  route (Phase 5).
* On the Windows *system* voice the button does not pretend: it explains that
  Windows installs speech voices through Settings, because an in-app button that
  silently cannot work is the defect this phase exists to remove.

### 2.8 Tests: the fake engines are gone

`scripts/check-tts-languages.mjs` was rewritten around the rule "no invented
executables". It now asserts the Windows command line, rate clamping, language
routing, Piper discovery against real files and the blocker copy (47 assertions),
and then runs the synthesis chain **for real with no engine present**, asserting
the *failure* is legible: a sentence, not a stack frame; the engine named; the
attempts recorded; the raw spawn error kept in a separate `detail` field instead
of pasted into the advice.

New unit tests: `src/tests/onboarding.test.ts` (15),
`src/tests/screen-states.test.ts` (15), `src/tests/voice-engines.test.ts` (26,
including two real network-failure paths — a non-resolving host and a real 404 —
that assert nothing is left on disk). New E2E: `tests/e2e/phase3-ui.spec.ts`
(6 scenarios), which fails the suite if the renderer logged a single console
error during these flows.

---

## 3. Verification performed, and what was observed

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx vitest run` | **13 files, 214 passed, 1 skipped (215)** — was 9 files / 158 |
| `node scripts/check-tts-languages.mjs` | **47 assertions passed — no fake engines were used**, plus the UNVERIFIED line |
| `node scripts/check-phase3-ui.mjs` | **96 assertions passed** |
| `node scripts/check-ui-audit.mjs` | passed, 85 files, **remaining recorded debt: none** (it failed first, on this phase's own button) |
| `node scripts/run-checks.mjs` (ffmpeg on `PATH`) | **BUILD PASSED: all 84 checks** |
| `npx playwright test --list` | **13 tests in 3 files** (was 7 in 2) |
| `npx playwright test tests/e2e/phase3-ui.spec.ts` | **fails honestly**: `E2E CANNOT RUN: the Electron binary is not installed in this checkout` — this container installs with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` by design |
| `node --check electron/*.cjs` | main, preload and voice-install parse |

The chain gate is the important one: `check-phase3-ui.mjs` runs on every build,
so "a screen shipped without a state story" and "a slider lost its tab stop" are
now build failures rather than review comments.

---

## 4. Still broken, incomplete, or UNVERIFIED

* **Everything on Windows is UNVERIFIED.** No part of this phase has run on
  Windows: the tour, the modal focus trap, the timeline keyboard path, the
  install button and its download have been verified by type-checking, unit
  tests, structural gates and the E2E suite's *listing* — not by a human or a
  runner on the target OS.
* **The E2E suite has never launched the app** (no Electron binary here). The
  six new scenarios are the specification; they pass only on `windows-latest`.
* **The Piper/whisper download is unverified end to end.** The Piper URL and
  asset size were confirmed against published release metadata, but no byte was
  transferred and no `piper.exe` was ever executed. `huggingface.co` is
  unreachable from this container, so the voice-model URLs are *assumed
  patterns*; if they 404, the UI will say so (that path is tested) but the
  download will not work until corrected.
* **No real audio has been produced by any engine in this session.** The TTS
  success path (engine writes a WAV → base64 → renderer) lost its only test when
  the fake executables were removed, and it is right that it did: the honest
  position is "unverified" rather than "verified against a fiction".
* **Whisper has no in-app fetch.** The button explains the folder instead of
  pretending to download; the real fetch exists only as `npm run whisper:fetch`
  for the packaged build.
* **Language coverage is still English + Hindi.** Japanese, Korean and Chinese
  are on the TTS language list but have no model source wired into the installer.
* `scripts/check-ui-audit.mjs` reports zero remaining recorded debt, but that is
  debt *it knows how to look for*: colour, motion, names, disabled controls.
  It cannot tell whether a screen's error message is true.
* The timeline's keyboard path is asserted structurally and (on Windows) by E2E;
  it has not been driven by a screen reader. NVDA announced behaviour is
  therefore UNVERIFIED.
* Pre-existing and out of scope for this phase: 42 empty-ish `catch {}` blocks
  elsewhere in `src/`, 100 of 148 `src/lib` modules without unit tests, the
  version divergence between `main` (0.13.0) and published releases (0.15.0),
  and the `v0.12.0` tag that has no release.
