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

Canvas-drawn pieces (device mockups 2.15, before/after labels 2.21, scopes, the
curve editor) cannot read CSS variables in the export path, so they use the token
*values* literally: body `--color-bg`, browser chrome/laptop base `--color-panel-alt`
/ `--color-panel`, traffic lights `--color-danger` · `--color-muted` · `--color-accent`,
dividers/labels `--color-text`, curve handles/scope blue `--color-info`. No new colours.

### Type

- UI sans: **Inter Variable**; Mono: **JetBrains Mono Variable**.
- Studio title families: **Inter Variable**, **Manrope Variable**, **DM Sans Variable**, **Space Grotesk Variable**, **Playfair Display Variable**, and **JetBrains Mono Variable**. Sans families cover neutral UI, editorial, geometric tech and compact social work; Playfair is reserved for display copy. All are bundled locally through Fontsource so preview/export never depend on a network font.
- Scale: **12 / 13 / 14 / 16 / 20 / 28 px** (`text-xs → text-xl`). Never below 12 px — including ruler ticks and kbd chips.
- Mono + `tabular-nums` on anything numeric that updates in place: durations, timecode, percentages, prompt sizes.

### Radius & spacing

- Radius: `--radius-1…4` (4 / 8 / 12 / 16 px). Cards `rounded-xl` (12), buttons/inputs `rounded-lg` (8), badges pill.
- Spacing: `--spacing-1…8` (4→32 px). Screen gutters 24 px; content max-width 1152 px except full-bleed Timeline.

### Motion — one language (`src/lib/motion.ts`)

- Everyday ease: `cubic-bezier(0.22, 1, 0.36, 1)`, 150–200 ms (`EASE_SOFT`).
- The one spring: `cubic-bezier(0.34, 1.56, 0.64, 1)` — only on the six *moments*:
  1. sidebar active-indicator glide (layoutId),
  2. toast enter/exit,
  3. modal enter (from **scale 0.96**, never 0),
  4. rundown field fill flash (Brief),
  5. Ask-panel slide,
  6. button press (`active:scale-[0.96]`, CSS).
- Playhead/render progress: linear/ease-out — springs don't animate data.
- Every animation is skipped under `prefers-reduced-motion`.

### Effects & stage backgrounds

- Local pack: `src/lib/effects.ts` + `src/lib/gradients.ts`.
- Stage backgrounds (grid, dots, lime haze) are for **preview / Arena / marketing only**.
- App chrome stays flat surface tokens — no stacked page backgrounds.

### Studio (in-app editor)

The Studio is Cupric's CapCut-style editor: stacked tracks of video / image /
text / background / overlay clips over a painted background.

- **One renderer**: `src/lib/studio/renderer.ts#drawStudioFrame` draws the
  preview *and* every exported frame. There is no "preview only" effect.
- **Backgrounds** (`src/lib/studio/backgrounds.ts`) ship twice — as CSS for the
  DOM/Arena/Library, and as a canvas `paint()` so the export matches the
  preview exactly. `src/lib/gradients.ts` is a view over this list, never a
  second list.
- **Export** (`src/lib/studio/export.ts`) records in real time through
  MediaRecorder so duration and audio stay correct; frame-stepping is
  deliberately not used because MediaRecorder timestamps by wall clock.
- **Media handles are runtime-only.** The store keeps `mediaId`, file name,
  poster and source duration; object URLs never persist. After a reload the
  clip paints a "Relink" frame and the inspector offers the file picker — it
  never pretends the media is still there.
- Motion inside a clip is a pure function of clip progress, so scrubbing to a
  time always shows the same frame.

### Vendored UI Lab

`src/lab/` holds the 190 components from lab.xevrion.dev (MIT). They keep their
own neutral palette through `--lab-*` tokens mapped in `@theme inline`, scoped
to `.lab-canvas`, so the lab never becomes a second design language in Cupric
chrome. `muted` and `danger` deliberately fall through to Cupric tokens.
Next.js APIs are shimmed in `src/lab/shims/` (no network fonts, no optimizer).

---

## 2. Component inventory & states

Buttons (`Button.tsx`): `primary` lime / `outline` hairline / `ghost` / `danger`. Every
interactive element has hover, visible focus ring, and press-scale 0.96.
Icon-only buttons go through `IconButton` (enforces `aria-label`).

Every data surface defines: **default / hover / focus-visible / disabled / empty /
loading(skeleton or progress) / error**. Disabled buttons explain themselves with
helper text below (never tooltips).

Shared: `Badge`, `Card`, `Kbd`, `Modal`, `Toasts`, `EmptyState` (**exactly one action**),
`ProgressBar`, `Segmented`, `NoProject`.

Bridge: `src/lib/bridge.ts` — prefer `window.cupric`, legacy alias `window.northframe`.

---

## 3. Finish rules (per screen, last pass)

- Labels/inputs: text inputs live in a `<form>` (Enter submits); composer also accepts ⌘↵.
- Hover styles only under `@media (hover: hover)`.
- Copy feedback is an **inline check**, not a toast where possible (Arena prompt).
- Press scale ~0.96; dialogs enter at 0.96 → 1.
- Focus ring via box-shadow double ring, never `outline`.
- `::selection` is lime.
- Aspect-ratio boxes for thumbnails/waveform/stage — no layout jump.
- Decorative orbs have `pointer-events: none`.
- Timecode, percentages, durations: `font-mono tabular-nums`.
- Skeletons/progress match real layout.

---

## 4. Deliberate omissions

- **No page backgrounds on chrome** — flat tokens only; stage packs are opt-in resources.
- **No fluid Utopia scale** — fixed desktop viewport (Electron, min 1120×720).
- **One kit** — local primitives only; no second component library.
- **Icons** — lucide only; logo mark is the single custom glyph.

---

## 5. Extending

1. Add/extend tokens here → `@theme` in `styles.css`.
2. New component → `src/components/`, states included.
3. New screen → `src/screens/`, register in `AppLayout` + `Sidebar` `NAV`.
4. Effects / gradients → `src/lib/effects.ts` / `gradients.ts`, surface in Library.
5. Anything async → same signature in `src/lib/` for web + desktop paths.

## 0.9 reskin — typography and surfaces

- **UI face:** Geist Variable (OFL, bundled via `@fontsource-variable/geist`), with Inter Variable as the fallback. Body text uses `--tracking-ui` (−0.006em). Headings h1–h4 are weight 600, use `--tracking-display` (−0.022em) and balanced wrapping.
- **Display scale (Mantine heading sizes):** `text-h1` 34px, `text-h2` 26px, `text-h3` 22px. The UI scale (12/13/14/16/20/28) is unchanged, so dense Studio panels keep their density.
- **Surfaces:**
  - `.cu-panel` is the gradient panel with a 1px top sheen (`--shadow-sheen`) plus `--shadow-1`. `Card` uses it, and `Card interactive` adds a hover lift.
  - `.cu-eyebrow` is the uppercase section label; `.cu-page-title` is the page H1.
  - `.cu-dot-grid` is the empty-state backdrop.
- **Buttons:**
  - Primary gets the sheen, plus `--shadow-accent-glow` on hover (a Magic UI-style shine).
  - Outline gets a tinted fill and a lighter border on hover.
  - Sizes follow Mantine: sm is 32px, md is 36px.
- **Empty states:** a static Aceternity-style accent spotlight sits behind an accent icon tile. There is no motion, so the renderer-purity rules don't apply.
- **Nav:** the active item gets a filled pill with the sheen and an accent icon; the spring rail marker is kept.
