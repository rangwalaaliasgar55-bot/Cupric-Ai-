# Cupric AI

Cupric AI is a desktop creator tool for short-form video — from rough
idea to exported cut:

**Brief → Arena battle → Footage auto-edit → Timeline → Render**, or skip the
model entirely and cut the video yourself in **Studio**, the built-in
CapCut-style editor.

The app now avoids placeholder starter projects and wires real local media paths
behind the renderer signatures in `src/lib/gemini.ts`, `src/lib/arena.ts`, and
`src/lib/render.ts`.

The Arena workflow intentionally stays human-in-the-loop: Cupric AI generates
the prompt, opens `arena.ai/code` in your browser, copies the prompt for paste,
you vote in Arena yourself, download the winning export, then import that winner
back into Cupric AI.

---

## Quick start

```bash
npm install
npm run dev        # web preview at http://localhost:5173
```

The web preview now works with real local browser files for HTML/ZIP Arena imports,
Video.js footage preview, Web Audio silence/waveform analysis, and downloadable
WebM draft renders. To use the native filesystem, Gemini key storage, FFmpeg MP4
rendering pipeline, and installed-app media tools, run Electron:

```bash
npm run desktop
```

### Build the Windows installer

On a Windows machine:

```bash
npm install
npm run dist:win
```

Outputs into `release/`:

- `Cupric-AI-Setup-0.9.0.exe` — NSIS installer.
- `Cupric-AI-0.9.0-x64-Portable.exe` — portable executable.

The packaged app loads the built `dist/` over `file://` and self-hosts fonts, so
it can run offline after installation. On first AI use and when Settings opens,
Cupric auto-discovers OpenCode Desktop, Zen (only with an existing key), Ollama,
LM Studio, or the deterministic offline template; no key is required for local
or template mode.

---

## Desktop features implemented

| Area | Desktop behavior |
|---|---|
| **Gemini / OpenCode / Auto AI** | Settings and first use auto-discover OpenCode Desktop config/auth, keyed Zen Free, Ollama, LM Studio, and the offline template in that order. Gemini uses `gemini-2.5-flash` by default, validates pasted keys with a minimal call, refreshes live models, retries 429/503, and falls back without blocking the timeline. Secrets remain in Electron `settings.json` or environment variables; the renderer only receives key presence. |
| **Arena handoff + import** | Cupric AI can open `arena.ai/code` in the user's browser and copy a full Arena build brief for paste/build. The brief includes hard constraints, source/asset plan, exact scene sequence, render spec, and `window.__cupricSourceManifest` requirements. ZIP/HTML winners are imported into project app data, extracted safely, checked for `window.__seek(t)`, loaded in a hidden BrowserWindow, and captured as a PNG thumbnail. |
| **Arena preview** | Imported Arena HTML previews in a sandboxed iframe through an IPC-approved `file://` path under the project data folder. The browser preview imports `.html`/`.zip` with JSZip and validates `window.__seek(t)`. |
| **Remotion preview** | Locked rundowns are rendered through `@remotion/player` so you can preview the generated composition before exporting or importing Arena results. |
| **Footage analysis** | Desktop video is copied into project app data, duration is read by FFprobe, silences are detected with FFmpeg `silencedetect`, and waveform peaks are returned to the waveform UI. Browser mode uses Web Audio for duration/waveform/silence scanning. |
| **Video playback** | Footage preview uses Video.js controls, seeking, volume, playback rates, and picture-in-picture where available. |
| **Timeline render** | Desktop timeline clips render to MP4 under app data. Arena clips are captured frame-by-frame through `window.__seek(t)`; footage clips are trimmed, cropped/scaled, optional silence cuts are applied, and segments are concatenated in timeline order. Browser mode records a downloadable WebM draft via `canvas.captureStream()`/`MediaRecorder`. |
| **Progress/cancel** | Render progress streams over IPC. Cancel kills active FFmpeg processes and closes hidden capture windows. |
| **Persistence** | Zustand state mirrors to `%APPDATA%/cupric-ai/projects.json` in Electron; browser localStorage remains the web-preview fallback. |
| **Desktop hardening** | Single-instance lock, crash logs under `logs/`, renderer-crash reload screen, optional launch-on-login, GitHub updater check, and optional code signing docs. |

## Screens

