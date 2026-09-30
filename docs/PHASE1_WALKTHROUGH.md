# Phase 1 walkthrough — every subsystem, executed, with what came out

`npm run verify:phase1` runs the shipped code for each Phase 1 claim and prints
what actually happened. This document is that output, with the numbers explained.

The rule the script follows is the rule of this project: **nothing is simulated.**
Where something genuinely cannot run on the machine (no API key, no Windows
voice), the step reports `unavailable` with the reason and is *not* counted as a
pass. The exit code is non-zero if any step that could run failed.

```
node scripts/phase1-walkthrough.mjs          # human-readable
node scripts/phase1-walkthrough.mjs --json   # the same run as data
```

**Run recorded:** 2026-09-30, Linux container, Node 22, ffmpeg N-47683 (static)
on `PATH`, no API key configured, no speech engine installed.
**Result: 6 steps ran and held · 0 failed · 1 could not run here.**

---

## 1. AI backend — 10 error codes, real retry decisions

| | |
| --- | --- |
| Codes | `NO_KEY_CONFIGURED, UNAUTHORIZED, RATE_LIMITED, NETWORK_ERROR, TIMEOUT, INVALID_RESPONSE, MODEL_NOT_FOUND, BAD_REQUEST, SERVER_ERROR, CANCELLED` |
| Retry decisions | 4 retryable, 6 not — `NO_KEY_CONFIGURED` and `UNAUTHORIZED` are **never** retried (retrying a rejected key only burns quota); `RATE_LIMITED` and `SERVER_ERROR` are |
| Status mapping | `401/403→UNAUTHORIZED`, `404+“model not found”→MODEL_NOT_FOUND`, `404+“no such route”→BAD_REQUEST`, `429→RATE_LIMITED`, `500/503→SERVER_ERROR`, `400→BAD_REQUEST` |
| Transport | `ENOTFOUND→NETWORK_ERROR`, `TimeoutError→TIMEOUT`, cancel→`CANCELLED` |
| Backoff | a bounded array; asserted to be > 1 and ≤ 6 attempts, each under 60 s |

