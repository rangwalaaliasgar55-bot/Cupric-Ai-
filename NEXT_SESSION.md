# NEXT_SESSION.md — Making Northframe Studio real

Handoff for the next working session. The prototype is done; everything below
turns the three mocks into real implementations **without touching the UI**.

---

## Where we are

- All 7 screens are built and smoke-tested (see `README.md`).
- Every async operation is mocked behind three files with stable signatures:
  - `src/lib/gemini.ts` → `fakeAskGemini(text, askCount)` / `fakeGeminiChat(text, ctx)`
  - `src/lib/arena.ts` → `fakeImportArenaZip(file, onProgress)` / `fakeUploadFootage(file, onProgress)`
  - `src/lib/render.ts` → `fakeStartRender(onUpdate, onDone)` → returns a cancel fn
- In Electron, the renderer can talk to the main process through
  `window.northframe.ipc.invoke(channel, payload)` (already exposed in `electron/preload.cjs`).
- **The golden rule for every prompt below: keep the function signatures.
  UI components never change. Only the contents of `src/lib/*` and `electron/*` grow.**

---

## Prompt 6 — settings + real Gemini (paste this first next session)

```
Keep the entire existing UI exactly as it is. Wire the Brief screen's
fakeAskGemini (src/lib/gemini.ts) and the Ask Gemini panel's fakeGeminiChat to a
REAL Gemini API call, with the API key never exposed to the renderer.

1. In electron/main.cjs add IPC handlers:
   - "gemini:ask" (prompt, history, rundownContext) -> { text, rundownPatch }
   - "gemini:chat" (text, ctx) -> string
   - "settings:get" / "settings:set" — persist a JSON settings file via
     app.getPath('userData')/settings.json (use electron-store or plain fs).
   - "settings:hasKey" -> boolean
2. The key comes from settings.json (a Settings dialog writes it) or the
   GEMINI_API_KEY env var. NEVER log it, NEVER send it over IPC to the renderer
   — the renderer only ever sees "hasKey: true/false".
3. Use the official @google/generativeai SDK, model gemini-2.0-flash. Ask for
   STRICT JSON output matching the SceneRundown type (title, durationSec, fps,
   size, style, scenes[{id,from,to,type,copy,motion}], arenaPrompt). The
   arenaPrompt string MUST follow the existing mock's shape verbatim (SINGLE
   FILE index.html, #scene WxH, duration Ns at 30fps, window.__seek(t) pure
   function of t, style details). Parse defensively; on bad JSON retry once,
   then fall back to the mock so the demo never dies.
4. In src/lib/gemini.ts, keep the fake functions renamed as askGeminiLocal and
   add askGemini() that: if window.northframe exists -> ipc invoke
   "gemini:ask"; else (web preview) keep using the local mock. Same return
   shape { text, rundownPatch }. The Brief screen now calls askGemini() —
   zero component changes.
5. Add a small "Gemini API key" field + Save in the Ask Gemini slide-over
   header area (settings icon) that calls settings:set. Show a subtle "mock"
   / "live" badge next to it based on settings:hasKey.
6. Keep the field-by-field rundown animation — it now animates the REAL patch.
```

## Prompt 7 — real Arena import + real thumbnails

```
Keep the UI exactly as is. Make the Arena Desk import real.

1. Add deps: adm-zip (zip read), and keep everything offline-capable.
2. electron/main.cjs: IPC "arena:import" (filePath, projectId):
   - unzip to app.getPath('userData')/projects/<projectId>/arena/<assetId>/
   - locate index.html; validate it defines window.__seek (scan for
     "__seek" text); reject with a clear error if missing
   - spin a hidden 1280x720 BrowserWindow, load the file over file://,
     call window.__seek(1.5) after load, wait 400ms, capturePage() ->
     PNG dataUrl, destroy window
   - return { htmlFileName, thumbnailDataUrl, localPath }
3. IPC "arena:previewPath" (localPath) -> returns a file:// URL the preview
   modal can show. Update electron/preload.cjs to expose a small
   "paths" allowlist — file:// in <iframe src> only for paths under the
   project data dir. The PreviewModal swaps its mock stage for a real
   <iframe> when window.northframe exists (keep the mock stage for web).
4. In src/lib/arena.ts add importArenaZip() that: in Electron uses
   dialog.showOpenDialog via IPC ("dialog:pickArena") when the user clicks
   browse, reads the File on drop, invokes "arena:import"; in web preview
   keeps the current fake. Same onProgress shape -> the existing progress
   bar just works.
5. Store the returned thumbnailDataUrl on the ArenaAsset (the field already
   exists) — cards and Home grid now show real thumbnails. Project card
   thumbnails use the first arena asset's thumbnail when present.
```

## Prompt 8 — real footage analysis

