# Phase 1.6 — Export / Render: refuse before encoding, verify before announcing

Scope: the three desktop export paths — the timeline render (`render:start` →
`executeRenderJob`), the Studio MP4 export (`studio:exportMp4` →
`executeStudioMp4Job`) and the Autonomous render (`renderAutomationMp4`).
Phases already delivered: 1.1 provider layer, 1.2 automation steps, 1.3 Studio.

Baseline commit: `d4a6290`.

---

## 1. What was found

`docs/AUDIT_PHASE0.md` §B6/§B7 recorded that progress was already real (parsed
from ffmpeg's `-progress` output, not a timer) but that failures were not.
Reading the three paths at `d4a6290`:

| # | Finding | Where | Consequence |
| - | - | - | - |
| H1 | **Nothing was checked before the encode** | `main.cjs:4400` (`executeRenderJob`), `:3654` (`executeStudioMp4Job`), `:1702` (`renderAutomationMp4`) | A full disk, a read-only folder, a filename Windows refuses (`CON.mp4`, a trailing space, `|`), a missing encoder in the FFmpeg build, or a path past `MAX_PATH`, were all discovered *after* rendering started, as ffmpeg's stderr wrapped in "FFmpeg could not…". |
| H2 | **"Render complete" was emitted without reading the file back** | `main.cjs:4660` region: `concatSegments` → `sendRenderEvent('render:done')` | A zero-byte file, a file with no picture track, a truncated file, or a file at the wrong resolution were announced as a finished export. The Studio path checked only that the path existed (`:3709`). |
| H3 | **Distinct failures shared one message** | `:3707` (`FFmpeg could not convert the recording: …`), `:3709` (`FFmpeg reported success but produced no file.`) | The user could not tell "the disk is full" from "Windows will not let me write there" from "this FFmpeg has no H.264 encoder", which have three different fixes. |
| H4 | **The audio expectation was never checked** | all three paths | A timeline with sound whose export came out silent was delivered as a success. |
| H5 | **The MP4 was never compared with the recording it came from** | `executeStudioMp4Job` | The recording (WebM) was written, converted and deleted without the MP4 being checked for length or tracks against it. |

---

## 2. What changed and why

### 2.1 New `electron/render-preflight.cjs` (366 lines) — named failures with stated fixes

- `RENDER_FAILURES` — `PATH_INVALID`, `PATH_NOT_ABSOLUTE`, `PATH_BAD_EXTENSION`,
  `PATH_RESERVED_NAME`, `PATH_TOO_LONG`, `OUTPUT_DIR_MISSING`,
  `OUTPUT_NOT_WRITABLE`, `DISK_FULL`, `FFMPEG_MISSING`, `FFPROBE_MISSING`,
  `ENCODER_MISSING`, `EMPTY_FILE`, `NO_OUTPUT_FILE`, `UNPLAYABLE`,
  `NO_VIDEO_STREAM`, `NO_AUDIO_STREAM`, `WRONG_DURATION`, `WRONG_SIZE`. Every
  failure carries `{ code, message, action }` — the message says what happened,
  the action says what to do.
- `classifyOutputPath` — real Windows rules (absolute path, allowed extensions,
  reserved characters, reserved device names `CON`/`COM1`/…, a component ending
  in a space or dot, the 240-character limit). The rules are written as Windows
  rules and the platform is a parameter, so the tests run them everywhere and say
  so instead of pretending POSIX proves anything.
- `estimateOutputBytes` — a stated bitrate model (`0.06/0.10/0.16` bits per pixel
  per frame by quality, plus 192 kbps audio, ×1.15) used for the disk check. It
  is deliberately pessimistic: refusing an export that would have fitted is a
  smaller failure than filling a disk and writing a truncated file.
- `checkDiskSpace` — real free space via `fs.statfs` with a 512 MB reserve kept
  clear, and an honest "could not be read" instead of guessing.
- `checkWritable` — creates the folder if needed, then **writes and deletes a real
  probe file**. An `access()` check lies on Windows when a file is open
  elsewhere; the write is what actually fails. `ENOSPC` is reported as a disk
  failure, `EACCES`/`EPERM`/`EROFS` as a permission failure.
- `parseEncoders` / `checkEncoder` — reads a real `ffmpeg -encoders` listing and
  accepts any H.264 encoder the build has (software or hardware); a list that
  cannot be read is treated as *unknown*, not as *missing*.
- `buildPreflight` — runs all of the above and returns every failure at once, so
  the user fixes one pass of problems instead of one per attempt.
- `verifyExport` — the delivered file against what was asked for: zero bytes,
  unreadable, no picture track, no sound when the timeline had sound, wrong
  length beyond tolerance, wrong size. Returns `{ ok, checks, failures }`, and
  `checks` is logged so a passing export is auditable too.

### 2.2 Wired into all three export paths — `electron/main.cjs`

- `runExportPreflight(...)` (`:3571`) logs the checks and throws
  `renderPreflight.failureError(failures)` when anything fails. Called from
  `executeRenderJob` (`:4591`), `executeStudioMp4Job` (`:3812`) and
  `renderAutomationMp4` (`:1724`) — **fixes H1 and H3**.
- `availableEncoders()` (`:3555`) reads `ffmpeg -encoders` once per app run and
  caches it; a failure to read is logged as unknown.
- `verifyRenderOutput(...)` (`:3602`) stats the file, runs the **real ffprobe**
  through the existing `probeMedia`, applies `verifyExport` and logs the verdict.
  Called before `render:done` in the timeline render (`:4660`) and before the
  Studio MP4 is announced (`:3877`) — **fixes H2**.
- `sourcesHaveAudio(sources)` (`:3648`) probes up to 12 distinct source files and
  answers whether the timeline really has audio, so the delivered file is checked
  against *measured* expectations (**fixes H4**). The Studio path takes its
  expectation from the recording it just converted (a WebM that carries sound
  means the MP4 must).
- The Studio recording is probed before conversion, so the disk estimate uses the
  real dimensions and length, and the MP4 is verified against the real recording
  duration (**fixes H5**).
- "FFmpeg reported success but produced no file" is now the named
  `NO_OUTPUT_FILE` failure, not a bare string.

### 2.3 Tests — `src/tests/render-preflight.test.ts` (24 tests)

Pure rules with injected side effects: path rules (including "a space before the
extension is legal and must not be refused"), the size model, disk space
(including the reserve), writability (permission vs full disk), encoder
selection, the whole preflight verdict (including "every reason at once"), and
the finished-file verdict (zero bytes, unreadable, no picture, no sound, wrong
length, wrong size, tolerance, silent-timeline case).

### 2.4 `scripts/check-export-preflight.mjs` (33 assertions) — run against real binaries

- Resolves `ffmpeg`/`ffprobe` the way the app does (env → PATH → `ffmpeg-static` /
  `ffprobe-static` → `@ffmpeg-installer/ffmpeg`). **FFprobe is required**: without
  it nothing can be verified, so the check fails rather than pretend.
- Writes a real 1-second PCM WAV by hand and probes it; writes a real text file
  named `.mp4` and asserts ffprobe really refuses it and the verdict is
  `UNPLAYABLE`; asserts a zero-byte file is caught before probing.
- Encodes a real two-second 320×180 clip with the real ffmpeg (video + audio),
  probes it, and asserts the verification passes with the right codecs reported;
  then asserts a 2 s file is refused for a 12 s timeline, a 320×180 file for a
  1920×1080 export, and a silent file when sound was expected. It also asserts the
  disk estimate covers the real encoded size.
- Runs the preflight against the **real filesystem**: a real writable folder
  (asserting free space is reported from the real `statfs`), an absurd 24-hour 4K
  request (asserting `DISK_FULL` with the numbers), a missing FFmpeg, and a real
  `chmod 0555` folder (asserting `OUTPUT_NOT_WRITABLE`); if the check runs as
  root it prints `SKIPPED` for the permission case instead of claiming a pass.
- Asserts the wiring in `main.cjs`: three preflight call sites, two verification
  call sites, verification before `render:done`, named failures reaching the
  renderer.
- **Falsifiability was tested, not assumed.** Replacing the timeline verification
  with a stub that always returns `{ ok: true }` makes the check fail with
  `AssertionError: FAIL: the timeline render and the Studio MP4 read the delivered
  file back`; restoring it returns exit 0 with 33 assertions.

### 2.5 FFmpeg is optional; the skip is loud, counted and reported

`ffmpeg-static` and `ffprobe-static` are `optionalDependencies`. `ffprobe-static`
ships its binary inside the tarball (so it is always there), while
`ffmpeg-static` downloads its binary at install time. On a checkout where that
download did not happen, `check-export-preflight.mjs` prints, in full:

```
SKIPPED: FFmpeg was not found in this checkout (it is an optional dependency whose binary downloads at install time).
SKIPPED: the encoder-availability assertions, the real encode and the size-estimate comparison did NOT run.
SKIPPED: they run in the release chain on Windows, where ffmpeg-static provides the binary. See docs/PHASE1_EXPORT.md.
```

The skip count appears in the check's summary line. This is stated rather than
hidden because a silently skipped encoder test is exactly the "looks done but
isn't" pattern this project is removing.

---

## 3. Verification performed, and what was observed

| Command | Observed result |
| ------- | --------------- |
| `npx vitest run src/tests/render-preflight.test.ts` | `Tests 24 passed (24)` |
| `npm test` | `Test Files 7 passed (7)`, `Tests 124 passed \| 1 skipped (125)` |
| `npx tsc --noEmit` | clean |
| `node --check electron/render-preflight.cjs`, `node --check electron/main.cjs` | `SYNTAX_OK` after every patch |
| `node scripts/check-export-preflight.mjs` | exits 0: `export preflight check passed — 33 assertions, 2 against the real FFmpeg (ffmpeg)` |
| Real binaries used | `ffmpeg version N-47683-g0e8eb07980-static` (johnvansickle build, `--enable-libx264`, libvpx-vp9, aac) and `ffprobe-static` 3.1.0 |
| Real encode in the check | 2 s 320×180 testsrc + sine → H.264/AAC MP4, 10.8 KB, probed and verified |
| Negative probe — timeline verification stubbed out | `AssertionError: FAIL: the timeline render and the Studio MP4 read the delivered file back`; restored, exit 0 |
| `node scripts/run-checks.mjs` | `BUILD PASSED: all 80 checks` (was 79; `check-export-preflight` added after `check-preview-parity`) |

---

## 4. Still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED on Windows.** Every run above is Linux. The *rules* are Windows
   rules and are tested as rules, but no Windows machine has yet refused a
   `CON.mp4` export, hit a real `EACCES` on `C:\Program Files`, or reported a
   Windows free-space number. The desktop app itself cannot run in this
   container at all (no Electron binary, see `docs/PHASE1_AUTONOMOUS.md` §4).
   *Verification required on Windows:* export to `C:\Program Files\` (permission),
   to a nearly-full drive (space), with a name like `launch|final.mp4` (name
   rules), and with `CUPRIC_FFMPEG_PATH` pointing at a non-existent file (missing
   FFmpeg) — each must produce its own message and its own action line.
2. **UNVERIFIED: a real end-to-end export of a real project.** No Cupric render
   has been produced: the timeline render needs the Electron hidden window, and
   the Studio export needs MediaRecorder. The gate that would catch a bad export
   is now in place and verified with real ffmpeg output, but the exports it will
   judge have not been run here.
3. **The disk estimate is a model, not a measurement.** It was checked against one
   real encode (2 s, 320×180, deliberately pessimistic) — not against a long
   1080p render, where H.264's rate control behaves differently. A wrong estimate
   can only cause a refusal that was not needed (it cannot cause a truncated
   file, because the reserve is kept clear).
4. **`WRONG_SIZE` is only checked when the caller knows the size.** The Studio MP4
   path passes `size: null` (the recording's own dimensions are the truth there),
   so a size mismatch on that path is reported by the probe's `checks` but not
   failed.
5. **Tolerances are fixed at 0.75 s.** A render whose last frame is short by more
   than that (a dropped segment) fails; a slow-motion `-r` mismatch smaller than
   that passes. Frame-accurate length checking would need frame counting, which is
   Phase 1.6's remaining work together with WebCodecs frame-exact export.
6. **Encoder *choice* is not verified end to end.** `checkEncoder` proves the
   build has an H.264 encoder; that the hardware path (`h264_nvenc`, `h264_qsv`,
   `h264_amf`) is actually used and falls back correctly is covered elsewhere
   (`scripts/check-encoders.mjs`) and not by a real hardware encode here.
7. **`@ffmpeg-installer/ffmpeg` was installed in this container with `--no-save`**,
   purely so the encode assertions could run. Nothing in the repository depends on
   it; the release chain uses `ffmpeg-static`, and the check prints a skip when no
   ffmpeg is present.
