# Changelog

Cupric AI is a Windows desktop app. This file is the release record, and
`scripts/check-version-sync.mjs` fails the build when it drifts from
`package.json`, the README, or the version the app reports at runtime.

How a release is cut (enforced, not just described): the release commit moves
the `Unreleased` notes under a new `## [x.y.z]` heading, sets that version in
`package.json` and the README, and tags `vx.y.z`. The release workflow runs
`npm run check:version-sync --tag <tag>` before it packages anything, so a tag
that does not match the version, or a changelog that was not finalised, cannot
produce a release.

The 0.2.0 → 0.15.0 releases below happened before this file existed; they are
reconstructed from the published GitHub releases, and where a release was
published with only GitHub's auto-generated notes it says so rather than
inventing a summary.

## [0.16.0] — 2026-09-30

- **Phase 1.3 — frame-accurate timeline.** Drag, both trims, split, move-to-playhead
  and the ←/→ frame step land on the document's frame grid instead of 0.01 s;
  `normaliseClip` no longer rounds snapped edits back off the frame; the paused
  preview seeks to the middle of the frame under the playhead with half-a-frame
  tolerance. `scripts/check-frame-accurate.mjs`.
- **`whisper:fetch` verifies bytes** against the publisher's SHA-256 (GitHub asset
  digest, HuggingFace `x-linked-etag`) before installing; a mismatch deletes the file.
- `check-encode-dims` follows the Studio MP4 argv into `studio-trim.cjs`.
- **Timeline commands and gesture-atomic undo (Phase 1.3 close-out).** Drag, both
  trims, split, move-to-playhead and reorder go through a command layer with a
  gesture id minted per pointer-down, so one drag is one undo step however long
  it takes; two real bugs fell out of the new tests (a head trim moved the
  source in-point the wrong way; millisecond rounding knocked times off frame
  boundaries). `check:install --unsigned-build` (install → version readback →
  boot on every view → uninstall → no leftovers) runs on every pull request,
  and the update path is exercised there too.
- **Release path: an honest unsigned mode.** This repository has no signing
  certificate configured (`CSC_LINK` is unset — the first v0.16.0 release run
  died on exactly that), so `release-windows.yml` now takes a labelled UNSIGNED
  path when no certificate is present: the run and the release say so, the
  signature assertions are inverted rather than skipped (the build must be
  unsigned and must not claim a `publisherName`), and the install check runs as
  `check:install --unsigned-build`. With `CSC_LINK` configured, the fail-closed
  signed path is unchanged.

Remediation work on this branch, in phases (each phase's evidence is in
`docs/`):

- **Phase 1.1 — AI backend/brain.** One `AIProvider` interface with typed
  success/error results, real OpenAI/Anthropic-compatible/local (Ollama,
  LM Studio) adapters, a named error taxonomy
  (`NO_KEY_CONFIGURED`/`RATE_LIMITED`/`NETWORK_ERROR`/`INVALID_RESPONSE`/
  `TIMEOUT`) each with its own message and retry, and the regex response
  "cleanup" removed. `docs/PHASE1_AI_PROVIDER.md`.
- **Phase 1.2 — Autonomous Mode.** Eight pipeline steps as testable functions
  with per-step progress and persisted intermediate state.
  `docs/PHASE1_AUTONOMOUS.md`.
- **Phase 1.3 — Studio/timeline.** One renderer contract, one history rule and a
  Timeline that shows its source. `docs/PHASE1_STUDIO.md`.
- **Phase 1.6 — Export.** Refuse before encoding and verify before announcing:
  18 named preflight failures with real write/`statfs`/encoder checks, and a
  post-render verification of the delivered file. `docs/PHASE1_EXPORT.md`.
- **Phase 5 — Licensing.** The two dependencies that restrict commercial use
  (`@paper-design/shaders-react`, PolyForm Shield; `remotion`/`@remotion/player`)
  are replaced by original code rather than shipped; the bundled LGPL wasm and
  the GPL FFmpeg obligations are recorded and gated.
  `docs/PHASE1_LICENSING.md`.
- **Phase 4 — Release.** EV code-signing configuration with a fail-closed
  release path, a version-sync gate, an in-app version read from
  `app.getVersion()`, and Windows install/upgrade verification.
  `docs/PHASE4_RELEASE.md`.

## [0.15.0] - 2026-09-29

- Published with the note "Windows installer build passed checks; assets pending
  upload." No feature notes were written for this release.

## [0.14.1] - 2026-09-28

- Release-only change; GitHub's auto-generated notes only. Published 20 minutes
  after 0.14.0.

## [0.14.0] - 2026-09-28

- README and release notes updated for v0.13.0 (auto-generated notes).

## [0.13.0] - 2026-09-28

- "Fix release build: re-stamp curated pack versions" and "Name the failing
  release check, and sync the lockfile to 0.13.0".
- This is the version the current `main` branch carries.

## [0.12.0] - 2026-09-28

- Tagged without a GitHub release: no installer was published for this version.

## [0.11.0] - 2026-09-28

- 0.10.0's motion-board set, agent kit, framecn, motion kit and creative/editor
  upgrades (auto-generated notes).

## [0.10.0] - 2026-09-27

- Motion-board components (original code, frame-pure): Chart morph, Masked type,
  Elastic type, Shutter reveal, Search → results.
- Agent timing grammar: beats run forward, hold, then return, so the agent
  morphs one element between states instead of cutting.

## [0.9.0] - 2026-09-27

- Studio → Components: every UI Lab component (190 of them) can be added from
  inside the Studio with its real animation.

## [0.8.0] - 2026-09-26

- Integration of the React Motion Design Engine v2: deterministic 2D Canvas and
  WebGL motion graphics.

## [0.7.6] - 2026-09-26

- No release notes were written; GitHub's auto-generated compare link only. This
  is the sixth release of the day (rushed releases are finding D1 in
  `docs/AUDIT_PHASE0.md`).

## [0.7.5] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.7.4] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.7.3] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.7.2] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.7.1] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.7.0] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.6.0] - 2026-09-26

- No release notes were written (auto-generated compare link only).

## [0.5.0] - 2026-09-26

- "Studio 0.4.0: liquid glass, resource packs, voice commands, desktop MP4
  export" and "Add external resource packs and editable SaaS video templates"
  (auto-generated notes).

## [0.4.0] - 2026-09-26

- First release with a written download section: guided NSIS installer and a
  single-executable portable build.

## [0.2.2] - 2026-09-26

- "feat: Cupric AI autonomous editing workflow" (auto-generated notes).

## [0.2.1] - 2026-09-26

- Windows download section; published 11 minutes after 0.2.0.

## [0.2.0] - 2026-09-26

- Cupric AI Autonomous Mode foundation, local editing pipeline, captions, video
  preview, editing plans and Electron automation.
