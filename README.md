# Cupric AI

Cupric AI is a desktop creator tool for short-form video — from rough
idea to exported cut:

**Brief → Arena battle → Footage auto-edit → Timeline → Render.**

The original prototype UI is preserved, but the Electron desktop build now wires
real functionality behind the same stable renderer signatures in
`src/lib/gemini.ts`, `src/lib/arena.ts`, and `src/lib/render.ts`.

The Arena workflow intentionally stays human-in-the-loop: Cupric AI generates
the prompt, you paste it into `arena.ai/code`, vote in Arena yourself, download
the winning export, then import that winner back into Cupric AI.

---

## Quick start

```bash
npm install
npm run dev        # web preview at http://localhost:5173
```

The web preview keeps local fallbacks for operations that require desktop
filesystem/media access. To use the real filesystem, Gemini key storage,
footage analysis, and rendering pipeline, run Electron:

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

- `Cupric AI-Setup-0.2.1.exe` — NSIS installer.
- `Cupric AI-0.2.1-x64-Portable.exe` — portable executable.

The packaged app loads the built `dist/` over `file://` and self-hosts fonts, so
it can run offline after installation. Gemini requires either a saved key or a
`GEMINI_API_KEY` environment variable.

---

## Desktop features implemented

| Area | Desktop behavior |
|---|---|
| **Gemini** | API key is stored in Electron `settings.json` or read from `GEMINI_API_KEY`; the renderer only receives key presence. Brief and Ask Gemini call `gemini-2.0-flash` and fall back locally if the live call fails. |
| **Arena import** | ZIP/HTML is imported into project app data, extracted safely, checked for `window.__seek(t)`, loaded in a hidden BrowserWindow, and captured as a PNG thumbnail. |
| **Arena preview** | Imported Arena HTML previews in a sandboxed iframe through an IPC-approved `file://` path under the project data folder. |
| **Footage analysis** | Video is copied into project app data, duration is read by FFprobe, silences are detected with FFmpeg `silencedetect`, and waveform peaks are returned to the existing waveform UI. |
| **Timeline render** | Timeline clips render to MP4 under app data. Arena clips are captured frame-by-frame through `window.__seek(t)`; footage clips are trimmed, cropped/scaled, optional silence cuts are applied, and segments are concatenated in timeline order. |
| **Progress/cancel** | Render progress streams over IPC. Cancel kills active FFmpeg processes and closes hidden capture windows. |
| **Persistence** | Zustand state mirrors to `%APPDATA%/cupric-ai/projects.json` in Electron; browser localStorage remains the web-preview fallback. |
| **Desktop hardening** | Single-instance lock, crash logs under `logs/`, renderer-crash reload screen, optional launch-on-login, GitHub updater check, and optional code signing docs. |

## Screens

| Screen | What it does |
|---|---|
| **Home** | Project grid with open / duplicate / delete and first Arena thumbnail as the project preview when available. |
| **Brief** | Chat with Gemini; the scene rundown fills in field by field; lock the rundown to unlock the Arena Desk. |
| **Arena Desk** | Copy prompt → paste into Arena → vote manually → import the winning ZIP/HTML → preview/import thumbnail/render. |
| **Footage Desk** | Drop or browse raw video, scan for silences, view real waveform peaks, exclude proposed cuts, pick caption style/crop, apply edit. |
| **Timeline** | Single-track editor with insert pickers, reorder, resize, seek ruler, and looping preview playhead. |
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

## Gemini key

Set the key in the Ask Gemini settings panel or set `GEMINI_API_KEY` before
launching the desktop app. The key is never sent to the renderer and is never
logged; renderer code only sees `hasKey: true/false`.

## FFmpeg / FFprobe

Cupric AI depends on `ffmpeg-static` and `ffprobe-static`; a normal clean
`npm install` downloads the native binaries. The desktop app also supports
explicit paths for constrained environments:

```bash
NORTHFRAME_FFMPEG_PATH=C:\path\to\ffmpeg.exe
NORTHFRAME_FFPROBE_PATH=C:\path\to\ffprobe.exe
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
| `npm run build` | Typecheck + production renderer build to `dist/`. |
| `npm run typecheck` | TypeScript only. |
| `npm run desktop` | Vite + Electron together for desktop development. |
| `npm run dist:win` | Build + package Windows NSIS and portable artifacts. |

## Project structure

```text
electron/            main.cjs desktop backend · preload.cjs safe IPC bridge
src/
  app-shell/         Sidebar · TopBar · AppLayout · AskPanel
  screens/           HomeProject · Brief · ArenaDesk · FootageDesk · Timeline · Render · Library
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
