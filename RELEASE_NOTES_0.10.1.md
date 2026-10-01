# NewBrand 0.10.1 — blank Studio fix + "never white again" hardening

## The bug (0.10.0)

**Create New Project → Studio showed a blank white window** in the packaged
Windows app. Launching with `--enable-logging --v=1 --disable-gpu` logged:

```
Uncaught TypeError: Cannot assign to read only property 'newbrand' of object '#<Window>'
    at dist/assets/index-C3eb6nHN.js:977
```

**Root cause.** The preload exposes the desktop bridge with
`contextBridge.exposeInMainWorld('newbrand', bridge)`, which defines
`window.newbrand` as a **non-writable, non-configurable** property. On mount the
Studio published its scripting API with
`window.newbrand = { ...window.newbrand, studio: api }` (and
`delete window.newbrand.studio` on unmount). In the packaged app that assignment
threw inside a React effect. With no error boundary, React unmounted the whole
tree, leaving a white window. The web build has no bridge, so the bug never
showed there. `project:create` had already succeeded, which is why
`projects.json` held a valid `view: "studio"` project.

The rebuilt 0.10.0 bundle has the same hash (`index-C3eb6nHN.js`), and the new
boot check reproduces the exact error against it.

## Workaround for anyone still on 0.10.0

If restarting reopens the blank Studio: quit NewBrand, open `projects.json` in
the app data folder (`%APPDATA%\NewBrand\projects.json` on Windows) and change
`"view":"studio"` to `"view":"library"`. The app then boots to the Library.
Don't open the Studio again until you update to 0.10.1.

## Fix

- **Bridge is read-only everywhere.** The preload builds **one** deep-frozen
  bridge and exposes it as `newbrand` + `northframe` (the legacy alias, same
  object). The renderer only reads it via `getBridge()` / `getIpc()`.
- The Studio scripting API moved to its own global, **`window.__newbrandStudio`**,
  and cleanup deletes only that.
- Types: `Window.newbrand` / `Window.northframe` are `readonly … Readonly<Bridge>`,
  so any direct assignment is a compile error.

## Hardening

- **`npm run check:bridge`**: an ESLint `no-restricted-syntax` ban on assigning
  to, deleting from, or `defineProperty`-ing `newbrand` / `northframe` (inline
  disables are ignored). The rule is self-tested against the verbatim 0.10.0
  code and 13 other write forms. The check also runs a comment-stripped source
  grep, executes the preload against a mocked contextBridge, runs a tsc fixture
  where `window.newbrand = …` must fail to compile, and scans the built bundle.
  It is part of `npm run build`.
- **Error boundaries**: one per route (every screen, including Studio, Library,
  Render, Lab and Brief), one around the Ask panel and one around the whole app.
  Global `error` / `unhandledrejection` handlers show a dismissible card. A
  last-resort plain-DOM card appears if React itself is gone. Every card shows
  the project id and has **Copy error** and **Go to Library** buttons. Go to
  Library also saves `view: "library"`, so a restart doesn't boot back into the
  broken screen. To test the fallback in any build, set
  `sessionStorage['newbrand:debug:forceThrow'] = 'studio'` and reload.
- **File logging**: electron-log writes main + renderer lines to
  `userData/logs/newbrand.log`. Logged events: app start (flags, GPU state), the
  renderer console (so any `Uncaught …` lands in the file), preload errors,
  failed loads, `bridge:init`, `project:create`, `project:load` (with timings
  and repair warnings) and `studio:mount` (with timings). `--enable-logging`
  switches to verbose.
- **DevTools shortcut** (Ctrl+Shift+I / F12) works in dev and in prerelease
  builds (`-beta` / `-rc` / `-alpha`), or with `--newbrand-devtools` /
  `NEWBRAND_DEVTOOLS=1`. Stable builds log that it's disabled instead of doing
  nothing.
- **projects.json schema validation (zod) on every load.** zustand's `migrate`
  only runs on a version change. A same-version file with `brief: null` also
  blanked Library and Studio, and the boot check caught it. Now, when
  something's wrong, the app falls back and says so:
  - Unknown view → Home.
  - Unknown background → Lime Void.
  - Bad font → default font.
  - Unknown clip kind → the clip is kept but not drawn.
  - Zero tracks → one track.

  A sticky notice lists what was repaired. Unreadable JSON starts an empty
  workspace with a notice, and the damaged file is kept as
  `projects.corrupt-*.json` (it used to be overwritten by the next autosave
  when no snapshot existed).
- **GPU safety**: if the 2D canvas can't be created or the renderer throws, the
  Studio switches to a simplified DOM preview with a banner and a Retry button.
  Two GPU-process crashes in one session turn hardware acceleration off for the
  next launch. `check:boot` runs with `--disable-gpu`.
- **Empty state**: a Studio with `clips: []` still paints its background, with
  a drop hint over it. A missing background or font (including a failed
  Inter Variable load) shows a one-line notice and falls back to a plain colour
  or the system font.

## Verification gate

```
npm install && npm run typecheck && npm run check:renderer && npm run check:bridge && npm run check:boot
```

(`npm run verify` runs the last four.) `check:boot` visits all 12 views with
four saved-state fixtures (the exact bug-report project, no projects,
bad-shape, zero tracks), plus corrupt JSON and a fresh install. It also checks
that a restart with `view:"studio"` stays on the Studio, forces a throw in
Studio, Library, Render, Lab and Brief (a card must appear, and Go to Library
must recover), and forces a global error. It fails on any uncaught error, blank
screen, or unexpected fallback.

Modes: Electron (a real preload; two passes, `--disable-gpu` and GPU on), the
packaged exe via `NEWBRAND_BOOT_EXE` (the release workflow runs this before
publishing), or headless Chrome via `NEWBRAND_BOOT_CHROME` with a bridge defined
exactly as contextBridge defines it. If none of these is available, the check
fails. It never passes silently.

### Manual check

Fresh install → Create New Project → Studio is visible. Restart with
`view: "studio"` → still visible. Launch with `--enable-logging` → no
`TypeError` in the console or in `userData/logs/newbrand.log`.
