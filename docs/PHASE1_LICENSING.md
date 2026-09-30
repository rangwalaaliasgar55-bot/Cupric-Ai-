# Phase 5 — Licensing review: what ships, what was replaced, what still needs a decision

Scope: every third-party component that ends up inside the Windows build — npm
production dependencies, vendored source, bundled binaries, shipped resource
data — and the commercial-use restrictions `docs/AUDIT_PHASE0.md` §C flagged.

Baseline commit: `821c788`.

Every claim below is backed by two checks in the release chain, neither of which
trusts this document:

* `scripts/check-licences.mjs` — the *packages*: installed production
  dependencies, the lockfile, vendored packs (84 assertions at last run).
* `scripts/check-attribution.mjs` — the *source*: any file in `src/` or `electron/`
  whose header claims an upstream must be credited in `THIRD_PARTY_NOTICES.md`,
  and the two restricted packages must stay absent from code and lockfile. It
  exists because a licence check that reads `package.json` cannot see a function
  copied from an Apache-2.0 project into this repository's own source, which is
  where licence trouble actually hides.

**Added in this round (both found by `check-attribution.mjs`, not by reading):**

* **`thinking-orbs` ^0.3.2 is a real shipped dependency** (`src/app-shell/AskPanel.tsx`
  renders `ThinkingOrb`) that arrived with the Libraries.dev skill and was credited
  only inside `resources/libraries-dev/review.json` — never in
  `THIRD_PARTY_NOTICES.md`. It is now recorded there with its upstream. The other
  six packages in that skill are **not** installed; the review report lists them as
  suggestions and the app never installs anything.
* The Libraries.dev skill material itself (`resources/libraries-dev/SKILL.md`,
  `references/`, the generated `review.json`) ships inside the app and had no
  notice. Now credited to `Jakubantalik/Libraries.dev` with the licences of each
  library it describes.

---

## 1. What was found

