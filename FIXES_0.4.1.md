# 0.4.1 — pipeline honesty, resources in the loop, Studio audio & transforms

What follows is per item: **root cause**, **change**, **files**, **what it was tested against**.
The environment this was written in has no npm registry access, so `tsc --noEmit`
and `npm run build` could not be run here — the checks listed are the ones that
were actually executed plus the exact commands to run locally.

---

## 1. The autonomous pipeline's "AI voting" was theatre — fixed

**Root cause.** `writeAutomationCandidates()` never contacted a model. It called
`candidateHtmlForRundown(rundown, i)` three times — the *same* hardcoded
template with three palette variants — and then "scored" the results with
checks every variant passed by construction (`includes('window.__seek')` is true
because the template literally writes that string). The ranking therefore came
down to the `i * 4` tiebreak, i.e. candidate 3 always won. Nothing about the
brief, the model, or quality entered the decision.

**Change.** Each candidate is now an independent generation from the configured
provider — Gemini via `runGeminiGenerateContent(key, prompt, …)` or OpenCode via
`callOpenCode(...)`, selected by `aiSettings().provider`, exactly like
`generateGeminiRundown()` / `generateOpenCodeRundown()` do. Each of the three
gets a *different creative direction* (typography-led / composition-led /
atmosphere-led) so the battle compares different pieces rather than three
samples of one prompt.

New `validateCandidateHtml()` enforces the contract the renderer actually needs
at capture time (the same things `renderArenaSegment` and
`scripts/check-renderer.mjs` assume): a complete HTML document, an `#scene`
root, `window.__seek` defined, no remote `<script>`/`<link>`, a valid t=0 frame,
no wall-clock animation (`requestAnimationFrame`/`setTimeout`/`Date.now`), no
`Math.random`, the requested frame size, and every line of locked scene copy
present. Fatal failures disqualify; the rest are points.

