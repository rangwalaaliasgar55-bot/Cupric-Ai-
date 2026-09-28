/**
 * JOB 11 — Auto polish and Auto effects that read YOUR timeline first.
 *
 * Both buttons used to fire the same paragraph of generic instruction at the
 * planner no matter what was on the timeline, so they produced a guess and you
 * found out what it decided afterwards. That breaks the rule this whole app is
 * built on: you supply input before Cupric produces output.
 *
 * So the click now reads the live StudioDoc, states what it actually found,
 * and asks exactly ONE question — with named options, not a blank box. The
 * planner only runs once you have picked, and the instruction it receives
 * carries the real counts so the plan fits this timeline and no other.
 */
import type { StudioClip, StudioDoc } from '../../types/project'

export type AutoMode = 'polish' | 'effects'

/** What is actually on the timeline right now. Facts only — nothing inferred. */
export type TimelineFacts = {
  clips: number
  text: number
  media: number
  audio: number
  decorative: number
  tracks: number
  durationSec: number
  withTransition: number
  withMotion: number
  withHighlight: number
  longestTextChars: number
  aspect: StudioDoc['aspect']
}

const isText = (c: StudioClip) => c.kind === 'text'
const isMedia = (c: StudioClip) => c.kind === 'video' || c.kind === 'image'
const isAudio = (c: StudioClip) => c.kind === 'audio'

export function readTimeline(doc: StudioDoc): TimelineFacts {
  const clips = doc.clips ?? []
  const end = clips.reduce((max, c) => Math.max(max, (c.startSec || 0) + (c.durationSec || 0)), 0)
  return {
    clips: clips.length,
    text: clips.filter(isText).length,
    media: clips.filter(isMedia).length,
    audio: clips.filter(isAudio).length,
    decorative: clips.filter((c) => !isText(c) && !isMedia(c) && !isAudio(c)).length,
    tracks: new Set(clips.map((c) => c.track ?? 0)).size,
    durationSec: Math.round(end * 10) / 10,
    withTransition: clips.filter((c) => (c.transitionIn && c.transitionIn !== 'none') || (c.transitionOut && c.transitionOut !== 'none')).length,
    withMotion: clips.filter((c) => Array.isArray(c.keyframes) && c.keyframes.length > 1).length,
    withHighlight: clips.filter((c) => isText(c) && !!(c as { highlightWord?: string }).highlightWord).length,
    longestTextChars: clips.filter(isText).reduce((max, c) => Math.max(max, ((c as { text?: string }).text || '').length), 0),
    aspect: doc.aspect,
  }
}

/** One option you can pick. The instruction is what the planner actually gets. */
export type PolishChoice = {
  id: string
  /** The name this diff will carry in the preview, so a plan is never nameless. */
  label: string
  hint: string
  instruction: string
  /**
   * True when this choice is computed by Cupric itself rather than sent to a
   * model. The hint may only claim "no AI" when this is set — the caller
   * branches on it, so the label cannot drift away from what actually runs.
   */
  runsLocally?: boolean
}

export type PolishAsk = {
  mode: AutoMode
  /** What Cupric found — real numbers from the doc, never a guess. */
  headline: string
  question: string
  choices: PolishChoice[]
}

/** Why a pass cannot run yet, phrased as something you can act on. */
export type PolishBlocked = { blocked: string }

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

/** A plain-English inventory of the timeline, used as the card's first line. */
export function describeTimeline(f: TimelineFacts): string {
  const parts: string[] = []
  if (f.text) parts.push(plural(f.text, 'text clip'))
  if (f.media) parts.push(plural(f.media, 'video or photo', 'videos or photos'))
  if (f.audio) parts.push(plural(f.audio, 'audio clip'))
  if (f.decorative) parts.push(plural(f.decorative, 'graphic'))
  const body = parts.length ? parts.join(', ') : plural(f.clips, 'clip')
  return `${body} across ${plural(f.tracks, 'track')}, ${f.durationSec}s in ${f.aspect}.`
}

/**
 * Build the one question to ask before generating anything.
 *
 * The options are chosen from what the timeline is missing, so they are never
 * boilerplate: a timeline that already has transitions everywhere is not
 * offered "add transitions", it is offered something it can still use.
 */
