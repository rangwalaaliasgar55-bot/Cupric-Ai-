# Phase 4 — Windows packaging and release: signing, version sync, install and update verification

Baseline: `f20f7ec` (Phase 5). Everything below is stated against that commit, and
every observed result is a command that was actually run in this container
(Linux, no Electron, no Windows) or plainly marked **UNVERIFIED**.

The container cannot run the product: Electron's binary download and
Chrome-for-Testing are both unreachable from this sandbox, so **nothing in this
phase is Windows-verified**. What is verified here is the part that can be: the
gates themselves, including deliberately breaking each rule and observing the
failure (section 3).

---

## 1. What was found

| # | Finding | Evidence at `f20f7ec` |
|---|---|---|
| H1 | **The build was unsigned, and that removed the updater's signature check — not just SmartScreen reputation.** electron-builder writes `publisherName` into `resources/app-update.yml` only when it has a signing certificate; `publish/PublishManager.js:206-211` guards that on `isForceCodeSigningVerification`, which `winPackager.js:26-28` defines as `verifyUpdateCodeSignature !== false`. `NsisUpdater.js:84-99` then returns `null` (no verification at all) when the field is missing. With `autoUpdater.autoDownload = true` (`electron/main.cjs:4850`) and a four-hourly check (`main.cjs:4875-4882`), an unsigned build accepts whatever the feed hands it — for every future version installed over it. | `package.json` `build.win` had only `target`, `icon`, `artifactName`; no `signtoolOptions`, no `publisherName`, no `forceCodeSigning`. Nothing in `.github/workflows/release-windows.yml` mentioned signing. |
| H2 | **The version was stated in four places and compared in none.** The README advertised `Cupric-AI-Setup-0.13.0.exe` while the newest published release was v0.15.0 (Phase 0 finding D4). | `README.md:48-49` were the only version statements in the repo; `grep -c "version" scripts/*.mjs` found no check that compared them. `package.json:4` said `0.13.0`. |
| H3 | **The app could not show its own version.** The preload bridge exposed only the *runtime* versions (`electron`, `chrome`, `node`), so the renderer had no way to obtain `app.getVersion()` — the value the diagnostics report and the log already used. | `electron/preload.cjs:82-86`; `app.getVersion()` appears in `main.cjs:1149` (diagnostics) and `main.cjs:5042` (log line) and nowhere the UI could reach. |
| H4 | **The release workflow published first and asked questions never.** It never checked that the artifacts were signed, and it accepted any `v*` tag regardless of what `package.json` said — which is how `v0.15.0` was tagged while `main` still declared 0.13.0. | `.github/workflows/release-windows.yml`: `npx electron-builder --win --publish never` with no signing inputs; no `Get-AuthenticodeSignature`; no tag/version comparison. |
| H5 | **No install/run/uninstall verification existed.** The only artifact assertion was "exactly one setup exists and it is ≥10 MB". | `.github/workflows/release-windows.yml`, "Verify installer artifacts" step. |
| H6 | **The updater could not be verified headlessly.** It logged failures only, had no way to be pointed at a test feed, and never recorded the moments a check *succeeded*, so no automated test could distinguish "download finished" from "nothing happened". | `main.cjs:4854-4857` logs `updater-error` only; `wireUpdater()` had no feed configuration. |
| H7 | **Release bursts at tag time** (Phase 0 D1/D2): seven releases in 2 h 10 min, three within 18 minutes, several cut from commits whose checks had just failed. Nothing in the pipeline slowed that down or made it visible. | GitHub release list + workflow runs, recorded in `docs/AUDIT_PHASE0.md` §D. |

---

## 2. What changed, and why

### 2.1 Signing configuration (`package.json`)

`build.win.signtoolOptions` now configures **SHA-256** signing with an **RFC 3161
timestamp server** (`http://timestamp.digicert.com`). The timestamp is not
decoration: an untimestamped signature stops verifying when the certificate
expires, which would break the update path for every existing install at once.

`forceCodeSigning` is deliberately **not** set in `package.json`: a developer
machine has no certificate and `npm run dist:win` must keep working. It is set
on the release path instead, where "unsigned" is unacceptable.

