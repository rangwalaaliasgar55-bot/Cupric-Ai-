import type { SceneRundown, View } from '../types/project'
import { round1, slugify, uid } from './utils'

/**
 * Mocked Gemini co-pilot. No network — deterministic-ish templates shaped by
 * the user's text. The Brief screen animates `rundownPatch` into the JSON
 * panel field by field.
 */

export type RundownPatch = Partial<SceneRundown>
export type GeminiResult = { text: string; rundownPatch: RundownPatch }

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type Flavor = 'logo' | 'quote' | 'saas' | 'podcast' | 'generic'

function detectFlavor(t: string): Flavor {
  if (/logo|sting|reveal\b/.test(t)) return 'logo'
  if (/quote|kinetic|typograph/.test(t)) return 'quote'
  if (/saas|launch|product|startup|\bapp\b/.test(t)) return 'saas'
  if (/podcast|clip|interview|episode/.test(t)) return 'podcast'
  return 'generic'
}

function parseDuration(t: string): number | null {
  const m = t.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec|secs|second)/i)
  if (m) {
    const v = parseFloat(m[1])
    if (v >= 1 && v <= 120) return v
  }
  return null
}

function topicOf(t: string): string {
  const cleaned = t
    .replace(/\d+(?:\.\d+)?\s*(?:s\b|sec|secs|seconds)/gi, ' ')
    .replace(
      /\b(make|create|build|draft|want|need|a|an|the|for|of|with|me|please|video|short|clip|bumper|second)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Northframe'
  return cleaned
    .split(' ')
    .slice(0, 4)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

const STYLES: Record<Flavor, string> = {
  logo: 'Bold centered logo type, near-black base, single lime accent, spring scale-in with overshoot, generous tracking',
  quote: 'Kinetic typography, word-by-word reveal, warm white on near-black with one lime highlight word, tight leading',
  saas: 'Clean tech launch: dark base, lime accent, tight grid, tabular numerals, confident macro type',
  podcast: 'Caption-forward edit: big bold captions, blue info accent for names, safe-area margins, snappy cuts',
  generic: 'Kinetic type on near-black, single lime accent, ease-out motion, generous spacing',
}

const FLAVOR_LABEL: Record<Flavor, string> = {
  logo: 'logo sting',
  quote: 'kinetic-type quote card',
  saas: 'launch bumper',
  podcast: 'podcast clip opener',
  generic: 'motion piece',
}

function buildScenes(dur: number, flavor: Flavor, topic: string): SceneRundown['scenes'] {
  const mk = (from: number, to: number, type: string, copy: string, motion: string) => ({
    id: uid(),
    from: round1(from),
    to: round1(to),
    type,
    copy,
    motion,
  })

  if (dur <= 4) {
    return [mk(0, dur, 'logo', topic.toUpperCase(), 'spring scale-in with overshoot, hold 0.8s')]
  }

  const hookEnd = round1(Math.max(2, dur * 0.25))
  const bodyEnd = round1(Math.max(hookEnd + 2, dur * 0.75))

  if (flavor === 'quote') {
    return [
      mk(0, hookEnd, 'quote', `“${topic}.”`, 'word-by-word reveal, 9 words/s'),
      mk(hookEnd, bodyEnd, 'attribution', '— Northframe Studio', 'fade up, letter-spacing settles'),
      mk(bodyEnd, dur, 'mark', 'NORTHFRAME', 'scale 0.96 -> 1 spring, hold'),
    ]
  }

  const scenes = [
    mk(0, hookEnd, 'hook', `${topic.toUpperCase()}`, 'oversized type snaps in at 0.96 scale, tracking tightens'),
  ]
  if (flavor === 'saas' || flavor === 'podcast') {
    scenes.push(
      mk(hookEnd, bodyEnd, 'proof', flavor === 'saas' ? 'Edit video with a sentence.' : 'The moment everyone went quiet.', 'line-by-line rise, 80ms stagger'),
    )
  } else {
    scenes.push(mk(hookEnd, bodyEnd, 'body', `${topic} — in motion.`, 'mask wipe left-to-right, ease-out'))
  }
  scenes.push(mk(bodyEnd, dur, 'cta', 'northframe.studio — Oct 2', 'counter ticks up, fade to logo'))
  return scenes
}

function arenaPromptOf(r: Pick<SceneRundown, 'durationSec' | 'fps' | 'size' | 'style' | 'scenes'>): string {
  return (
    'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: ' +
    'one file, inline CSS/JS, no build step. ' +
    `Root #scene exactly ${r.size[0]}x${r.size[1]} px. ` +
    `Duration ${r.durationSec}s at ${r.fps}fps. ` +
    'Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. ' +
    `Style: ${r.style}. Scene copy: ` +
    r.scenes.map((s) => `[${s.from}-${s.to}s ${s.type}] "${s.copy}" (${s.motion})`).join(' ')
  )
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

export async function askGeminiLocal(userText: string, askCount: number): Promise<GeminiResult> {
  await wait(800 + Math.random() * 700)

  const t = userText.toLowerCase()
  const flavor = detectFlavor(t)
  const topic = topicOf(userText)
  const dur = parseDuration(t) ?? (flavor === 'logo' ? 3 : flavor === 'quote' ? 6 : 12)
  const seed = userText.length + askCount

  const base: SceneRundown = {
    title: `${topic} — ${dur}s ${FLAVOR_LABEL[flavor]}`,
    durationSec: dur,
    fps: 30,
    size: [1920, 1080],
    style: STYLES[flavor],
    scenes: buildScenes(dur, flavor, topic),
    arenaPrompt: '',
  }

  if (askCount === 0) {
    const openers = [
      `Love this direction. I sketched a ${dur}s ${FLAVOR_LABEL[flavor]} — ${base.scenes.length} scenes, dark base with one lime accent. I'm filling the rundown on the right field by field. Tweak anything, or tell me to push the copy harder.`,
      `Good brief. Here's a first pass: a ${dur}s ${FLAVOR_LABEL[flavor]} in ${base.scenes.length} beats, opening big and landing on a clean CTA. Watch the rundown fill in — then ask me for revisions or lock it.`,
    ]
    return { text: pick(openers, seed), rundownPatch: { ...base } }
  }

  // Second and later asks: refine + produce the Arena prompt
  base.scenes = base.scenes.map((s) =>
    s.type === 'cta' ? { ...s, motion: 'counter ticks up in tabular numerals, fade to logo' } : s,
  )
  base.arenaPrompt = arenaPromptOf(base)
  const refinements = [
    `Tightened the timing and punched up the copy — the CTA now ticks in on tabular numerals. I also wrote the Arena prompt at the bottom of the rundown: copy it into arena.ai/code, run the battle, vote, then drop the winning .zip into the Arena Desk.`,
    `Sharpened it. Every beat now has motion cues a renderer can follow deterministically. The Arena prompt is ready in the rundown — that's the text you paste into arena.ai/code. Win the battle, bring me the .zip.`,
  ]
  return { text: pick(refinements, seed), rundownPatch: { ...base } }
}

/** Mocked chat replies for the "Ask Gemini" slide-over panel. */
export async function fakeGeminiChatLocal(
  text: string,
  ctx: { projectName: string | null; view: View },
): Promise<string> {
  await wait(700 + Math.random() * 600)
  const t = text.toLowerCase()
  const proj = ctx.projectName ? `“${ctx.projectName}”` : 'a project'

  if (/rundown|idea|bumper|sting|quote|concept|12s|short/.test(t)) {
    return `Happy to. Head to the Brief screen and type the raw idea — I'll draft the scene rundown there, field by field, and you can lock it when it feels right. (This prototype mocks my answers; in the desktop build I'm a real Gemini Flash call.)`
  }
  if (/import|zip|arena flow|how does the arena|battle|vote/.test(t)) {
    return `The Arena flow: 1) Lock a rundown in the Brief. 2) Copy the Arena prompt from the Arena Desk. 3) Paste it into arena.ai/code and let two models battle. 4) Vote, download the winner's .zip, and drop it into the Arena Desk — it lands as an imported asset you can preview and render.`
  }
  if (/caption|hormozi|subtitle/.test(t)) {
    return `Captions live on the Footage Desk. Pick a style per clip — Hormozi (big, punched, one lime word), Standard (clean white), or Minimal (quiet chip) — mark the silence cuts to drop, then Apply. The edit shows up on the Timeline.`
  }
  if (/render|export|mp4/.test(t)) {
    return `Rendering is mocked in this prototype: set aspect, fps and quality on the Render screen and a fake worker streams progress for ~6s. In the Electron build that swaps for the real Puppeteer-seek + ffmpeg pipeline with the same progress callback.`
  }
  return `Noted — I'd start from ${proj} on the ${ctx.view === 'home' ? 'Home' : ctx.view} screen. Everything I do here is mocked in the prototype, so try the Brief screen for a full walkthrough of the flow.`
}

export async function askGemini(userText: string, askCount: number): Promise<GeminiResult> {
  const api = (window as any).northframe?.ipc
  if (api) {
    try { return await api.invoke('gemini:ask', { prompt: userText, history: [], rundownContext: {} }) } catch { /* demo fallback */ }
  }
  return askGeminiLocal(userText, askCount)
}

export async function fakeAskGemini(userText: string, askCount: number) { return askGeminiLocal(userText, askCount) }
export async function fakeGeminiChat(text: string, ctx: { projectName: string | null; view: View }) {
  const api = (window as any).northframe?.ipc
  if (api) { try { return await api.invoke('gemini:chat', { text, ctx }) } catch { /* demo fallback */ } }
  return fakeGeminiChatLocal(text, ctx)
}

export { arenaPromptOf, slugify }