export function polishAsk(doc: StudioDoc, mode: AutoMode): PolishAsk | PolishBlocked {
  const f = readTimeline(doc)
  if (f.clips === 0) {
    return { blocked: 'There is nothing on the timeline yet. Add a clip, some text or a photo, then Cupric can suggest a pass over it.' }
  }
  if (f.text === 0 && f.media === 0) {
    return { blocked: `The timeline only has ${plural(f.decorative + f.audio, 'clip')} with no text or footage to work from. Add a caption or a shot first.` }
  }

  const headline = `Cupric read your timeline: ${describeTimeline(f)}`
  const facts = `The timeline has ${f.clips} clips (${f.text} text, ${f.media} visual, ${f.audio} audio) on ${f.tracks} tracks over ${f.durationSec} seconds in ${f.aspect}. ${f.withTransition} clips already have a transition, ${f.withMotion} already have keyframed motion, ${f.withHighlight} captions already highlight a word.`
  const keep = 'Only change what the chosen direction needs. Never delete or rewrite the source wording, never invent facts, and keep every element inside the safe area.'

  if (mode === 'polish') {
    const choices: PolishChoice[] = [
      {
        id: 'punchy',
        label: 'Punchier — faster cuts, bolder type',
        hint: f.text ? `Tightens the ${plural(f.text, 'caption')} and pushes contrast up.` : 'Pushes pace and contrast up.',
        instruction: `${facts} Polish this timeline in a PUNCHY direction: heavier weights and larger sizes on the existing captions, higher-contrast colour, quicker entrances, and a highlight on the single strongest word already present in each caption. ${keep}`,
      },
      {
        id: 'calm',
        label: 'Calmer — cinematic, more breathing room',
        hint: 'Softer entrances, restrained type, slower motion.',
        instruction: `${facts} Polish this timeline in a CALM, cinematic direction: restrained type sizes, softer entrance animations, gentle slow motion on visual clips, and generous spacing from the safe-area edge. ${keep}`,
      },
      {
        id: 'craft',
        label: 'Motion craft — sprung entrances on a beat',
        hint: 'Fixes the three things a motion designer fixes first. Runs locally, no AI, no waiting.',
        runsLocally: true,
        instruction: `${facts} Apply the MOTION CRAFT pass: give every clip without motion a sprung entrance, stagger clips that arrive at the same instant onto a rhythm grid so one thing happens at a time, and give held stills a fraction of drift. ${keep}`,
      },
      {
        id: 'consistent',
        label: 'Just make it consistent',
        hint: 'One font, one colour system, even timing — no new ideas.',
        instruction: `${facts} Polish this timeline for CONSISTENCY only: unify the captions onto one bundled font family and one colour system, even out clip durations that are wildly out of step with their neighbours, and align placement. Add no new effects and no new motion. ${keep}`,
      },
    ]
    return { mode, headline, question: 'How should this polish feel?', choices }
  }

  const choices: PolishChoice[] = []
  if (f.withTransition < Math.max(1, f.clips - 1)) {
    choices.push({
      id: 'transitions',
      label: 'Transitions at the scene changes',
      hint: `${f.clips - 1 - f.withTransition} of ${plural(f.clips - 1, 'cut')} have none yet.`,
      instruction: `${facts} Apply an EFFECTS pass focused on scene changes: choose a suitable native transition at each boundary that does not already have one, varying the choice so the film does not repeat a single transition. Leave clips that already have a transition alone. ${keep}`,
    })
  }
  if (f.text > 0 && f.withHighlight < f.text) {
    choices.push({
      id: 'captions',
      label: 'Bring the captions to life',
      hint: `${f.text - f.withHighlight} of ${plural(f.text, 'caption')} have no emphasis yet.`,
      instruction: `${facts} Apply an EFFECTS pass focused on the captions: animate each caption's entrance and emphasise the single strongest word ALREADY PRESENT in its text. Do not write new words. ${keep}`,
    })
  }
  if (f.media > 0 && f.withMotion < f.media) {
    choices.push({
      id: 'motion',
      label: 'Gentle motion on the stills and footage',
      hint: `${f.media - f.withMotion} of ${plural(f.media, 'visual clip')} sit perfectly still.`,
      instruction: `${facts} Apply an EFFECTS pass focused on movement: add a gentle start-and-end keyframe drift or scale to visual clips that have no keyframed motion, staying inside the frame at every point. ${keep}`,
    })
  }
  if (!choices.length) {
    return { blocked: 'Every clip already has a transition, emphasis and motion. Tell Cupric what you want changed instead — the instruction box takes anything specific.' }
  }
  return { mode, headline, question: 'Which effects pass do you want?', choices }
}

export const isBlocked = (r: PolishAsk | PolishBlocked): r is PolishBlocked => 'blocked' in r