### 2.2 The release path is fail-closed (`.github/workflows/release-windows.yml`)

Six things now have to hold before an installer becomes public:

1. `CSC_LINK` is present as a repository secret, or the run fails *before*
   packaging with a message naming the secret (no forty-minute wait to discover
   an unsigned installer);
2. `npm run check:version-sync -- --tag <tag>` — the tag must equal
   `v<package.json version>` and the changelog must be finalised for it;
3. `electron-builder --win --publish never --config.forceCodeSigning=true` —
   electron-builder refuses to emit an unsigned build
   (`winPackager.js:105-107`);
4. `Get-AuthenticodeSignature` on **each** installer: status `Valid`, a `CN=`
   signer subject, and a **timestamp certificate**;
5. `release/win-unpacked/resources/app-update.yml` must contain `publisherName`
   — the field that makes every future update's signature verified. This is the
   assertion that would have caught H1;
6. `npm run check:install` — the built installer must install, run every view,
   and uninstall (section 2.4).

The publish step still uses `--clobber`, but only to re-upload after a failed
upload: a release that already exists is reported and updated, never silently
replaced by artifacts from a different run.

### 2.3 One version, four statements, one gate (`scripts/check-version-sync.mjs`)

`package.json` is the source of truth, and:

- the README's installer names and its `**Current version:**` line must quote it
  exactly;
- `CHANGELOG.md`'s top section must be `## [Unreleased]` or `## [<version>]`, the
  version must appear as a released section, and the file must keep at least five
  released sections (a changelog truncated to a stub is worse than none);
- the running app must read `app.getVersion()`: `app:info` must exist, must
  return `app.getVersion()`, must handle failure, and **no literal `x.y.z` may
  appear in app code** (`src/lab/**` is excluded because those vendored demo
  components contain sample changelog data; the exclusion is asserted to be
  exactly that prefix).

Under a tag the rules tighten: the tag must equal `v<version>` and the top
changelog section must be the version, so a release commit finalises the
changelog instead of tagging whatever was on the branch.

`CHANGELOG.md` is new (the repo had two `RELEASE_NOTES_*.md` files for old
versions and nothing else). Its 0.2.0 → 0.15.0 entries are reconstructed from
the published GitHub releases via the API; where a release was published with
only GitHub's auto-generated notes, the entry says so rather than inventing a
summary.

### 2.4 The installer is really installed (`scripts/check-install-windows.mjs`)

Not part of `npm run build` — the chain must run on any machine, and this needs a
packaged Windows build. It runs in the release workflow after packaging:

1. exactly one NSIS setup and one portable, named with the declared version;
2. silent install into a throwaway directory (`/S /D=<dir>`, with the NSIS
   quoting rules respected — `/D=` last and unquoted, and a space in the path
   fails loudly as `INSTALL_DIR_HAS_SPACE` rather than mysteriously inside the
   installer);
3. the installed `Cupric AI.exe`'s PE `FileVersion`/`ProductVersion` must equal
   `package.json`'s version — this is what ties an artifact to a version, instead
   of trusting the file name;
4. the installed executable must be signed **and timestamped**, and the installed
   `resources/app-update.yml` must carry a `publisherName` matching the signer;
5. the installed app must pass `scripts/check-boot.mjs` (the harness that caught
   the 0.10.0 white-screen regression) with zero uncaught errors;
6. the uninstaller must remove the installation and the Start Menu shortcut;
7. the portable build must report the same version, be signed, and start (it
   writes its log into an isolated userData directory).

Every failure has a code (`INSTALL_FAILED`, `VERSION_MISMATCH`, `EXE_UNSIGNED`,
`EXE_UNSTAMPED`, `PUBLISHER_NAME_MISSING`, `BOOT_FAILED`, `UNINSTALL_LEFTOVERS`,
`PORTABLE_DID_NOT_START`, …). On a non-Windows machine the script **fails**
rather than passing silently.

### 2.5 A real version-to-version update (`scripts/check-update-path.mjs` + `update-path.yml`)

