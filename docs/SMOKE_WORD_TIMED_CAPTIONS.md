# Packaged-desktop smoke scenario — word-timed captions and breaking a video apart

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

## Scenario D — import a finished video and take it apart

1. Studio → import a video that has speech in it (Import media / drag onto the timeline).
2. Right-click the clip on the timeline → **Break into clips (measured pauses)**.
3. Expected: an info toast says Cupric is measuring; then a success toast names the piece count and
   the seconds of silence closed, and says one Undo reverts it.
4. Expected on the timeline: the clip is now several clips named `Name · 1/N` …, butted together,
   each selectable, trimmable, deletable and movable on its own; an overlay that sat after the cuts
   moved left with the audio; a music bed that spanned the clip is shorter by the same amount.
5. Pro panel → **Break into clips** exposes the other two modes: *Pauses in the words* (needs a
   transcript — run Auto-captions first) and *Even pieces* (for B-roll; nothing is removed and the
   timeline plays back identically), plus **Keep the original timing**, which splits at the pause
   boundaries instead of closing them, so each silence becomes a clip you can delete.
6. With a transcript present, tick "Caption the pieces…" and confirm the caption clips are created
   *before* the cut and land on the same words afterwards (inspector: `Word timing: real word times…`).

**Failure signatures**

- `Cupric cannot read this clip's audio` → the file is missing/relinked, or the browser build cannot
  decode this container; relink it or use the even split.
- `No speech in this clip` → the level never rises 6 dB above its floor (music, B-roll, dead audio):
  the even split is the honest tool for that.
- `No pause in this clip reaches 0.45 s` → lower the word-pause threshold is not exposed yet; use the
  even split or trim by hand.

## Scenario E — take a montage apart at its own cuts

1. Studio → import an edited video whose picture changes at its cuts (a montage, a screen
   recording with hard cuts, anything without useful speech).
2. Right-click the clip → **Break at scene changes (the picture)**.
3. Expected: an info toast says Cupric is sampling the clip's frames; then a success toast names
   the number of scene changes found and says nothing was re-timed and one Undo reverts it.
4. Expected on the timeline: the clip is cut where the picture changes, every piece selectable/movable/
   deletable on its own, and the total length **unchanged** (nothing was removed). An overlay that
   crossed a cut is now split with it — check its text still reads correctly.
5. Pro panel → **Break into clips** → *Break at* → **Shots + pauses (best for an imported video)** →
   **Take the video apart**: the same run closes what the voice left empty *and* splits the result at
   the shot cuts, so the video arrives as phrases and shots. The notes under the button say how many
   pauses were closed, how many shot cuts landed inside removed silence (they leave no extra piece),
   and that the word timings stay on the pieces.
6. With *Scene changes (the picture alone)* selected, the panel says nothing is removed; with *Shots +
   pauses* the "Keep the original timing" checkbox is available and keeps the sequence identical to the
   import while still cutting every pause into its own clip.

**Failure signatures**

- `The video file is not loaded — relink it first.` → the media handle is gone (the project was copied
  to another machine, or the file moved): relink it in the media panel and retry.
- `Looking for shots means looking at the picture — select a video clip, or use the silence or even
  split for audio.` → an audio clip was selected while *Break at* was on a shot mode.
- `The picture changes too little from frame to frame to find a cut — nothing was split.` → a locked-off
  single shot (or a very slow pan), so there is nothing to break on: use the silence/even split.
- `Every boundary this clip has sits at its edges or inside the removed silence — nothing was split.`
  → the import path found boundaries, but removing the pauses already brought the kept ranges together:
  turn on "Keep the original timing" to split at the pause boundaries instead.
- A long clip takes a while: the shot detector reads four frames per second of footage through the
  browser decoder. The panel shows `Sampling frames to find the cuts… NN%` while it runs, and the
  toast is informational.

**Honest limits** (verified in this repository, not measured on real footage here)

- The detector is a mean-luma difference between sampled frames (`frameDifference`), thresholded
  adaptively (`median + 5 × MAD`, floor 0.06). It finds hard cuts; a long dissolve or a flash frame can
  be missed or can over-report, and sampling at 4 fps can place a cut up to one sample (0.25 s) late.
