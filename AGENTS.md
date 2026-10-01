# AGENTS.md — the contract for working in this repository

Written for an agent (or a person) picking this repo up cold. It is NewBrand's own contract, in the spirit
of open-edit's `.claude/skills/**` and `docs/FLOW.md` — the *patterns*, not their engine syntax or their
files. Read `NEXT_SESSION.md` first for what shipped last; this file is what must stay true while you
change it.

## 1. One gate chain, and it stops at the first failure

`src/lib/studio/gates.ts` runs `lint → timing → safe zones → contrast → deliver`. The chain stops at the
first gate with an **error** and names it (`report.stoppedAt`); warnings ride along. Do not add a gate
that reports "3 things failed" without saying which one stopped the work, and do not let a caller read
`report.ok === false` without showing `report.summary` to the user.

Corrections are budgeted: `GATE_BUDGET = 2` per gate, then stop and report. A run nobody is watching must
not loop a fix forever. `recordFailure` / `budgetLine` exist for exactly that; do not re-implement the
count.

## 2. Verification is mechanical, never asserted

- A fix is **scored** analytically, so after applying one you must **re-measure**: `verifyAppliedFixes`
  re-renders the patched document and re-runs the chain. A patch that missed its target must not be
  reported as an improvement.
- An edit must prove its **scope**: `diffStudioDoc(before, after, { allow })` from `studio/scopedEdit.ts`.
  Allowed targets come from the thing that asked for the change (`allowListOfReport` for a gate report),
  never from the edit itself.
- Never write a claim you did not measure. `docs/AUDIT_2026-09-29_REFERENCES.md` uses the labels
  **VERIFIED IMPLEMENTED / PARTIAL / MISSING / NOT VERIFIED** and cites file:line; keep that standard in
  new docs, and keep "tested here" separate from "unverified here".

## 3. Degrade honestly, and say which path ran

Every capability has a fallback, and each one must name itself:

| Capability | Real path | Fallback, and how it says so |
|---|---|---|
| Captions | word-timed Whisper | even split, labelled `timingSource: 'even'` (never `word`) |
| Export | desktop FFmpeg MP4 | browser WebM **draft** — never call it an MP4 |
| Transcription | `transcribeClip` → cache → engine | the cache hit says `cached: true`; a drift is reported, never applied in silence |
| Speech cuts | transcript (`speechCuts`) | measured waveform (`probeClip`/`probeCuts`); if neither, refuse with the reason |
| Shot cuts | frame sampling | refuse with "the picture changes too little", never split at random |
| AI | configured provider | local model (free) or template mode — `template` is **not** "AI configured" |
| Loudness | measured linear gain (`loudness.mode: 'measured'`) | loudnorm's dynamic normaliser (`'dynamic'`, named as different processing) or nothing with the reason (`'none'`) |
| Joining renders | stream copy, with every part's shape probed first | re-encode onto one parameter set, naming the part that disagreed (`concat.reasons`) |

A failure returns the document **unchanged** plus a readable reason. Never a half-applied edit, never a
silent no-op.

## 4. Every document edit is one undo step, previewed

Use the `propose()` pattern (`src/screens/studio/StudioProPanel.tsx`): preview → accept → one
`patchStudio` call, so Ctrl+Z reverts the whole thing. If an action moves a dozen clips, that is still
one action. `applyAuditFixes` and `planCaptionPlacement` return a whole document for this reason.

## 5. Tests: `scripts/check-*.mjs`, and what they can cover

- `vitest` is **not installed** in a plain checkout: `src/tests/*.test.ts` and `ARCHITECTURE.md:42`'s
  `npx vitest run` are aspirational. Do not report those suites as passing.
- Tests are esbuild harnesses: bundle the module with a `stdin` export list, assert, delete the bundle.
  `node scripts/run-checks.mjs` runs the chain from `package.json` one step at a time and names the
  failure.
- **Pure functions are tested; decoding paths are not.** Frame sampling (`analyseShots`,
  `analyseSubject`, `analysePlacement`), the waveform probe and MediaRecorder need a browser or a real
  file. Structure new work so the arithmetic is pure and the decode is a thin wrapper — that is why
  `measurePlacement` takes three luma grids and `shotCutTimes` takes samples.
- `check-boot.mjs` needs Chromium and cannot run in CI-less sandboxes. Say so instead of deleting it.
- New suite → add it to the `build` chain **and** `npm run verify`, plus a `check:<name>` alias.

## 6. Provenance and licences

Ported code lives under Apache-2.0 (open-edit) or MIT (MoneyPrinterTurbo). Keep
`resources/open-edit/LICENSE` + `NOTICE` verbatim, add a row to `THIRD_PARTY_NOTICES.md` for every file
you port, describe the changes in the file's header, and never relicense the result. **Never** take the
PolyForm-Shield engine binary, the VEED cloud/login/transcription routes, or their `.wv`/recipe format —
see §F and §F-bis of the audit for the full do-not-copy list.

## 7. Keep out of the diff

- `resources/libraries-dev/review.json` mutates on its own; `git checkout --` it before staging.
- Repository-root esbuild scratch files (`.dbg*.mjs`, `.check-*.mjs`) are deleted by the scripts that
  create them — do not commit one.
- Dead prototypes (`src/{app,core,db,editor,engine-showcase,effects,graphics,motion,registry,render,
  renderer,three,ui,video}`, `src/components/editor/*`, `src/editor/*`) are unimported. Do not wire them
  in by accident (`src/video/export.ts` needs the absent `mediabunny` package), and do not "clean them
  up" without saying so.

## 8. Product rules that are not negotiable

- A render is never called delivered without the gates; a vote in the Arena flow is never automated
  (`main.cjs:3146` requires `window.__seek` — the manual handoff) — the human votes, the app imports.
- No hardcoded secrets. Keys live in `userData/settings.json` or the environment.
- Do not distinguish a "real improvement" from another preset by adding a preset. If a change is hard to
  see, it probably is not one.
- macOS/Linux: the only workflow is Windows (`release-windows.yml`). Do not claim support you cannot
  test.
