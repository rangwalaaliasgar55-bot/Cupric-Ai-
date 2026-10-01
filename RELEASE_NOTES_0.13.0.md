# NewBrand 0.13.0 — release build unblocked

Three separate defects stopped the Windows release build. All three were
invisible locally and only appeared on `windows-latest`, which is why
`v0.12.0` and two earlier `v0.13.0` attempts failed with a bare
`Process completed with exit code 1` and no published release.

## 1. Curated packs went stale on a version bump

```
AssertionError: ui-libraries pack version must match the app
'0.11.0' !== '0.12.0'
```

`scripts/build-packs.mjs` generates `resources/packs/*.json` from the
registries the app itself uses, stamping `version: VERSION` from
`package.json`. Three packs are **hand-maintained** and carried through
verbatim instead of generated:

- `ui-libraries.json` (Mantine, Pixel Perfect UI, Sora UI)
- `essentials.json` (libraries, fonts, icons, media)
- `motion-kit.json` (fonts, Javis.jl concepts)

Their `version` was never re-stamped, so the 0.11.0 → 0.12.0 bump moved the
21 generated packs but left these at 0.11.0. `check-resources.mjs` asserts
every pack matches the app version — and stopped at the first stale pack,
hiding the other two.

**Fix:** `readCuratedPack()` re-stamps the carried-through copy from
`package.json` on every run. Self-healing: a curated pack can no longer go
stale, so no future bump can break the release this way. Content, ids,
licensing, attribution and item counts are untouched.

## 2. `new URL(import.meta.url).pathname` is not a filesystem path on Windows

`scripts/libraries-review.mjs` computed its root as:

```js
path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
```

On Linux and macOS the URL pathname is a plain path and this works. On
Windows `new URL('file:///C:/a/b/scripts/x.mjs').pathname` is
`/C:/a/b/scripts/x.mjs`, so:

```
BROKEN root : "\C:\a\b"     <- wrong drive, every read throws ENOENT
FIXED  root : "C:\a\b"     <- correct
```

The release build runs on `windows-latest`, so
`check-libraries-dev.mjs` failed there and only there. `build-packs.mjs`
already documented this exact trap.

**Fix:** `fileURLToPath(import.meta.url)`. Applied to all three scripts that
had the pattern — `libraries-review.mjs` (in the release chain) plus
`audit-uselayouts.mjs` and `build-opus-index.mjs` (both in `packs:build`,
which would have failed on a Windows checkout). Every other
`import.meta.url` use in `scripts/` is `createRequire()` or a `new URL(relative,
import.meta.url)` passed straight to `readFile` — already safe.

## 3. The TTS check stood up POSIX-only fake binaries

`scripts/check-tts-languages.mjs` creates fake `espeak-ng` and `piper`
executables and puts them on PATH:

```js
writeFileSync(p, `#!${process.execPath}\n...`); chmodSync(p, 0o755)
PATH: `${dir}:${process.env.PATH}`
```

A shebang file with the exec bit is not executable on Windows, and `':'` is
not the Windows PATH separator (`path.delimiter` is `';'`), so the fakes
were never found.

**Fix:** follow the guard `check-local-voice.mjs` already uses for the
Whisper fake. Everything platform-independent still runs on Windows — Piper
discovery, rate clamping, language routing, the SAPI voice-by-culture
command, and the no-English-fallback blocker. Only the five assertions that
must spawn a fake binary are behind the guard, and the console line says
plainly when the spawn was skipped so a Windows run never looks like full
coverage. PATH now uses `path.delimiter`.

## Why it was so hard to see

`npm run build` is a **single 65-command `&&` chain**, so a failure anywhere
reported only an exit code. The log ended with 60+ passing checks and no
indication of the one that broke.

`scripts/run-checks.mjs` now runs that same chain — read from `package.json`,
so there is still one source of truth — one step at a time, and reports per
step: the name, how long it took, a clear `BUILD FAILED: <step>` line, and a
`::error` workflow command that surfaces the failing step on the run page
without opening the log. That annotation is what named defects 2 and 3 in one
run each. Local runs are unaffected; `--continue` collects every failure.

The workflow now runs checks and packaging as separate steps, so the log
distinguishes "a check failed" from "electron-builder failed".

## Verification

The Windows run is green end to end — all 12 steps:

```
✓ Run release checks and build the app     (65/65 checks)
✓ Package Windows installers
✓ Boot check packaged app (every view, zero Uncaught)
✓ Verify installer artifacts
✓ Publish GitHub release assets
```

## Download

- `NewBrand-Setup-0.13.0.exe` — NSIS installer (224 MB)
- `NewBrand-0.13.0-x64-Portable.exe` — portable executable (223 MB)
- `NewBrand-Setup-0.13.0.exe.blockmap`, `latest.yml` — for the in-app updater

0.12.0 was never published; move straight to 0.13.0.
