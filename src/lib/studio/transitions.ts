/**
 * Transition + animation catalogue.
 *
 * Single source of truth: the Studio inspector lists these, the Library shows
 * them as resources, and `renderer.ts` implements exactly these ids. If an id
 * is not here it cannot be selected, and if it is here it renders.
 */

import type { StudioTextAnim, StudioTransition } from '../../types/project'

export type TransitionInfo = {
  id: StudioTransition
  name: string
  description: string
  /** Where the id came from, for the Library credit line. */
  family: 'core' | 'glass' | 'liquid'
}

export const TRANSITIONS: TransitionInfo[] = [
  { id: 'none', name: 'Cut', description: 'Hard cut — no blend at all.', family: 'core' },
  { id: 'fade', name: 'Fade', description: 'Opacity ramp on an ease-out curve.', family: 'core' },
  { id: 'wipe-left', name: 'Wipe', description: 'Hard edge travelling left to right.', family: 'core' },
  { id: 'zoom-in', name: 'Zoom', description: 'Scales from 1.08 with the fade, never from 0.', family: 'core' },
  { id: 'blur', name: 'Blur through', description: 'Focus pulls in from 18px of blur.', family: 'core' },
  { id: 'iris', name: 'Iris', description: 'Circular reveal from the centre outwards.', family: 'core' },
  { id: 'push-up', name: 'Push up', description: 'Slides up a third of the frame as it fades.', family: 'core' },
  {
    id: 'glass-wipe',
    name: 'Glass wipe',
    description: 'A refracting glass bar sweeps across and leaves the clip behind it.',
    family: 'glass',
  },
  {
    id: 'liquid-dissolve',
    name: 'Liquid dissolve',
    description: 'Warping blur dissolve — the frame melts in rather than fading.',
    family: 'liquid',
  },
  {
    id: 'lens-sweep',
    name: 'Lens sweep',
    description: 'A circular lens travels across the frame, magnifying as it reveals.',
    family: 'glass',
  },
]

export function transitionInfo(id: StudioTransition): TransitionInfo {
  return TRANSITIONS.find((t) => t.id === id) ?? TRANSITIONS[0]
}

export type TextAnimInfo = {
  id: StudioTextAnim
  name: string
  description: string
  family: 'core' | 'glass' | 'kinetic' | 'liquid'
}

export const TEXT_ANIMATIONS: TextAnimInfo[] = [
  { id: 'none', name: 'None', description: 'Static text — nothing moves.', family: 'core' },
  { id: 'fade-up', name: 'Fade up', description: 'Rises half a line while it fades in.', family: 'core' },
  { id: 'word-reveal', name: 'Word reveal', description: 'Word by word, ~9 words a second.', family: 'kinetic' },
  { id: 'pop', name: 'Pop', description: 'Spring scale with a small overshoot.', family: 'kinetic' },
  { id: 'typewriter', name: 'Typewriter', description: 'Characters appear over the first 60% of the clip.', family: 'kinetic' },
  { id: 'slide-left', name: 'Slide', description: 'Enters from 8% of the frame width.', family: 'core' },
  { id: 'shimmer', name: 'Glass shimmer', description: 'A specular highlight sweeps through the letters.', family: 'glass' },
  { id: 'glass-rise', name: 'Glass rise', description: 'Frosted plate rises and clears behind the text.', family: 'glass' },
  { id: 'liquid-wave', name: 'Liquid wave', description: 'Letters ride a sine wave that settles into place.', family: 'liquid' },
]

export function textAnimInfo(id: StudioTextAnim): TextAnimInfo {
  return TEXT_ANIMATIONS.find((t) => t.id === id) ?? TEXT_ANIMATIONS[0]
}