- `scripts/check-decompose.mjs` covers the pure half (differences, threshold, minimum shot length,
  remapping after a cut) and the assembly around it; the frame sampling itself needs a decodable video
  and is only exercised by this scenario in the packaged app.
- Splitting makes the *pieces* editable, not the layers inside them: a caption, logo or watermark burned
  into the imported pixels stays burned in, and audio that arrived mixed into one stream stays one
  stream. Removing those needs paint-out or stems the import does not have.
- Every piece points at the same source file, so a relink (media panel) fixes them all at once; deleting
  a piece never deletes the file.

## Scenario F — a caption drawn at the wrong time, and a fix that proves its scope

1. Studio → run Auto-captions on a clip with speech, so some caption clips carry word timings
   (inspector shows *Word timing: real word times*).
2. Select a caption on the timeline and drag its right edge left until the block ends **before** its last
   word would be revealed (the inspector's `wordDelaysMs` shows the delays; the last is the one to beat).
3. Click **Checks** (the delivery audit button).
4. Expected: the chain stops at the **timing** gate and names the block: *"…ends at 1.2s but its last word
   is revealed at 1.8s, so that word is never seen."* The panel offers **Hold to fit the last word**.
5. Press **Fix all**. Expected toast: *"Applied 1 measured fix — one undo step, and 1 change(s), 1 allowed."*
   — the second half is `scopedEdit` proving the fix touched only the blocks the report named. Undo
   reverts the whole fix.
6. Expected after the fix: re-running **Checks** no longer reports a timing finding for that block, and
   playing the timeline shows the last word appear.
7. Also try: shorten a caption's text but leave its `wordDelaysMs` long (or paste a timing list from a
   partial transcript). Expected: *"has 3 word timing(s) for 4 word(s): the last 1 never appear"* — an
   error, because the renderer stops revealing at the end of the list.
