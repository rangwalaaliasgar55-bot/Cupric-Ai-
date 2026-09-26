# Cupric AI — Resources pack

On-disk resource bench for video generation, UI polish, and agent prompts.

These files are **uploaded into the app repo** so Electron / web builds can read them without hitting the network at runtime.

## Layout

```text
resources/
  README.md                 ← this file
  VENDOR.md                 ← sources, licenses, what was vendored vs referenced
  catalog.json              ← machine-readable index for Library + agents
  ui-lab/
    registry.json           ← full lab entry catalog (slugs, categories, keywords)
    patterns.md             ← interaction patterns absorbed into Cupric
  spectrum/
    index.json              ← Spectrum UI registry item names + categories (subset index)
    pipeline.md             ← how to pull blocks without dual-kitting chrome
  design-systems/
    pipeline.md             ← Open Props / Utopia / checklist / coss / ReUI order
    checklist.md            ← minimum app gate
  kdenlive/
    NOTES.md                ← GSoC widgets / effect ideas mapped to FFmpeg + Arena
  effects/
    *.html                  ← deterministic __seek(t) stage templates
  backgrounds/
    stage.css               ← copy-paste stage backgrounds
  avatars/
    README.md               ← avatar asset notes (CC0 Notionists remix upstream)
```

## Runtime use

| Consumer | Path |
|---|---|
| Library screen | effects + gradients already in `src/lib/*`; expand from `resources/catalog.json` |
| Arena prompts | `resources/effects/*.html` as structure references |
| Agents | `resources/ui-lab/registry.json`, `resources/spectrum/index.json` |
| Design edits | `resources/design-systems/*` + root `DESIGN.md` |

## Sync upstream (optional)

```bash
# ui-lab registry only (MIT)
curl -sL https://raw.githubusercontent.com/xevrion/ui-lab/main/src/lab/registry.ts -o /tmp/registry.ts

# Spectrum registry (large) — prefer index, not full dump in app chrome
curl -sL https://raw.githubusercontent.com/arihantcodes/spectrum-ui/main/registry.json -o resources/spectrum/registry.full.json
```

Do **not** import Spectrum/ui-lab components into `src/components` wholesale — restyle into Cupric tokens or keep under `resources/` as reference.
