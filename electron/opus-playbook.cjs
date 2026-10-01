'use strict'

/**
 * Opus 5.5 case-study learnings, distilled from the MIT catalog in
 * resources/opus55. This is a prompt policy, not model training and not a
 * claim that the catalog authors used every step below. It keeps the useful
 * recurring production patterns while preserving NewBrand's local, deterministic
 * renderer and its manual-review safeguards.
 */
const OPUS_PLAYBOOK = Object.freeze([
  {
    id: 'brief-to-beat-sheet',
    rule: 'Turn the brief into a beat sheet before styling: hook in the first second, distinct beats, readable holds, one payoff, and a clean final frame.',
  },
  {
    id: 'single-clock-render',
    rule: 'Use one shared timeline clock for every visual, caption, audio cue, camera move and transition. Preview and export must sample the same pure frame function.',
  },
  {
    id: 'code-first-motion',
    rule: 'Prefer editable native primitives, HTML canvas scenes, Remotion-style compositions, or deterministic SVG/CSS motion over flattened screenshots. Never depend on Date.now, Math.random, CSS animation time, or an external renderer.',
  },
  {
    id: 'hook-pacing',
    rule: 'Make the first frame legible and high-contrast, establish the visual grammar quickly, vary scale and composition across beats, and avoid filling every moment with motion.',
  },
  {
    id: 'system-not-random-effects',
    rule: 'Choose one visual system per video: at most two type families, one accent, one caption treatment, one background family, and a small set of repeated easing and transition recipes.',
  },
  {
    id: 'layered-production',
    rule: 'Build in layers: background or atmosphere, subject/media, typography, accents, captions, then audio. Keep every layer editable and leave safe areas around faces, products and titles.',
  },
  {
    id: 'audio-as-structure',
    rule: 'Treat music, narration and sound effects as timing structure: mark beats, duck music under speech, land key reveals on changes, and keep audio optional when no local source exists.',
  },
  {
    id: 'iterative-review',
    rule: 'Use staged passes instead of one opaque generation: composition pass, motion pass, typography and caption pass, audio pass, then an export QA pass for overflow, contrast, timing, missing media and even dimensions.',
  },
  {
    id: 'multi-tool-adapters',
    rule: 'When a brief calls for a 3D, particle, shader, character or UI treatment, translate the intent into a NewBrand-native component or sandboxed source scene. Do not execute arbitrary MCP, After Effects, Blender or remote code inside the desktop app.',
  },
  {
    id: 'real-copy-real-data',
    rule: 'Use the user brief, imported media and verified values. Never fabricate testimonials, statistics, reviews, before/after claims, credits or source ownership to make a case study look finished.',
  },
  {
    id: 'social-reframe',
    rule: 'Design the hero for the requested aspect ratio, then reframe with safe title/action areas. Keep text on the short-side safe zone and create separate queued variants rather than squeezing one composition.',
  },
  {
    id: 'deliverable-check',
    rule: 'Before declaring success, make a playable MP4, preserve the editable project, report any missing provider or media honestly, and show the exact source/credit trail for borrowed references.',
  },
])

const DASHI_PLAYBOOK = Object.freeze([
  'Route by deliverable: preserve an editable native scene or project structure instead of replacing it with a flattened video.',
  'Break a reference into measurable beats: direction, spacing, counts, proportions, holds, speed peaks, transitions and end states.',
  'Use shared controls for repeated motion; discover actual properties before writing and never trust old numeric indexes or coordinates.',
  'Fix motion before texture: review decoded frames at matching timestamps and change the accepted baseline only where the observed difference is.',
  'Separate open/save, render, decode and comparison steps, and report exactly which evidence exists instead of treating a script exit code as proof.',
])

const DUO_PLAYBOOK = Object.freeze([
  'For a foldable promotion, keep the rear-camera panel fixed, rotate the cover panel around a visible hinge, and give the fold a closed hold, open reveal, readable hold and optional return.',
  'Keep browser, SaaS dashboard, product page or campaign artwork in one front-view coordinate system while folding; project the outer panel rather than stretching UI with the mesh.',
  'Use bounded progressive edge blur and darkening on the receding panel, while preserving copy safe areas and a stable CTA.',
  'Make screen modes intentional and replaceable: browser flow, SaaS launch, product page, social post, wallpaper or custom media; use only verified user copy and values.',
  'Use a native deterministic Canvas/Three-like projection in NewBrand so the same editable scene drives preview and export; never require the upstream webpage, remote model or Apple asset.',
  'Professional promo structure: closed hook → hinge opens → product/browser interaction plays → outer panel carries the concise CTA → clean lockup and credits.',
])

const OPUS_PLAYBOOK_PROMPT = `\n\nOPUS CASE-STUDY PRODUCTION POLICY (informed by the MIT catalog at resources/opus55; use as craft guidance, never as fabricated evidence):\n${OPUS_PLAYBOOK.map((entry, index) => `${index + 1}. ${entry.rule}`).join('\\n')}\n\nQUALITY BAR: output a concrete beat sheet and an editable, deterministic, reviewable plan. Do not claim that Opus, a case-study author, or a reference asset produced anything unless the user supplied that fact.\n`
const ADVANCED_VIDEO_PLAYBOOK_PROMPT = `${OPUS_PLAYBOOK_PROMPT}\nDASHI-MOTION NATIVE PRODUCTION RULES (distilled reference guidance; do not claim AE/Rive/Cavalry execution unless the user supplied that evidence):\n${DASHI_PLAYBOOK.map((rule, index) => `${index + 1}. ${rule}`).join('\\n')}\n\nIPHONE-DUO-INSPIRED FOLDABLE PROMOTION RULES (original NewBrand translation; Apple model/assets are not bundled):\n${DUO_PLAYBOOK.map((rule, index) => `${index + 1}. ${rule}`).join('\\n')}\n`

module.exports = { OPUS_PLAYBOOK, DASHI_PLAYBOOK, DUO_PLAYBOOK, OPUS_PLAYBOOK_PROMPT, ADVANCED_VIDEO_PLAYBOOK_PROMPT }