| Screen | What it does |
|---|---|
| **Home** | Project grid with open / duplicate / delete and first Arena thumbnail as the project preview when available. |
| **Review Room** | Twilio-compatible live review area with real camera/mic preview, invite link copying, mute/camera toggles, and optional Twilio Video token connection. |
| **Brief** | Chat with Gemini; the scene rundown fills in field by field; lock the rundown to unlock the Arena Desk. |
| **Arena Desk** | Copy prompt → paste into Arena → vote manually → import the winning ZIP/HTML → preview/import thumbnail/render. |
| **Footage Desk** | Drop or browse raw video, scan for silences, view real waveform peaks, exclude proposed cuts, pick caption style/crop, apply edit. |
| **Studio** | The in-app video editor. Import video/images, stack text, backgrounds and UI Lab overlays on multiple tracks, trim by dragging clip edges, split at the playhead, restack by dragging between tracks, scrub, play with audio, and export a WebM recorded from the same renderer the preview uses. |
| **UI Lab** | All 190 interactions from lab.xevrion.dev running locally: search, filter by category, open one full-screen, or snapshot it straight onto the Studio timeline. |
| **Timeline** | Single-track assembly of Arena + footage assets with insert pickers, reorder, resize, seek ruler, and looping preview playhead. |
| **Render** | Pick aspect/fps/quality, start a real desktop render, see progress, cancel, retry, copy to Downloads, or reveal output. |
| **Library** | Searchable sample library of rundowns, Arena prompts, and brand presets. |

## Data locations

Electron uses `app.getPath('userData')`. On Windows this resolves to:

```text
%APPDATA%/cupric-ai/
```

Important files/folders:

- `settings.json` — local settings, including the Gemini key if saved.
- `projects.json` — persisted project state mirror.
- `projects/<projectId>/arena/<assetId>/` — imported Arena exports.
- `projects/<projectId>/footage/` — copied raw footage.
- `renders/<jobId>/` — MP4 outputs and temporary render work folders.
- `logs/` — crash and render/update logs.

## Live AI providers: Gemini + free OpenCode presets

The Ask AI settings panel supports Gemini and OpenCode/OpenAI-compatible chat
completion endpoints.

Free / no-cost options exposed in the UI:

- **Many OpenRouter free-tier presets** including Qwen, DeepSeek, Gemma, Llama,
  Mistral, Kimi, GLM, and MAI `:free` model IDs. These models are free-tier, but
  OpenRouter still requires a free API key.
- **OpenCode Desktop import** with **Load OpenCode**, which reads local
  OpenCode provider/model config and reuses keys from OpenCode/env inside the
  Electron main process without exposing the secret to the renderer.
- **Live free-model discovery** with **Load live list**, which calls the
  configured `/models` endpoint and filters free models automatically.
- **Local Ollama / LM Studio / Atomic Chat / llama.cpp** OpenAI-compatible
  endpoints. Ollama defaults to `http://localhost:11434/v1` with examples like
  `qwen2.5-coder:7b` or `llama3.2:3b`.
- **Gemini** through a saved key or `GEMINI_API_KEY`; the default model is
  `gemini-2.5-flash` and can be overridden with `GEMINI_MODEL` or the settings
  field. Pasted keys are tested immediately and the model list drops deprecated
  or unavailable models.