Every code is produced through `makeError`, so each one carries a `retryable`
flag, an `action` ("Retry", "Pick another model in Settings", "Add a key in
Settings") and a full sentence. The stronger exercise of this layer lives in
`scripts/check-ai-providers.mjs`: **37 assertions against two real HTTP servers**
(OpenAI-compatible and Anthropic), including a real retry on a real socket, a
keyless local server, and a closed port producing `NETWORK_ERROR` rather than
`fetch failed` in front of a user.

**UNVERIFIED here:** a call to a real vendor. It needs an API key, which this
environment does not have — the step says so and is not counted as a pass.

## 2. Autonomous pipeline — 12 real briefs, measured

`scripts/lib/pipeline-evidence.mjs` runs the **shipped planner** (`planLocally`,
the same function `makeDeps()` wraps) over twelve varied briefs and measures the
output. `scripts/check-automation-steps.mjs` asserts the numbers, so this table
cannot drift from the code.

| | |
| --- | --- |
| Briefs | 12 |
| Distinct durations | **9** — 8, 11, 12, 17, 20, 23, 30, 31, 45 s |
| Distinct scene counts | **8** — from 4 to 20 scenes |
| Distinct hook lines | **12 of 12** — every brief opens differently |
| Same-length check | three briefs all ask for **17 s**; they produce 8, 11 and 12 scenes with three different scene-type sequences |

**Two defects were found by this run, not by reading:**

1. **A Hindi brief's stated duration was silently ignored.** "स्मार्ट बचत ऐप के लिए
   20 सेकंड का विज्ञापन" asked for 20 seconds and got the 30-second default,
   because the pattern only knew the English word *second*. The pipeline supports
   Hindi everywhere else (language detection, Hindi TTS voices), so this was a
   defect rather than a limit. `statedSeconds()` now reads Devanagari words and
   digits (२०) as well as English, in both word orders, and
   `durationFromBrief` shares that one reader. **20 s, as asked.**
2. **A clamped duration was reported as no change at all.** `requestedDuration`
   only set its "raised from" field when the floor *raised* a value; a 5-minute
   brief capped at 3 minutes came back with nothing to show. Both directions now
   report `adjustedFrom`, and the Autonomous screen tells the user in words: *"Your
   brief asked for 6s. This plan is 8s — the shortest structure it builds is 8s."*

Also verified rather than assumed: a scene *may* carry no copy (a hold or a
visual beat — the engine creates no text element for it), but every placeholder
that does exist is bracketed (`[Add your call to action]`) and counted as
outstanding work rather than quietly rendered as if it were the user's words.

## 3. Studio — the document round-trips

`emptyStudioDoc()` produces a real document (`aspect, fps, backgroundId, clips,
trackCount`); the edit-operations module exposes `applyStudioEditPlan`,
`validateStudioEditPlan`, `localStudioEditPlan` and `describeStudioEditOp`. The
timeline's drag path and its keyboard path call the same store command, which is
asserted in `scripts/check-phase3-ui.mjs` (96 assertions) and driven end to end by
`tests/e2e/studio-export.spec.ts` on Windows.

## 4. Export — a real MP4, read back by the app's own verifier

| | |
| --- | --- |
| Encode | `ffmpeg -f lavfi testsrc=640x360@30 -f lavfi sine=440Hz → h264 + aac` |
| File | `clip.mp4`, **53 KB**, `sha256 460b51e999fd03e7…` |
| Streams | `h264 640×360 @ 30/1`, `aac 44100 Hz` |
| Duration | **3.02 s** (asked for 3) |
| Verdict | `verifyExport` — `size=ok · probe=ok · video=ok · audio=ok · duration=ok (3.02s vs 3.00s) · size=ok` |
| Negative control | the same verifier on a zero-byte file → `EMPTY_FILE, UNPLAYABLE` |

That second row matters as much as the first: a verifier that says yes to
everything would also say yes here. Progress is parsed from ffmpeg's own
`out_time_ms`/`time=` output (`electron/main.cjs:4412`), not from a timer, and the
UI is only told `done` after this read-back succeeds (`electron/main.cjs:4773`).

## 5. Voice — the chain ran, and failed honestly

On this machine every engine is absent, so the truthful result is a failure — and
what is asserted is that the failure is *legible*:

```
engines tried: eSpeak NG: spawn espeak ENOENT
message: Cupric could not start the speech engine (espeak-ng). Install it, or add
         Piper plus a voice model in the Cupric "piper" folder.
whisper: not installed
```

`scripts/check-tts-languages.mjs` (47 assertions, **no fake engines**) pins the
rest: the Windows command line, the culture-based voice choice, rate clamping,
Piper discovery against real files, and the rule that Hindi is never read with an
English voice. The installer side is exercised for real in step 6.

## 6. Speech engine install — plans, guards, and a real network failure

| | |
| --- | --- |
| Plan | `github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip` → `piper_windows_amd64.zip` |
| Verification | `piper.exe` must exist on disk after unzip, or the install reports failure |
| Real failure | a host that does not resolve → `network`, and **no file left behind** |
| Traversal guard | `../escape` refused by name |

---

## What this walkthrough does not prove

* **Anything Windows.** Every step here runs on Linux. `check-install-windows.mjs`
  and `check-update-path.mjs` refuse to run off Windows by design, and the E2E
  suite cannot launch the app without the Electron binary.
* **A real vendor API call** — no key. The adapters are proven against real HTTP
  servers locally; the vendor's own service is not.
* **Real audio from a real engine** — no engine on this machine and no Windows
  voice to probe. This is the honest position after the fake-engine test was
  deleted in the last round.
* **The Piper download end to end** — the URL and asset size were confirmed from
  published release metadata, but `huggingface.co` is unreachable from this
  container, so the voice-model URLs remain patterns until a Windows machine
  fetches them.
* **Frame-accurate preview / WebCodecs.** Not exercised here; it needs the app.