Manual workflow (`workflow_dispatch` with `from_tag` / `to_tag`) that builds both
versions in separate git worktrees and then, on Windows:

1. installs the old build silently and reads back the version Windows reports on
   the installed executable;
2. serves the new release directory (a real electron-builder output with its
   `latest.yml`) over HTTP from `127.0.0.1`;
3. launches the installed app with `CUPRIC_UPDATE_FEED` pointing at that server
   and an isolated userData directory;
4. reads the app's **own log** until it records `updater-downloaded` — the moment
   the update exists on disk — failing with the updater's message if it records
   `updater-error`, and failing if the feed's version was never offered;
5. closes the app politely (`taskkill` **without** `/F`, i.e. WM_CLOSE) so the
   install-on-quit path actually runs;
6. requires the installed executable's version to change to the new one **and** a
   fresh `app-start` record for it in the log — the app really came back up as
   the new release;
7. uninstalls and shuts the feed down.

Supporting app changes: `CUPRIC_UPDATE_FEED` (validated as http/https, wired to
`setFeedURL`, logged loudly when set, rejected with a log line when malformed),
and updater transitions are now logged (`updater-available`, `updater-current`,
`updater-downloaded`) with the current version — previously only failures were
recorded.

### 2.6 The app states its own version (`app:info`)

`electron/main.cjs` gains an `app:info` handler returning `{ ok, version,
packaged, platform, arch, electron, chrome, node }`, with a real failure branch
(`APP_INFO_FAILED`, logged). It is on the preload allowlist, and Settings now
shows `Cupric AI version — v<version>` next to the updater block. On a failed
read it shows the error in `text-danger`; it never shows a plausible-looking
guess. The `check-updater.mjs` contract (automatic checks, four-hourly interval,
`quitAndInstall(false, true)`, "Update & restart") is unchanged.

---

## 3. Verification performed, and what was observed

| Command | Observed result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | `Test Files 8 passed (8)`, `Tests 141 passed \| 1 skipped (142)` — Phase 4 added no Vitest file: its new logic is the release pipeline itself, and it is verified by the gate probes below rather than by a unit test that could only restate the regexes |
| `node scripts/run-checks.mjs` | `BUILD PASSED: all 83 checks` (chain was 81) |
| `npm run build` | exit 0, `vite build` completes |
| `node scripts/check-version-sync.mjs` | `version sync passed — package.json, README, CHANGELOG and the in-app version all agree on 0.13.0 (22 assertions)` |
| `node scripts/check-release-signing.mjs` | `release signing check passed — 25 assertions` (SHA-256 + RFC 3161 configured, `verifyUpdateCodeSignature` intact, fail-closed release path, version gate, install verification, single publish) |
| `node scripts/check-install-windows.mjs` **on Linux** | `check:install FAILED — this check runs the real Windows installer, so it only runs on Windows.` — it refuses rather than reporting a pass (this is the intended behaviour and the reason it is absent from `npm run build`) |
| Gate probes (throwaway copy of the tree, real runs) | 1. untagged build passes. 2. tag matching a finalised changelog passes. 3. `--tag v0.14.0` → `FAIL: release tag v0.14.0 does not match package.json version 0.13.0`. 4. README artifact 0.12.0 → `FAIL: README installer names disagree with package.json 0.13.0`. 5. Changelog left as `Unreleased` under a tag → `FAIL: releasing v0.13.0 requires CHANGELOG.md's top section to be [0.13.0]`. 6. A `'0.13.0'` literal in `AskPanel.tsx` → `FAIL: a version literal is hardcoded in app code`. 7. README current-version line 0.13.1 → `FAIL: README says the current version is 0.13.1`. 8. `app:info` returning a literal instead of `app.getVersion()` → `FAIL: app:info returns the real version`. 9. Changelog truncated to two sections → `FAIL: CHANGELOG keeps the released history (2 sections)` |
| `node --check` on the three new/changed CJS files | `main.cjs parses`, `preload.cjs parses` |
| Workflow YAML | both workflows parse structurally (no tabs, `jobs:` present); GitHub validates the rest on push |

