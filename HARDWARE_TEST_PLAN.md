# Real-machine test plan

These can't be exercised in the CI sandbox. There's no display, no GPU, no
microphone, and no network access to GitHub release assets or Hugging Face.
Run them on a real Windows 10/11 PC first, then macOS. Record pass/fail in the
table at the end.

## Setup
1. `npm install` (full, with postinstall: this downloads Electron + ffmpeg-static).
2. `npm run whisper:fetch`: downloads the whisper.cpp binary and `ggml-base.en-q5_1.bin`.
3. `npm run dev:desktop` (or install the packaged build).

## 1. Video proxies (2.7)
- Import a 4K (3840×2160) MP4 from disk.
  **Expect:** the Inspector shows "Making proxy… N%", then "Proxy ready".
- Scrub the timeline quickly.
  **Expect:** it stays smooth. Task Manager shows much less decode load than with proxies Off.
- Export at 4K.
  **Expect:** the output is full resolution (check it with `ffprobe`), not 540p.
- Re-import the same file.
  **Expect:** "Proxy ready (cached)" appears instantly.
- Set "For new imports" to Off and import again.
  **Expect:** no proxy is made.
- Test failure handling: rename the source file mid-transcode.
  **Expect:** "Proxy failed: …" is shown, and the preview keeps playing the original.

## 2. Auto-captions with word timing
- Select a talking-head clip and click Pro tools → Auto-captions → Transcribe & caption.
  **Expect:** the note reads "Whisper · word-level timing", and captions line up with the lips to within about 150 ms.
- Test trim and speed: trim 3 s off the front and set the speed to 1.5×.
  **Expect:** captions still line up.
- Delete `vendor/whisper` on Windows.
  **Expect:** the note reads "Windows Speech · phrase-level timing" (if a recogniser is installed), or you see the clear "No offline speech engine" message.
- Accept, then Undo.
  **Expect:** a single undo step removes all the captions.

## 3. Arena capture sandbox (web build)
- Run `npm run dev`, open it in Chrome, and import an Arena `.zip` that uses CSS, images and JSON.
  **Expect:** the thumbnail appears.
- Render it in the browser.
  **Expect:** the frames match the Arena preview.
- Negative test: an Arena HTML that calls `parent.localStorage` or `fetch('https://…')`.
  **Expect:** it's blocked (see the console). The app itself is unaffected.
- Known limit: `<video>` inside Arena HTML captures as blank. Use the desktop render for those.

## 4. Smart components
- Add text lines: "Trusted by 10,000 users", "Only ₹499/month", "Sign up free".
  **Expect:** Pro tools → Smart components lists 3 moments, each with a reason.
- Click Preview all, then Accept.
  **Expect:** the components record their real animation. A single Undo removes them all.

## 5. Carried over from earlier releases
- Local voice (1.10): dictation works offline on Windows.
- Encoder fallback (2.24): export works with NVENC/QSV unavailable.
- HEIC import (2.30) from an iPhone photo.

| Area | Windows | macOS | Notes |
|---|---|---|---|
| Proxies | | | |
| Auto-captions | | | |
| Arena sandbox (web) | | | |
| Smart components | | | |
| Local voice | | | |