Keys are stored only in Electron `settings.json` or read from environment
variables (`OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `GEMINI_MODEL`). The renderer only sees provider/key presence,
not the secret.

## FFmpeg / FFprobe

Cupric AI uses `ffmpeg-static` and `ffprobe-static` as optional packaged media
engines; a normal clean `npm install` attempts to download the native binaries
without blocking the rest of the app if a corporate proxy/certificate blocks the
download. The desktop app also supports explicit paths for constrained
environments:

```bash
CUPRIC_FFMPEG_PATH=C:\path\to\ffmpeg.exe
CUPRIC_FFPROBE_PATH=C:\path\to\ffprobe.exe
```

If those variables are not set, Cupric AI checks the packaged static modules
and then falls back to `ffmpeg` / `ffprobe` on `PATH`.

## Windows signing and SmartScreen

Personal builds can remain unsigned. Windows SmartScreen may show an unsigned
app warning; choose **More info → Run anyway**.

For signed builds, set these environment variables before `npm run dist:win`:

```bash
CSC_LINK=path-or-base64-pfx
CSC_KEY_PASSWORD=your-certificate-password
```

## Auto-update

`electron-updater` is configured for GitHub Releases:

```json
{
  "provider": "github",
  "owner": "rangwalaaliasgar55-bot",
  "repo": "Cupric-Ai-"
}
```

The app checks for updates in packaged builds and exposes a manual **Check for
updates** action in the Ask Gemini settings area.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite web preview. |
| `npm run build` | Packs + typecheck + renderer check + production build to `dist/`. |
| `npm run typecheck` | TypeScript only. |
| `npm run packs:build` | Regenerate `resources/packs/*.json` from the in-app registries. |
| `npm run check:renderer` | Headless smoke test: every background, transition, animation and glass preset is rendered against a stub canvas and the voice grammar is asserted. |
| `npm run desktop` | Vite + Electron together for desktop development. |
| `npm run dist:win` | Build + package Windows NSIS and portable artifacts. |

## Project structure

```text
electron/            main.cjs desktop backend · preload.cjs safe IPC bridge
src/
  app-shell/         Sidebar · TopBar · AppLayout · AskPanel
  screens/           HomeProject · Brief · ArenaDesk · FootageDesk · Studio · Lab · Timeline · Render · Library
  screens/studio/    Preview canvas · multi-track timeline · inspector
  lab/               Vendored lab.xevrion.dev components (MIT) + shims + registry
  lib/studio/        doc (pure edit ops) · backgrounds · transitions · glass · media registry · renderer · exporter · handoff
  components/glass/  GlassSurface (backdrop-filter + SVG displacement) · GlassPanel/Button/Lens/Dock
  lib/glass.ts       One glass material: presets + displacement map, shared by DOM and canvas
  lib/packs.ts       Resource packs fetched from this repo, cached in IndexedDB for offline
  lib/voice.ts       Voice-command grammar (pure parser) + Web Speech listener
resources/packs/     Generated pack JSON served to the Library (glass, transitions, animations, backgrounds, effects, voice, components)
scripts/             build-packs.mjs · check-renderer.mjs
  components/        Shared design-system components
  state/             Zustand store with desktop-aware persistence
  lib/               Gemini, Arena, render wrappers with web fallbacks
  types/             Project data model
  styles.css         Design tokens — see DESIGN.md
build/icon.png       Windows app icon
```

## Design system

`DESIGN.md` is the source of truth for palette, type scale, radii, motion,
component states, accessibility rules, and finish-pass standards.

## Studio — making a video inside Cupric

1. Open a project, go to **Studio**.
2. **Import media** (video or images) — they land on track 1.
3. Add **Text** (nine animations, Hormozi / standard / minimal caption styles,
   optional lime highlight word), **Background** (17 presets incl. mesh and
   liquid gradients) and **Glass** clips on the tracks above.
4. Drag a clip to move it, drag it up or down to restack, drag its edges to
   trim, press <kbd>Space</kbd> to play, <kbd>⌘/Ctrl+B</kbd> to split at the
   playhead, <kbd>Delete</kbd> to remove.
5. Pick a transition per clip — ten of them, including `glass-wipe`,
   `liquid-dissolve` and `lens-sweep`, all drawn by the same canvas code that
   the export uses.
6. **Export WebM** records the composition in real time. On desktop,
   **Export MP4** sends that recording to FFmpeg in the main process
   (`studio:exportMp4`) and writes a real H.264 file — the browser build only
   offers WebM rather than renaming one.

### Voice commands

Press **Voice** in the Studio toolbar (Chromium only — the button is hidden
where the Web Speech API is missing). Say "play", "go to 12 seconds",
"forward five", "cut here", "add text hello world", "add glass lens",
"transition liquid dissolve", "zoom out", "export". The grammar is a pure
function in `src/lib/voice.ts` and is asserted by `npm run check:renderer`;
what was heard is always shown, including when nothing matched.

### Resource packs

The Library's top section lists packs that live **in this repository** and are
fetched over the internet from
`raw.githubusercontent.com/<repo>/<branch>/resources/packs`. Nothing is read
from your machine. **Download all** copies them into IndexedDB so the Library
keeps working offline; a same-origin `/resources/packs/...` copy is the last
fallback. Each item has one honest action — glass, backgrounds, transitions and
animations add themselves to the Studio, effects and voice phrases copy, lab
components open in the Lab.

### Hand-offs into the Studio

- **Footage Desk → Edit in Studio** loads the real file into the media registry
  and drops a video clip (desktop paths resolve through the main process).
- **Arena Desk → Send to Studio** adds the asset's captured frame as an overlay
  clip; the label says "(captured frame)" because the canvas cannot execute the
  Arena HTML.

Two deliberate honesties:

- **Preview and export share one renderer** (`src/lib/studio/renderer.ts`), so
  nothing looks different after you export.
- **Media handles cannot survive a reload** in a browser sandbox. Instead of
  pretending, a reloaded clip paints a "Relink" frame and the inspector offers
  the file picker. On desktop the original path is kept alongside it.

## Chat with free models (OpenCode / Ollama / LM Studio)

Chat is for talking about the edit — it never generates video.

- **Desktop**: keys stay in the Electron main process. "Load OpenCode" reads
  your installed OpenCode provider config.
- **Web (`npm run dev`)**: settings are saved in the browser and "Load
  OpenCode" probes `localhost:4096` (OpenCode), `11434` (Ollama), `1234`
  (LM Studio) and `8080` (llama.cpp), listing every model they expose. Free
  OpenRouter `:free` presets are included too.
- With nothing configured the panel answers from the deterministic local
  planner and says so — it never dresses a canned reply up as a live model.
