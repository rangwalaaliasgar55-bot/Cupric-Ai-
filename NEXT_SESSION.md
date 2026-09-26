# NEXT_SESSION.md — Cupric AI desktop implementation status

The desktop functionality pass for Prompts 6–10 is now implemented on branch
`arena/01a0db3a-cupric-ai`.

## Current status

Implemented:

- Real Gemini IPC through Electron main process using `@google/generative-ai` and `gemini-2.0-flash`.
- Gemini API key storage in `settings.json` or `GEMINI_API_KEY`; key is never exposed to the renderer.
- Settings UI in Ask Gemini for key save, live/mock status, auto-launch, update check, and media-engine status.
- Real Arena ZIP/HTML import with safe extraction into app data.
- `index.html` discovery and `window.__seek(t)` validation.
- Hidden BrowserWindow thumbnail capture and sandboxed iframe preview through a path allowlist.
- Real footage copy into app data.
- FFprobe duration extraction.
- FFmpeg silence detection with configurable defaults (`-35dB`, `0.8s`).
- Real waveform peak extraction from PCM samples with web fallback.
- Full timeline render pipeline:
  - Arena clips captured frame-by-frame through `window.__seek(t)`.
  - Footage clips trimmed/cropped/scaled.
  - Optional silence-cut removal for edited footage.
  - Optional ASS subtitle burn support when captions are provided.
  - Segment concat in timeline order.
  - MP4 outputs under app data renders directory.
- Render progress, done, error, cancellation, reveal, and copy-to-Downloads IPC.
- Render cancellation kills active FFmpeg processes and closes hidden capture windows.
- Zustand persistence mirrors to Electron `userData/projects.json`; localStorage remains web fallback.
- Single-instance lock.
- Crash logging under `userData/logs` and renderer-crash reload screen.
- Optional launch-on-login.
- `electron-updater` check foundation with GitHub Releases config.
- Windows packaging config, `build/icon.png`, optional signing docs, SmartScreen/data-location docs.
- `npm run build` passes.

## Important environment note

The Arena sandbox could not download the `ffmpeg-static` binary from GitHub due
TLS/network failures (`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / `ECONNRESET`). The app
now detects missing media binaries clearly and also supports explicit overrides:

```bash
NORTHFRAME_FFMPEG_PATH=C:\path\to\ffmpeg.exe
NORTHFRAME_FFPROBE_PATH=C:\path\to\ffprobe.exe
```

A normal clean Windows install with working GitHub/network certificate access
should download the static binaries during `npm install`. The clean Windows 11
installer install/run test still needs to be performed on an actual Windows
machine.

## Definition of done status

- [x] Brief screen calls the real Gemini path when a key is present; fallback remains available.
- [x] Real Arena ZIP/HTML imports, validates `__seek`, captures a thumbnail, and previews in an iframe.
- [x] Real MP4 footage analysis path copies video, extracts duration, detects silences, and returns waveform peaks.
- [x] Timeline render writes a real MP4 path with progress, cancellation, reveal, and copy-to-Downloads actions.
- [ ] Installer must still be smoke-tested on a clean Windows 11 machine outside this sandbox.

## Human-in-the-loop Arena workflow remains unchanged

Cupric AI generates the Arena prompt, the user pastes it into `arena.ai/code`,
votes manually, downloads the winner, and imports that export back into
Cupric AI. Voting is intentionally not automated.

## Autonomous Mode status

Added the Auto screen, automation data model, Zustand actions, browser preview simulation, and safe Electron job lifecycle IPC with persisted jobs. Public Arena voting remains manual; local scoring is the autonomous-safe path. Native media orchestration and final report generation should be continued by wiring the persisted queue to the existing rundown, Arena import, footage analysis, and render services.