```
Keep the UI exactly as is. Make the Footage Desk analysis real.

1. Add deps: ffmpeg-static, ffprobe-static.
2. electron/main.cjs IPC "footage:analyze" (srcPath, projectId):
   - copy the uploaded file into userData/projects/<projectId>/footage/
   - run ffprobe -print_format json -show_streams -> durationSec
   - run ffmpeg -i file -af silencedetect=noise=-35dB:d=0.8 -f null - and
     parse silence_start/silence_end pairs from stderr -> silenceRanges
     (same [start, end][] shape the UI already renders)
   - waveform: run ffmpeg showwavespic OR sample the PCM (ffmpeg -f s16le
     -ac 1 -ar 8000) and return ~88 peak values; render those in the
     existing Waveform component instead of the seeded PRNG bars (keep the
     PRNG as web-preview fallback)
3. src/lib/arena.ts: add uploadFootage() that in Electron gets a real file
   path (dialog or dropped File.path) and invokes "footage:analyze"; in web
   keeps the fake. Same progress + result shape.
4. Silence detection params (-35dB, 0.8s) become advanced settings with
   sane defaults; keep the per-cut "x to exclude" behavior identical.
```

## Prompt 9 — the real render pipeline

```
Keep the UI exactly as is. Replace the fake render worker with the real
seek-and-screenshot + ffmpeg pipeline.

1. electron/main.cjs IPC "render:start" (job { aspect, fps, quality,
   outputName, sources: [{type:'arena', htmlPath} | {type:'footage',
   videoPath, in, out, captions, crop}] }):
   - ARENA clips: hidden BrowserWindow sized to the locked rundown's
     WxH; load index.html; for frame i in 0..duration*fps:
     page.evaluate(window.__seek(i/fps)); capturePage() -> frame PNG;
     every frame call "render:progress" -> renderer updates the existing
     RenderJob.progressPct (same 0-100 mapping, same ProgressBar)
   - pipe frames to ffmpeg (ffmpeg-static): -framerate fps -f image2pipe
     -i - -c:v libx264 -preset <draft=veryfast|final=slow> -crf
     <draft=28|final=18> -pix_fmt yuv420p output.mp4
   - FOOTAGE clips: ffmpeg -ss in -to out, scale/crop to target aspect,
     optional subtitles burn (ASS generated from captionStyle), concat
     with arena segments via the concat demuxer in timeline order
   - write output to userData/renders/<jobId>/<outputName>; on done IPC
     "render:done" { outputPath }
   - support cancel (kill ffmpeg + close window) — wire the returned
     cancel fn from fakeStartRender's slot
2. src/lib/render.ts: startRender(job, onUpdate, onDone) -> in Electron
   subscribes to IPC progress events and returns a cancel that invokes
   "render:cancel"; in web keeps the 6s fake. SAME SIGNATURE.
3. Render screen: "Download" now copies/shims the real file to
   Downloads via IPC "render:reveal" (shell.showItemInFolder) — swap the
   mock toasts for real actions behind the same buttons.
4. Guardrails: max duration 120s, frame queue backpressure (don't hold
   >200 PNGs in memory — write to a temp frames dir), and if any frame
   throws, job -> 'error' with the message (the error row already exists).
```

## Prompt 10 — desktop hardening (ship it)

```
1. electron-updater + GitHub Releases: auto-update on quit/launch,
   "Check for updates" in settings. electron-builder publish config for
   the repo.
2. Optional auto-launch on login (app.setLoginItemSettings) — off by
   default, toggle in settings.
3. Single-instance lock (app.requestSingleInstanceLock), crash logging
   to userData/logs, and a graceful "renderer crashed" reload screen.
4. Windows code signing: document env vars (CSC_LINK, CSC_KEY_PASSWORD)
   in README; keep signing optional for personal builds.
5. README: end-user install section (download Setup exe, SmartScreen
   "More info -> Run anyway" note), and where data lives
   (%APPDATA%/northframe-studio).
```

---

## "Fully autonomous on a computer" checklist

What "it just works on any Windows PC" requires, in order:

1. `npm run dist:win` on a Windows machine → NSIS installer + portable exe (already configured).
2. Fonts/assets bundled (done — self-hosted, no CDN), app runs fully offline.
3. Data lives in `%APPDATA%/northframe-studio/` (userData) — projects.json mirror + arena/footage/renders folders. The prototype's localStorage is the web-preview fallback only; Prompt 6/7 should mirror the Zustand store to a JSON file via IPC (`state:save` / `state:load`) so desktop data survives cache clears.
4. Gemini key set once in Settings (or env var) — after that the Brief is live.
5. ffmpeg/ffprobe come bundled via ffmpeg-static/ffprobe-static — nothing to install.
6. Optional: code-signing cert to remove SmartScreen warning; electron-updater for silent updates.
7. The Arena battle itself stays a human-in-the-loop step by design: the app generates the prompt, you paste it into arena.ai/code, you vote, you drop the winner's zip back. Automating the vote would violate Arena's terms — the desk automates everything *around* the battle instead.

## Definition of done (next sessions)

- [ ] Brief screen answers a real prompt with a real rundown (badge shows "live")
- [ ] A real Arena zip imports, validates __seek, shows a real captured thumbnail, previews in an iframe
- [ ] A real MP4 drops in, real silence ranges render on the waveform, Apply edit works
- [ ] Timeline renders an actual MP4 to disk with a real progress bar; Reveal opens Explorer at the file
- [ ] Installer installs on a clean Windows 11 machine, app runs offline, data persists across restarts
