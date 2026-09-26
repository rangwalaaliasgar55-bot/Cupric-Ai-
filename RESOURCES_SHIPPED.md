# Resources shipped (v0.2.4)

## In repo now

```text
resources/
  README.md
  VENDOR.md
  catalog.json
  ui-lab/
    patterns.md
    registry.compact.json   ← 40 high-value lab demos offline
  spectrum/
    index.json
    pipeline.md
  design-systems/
    pipeline.md
    checklist.md
  kdenlive/
    NOTES.md
  effects/
    logo-sting.html         ← __seek(t) templates
    quote-card.html
  backgrounds/
    stage.css
  avatars/README.md
scripts/sync-resources.mjs  ← pulls FULL upstream catalogs + avatars
public/resources/README.md
```

## Pull the heavy catalogs (run once after clone)

```bash
npm run resources:sync
```

That writes:

- `resources/ui-lab/registry.json` — **190** ui-lab entries
- `resources/spectrum/registry.full.json` — full Spectrum registry (~200KB)
- `public/resources/avatars/{ava,ben,cara,dev,fay}.svg`

Verified in this environment: 190 lab entries + Spectrum registry + 5 avatars download cleanly.

## Why not embed Adobe React Spectrum / Kdenlive trees

- React Spectrum = multi-MB monorepo + different visual system
- Kdenlive = GPL C++/Qt native code

Both are mapped in `resources/VENDOR.md` and `resources/kdenlive/NOTES.md`. Patterns land in tokens/effects; catalogs land offline via sync.

## App integration

- Library already exposes Effects + Backgrounds from `src/lib/effects.ts` + `gradients.ts`
- Arena HTML templates under `resources/effects/` for local generation
- Electron package includes `resources/**/*` and `public/resources/**/*`