| # | Component | Licence | Where it came from | Why it was a problem |
| - | - | - | - | - |
| C1 | `@paper-design/shaders-react` | **PolyForm Shield 1.0.0** (text read from `node_modules/@paper-design/shaders-react/LICENSE`) | imported by all 18 vendored framecn shader components (`src/lab/framecn/shader-*/index.tsx`), exposed to users as Studio components `fc-shader-*` | PolyForm Shield forbids using the software to provide a competing product and restricts modification/redistribution. A commercial product cannot ship it on those terms. |
| C2 | `remotion`, `@remotion/player` | **Remotion License** (free for individuals and for-profit organisations of ≤3 employees; a paid company licence above that) | `src/components/MotionCompositionPlayer.tsx`, rendered in Arena Desk | The licence is not a permissive OSS licence: shipping commercially at >3 employees requires a purchase, and the terms exclude some usages outright. |
| C3 | `heic2any` (bundled wasm) | package declares **MIT**, but the bundle contains **libheif** compiled to WebAssembly, and upstream libheif is **LGPL-3.0** | HEIC (iPhone photo) import | `docs/AUDIT_PHASE0.md` §C3 flagged the provenance as unverified. The obligation attaches to the *bundled binary*, not to the npm package's own licence field. |
| C4 | `ffmpeg-static` / `ffprobe-static` | **GPLv3-class** builds (the static builds are `--enable-gpl`; verified locally against the running binary's `configuration` line) | shipped inside the installer, invoked as a separate process (`asarUnpack`) | Distributing GPL binaries with a proprietary app is allowed (no linking; separate process) **provided** the licence text and the corresponding-source offer travel with the distribution. That had never been written down. |
| C5 | `resources/packs/*.json` (Remotion templates, React Bits, opus55, framecn, panelui…) | mixed: MIT, MIT+Commons Clause, and items already flagged `license-review` | shipped as catalog *metadata* | Metadata and links are not the upstream source, but the flag had no owner and no process. |
| C6 | `resources/open-edit/*` | **Apache-2.0** | ported code (EDL, gates, transcript mapping, concat/mux) | Correctly handled already: `LICENSE` + `NOTICE` retained, per-file port table in `THIRD_PARTY_NOTICES.md`. The VEED binary it derives from is PolyForm and is explicitly not used. |

---

## 2. Decisions

### Decision 1 — `@paper-design/shaders-react` is removed and replaced (**done**)

The 18 shader effects are user-facing Studio components, so deleting them would
remove features. Instead the effect maths was written from scratch:

- `src/lib/shaders/fields.ts` — colour maths, value/fractal noise, domain warping,
  voronoi, metaballs, orbit geometry. Pure functions, no DOM, no GPU.
- `src/lib/shaders/render.ts` — 18 samplers (`perlin-noise`, `simplex-noise`,
  `dithering`, `dot-orbit`, `god-rays`, `grain-gradient`, `liquid-metal`,
  `mesh-gradient`, `metaballs`, `neuro-noise`, `pulsing-border`, `smoke-ring`,
  `spiral`, `swirl`, `voronoi`, `warp`, `water`, `color-panels`) behind
  `renderShaderPixels(kind, { width, height, params })`, which returns
  deterministic RGBA bytes.
- `src/lab/framecn/shader-kit.tsx` — the React components with the same names and
  the same props the wrappers used (`PerlinNoise`, `Dithering`, `MeshGradient`, …),
  so each wrapper changed one import line.
- The dependency is gone from `package.json` and `package-lock.json`, and
  `src/tests/shaders.test.ts` fails if any file imports it again.

**Stated cost, not hidden:** the previous shaders ran per-pixel on the GPU. Ours
run on the CPU, so the kit renders into a buffer capped at 192×120 and scales it
up with the browser's smoothing, throttles to 22 fps, and skips frames while the
tab is hidden. That is a deliberate trade for a decorative background; it is
visible in `shader-kit.tsx` as `INTERNAL_MAX_WIDTH`/`MAX_FPS` rather than buried.

### Decision 2 — Remotion is removed and replaced (**done**)

`remotion` and `@remotion/player` were used in exactly one place: an 85-line
preview in Arena Desk. `src/components/MotionCompositionPlayer.tsx` is now our
own player: a `requestAnimationFrame` clock at the rundown's frame rate, the same
composition (scene copy, motion note, spring entrance from `src/core/math.ts`,
progress bar) and real transport (play/pause, scrub, loop, frame readout). Both
dependencies are out of `package.json` and the lockfile.

The resource packs derived from Remotion's template catalogue stay: they are
metadata (titles, tags, links), not the runtime, and they keep their attribution.
The badge that told users the app shipped `@remotion/player` now says what it
actually is, and the source catalogue entry says plainly that Cupric does not ship
or depend on the Remotion runtime.

### Decision 3 — bundled `libheif` (LGPL-3.0) is documented and gated (**documented; legal sign-off still required**)

`heic2any` is MIT and is the wrapper; the WebAssembly inside it is compiled from
libheif, which is LGPL-3.0. HEIC import is a real feature (iPhone photos), so it
was not removed. Instead:

- the obligation is written into `THIRD_PARTY_NOTICES.md` (component, licence,
  upstream source location);
- `scripts/check-licences.mjs` fails if that entry disappears;
- this document states the remaining risk: LGPL-3.0 for a *bundled* wasm inside
  an Electron asar requires shipping the licence text and providing the
  corresponding source of the library, and the relinking question for a
  wasm module compiled into a JS bundle is genuinely arguable.

**UNVERIFIED / unresolved:** no lawyer has reviewed this, and it is the one
licence position in the build that is not clearly satisfied by a permissive
licence. The two clean resolutions are (a) ship the libheif licence text and the
corresponding source, with the HEIC importer as a separate, replaceable asset, or
(b) drop HEIC import and let the OS codec handle those files. That decision needs
the product owner, not an agent, and it is listed in §4.

### Decision 4 — FFmpeg GPL binaries: distribution obligations recorded (**action required at packaging time**)

`ffmpeg-static`/`ffprobe-static` are GPL-class builds spawned as separate
processes, which is the permitted way to ship them beside a proprietary app. What
is required, and what Phase 4's packaging must do:

1. include the FFmpeg licence text in the installer's licence folder;
2. include the written offer / source link for the exact build shipped (the
   `configuration` line of the shipped binary identifies it);
3. never link FFmpeg into the app (it is already only ever `spawn`ed).

`THIRD_PARTY_NOTICES.md` now records (1) and (2) as required artefacts; the
installer step itself is Phase 4 work and is **UNVERIFIED** until a packaged
build is inspected.

### Decision 5 — the `license-review` pack flag has a rule (**done**)

Every pack item carrying `license-review` is counted by the check and named in
its output, and the packs keep that flag until someone records a decision in this
document. This is what stops "flagged for review" from meaning "forgotten".

### Decision 6 — everything else is permissive (**verified**)

`scripts/check-licences.mjs` reads every production dependency's declared licence
from its installed manifest and fails on anything restricted or unknown. Current
state, 48 production dependencies:

| Licence group | Count | Notes |
| - | - | - |
| MIT | 17 | `adm-zip`, `clsx`, `electron-log`, `electron-updater`, `heic2any` (wrapper only — see Decision 3), `html-to-image`, `html2canvas`, `lottie-web`, `motion`, `pg`, `react`, `react-dom`, `tailwind-merge`, `thinking-orbs`, `three`, `zod`, `zustand` |
| OFL-1.1 (fonts) | 22 | the bundled Fontsource families; OFL requires keeping the copyright notice with redistributed fonts, and the foundry names are unmodified |
| Apache-2.0 | 4 | `@dimforge/rapier3d-compat`, `@google/generative-ai`, `drizzle-orm`, `video.js` |
| ISC | 2 | `canvas-confetti`, `lucide-react` |
| BSD-3-Clause | 1 | `twilio-video` |
| CC0-1.0 | 1 | `simple-icons` |
| MIT OR GPL-3.0-or-later | 1 | `jszip` — the MIT arm is taken |
| **PolyForm / SSPL / BUSL / Commons Clause / proprietary** | **0** | the allow-list is enforced, so this cannot silently change |

Individual entries, for the drift gate (`scripts/check-licences.mjs` asserts each
of these names appears here):

`@dimforge/rapier3d-compat` (Apache-2.0), `@fontsource-variable/bricolage-grotesque`,
`@fontsource-variable/dm-sans`, `@fontsource-variable/fraunces`,
`@fontsource-variable/geist`, `@fontsource-variable/inter`,
`@fontsource-variable/jetbrains-mono`, `@fontsource-variable/manrope`,
`@fontsource-variable/montserrat`, `@fontsource-variable/outfit`,
`@fontsource-variable/playfair-display`, `@fontsource-variable/plus-jakarta-sans`,
`@fontsource-variable/space-grotesk`, `@fontsource-variable/syne`,
`@fontsource-variable/unbounded`, `@fontsource/anton`, `@fontsource/archivo-black`,
`@fontsource/bebas-neue`, `@fontsource/dm-serif-display`, `@fontsource/hind`,
`@fontsource/instrument-serif`, `@fontsource/noto-sans-devanagari`,
`@fontsource/poppins` (all OFL-1.1), `@google/generative-ai` (Apache-2.0),
`adm-zip` (MIT), `canvas-confetti` (ISC), `clsx` (MIT), `drizzle-orm` (Apache-2.0),
`electron-log` (MIT), `electron-updater` (MIT), `heic2any` (MIT wrapper — see
Decision 3), `html-to-image` (MIT), `html2canvas` (MIT), `jszip` (MIT arm),
`lottie-web` (MIT), `lucide-react` (ISC), `motion` (MIT), `pg` (MIT),
`react` (MIT), `react-dom` (MIT), `simple-icons` (CC0-1.0),
`tailwind-merge` (MIT), `thinking-orbs` (MIT), `three` (MIT),
`twilio-video` (BSD-3-Clause), `video.js` (Apache-2.0), `zod` (MIT),
`zustand` (MIT).

---

## 3. Verification performed, and what was observed

| Command | Observed result |
| - | - |
| `npx vitest run src/tests/shaders.test.ts` | `17 passed` — including "is not imported anywhere in the source tree", "left all 18 Lab shader components rendering from our own kit" and 5 renderer-quality suites |
| `npm test` | `Test Files 8 passed (8)`, `Tests 141 passed \| 1 skipped (142)` |
| `npx tsc --noEmit` | clean |
| `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` then `ls node_modules/@paper-design node_modules/remotion` | both `No such file or directory` — the packages are gone from a clean install |
| `npm install --package-lock-only` then `grep -c "remotion\|paper-design" package-lock.json` | `0` |
| `node scripts/check-licences.mjs` | asserts 48 production dependencies are permissive, 3 restricted packages absent, the document names every dependency, the notices record the ports and the LGPL wasm, and the pack flags stay visible |
| Dependency licence read | 48/48 declared and allowed: MIT, OFL-1.1, Apache-2.0, ISC, BSD-3-Clause, CC0-1.0, MIT-or-GPL-3.0 (MIT arm) |
| Shader behaviour | every one of the 18 effects renders, is deterministic frame-for-frame, moves over time, has luma range > 12, responds to colour props (≥13 by direct palette), and **no two effects are visually interchangeable** (pairwise mean difference ≥ 3/255) — measured by `src/tests/shaders.test.ts` |

A bug the new tests caught while writing them: `rampStepped` asked `ramp` for
exactly `1`, which wraps back to the first colour, so the brightest band of every
stepped palette was unreachable. Fixed in `fields.ts` and covered by a test.

---

## 4. Still broken, incomplete, or UNVERIFIED

1. **UNVERIFIED: nobody has seen the app run after these changes.** This container
   cannot run Electron (see `docs/PHASE1_AUTONOMOUS.md` §4). The 18 Lab shaders and
   the Arena Desk preview are covered by headless tests (pixel determinism, motion,
   contrast, distinctness, TypeScript) and by the Lab's own resource checks, but
   their *look* on screen has not been observed, and the CPU-rendered shaders are
   softer than the WebGL originals they replaced.
2. **UNVERIFIED: the AGPL/GPL question for the *shipped* FFmpeg build.** The
   obligation is written down (Decision 4), but no packaged installer has been
   inspected, so the licence text and source offer are not yet in a build.
3. **UNRESOLVED: bundled libheif (LGPL-3.0) inside `heic2any`.** Documented and
   gated, not resolved (Decision 3). Needs a product/legal decision between
   shipping the licence text plus corresponding source, or dropping HEIC import.
4. **UNVERIFIED: `resources/` was not swept directory by directory.** The Phase 0
   audit asked for it and this phase only enforced the pack-level rule. The
   ~25 vendored resource directories (panelui, uselayouts, framecn, opus55,
   open-edit, kdenlive notes, packs) each carry a licence file; a per-directory
   sweep that fails on a missing licence file is straightforward but was not done
   here.
5. **Remotion-derived resource metadata stays, deliberately, but its upstream
   licence was not re-verified file by file.** The catalogue is metadata with
   attribution; if any pack item ever carries upstream *source* rather than
   metadata, it must be re-reviewed against Remotion's licence (which restricts
   redistributing the software, not describing it).
