# NewBrand

NewBrand is a desktop studio for planning, editing, and exporting short-form video. It combines a multi-track editor, local media tooling, configurable AI providers, and a library of reusable motion resources.

## Features

- **Project workflow:** brief a video, organize source media, and assemble a locked rundown.
- **Studio editor:** work with video, images, text, backgrounds, overlays, transitions, and multi-track timelines.
- **Desktop rendering:** use Electron, FFmpeg, and FFprobe for local MP4 output, waveform analysis, silence detection, and render verification.
- **Flexible AI:** connect Gemini, OpenCode-compatible providers, Ollama, LM Studio, or use the deterministic offline template.
- **Resource library:** browse locally available motion, typography, background, effect, and storyboard resources.
- **Safe desktop bridge:** keep filesystem, provider credentials, and media-process work in Electron's main process.

## Quick start

```bash
npm install
npm run dev
```

The web preview is available at `http://localhost:5173`. For the full desktop workflow, including local filesystem access and MP4 rendering, run:

```bash
npm run desktop
```

## Build and test

```bash
npm run build
npm test
```

Create Windows installers on Windows:

```bash
npm run dist:win
```

Build artifacts are written to `release/`:

- `NewBrand-Setup-0.17.0.exe` — NSIS installer
- `NewBrand-0.17.0-x64-Portable.exe` — portable build

**Current version:** `0.17.0`

## Configuration

The desktop application stores its data under Electron's `userData` directory. On Windows this is typically:

```text
%APPDATA%/newbrand/
```

Useful environment variables include:

- `NEWBRAND_FFMPEG_PATH` and `NEWBRAND_FFPROBE_PATH` for explicitly configured media tools.
- `NEWBRAND_STOCK_PROXY_URL` for an optional stock-media proxy.
- `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, and `OPENCODE_API_KEY` for supported provider connections.

## Project scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run desktop` | Start Vite and Electron together. |
| `npm run typecheck` | Run TypeScript checks. |
| `npm test` | Run the Vitest suite. |
| `npm run build` | Generate resource packs, validate the application, and produce a production bundle. |
| `npm run dist:win` | Build and package Windows installers. |

## Releases

The updater is configured against this repository's GitHub releases. Published release assets must use the NewBrand artifact names above so the update metadata and installers stay in sync.
