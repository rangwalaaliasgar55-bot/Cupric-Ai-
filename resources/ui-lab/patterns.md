# ui-lab patterns absorbed into Cupric

Source: https://lab.xevrion.dev / https://github.com/xevrion/ui-lab (MIT)

## Already mirrored in app chrome

| Lab idea | Cupric location |
|---|---|
| Press scale ~0.96 | `Button`, DESIGN.md |
| Skeleton matches real layout | Footage / import drop zones |
| Toast / feedback timing | `Toasts.tsx` |
| Reduced motion | `MotionConfig reducedMotion="user"` |
| Segmented / sliding indicator | `Segmented`, sidebar `layoutId` |
| Copy → inline confirm | Arena Desk + Library effect copy |
| Focus ring settle | `styles.css` `:focus-visible` |

## High-value lab demos for video UI (reference only)

- `skeleton-loader` — hold layout while analyzing footage
- `copy-button` — Arena prompt copy
- `hold-to-delete` — destructive timeline actions
- `toast-stack` — render queue feedback
- `sparkline` / `odometer` — stats on Render / Home
- `scrub-input` — timeline numeric scrub
- `sliding-tabs` — Brief / Arena tabs
- `file-dropzone` — Footage Desk

Full slug list: `resources/ui-lab/registry.json`.
