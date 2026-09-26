/**
 * HTML video templates.
 *
 * Every file under `resources/effects/*.html` is a self-contained scene that
 * exposes two globals:
 *
 *   window.__seek(t)               — paint the scene at t seconds (pure; no rAF,
 *                                    no CSS animation, so frame N is always the
 *                                    same pixels)
 *   window.__cupricSourceManifest  — duration, fps, size, beat list, credits
 *
 * That contract is what lets the desktop renderer screenshot a template frame
 * by frame into an MP4 without a headless animation clock, and what lets the
 * Arena prompt builder describe the scene it is about to generate.
 *
 * This registry is the code's view of those files: `npm run packs:build` turns
 * it into `resources/packs/templates.json` for the Library.
 */

import type { SourceEntry } from './sources'
import { SOURCES } from './sources'

export type VideoTemplate = {
  id: string
  name: string
  description: string
  /** Path inside the packaged app and the repo. */
  file: string
  durationSec: number
  fps: number
  size: [number, number]
  /** Loops seamlessly at `durationSec` — safe to repeat under a longer voiceover. */
  loops?: boolean
  /** `SOURCES` ids this scene was built from. */
  sources: string[]
  tags: string[]
}

export const VIDEO_TEMPLATES: VideoTemplate[] = [
  {
    id: 'logo-sting',
    name: 'Logo sting',
    description: 'Mark snaps in, wordmark follows, everything settles on a clean hold frame.',
    file: 'resources/effects/logo-sting.html',
    durationSec: 3,
    fps: 30,
    size: [1080, 1080],
    sources: ['motion-primitives'],
    tags: ['intro', 'brand'],
  },
  {
    id: 'quote-card',
    name: 'Quote card',
    description: 'Word-by-word quote over a dot field, attribution fading in last.',
    file: 'resources/effects/quote-card.html',
    durationSec: 6,
    fps: 30,
    size: [1080, 1920],
    sources: ['dotforge', 'text-effects'],
    tags: ['quote', 'text'],
  },
  {
    id: 'text-reveal',
    name: 'Text reveal',
    description: 'Blur-and-rise word stagger for an opening statement. After Forge UI Text Reveal.',
    file: 'resources/effects/text-reveal.html',
    durationSec: 5,
    fps: 30,
    size: [1080, 1920],
    sources: ['forge-ui', 'motion-primitives', 'kinetics'],
    tags: ['text', 'stagger', 'opening'],
  },
  {
    id: 'progress-stack',
    name: 'Progress stack',
    description: 'Three onboarding cards with a filling progress bar — the “it is working” beat.',
    file: 'resources/effects/progress-stack.html',
    durationSec: 6,
    fps: 30,
    size: [1080, 1920],
    sources: ['forge-ui', 'circle-loaders'],
    tags: ['progress', 'onboarding', 'ui'],
  },
  {
    id: 'stack-ripple',
    name: 'Stack ripple',
    description: 'Notification cards fan open on a spring, then hold. After Forge UI Stack Ripple.',
    file: 'resources/effects/stack-ripple.html',
    durationSec: 5,
    fps: 30,
    size: [1080, 1920],
    sources: ['forge-ui', 'microkit'],
    tags: ['notifications', 'spring', 'ui'],
  },
  {
    id: 'mesh-drift',
    name: 'Mesh drift',
    description: 'Looping mesh-gradient atmosphere with a centred title. Canvas, not WebGL, so it survives frame capture.',
    file: 'resources/effects/mesh-drift.html',
    durationSec: 8,
    fps: 30,
    size: [1080, 1920],
    loops: true,
    sources: ['23rd-dev', 'gradient-lab', 'gradientool'],
    tags: ['background', 'gradient', 'loop'],
  },
]

export function getTemplate(id: string): VideoTemplate | undefined {
  return VIDEO_TEMPLATES.find((t) => t.id === id)
}

/** The catalogue entries behind a template, for credits in the Library. */
export function templateSources(template: VideoTemplate): SourceEntry[] {
  return template.sources
    .map((id) => SOURCES.find((s) => s.id === id))
    .filter((s): s is SourceEntry => Boolean(s))
}
