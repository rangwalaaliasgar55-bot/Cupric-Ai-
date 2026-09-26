# NEXT_SESSION.md — Cupric AI implementation status

## Current status (v0.3.0)

Shipped earlier (0.2.x): Gemini/OpenCode IPC, key storage, Arena ZIP/HTML import,
footage analysis, timeline MP4 render, persistence, updater foundation, Windows
packaging, effects + gradient packs, design tokens.

### New in 0.3.0 — make the video here

- **Studio** (`src/screens/Studio.tsx`, `src/lib/studio/*`) — a CapCut-style
  editor inside the app: multi-track timeline, drag to move/restack, edge trim,
  split at playhead (⌘/Ctrl+B), duplicate, delete, snapping, zoom, scrub,
  real playback with audio, and a WebM export recorded from the same renderer
  the preview uses.
- Clip kinds: video, image, text (6 animations + Hormozi / standard / minimal
  caption styles + lime highlight word), background, and UI Lab overlays.
- 10 canvas-painted backgrounds shared with the Library (`gradients.ts` is now
  a view over `studio/backgrounds.ts`, not a duplicate list).
- **UI Lab** (`src/screens/Lab.tsx`, `src/lab/*`) — all 190 components from
  lab.xevrion.dev vendored and running locally, searchable by category, with
  "Send to Studio" to rasterise one onto the timeline.
- **Chat on free models** — `src/lib/opencode.ts` adds a browser-side
  OpenAI-compatible client (OpenCode 4096 / Ollama 11434 / LM Studio 1234 /
  llama.cpp 8080 auto-probe, OpenRouter `:free`), and the Ask panel now saves
  settings in the web build instead of silently doing nothing.
- React upgraded to 19 (the vendored lab uses `inert`, `<style href>` and
  React 19 ref semantics).

### Bugs fixed in this pass

| Bug | Fix |
|---|---|
| App did not typecheck (`askGeminiChat` returned `unknown` into `ChatMsg`) | typed IPC boundary + `satisfies ChatMsg` |
| Autonomous run in the browser marked every step **done** without doing anything | reports "desktop only" and points at Studio |
| `desktopAwareStorage` and 6 screens read `window.northframe` only | everything goes through `getBridge()` / `getIpc()` |
| Footage upload invented a file name (`raw-clip-482.mp4`) | neutral label until the picker returns the real name |
| Local planner faked 0.7–1.5s of "thinking" latency | removed |
| `gradients.ts` and the Studio kept two drifting background lists | one source of truth |
| `render:copyToDownloads` toast claimed success on failure and read a missing field | reports the real error/path |
| `nextFreeStart` returned an occupied slot (found during smoke tests) | gap must actually fit the clip |
| `resources/catalog.json` pointed at a non-existent `ui-lab/registry.json` | generated from the vendored registry (190/190) |

## Open work

- [ ] Studio → desktop FFmpeg export (MP4) instead of WebM when Electron is present
- [ ] Bring Arena assets / analysed footage into Studio clips in one click
- [ ] Autonomous queue → full rundown / import / render orchestration
- [ ] Electron main: standardize env overrides to `CUPRIC_FFMPEG_PATH` / `CUPRIC_FFPROBE_PATH`
- [ ] Clean Windows 11 installer smoke test outside the sandbox
- [ ] Per-clip audio track UI (volume automation, music bed)

## Human-in-the-loop Arena workflow

Unchanged: generate prompt → user pastes into arena.ai/code → vote → import winner.

## Media binaries

If `ffmpeg-static` fails to download, set:

```bash
CUPRIC_FFMPEG_PATH=C:\path\to\ffmpeg.exe
CUPRIC_FFPROBE_PATH=C:\path\to\ffprobe.exe
```
