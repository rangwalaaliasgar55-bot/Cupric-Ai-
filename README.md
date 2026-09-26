# Northframe Studio

A desktop creator tool for short-form video — from rough idea to exported cut:
**Brief → Arena battle → Footage auto-edit → Timeline → Render.**

This repository contains a **UI prototype** in which every async operation
(Gemini calls, Arena zip imports, footage analysis, MP4 rendering) is mocked
with realistic delays and canned responses. There is no backend and no network
use — everything runs locally and persists to `localStorage`. The same
components become the renderer of the real Electron app later: swap the three
mocks (`src/lib/gemini.ts`, `src/lib/arena.ts`, `src/lib/render.ts`) for real
implementations and nothing in the UI changes.

The Electron shell is configured for **Windows** (NSIS installer + portable
x64 build).

---

## Quick start

```bash
npm install
npm run dev        # web prototype at http://localhost:5173
```

### Run it as a Windows desktop app (dev)

```bash
npm run desktop
```

Starts Vite and an Electron window pointed at it (`ELECTRON_START_URL`).
First `npm install` on Windows downloads the Electron binary automatically.

### Build the Windows installer

On a Windows machine:

```bash
npm run dist:win
```

Outputs into `release/`:

- `Northframe Studio-Setup-0.1.0.exe` — NSIS installer (choose install dir)
- `Northframe Studio-0.1.0-x64-Portable.exe` — portable single-file exe

The app loads the built `dist/` over `file://` (Vite `base: './'`), so the
packaged app is fully offline — fonts included (`@fontsource`, no CDN).

---

## The seven screens

| Screen | What it does | Status |
|---|---|---|
| **Home** | Project grid — open / duplicate / delete (inline confirm), new project | ✔ full |
| **Brief** | Chat with a mocked Gemini co-pilot; the scene rundown fills in **field by field** in a syntax-highlighted JSON panel; suggestion chips; **Lock rundown** gates the Arena Desk | ✔ full |
| **Arena Desk** | Locked `arenaPrompt` card → copy → paste into arena.ai/code → vote → drop the winning `.zip`; import zone with progress; asset grid with status badges, mock preview modal, "Render to MP4" | ✔ full |
| **Footage Desk** | Drop raw video (mocked analyzing), deterministic **waveform + silence map** with excludable cuts, Hormozi/Standard/Minimal caption cards, 16:9 / 9:16 / 1:1 crop, Apply edit | ✔ full |
| **Timeline** | Single-track editor: drag to reorder, drag right edge to resize (floating duration label), `+` insert pickers, click-to-seek ruler, real-time looping playhead | ✔ full |
| **Render** | Aspect/fps/quality cards + presets (YouTube, Shorts, X), start render → 0–100 % progress over ~6 s, queue with Download / Reveal / Retry | ✔ full |
| **Library** | Searchable, filterable sample library (rundowns, Arena assets, brand presets) with a wired **"Use in current project"** | ✔ full |

Plus the shell: 64 px icon rail with gated navigation (Arena Desk is dimmed
until a rundown is locked), top bar with inline-editable project name and a
`saving…/all changes saved` indicator, an **Ask Gemini** slide-over (⌘K), and
bottom-right toasts that auto-dismiss after 4 s.

## What's mocked (and where to plug reality in)

| Mock | File | Real implementation (Electron/Tauri) |
|---|---|---|
| Gemini co-pilot | `src/lib/gemini.ts` → `fakeAskGemini`, `fakeGeminiChat` | Gemini API (Flash) with the same signature |
| Arena zip import | `src/lib/arena.ts` → `fakeImportArenaZip` | `dialog`/`fs` reads of the downloaded zip |
| Footage analysis | `src/lib/arena.ts` → `fakeUploadFootage` | Whisper/VAD silence scan + ffprobe duration |
| Render worker | `src/lib/render.ts` → `fakeStartRender` | Puppeteer `__seek(t)`-screenshot loop + ffmpeg, same progress-callback shape |
| Arena battle view | — | Desktop-shell webview aimed at arena.ai/code |

## Stack

React 18 · TypeScript · Vite · Tailwind CSS v4 · Zustand (+`persist` → localStorage) ·
Motion (`motion/react`, reduced-motion aware) · lucide-react · Inter Variable + JetBrains Mono Variable (self-hosted).

```
electron/            main.cjs (window, navigation guards) · preload.cjs (contextBridge)
src/
  app-shell/         Sidebar · TopBar · AppLayout · AskPanel
  screens/           HomeProject · Brief · ArenaDesk · FootageDesk · Timeline · Render · Library
  components/        Button · IconButton · Badge · Card · Kbd · Modal · Toasts ·
                     EmptyState · ProgressBar · Segmented · NoProject
  state/             useProjectStore.ts (Zustand + persist, single source of truth)
  lib/               gemini.ts · arena.ts · render.ts (mocks) · utils.ts · seed.ts
  types/             project.ts (the full data model)
  styles.css         design tokens (@theme) — see DESIGN.md
build/icon.png       Windows app icon (electron-builder converts to .ico)
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server (the web prototype / Arena-preview renderer) |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run desktop` | Vite + Electron together (dev) |
| `npm run dist:win` | Build + package for Windows (NSIS + portable) |

## Design system

`DESIGN.md` is the single source of truth: palette, 12/13/14/16/20/28 type
scale, radii, motion tokens (one ease, one spring, 150–200 ms), component
states, and the a11y/finish rules every screen follows (focus rings via
box-shadow, press-scale 0.96, 44 px targets, `tabular-nums` on timecode,
inline-copy checkmarks, one accent per view, `prefers-reduced-motion`
honored everywhere).