8. Two captions that overlap on the same track are reported as a warning the timing gate can also fix
   (*Trim to …*) when trimming stays safe (at least 0.35 s, and not before the block's own last reveal).

**Failure signatures**

- `timing:missing-delays` (error) → the timing list is shorter than the text: re-run auto-captions, or
  shorten the text to what was transcribed. This one has no mechanical fix on purpose — deciding which
  words to drop is an editorial decision.
- `timing:late-reveal` (warning) → the block sits on screen for more than 1.2 s before its first word.
  No fix is offered: leading in before a caption is a style choice, and the warning is the whole point.
- A toast that says *"The fix also changed something it was not asked to"* → the audit button's own fix
  drifted outside the clips its report named. That is reported rather than hidden; **Undo** reverts all
  of it in one step.

## Scenario G — an applied fix is re-measured, and transcription is paid for once

**Fix all, verified**

1. Studio → **Checks** on an edit with at least one failing text block (white ink over a light frame is
   the quickest way to make one).
2. Press **Fix all**. Expected: the fixes apply as one undo step, and the toast ends with
   *"Re-checked the result: N/N proposed fix(es) held and no new error appeared."* — that sentence comes
   from rendering the patched document again and running the same gate chain over it, not from the
   fix's own arithmetic.
3. Expected if a fix does not hold: an error toast naming how many did not and quoting the finding that
   is still failing; the change stays applied (Undo reverts it).
4. Expected if the recheck itself cannot run: the fixes are still reported as applied, and the toast
   says the result could not be re-checked — it never claims a verification that did not happen.

**Transcription, cached**

5. Select a clip with speech → **Transcribe & caption** (desktop app). Expected: captions appear with a
   note naming the engine and the timing quality.
6. Run the same action again on the same clip. Expected: the transcription is served from the store —
   no second Whisper run — and a note says so, plus a **Re-transcribe** button that ignores the cache.
7. Settings → **Transcriptions kept** shows how many files are stored and how often they were reused;
   **Clear** forgets them (the next run transcribes again). Nothing else changes.
8. A clip that already carries word timings from an earlier run: caption it again with **Re-transcribe**.
   If the new alignment disagrees with the old words, the note says how many changed — the caption is
   built from the new words, and nothing that was built from the old ones is silently rewritten.

**Failure signatures**

- `Auto-captions from audio need the desktop app…` → the browser build has no offline engine. The cache
  is read before the engine is needed, so a **previously transcribed** file still captions instantly in
  the browser; a file that was never transcribed still shows this.
- Undo after *Fix all* reverts every patch from that press **and** the step is one history entry — if the
  toast counted fixes, one Undo removes exactly that many.

## Scenario H — readiness, and captions placed clear of the face

**Readiness**

1. Ask panel → settings (the drawer with Project safety) → **What this machine can do**.
2. Expected: one row per capability (the desktop app, MP4 export, captions, offline voiceover, writing,
   stock search, every clip's file, something to render) with a green tick, an amber dot for a blocking
   miss, or a hollow circle for an optional one — and a **remedy** sentence on every miss.
3. Expected on a machine with no Whisper: the captions row is *optional*, the detail says the fallback is
   typing or pasting a transcript, and the remedy names `npm run whisper:fetch` and the `<userData>/whisper`
   folder. A render is still offered: the summary says "Ready to render · N optional".
4. Expected in the **browser build**: the first row is blocking and says exports are WebM drafts with no
   offline engine — and there is no Piper row at all, because a capability the platform cannot have is
   not reported as missing.
5. Expected with a relinked project: the "Every clip's file" row turns blocking and counts the clips;
   deleting the clips or relinking clears it.
6. Press **Re-check** after installing FFmpeg: the row changes without reopening the drawer. Nothing in
   this panel writes, installs or reaches the network.

**Caption placement**

7. Studio → import footage of a person (or anything with a clear subject) → add captions (Auto-captions)
   → with the captions sitting in the middle of the frame over the face.
8. Pro → Auto-edit → **Place captions clear of the subject** → *Place captions*.
9. Expected: the button shows `Measuring under “…” NN%` while it samples three frames per caption, then a
   preview naming how many blocks moved and why ("Moved: band-3 crosses the motion, and band-6 does
   not"). Accepting is **one undo step** for every caption it moved.
10. Expected on the timeline: the moved captions sit lower (or higher, if the subject is at the bottom of
    the frame) and are still inside the safe zone.
11. Expected when the measurement finds nobody (a locked-off shot of a room, a screen recording): nothing
    moves and the message says *"No subject was found in this clip's frames, so the caption keeps its
    place"* — a busy background is not a person.
12. Expected when a caption's calmest band still overlaps the subject: the notes say how many blocks and
    the coverage percentage ("worst 42% covered — check those by eye"), and the blocks still move.

**Failure signatures**

- `No video under this caption — place it where there is footage to measure.` → the caption sits over an
  image, a background or a gap: move it over footage, or place it by hand.
- `That clip's video file is not loaded — relink it first.` → the media handle is gone (project copied to
  another machine, file moved). The readiness panel's "Every clip's file" row says the same thing.
- `N caption(s) could not be measured: "…” — …` → the rest were placed and this one kept its position;
  the reason is the file's own.
- Nothing happens on the browser build for the shot/frame measurements, and the button says the frames
  are read from the file — that is the desktop-only path, not a failure.

**Honest limits**

- Both measurements are heuristics over three sampled frames, stated as such in the code: a long
  dissolve or a fast cut inside the sampled window can hide the subject, and a terracotta wall passes the
  skin test (which is why motion is asked first, and why "no subject found" leaves the caption alone).
- `measurePlacement`'s arithmetic is covered by `scripts/check-placement.mjs` on synthetic frames; the
  frame decoding around it is only exercised here, in the packaged app.

## What this scenario does **not** cover

- macOS/Linux: no packaged build or release workflow exists for them (see
  `docs/AUDIT_2026-09-29_REFERENCES.md` §B12).
- The installer/updater: unsigned NSIS + `latest.yml` auto-update is covered by
  `.github/workflows/release-windows.yml` and the packaged boot check, not by this scenario.
- Provider cost approval: not implemented yet (audit backlog item 4).
