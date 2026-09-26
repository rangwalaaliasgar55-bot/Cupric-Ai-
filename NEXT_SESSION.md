# NEXT_SESSION.md — Cupric AI desktop implementation status

## Current status (v0.2.3)

Implemented previously:

- Real Gemini/OpenCode IPC, key storage, Arena ZIP/HTML import, footage analysis,
  timeline MP4 render, persistence, updater foundation, Windows packaging.

Shipped in 0.2.3:

- Unified bridge (`src/lib/bridge.ts`) — `cupric` preferred, `northframe` alias
- Motion token module (`src/lib/motion.ts`)
- Effects pack + gradient presets for local / Arena video generation
- Library expanded with Effects + Backgrounds (copyable cues/CSS)
- Local planner injects effect cues into Arena prompts by flavor
- Design tokens: spacing, radius, shadow scales; stage CSS utilities
- DESIGN.md + UPGRADE_0.2.3.md

## Open work

- [ ] Autonomous queue → full rundown / import / render orchestration
- [ ] Electron main: standardize env overrides to `CUPRIC_FFMPEG_PATH` / `CUPRIC_FFPROBE_PATH` (accept legacy aliases)
- [ ] Clean Windows 11 installer smoke test outside sandbox
- [ ] Optional component polish from Spectrum empty-states only if a screen is thin

## Human-in-the-loop Arena workflow

Unchanged: generate prompt → user pastes into arena.ai/code → vote → import winner.

## Media binaries

If `ffmpeg-static` fails to download, set:

```bash
CUPRIC_FFMPEG_PATH=C:\path\to\ffmpeg.exe
CUPRIC_FFPROBE_PATH=C:\path\to\ffprobe.exe
```
