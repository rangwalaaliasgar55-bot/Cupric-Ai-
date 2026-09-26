# DESIGN.md — Cupric AI system

One file, one look. If a screen needs a color, font, radius, duration or
spacing value that isn't here, the answer is **no** — extend this file first.

Tokens live in `src/styles.css` under `@theme` (Tailwind v4). Components never
use raw hex or arbitrary magic values.

---

## 1. Tokens

### Palette (dark first)

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#0B0B10` | app background |
| `--color-panel` | `#15151B` | cards, sidebar, top bar |
| `--color-panel-alt` | `#1C1C24` | inputs, hover fills, segmented tracks |
| `--color-line` | `rgb(255 255 255 / 0.08)` | hairline borders (elevation is flat — borders, not shadows) |
| `--color-text` | `#F4F1EA` | primary text (warm white) |
| `--color-muted` | `#9A9AA5` | secondary text |
| `--color-accent` | `#C8F542` (lime) | primary buttons, active nav, progress, arena clips |
| `--color-accent-ink` | `#141805` | text/icons on lime surfaces |
| `--color-accent-text` | lime in dark, `#5C7A0A` in light | lime *as text* (contrast-safe in both themes) |
| `--color-info` | `#4FB6E8` (blue) | informational badges, footage clips, links |
| `--color-danger` | `#E24B4A` | destructive actions, silence-cut markers, errors |

Light mode (`[data-theme="light"]`) swaps surfaces/text only; the brand lime
stays on buttons. One accent per view — lime leads, blue informs, red warns.

### Type

- Sans: **Inter Variable** (self-hosted via `@fontsource-variable/inter`); Mono: **JetBrains Mono Variable**.
- Scale: **12 / 13 / 14 / 16 / 20 / 28 px** (`text-xs → text-xl`). Never below 12 px — including ruler ticks and kbd chips.
- Mono + `tabular-nums` on anything numeric that updates in place: durations, timecode, percentages, prompt sizes.

### Radius

- 12 px (`rounded-xl`) cards/panels · 8 px (`rounded-lg`) buttons/inputs · pill (`rounded-full`) badges.
- Concentric where nested: thumb inside card uses `rounded-xl` flush or `rounded-lg` with padding.

### Spacing

4 / 8 / 12 / 16 / 24 / 32 (`p-1 … p-8` halves). Screen gutters: 24 px, content max-width 1152 px (`max-w-6xl`) except full-bleed surfaces (Timeline).

### Motion — one language

- Everyday ease: `cubic-bezier(0.22, 1, 0.36, 1)`, 150–200 ms.
- The one spring: `cubic-bezier(0.34, 1.56, 0.64, 1)` — used only on the six *moments*:
  1. sidebar active-indicator glide (layoutId),
  2. toast enter/exit,
  3. modal enter (from **scale 0.96**, never 0),
  4. rundown field fill flash (Brief),
  5. Ask-panel slide,
  6. button press (`active:scale-[0.96]`, CSS).
- Playhead/render progress run on linear/ease-out — springs don't animate data.
- Every animation is skipped under `prefers-reduced-motion` (`MotionConfig reducedMotion="user"` + media-gated CSS keyframes).

---

## 2. Component inventory & states

Buttons (`Button.tsx`): `primary` lime / `outline` hairline / `ghost` / `danger`. Every
interactive element has hover, visible focus ring, and press-scale 0.96.
Icon-only buttons go through `IconButton` (enforces `aria-label`).

Every data surface defines: **default / hover / focus-visible / disabled / empty /
loading(skeleton or progress) / error**. Disabled buttons explain themselves with
helper text below (never tooltips) — e.g. Render's "Add at least one clip…" hint.

Shared: `Badge` (status pills), `Card`, `Kbd`, `Modal` (Esc + backdrop close,
focus in/out), `Toasts` (bottom-right, 4 s auto-dismiss), `EmptyState`
(**exactly one action**), `ProgressBar`, `Segmented`, `NoProject`.

## 3. Finish rules (per screen, last pass)

- Labels/inputs: text inputs live in a `<form>` (Enter submits); composer also accepts ⌘↵.
- Hover styles only under `@media (hover: hover)` (Tailwind v4 default).
- Copy feedback is an **inline check**, not a toast (Arena prompt).
- Press scale ~0.96; dialogs enter at 0.96 → 1; nothing scales to 0.8.
- Focus ring via box-shadow double ring, never `outline`.
- `::selection` is lime.
- Aspect-ratio boxes for thumbnails/waveform/stage — no layout jump.
- Decorative orbs in the preview stage have no pointer interaction (backdrop layer).
- Timecode, percentages, durations: `font-mono tabular-nums`.
- Skeletons/progress match real layout (import/analyze use the same drop-zone box).

## 4. Deliberate omissions (pipeline notes)

- **No page backgrounds** (bg.ibelick-style): this is app chrome — flat surface tokens only; backgrounds belong on marketing pages.
- **No fluid Utopia scale**: fixed desktop viewport (Electron, min 1120×720) — a fluid type scale would add breakpoint soup for zero benefit. The 6-step fixed scale is the Utopia output at its 1240 px midpoint.
- **One kit**: all primitives are local (`src/components/ui`-equivalent). No second component library — no mixed visual languages.
- **Icons**: lucide only, 18/16/13 px rhythm, stroke weight consistent. The logo mark (`src/assets/logo.svg`) is the single custom glyph.

## 5. Extending

1. Add/extend tokens here → `@theme` in `styles.css`.
2. New component → `src/components/`, states included.
3. New screen → `src/screens/`, one exported root, register in `AppLayout` + `Sidebar` `NAV`.
4. Anything async → a mock in `src/lib/` first, same signature as the future real call.