`extractHtmlFromModel()` strips ```` ```html ```` fences and leading prose.

**The fallback is now honest.** The built-in template is only written when *no*
model candidate survives, and when that happens the job pushes:

> "No AI candidate passed the render contract (…). Cupric fell back to its
> built-in deterministic template — this render was NOT chosen by a model
> battle."

`voting-report.json` gained `mode` (`ai-generated-local-scoring` vs
`builtin-template-fallback`), `provider`, `fallbackUsed`, `attempts` (per
candidate: generated? valid? which checks failed?), the full prompt, and
`resourcesUsed`. A partial failure ("2 of 3 candidates failed") is also
reported rather than hidden.

**Files.** `electron/main.cjs` (`packsDir`, `automationResourceContext`,
`validateCandidateHtml`, `extractHtmlFromModel`, `generateCandidateHtml`,
`writeAutomationCandidates`, the step-3 call site, `generationGuideFor`).

**Tested against.** `node --check electron/main.cjs`; then the two pure
functions were extracted and exercised in node against real fixtures:
`resources/effects/text-reveal.html` (valid → score 122, all reasons listed),
`resources/effects/quote-card.html` (valid, one weak check: missing scene copy),
the string `"sorry I cannot help"` (invalid — a refusal can no longer win a
battle), and a fenced response (`extractHtmlFromModel` returns the bare
document). Live provider calls need a key and were not run here.

---

## 2. Dead `official-arena-api` voting mode — deleted

**Root cause.** It was reachable state (persisted jobs could carry it) whose only
implementation was `throw new Error('… is not configured in this build')`, with
the `<option>` merely `disabled` in the UI. A mode that exists only to throw is
the bug.

**Change.** Removed from the `VotingMode` union, from the `<select>`, and the
throwing branch is gone from the pipeline. `VotingMode` now documents why.
The remaining option is relabelled "AI candidate battle, scored locally" so it
describes what fix #1 actually does.

**Files.** `src/types/project.ts`, `src/screens/Autonomous.tsx`,
`electron/main.cjs`.

**Tested against.** `grep -rn 'official-arena-api'` across the repo returns
nothing outside this document.

---

## 3. UI Lab / Resources now feed autonomous generation

**Root cause.** `resources/catalog.json`, `resources/packs/*` and
`src/lab/registry.ts` were never read by the automation pipeline, so the model
(when it was finally called) started from a blank page every time.

**Change.** `automationResourceContext(brief, rundown)` reads the shipped packs
(`components.json`, `templates.json`, `sources.json`) from `packsDir()` —
`process.resourcesPath` when packaged, the repo tree in dev — tokenises the
brief plus the rundown's style and scene copy/motion, scores catalogue entries
by token overlap on name/description/tags, and injects the top 12 components,
4 templates and 6 source style-cues into the prompt, with the instruction to
use at least two as structural elements. Which entries were used is recorded in
`voting-report.json → resourcesUsed`, so a bad suggestion is traceable.

**Files.** `electron/main.cjs`.

**Tested against.** The pack files it reads are the ones generated by
`npm run packs:build` (46 sources, 6 templates, 190 components); `packsDir()`
resolution was checked against both layouts.

---

## 4. Resources drag-in to the Studio

**Root cause — and a correction.** The drag did not "insert a non-functional
placeholder": there was no drag at all. The Library cards were not `draggable`,
the stage had no `onDragOver`/`onDrop`, and the only pack-item → clip mapping
lived inline inside `PackBrowser.addToStudio`, unreachable from anywhere else.
A drag therefore ended as a no-op, which reads exactly like a silent failure.

**Change.** New `src/lib/studio/resourceDrop.ts` owns the mapping
(`RESOURCE_MIME`, `writeDragPayload`, `readDragPayload`, `resourceToStudio`).
Library cards are now drag sources; the stage is a drop target (it also accepts
real files). Items the canvas genuinely cannot render are **refused with a
reason** instead of inserted: chrome-only gradients (no canvas painter), Lab
components (live React — use the Lab's capture path), HTML templates (desktop
render pipeline), and source links.

**Files.** `src/lib/studio/resourceDrop.ts` (new), `src/screens/Studio.tsx`,
`src/screens/library/PackBrowser.tsx`.

---

## 5. Canvas = transform only, plus background customisation

**Root cause — correction again.** The canvas exposed *no* editing at all: it is
a `<canvas>` painted by `drawStudioFrame`, with no interaction layer, so there
was nothing to move either.

**Change.** `TransformHandles` in `StudioPreview` draws a selection box for the
clips that have a stage position (text, overlay, glass) while paused: drag the
body to reposition, drag the corner to scale (glass `w/h`, overlay `scale`, text
`fontSizePct`). No caret, no in-place content editing — content stays in the
inspector, CapCut-style.

Background customisation is now document-level and independent of the selection:
`StudioDoc.customBackground` supports `solid` (colour picker), `image`
(data URL, cover/contain) and `transparent`, overriding the preset when set. The
renderer paints it before anything else; `transparent` is labelled honestly
("exported video has no alpha, so this reads as black").

**Not done:** rotation. The renderer has no rotation term for these clip kinds,
so a rotate handle would move a box that the exported frame ignores — worse than
no handle. It needs `drawTextClip`/`drawGlassClip`/overlay to take an angle.

**Files.** `src/screens/studio/StudioPreview.tsx`,
`src/screens/studio/StudioInspector.tsx`, `src/lib/studio/renderer.ts`,
`src/types/project.ts`, `src/screens/Studio.tsx`.

---

## 6. Background music — new `audio` clip kind

Built on the existing clip-kind pattern, end to end:

- **Type** — `StudioAudioClip` (mediaId, trimIn, sourceDuration, volume,
  fadeIn, fadeOut). `src/types/project.ts`.
- **Model** — `defaultAudioClip()` and `audioGainAt(clip, t)` (master × fade-in
  × fade-out), one function shared by preview and export so what you hear is
  what is written. `sourceTimeFor` now accepts audio (no speed: pitch-shifting
  music is never the intent). `splitClipAt` moves the source in-point for audio
  too. `src/lib/studio/doc.ts`.
- **Import** — `registerFile` decodes audio, reads duration from
  `loadedmetadata`, and computes a 160-bucket peak envelope for the timeline
  (best-effort; a failure costs a waveform, not the clip). `src/lib/studio/media.ts`.
- **UI** — a "Music" button (and `audio/*` added to the main import accept);
  music lands on its own track (the last one) so it never competes with picture.
  `src/screens/Studio.tsx`.
- **Timeline** — violet tint, Music icon, and left-edge trimming now slides the
  source in-point instead of chopping the song's head. `StudioTimeline.tsx`.
- **Inspector** — trim / volume / fade-in / fade-out, with fades capped at half
  the clip so they cannot overlap. `StudioInspector.tsx`.
- **Playback & export** — the preview seeks and gains audio elements each frame;
  the exporter includes audio clips in the Web Audio mix and rides the fade
  envelope per frame. `StudioPreview.tsx`, `src/lib/studio/export.ts`.

---

## 7. Gemini in the Video tab

**Root cause.** The Brief screen's "Create video now" (`createVideoNow`) called
`askGeminiLocal()` — the offline planner — *directly*, so the desktop
`gemini:ask` IPC was never reached even with a key configured. Plain chat
(`send`) used `askGemini()`, which is why only this one action felt canned. A
second contributor: `askGemini()` swallowed IPC errors with an empty `catch`, so
a failing live call silently downgraded to the local planner and looked identical
to a real answer.

**Change.** `createVideoNow` uses `askGemini()` (same path as chat, same IPC),
and the reply shown is the model's own text. `GeminiResult` gained
`source: 'live' | 'local'` and `fallbackReason`; both Brief call sites surface a
toast when the offline planner was used, and the failure is logged.

**Files.** `src/screens/Brief.tsx`, `src/lib/gemini.ts`.

---

## 8. Premiere-style editing — partially done, honestly

Delivered here: multi-track with audio as a first-class kind, per-clip trim/fade,
drag-in from the resource registry, transform handles.

**Not delivered:** keyframes. Clip properties are still single values, not
`{t, value}` tracks, so "keyframed transitions" needs a real model change
(`Keyframed<T>` on x/y/scale/opacity, interpolation in `doc.ts`, the renderer
sampling at t, and a keyframe lane in the timeline UI) plus reusable animation
presets that write those tracks. That is a self-contained next chunk rather
than something to fake with a partial implementation.

---

## Verify locally

```bash
npm install
npm run typecheck      # tsc --noEmit — could not run here (no registry access)
npm run check:renderer # headless renderer smoke test
npm run build
npm run desktop        # then: Autonomous → start a job with a key configured
```
