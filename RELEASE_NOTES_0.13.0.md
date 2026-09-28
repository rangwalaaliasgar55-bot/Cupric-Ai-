# Cupric AI 0.13.0 — release build unblocked

## What was broken

The `v0.12.0` tag was pushed and the release workflow started, but
**the build failed and no release was ever published** — so there is no
`Cupric-AI-Setup-0.12.0.exe` to download.

The failure was in the `Build application and Windows packages` step:

```
resource check passed ...   ✗
AssertionError: ui-libraries pack version must match the app
'0.11.0' !== '0.12.0'
```

## Root cause

`scripts/build-packs.mjs` generates `resources/packs/*.json` from the
registries the app itself uses, so a pack can never describe something the
code cannot render. Every generated pack gets `version: VERSION` from
`package.json`.

Three packs are **hand-maintained** and are carried through verbatim rather
than generated:

- `ui-libraries.json` (Mantine, Pixel Perfect UI, Sora UI)
- `essentials.json` (libraries, fonts, icons, media)
- `motion-kit.json` (fonts, Javis.jl concepts)

Because they were read straight off disk and pushed as-is, their `version`
field was **never re-stamped**. When 0.11.0 → 0.12.0 was bumped, the 21
generated packs moved to 0.12.0 but these three stayed at 0.11.0.
`scripts/check-resources.mjs` asserts every pack matches the app version, so
the mismatch failed the release build — with a one-word clue
(`ui-libraries`) that hid the other two.

## The fix

`build-packs.mjs` now re-stamps the carried-through copy on every run:

```js
async function readCuratedPack(id) {
  const curated = JSON.parse(await readFile(path.join(outDir, `${id}.json`), 'utf8'))
  if (curated.version !== VERSION) {
    console.log(`Re-stamped curated pack ${id}: ${curated.version} -> ${VERSION}`)
  }
  return { ...curated, version: VERSION }
}
```

This is deliberately **self-healing**: a curated pack is now stamped from
`package.json` on every build, so no future version bump can leave one stale
and break the release again. The content, ids, licensing, attribution and
item counts of all three packs are untouched — only the version stamp moves.

```
Re-stamped curated pack ui-libraries: 0.12.0 -> 0.13.0
Re-stamped curated pack essentials: 0.12.0 -> 0.13.0
Re-stamped curated pack motion-kit: 0.12.0 -> 0.13.0
Wrote 24 packs (4095 items) to resources/packs
```

## Verification

The full release chain (`npm run build`, 65 steps — 62 feature checks,
TypeScript, ESLint bridge rule, pack generation and icon audit, then
`vite build`) passes end to end, and the three packs are all at 0.13.0.

## Download

- `Cupric-AI-Setup-0.13.0.exe` — NSIS installer
- `Cupric-AI-0.13.0-x64-Portable.exe` — portable executable

0.12.0 was never published; move straight to 0.13.0.