6. **The shader replacement is not pixel-equivalent to the old shaders.** The
   effect *families* are the same and the props are the same; the images differ.
   Anyone comparing before/after screenshots will see different (not broken)
   output — that is the honest description of a reimplementation.
7. **`@ffmpeg-installer/ffmpeg`** was used earlier in this session (installed with
   `--no-save`, outside the repo) purely to run the export checks. It is not a
   dependency of the project and does not ship; its build is also GPL-class and
   would carry the same obligations as Decision 4 if it ever replaced
   `ffmpeg-static`. It has since been removed from the container and the checks
   resolve `ffmpeg-static` or print a skip.

---

## 5. Changes made in this phase (file by file)

| File | Change |
| - | - |
| `src/lib/shaders/fields.ts` | **new** — colour parsing/mixing, stepped and wrapping ramps, value/fractal/billow noise from an integer hash, domain warping, voronoi, metaballs, orbit geometry. Pure, no DOM, no GPU, no clock. |
| `src/lib/shaders/render.ts` | **new** — the 18 samplers, `SHADER_KINDS`, `renderShaderPixels`, `isShaderKind`. Each sampler takes an explicit `SampleContext {t, aspect, params, palette}`, so there is no module-level state in a render loop. |
| `src/lab/framecn/shader-kit.tsx` | **new** — the React components the 18 wrappers import: same names, same props, own CPU renderer, internal buffer capped at 192×120, 22 fps, hidden-tab skip, explicit error if a 2D context cannot be created. |
| `src/lab/framecn/shader-*/index.tsx` (18) | import changed from `@paper-design/shaders-react` to `../shader-kit`; the vendoring header now states what was changed and why. |
| `src/components/MotionCompositionPlayer.tsx` | rewritten without `remotion`/`@remotion/player`: wall-clock frame loop, `MotionCompositionStage` (pure, takes `time`), play/pause, scrub, loop toggle, frame readout. |
| `src/tests/shaders.test.ts` | **new** — 17 tests: field maths, per-effect render/determinism/motion/contrast/palette-response/distinctness, and the structural "the restricted package is gone" assertions. |
| `scripts/check-licences.mjs` | **new** — release-chain gate over dependency licences, the removed packages, the licensing document's completeness, the notices, and the pack `license-review` flags. |
| `package.json` | `@paper-design/shaders-react`, `remotion`, `@remotion/player` removed; `check:licences` added to the chain. |
| `package-lock.json` | regenerated; zero occurrences of the three removed packages. |
| `THIRD_PARTY_NOTICES.md` | added the two removals, the libheif/LGPL obligation and the FFmpeg distribution requirements. |
| `docs/PHASE1_LICENSING.md` | **new** — this document. |
| `docs/AUDIT_PHASE0.md` | §C verdicts updated to the state after this phase. |
