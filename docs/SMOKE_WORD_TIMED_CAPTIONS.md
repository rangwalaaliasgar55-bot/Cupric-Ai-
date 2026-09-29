# Packaged-desktop smoke scenario — word-timed captions (v0.13.0+, Windows)

**Why this file exists.** The headless checks (`scripts/check-auto-captions.mjs`) prove the
timing contract with synthetic transcripts, but they cannot prove that a *packaged* app
transcribes a real voiceover with the real offline Whisper build and lands the caption on the
spoken word in a real MP4. That needs the installer, the FFmpeg/Whisper binaries unpacked by
electron-builder and a human ear. This is the scenario to run before shipping a build that
touches captions.

**Status of this scenario in this environment: NOT EXECUTED.** No Electron binary can be
downloaded or run here (`npm install --ignore-scripts`, no Chromium, no display), so nothing
below was observed. It is written so a person with the installed build can run it in ~10 minutes
and knows what a failure looks like.

## Preconditions

- `Cupric-AI-Setup-<version>.exe` installed on Windows 10/11 (unsigned NSIS build; SmartScreen
  will warn).
- The app opens without the recovery card ("Renderer recovered").
- Settings shows the media tools as found (FFmpeg/FFprobe). If not, the run will say so instead
  of failing silently.
- At least one project open (Home → New/Open project).

## Scenario A — real word timings (the default)

1. Production → **Quick video**. Topic: `why sleep matters`, Language English, Subtitles **on**,
   **Real word timings** checked, Footage source `Openverse (keyless)`, Variants 1.
2. Press **Build timeline**.
3. Expected, in order:
   - the log names the voice engine ("… voiceover made offline with …");
   - a log line naming the transcription engine and word count, e.g.
     `Word timings from whisper: NN words.` (phrase-level engines add
     "…(phrase-level — words inside a phrase are spread)");
   - a final line `Subtitles: real word times (N of N captions).`;
   - the toast says the timeline was built and that Undo reverts it in one step.
4. Open **Studio**. Select a subtitle clip. The inspector shows
   `Word timing: real word times from the transcript (N words)`.
5. Scrub the timeline slowly across one caption: each word appears on the syllable you hear,
   not on a steady clock. (If the voiceover is silent or the file is missing, step 3 reports the
   reason instead.)
6. Export MP4 (Render → Export). Open the file: the same caption lands on the same word in the
   file as in the preview. A browser-preview WebM is a draft, not this check.

**Failure signatures**

- Log says `Word timings unavailable (…)` and the summary says `estimated from the script` →
  the transcription path failed. Read the parenthesised reason; do not report the build as
  broken captions, it is a labelled estimate.
- Captions appear all at once → the engine returned phrase-level stamps (the log says so). This
  is expected for Windows Speech; use a Whisper-backed transcription to get per-word times.
- Words are missing from a caption → that would be a word-count mismatch, which must fall back to
  an even split inside the caption and stay labelled. Capture the transcript JSON and the doc.

## Scenario B — the honest fallback

1. Same as A, but **Real word timings** unchecked (or run it in the browser build, where the
   checkbox is disabled and the hint says timings are estimated).
2. Expected: no transcription log line; summary `Subtitles: estimated from the script — no word
   timings.`; every subtitle clip's inspector reads
   `Word timing: estimated across the clip — no transcription behind it`.
3. Export and confirm the captions still cover the narration from start to end (they are
   approximate, not absent).

## Scenario C — replace an estimate with real times in Studio

1. From Scenario B, open **Studio → Pro → Auto-captions from the clip's audio** on the voice clip.
2. Expected: status text reports the engine and the timing precision; new caption clips carry
   `Word timing: real word times…`; the previous estimated captions can be deleted with one undo.

## What this scenario does **not** cover

- macOS/Linux: no packaged build or release workflow exists for them (see
  `docs/AUDIT_2026-09-29_REFERENCES.md` §B12).
- The installer/updater: unsigned NSIS + `latest.yml` auto-update is covered by
  `.github/workflows/release-windows.yml` and the packaged boot check, not by this scenario.
- Provider cost approval: not implemented yet (audit backlog item 4).