Probes 5–9 were **re-run** after my first attempt by accident left a stale
README from probe 4 in place and made three probes print the wrong failure. The
results above are from fresh copies of the tree, and the gate was re-run green
afterwards.

---

## 4. What is still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED — the entire release path.** No signed build has ever been
   produced: there is no certificate in this repository, so
   `--config.forceCodeSigning=true` has never been exercised and neither has the
   Authenticode assertion. The first real release tag is the test, and it is
   designed to fail loudly rather than publish anything unsigned.
2. **UNVERIFIED — `check:install` and `check:update-path` have never run on
   Windows.** Both were written in a Linux container that cannot install an
   NSIS package or launch Electron. Their first run on `windows-latest` is the
   verification. The failure codes exist so the first run is diagnosable, but I
   will not claim they work.
3. **UNVERIFIED — a real clean-VM install.** The release workflow installs and
   uninstalls on a GitHub-hosted runner, which is *not* a clean VM: it has Node,
   build tools and a warmed filesystem. A true clean-VM pass needs a Hyper-V or
   cloud Windows 10/11 instance and a human following the checklist; that
   checklist is in §5. What the runner does prove is the installer, the version
   resource, the signature, the boot path and the uninstaller.
4. **UNFIXED in practice — SmartScreen.** The configuration and the gate are in
   place, but until an EV certificate is bought and uploaded as `CSC_LINK` /
   `CSC_KEY_PASSWORD`, releases cannot be cut at all (the first workflow step
   fails); and reputation on a *new* certificate is only immediate for EV. The
   cost and the purchase are a business decision I cannot make.
5. **UNVERIFIED — the update path against signed builds.** `check:update-path`
   verifies download → install → relaunch. When run against unsigned builds it
   explicitly prints that no signature was checked; the signed case (where
   `publisherName` is pinned and the updater will refuse a mismatched installer)
   has never run.
6. **Partially fixed — release hygiene.** A duplicate or mismatched tag now has
   to get past the version/changelog gate, and a release that already exists is
   reported rather than silently replaced. Nothing prevents a human from cutting
   two releases an hour; "one release per verified green build" is enforced only
   in the sense that the build must be green and the tag must match the version.
7. **Still open from Phase 0, not addressed here:** 42 empty `catch {}` blocks
   across `electron/` and `src/` (two of them inside `logLine`, where swallowing
   is deliberate so logging cannot crash the app, but the rest are not
   individually justified); the `resources/` per-directory licence sweep; the
   bundled libheif LGPL position (Phase 5 §4).
8. **Historical divergence not repaired.** `main`'s `package.json` is 0.13.0 while
   releases reached 0.15.0, and `v0.12.0` was tagged with no release at all. The
   gate prevents *new* drift; it does not retroactively publish 0.12.0 or rename
   anything.

---

## 5. Clean-VM checklist (for the human step)

On a Windows 10 or 11 machine that has never had Cupric AI installed:

1. `\\path\to\Cupric-AI-Setup-<version>.exe` → run it. Observe: no SmartScreen
   "unknown publisher" interstitial (EV), the per-user installer offers a
   directory, and it finishes without elevation prompts.
2. Confirm the installer is signed: right-click the exe → Properties → Digital
   Signatures → the publisher's name, and "Timestamp" present.
3. Launch from the Start Menu. Settings must show `Cupric AI version — v<version>`
   matching the installer's file name; if it shows `unavailable`, the error text
   under it is the diagnostic.
4. Import a video, export an MP4, confirm the file plays (this exercises the
   FFmpeg unpack path, which is the most common install-time failure).
5. Install the *previous* version first, let the updater find the new one, and
   confirm "A new release is ready" → "Update & restart" brings the app back on
   the new version. Compare with the log at
   `%APPDATA%\Cupric AI\logs\<date>.log` (records `updater-downloaded`).
6. Uninstall from Settings → Apps. Confirm the install directory is gone, the
   Start Menu shortcut is gone, and `%APPDATA%\Cupric AI` (projects and settings)
   is preserved — user data must survive an uninstall.
7. Reinstall over the old version (without uninstalling) and confirm projects are
   still listed.
