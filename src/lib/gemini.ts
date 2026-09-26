import type { SceneRundown, View } from '../types/project'
import { getIpc } from './bridge'
import { effectsPromptAppendix } from './effects'
import { round1, slugify, uid } from './utils'

/**
 * Gemini / OpenCode co-pilot.
 * Desktop calls live models when a key is configured; otherwise the same UI
 * uses a deterministic local planner so the editing workflow still runs.
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
  if (!cleaned) return 'Cupric AI'
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

/** Default effect sets per flavor for richer local + Arena prompts */
const FLAVOR_EFFECTS: Record<Flavor, string[]> = {
  logo: ['bg-lime-haze', 'tr-scale-overshoot'],
  quote: ['bg-dot-field', 'mo-word-reveal', 'cap-hormozi'],
  saas: ['bg-soft-grid', 'mo-counter-tick', 'tr-mask-wipe'],
  podcast: ['bg-soft-grid', 'cap-hormozi'],
  generic: ['bg-lime-haze', 'mo-word-reveal'],
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
      mk(hookEnd, bodyEnd, 'attribution', '— Cupric AI', 'fade up, letter-spacing settles'),
      mk(bodyEnd, dur, 'mark', 'CUPRIC AI', 'scale 0.96 -> 1 spring, hold'),
    ]
  }

  const scenes = [
    mk(0, hookEnd, 'hook', `${topic.toUpperCase()}`, 'oversized type snaps in at 0.96 scale, tracking tightens'),
  ]
  if (flavor === 'saas' || flavor === 'podcast') {
    scenes.push(
      mk(
        hookEnd,
        bodyEnd,
        'proof',
        flavor === 'saas' ? 'Edit video with a sentence.' : 'The moment everyone went quiet.',
        'line-by-line rise, 80ms stagger',
      ),
    )
  } else {
    scenes.push(mk(hookEnd, bodyEnd, 'body', `${topic} — in motion.`, 'mask wipe left-to-right, ease-out'))
  }
  scenes.push(mk(bodyEnd, dur, 'cta', 'cupric.ai — Oct 2', 'counter ticks up, fade to logo'))
  return scenes
}

function sceneSequenceLines(r: Pick<SceneRundown, 'scenes'>): string {
  return r.scenes
    .map(
      (s, index) =>
        `${index + 1}. ${s.from}-${s.to}s | ${s.type.toUpperCase()} | on-screen copy: "${s.copy}" | motion: ${s.motion}`,
    )
    .join('\n')
}

function arenaPromptOf(
  r: Pick<SceneRundown, 'durationSec' | 'fps' | 'size' | 'style' | 'scenes'>,
  effectIds: string[] = [],
): string {
  return `Build a SINGLE FILE index.html motion-graphics piece for Cupric AI to capture as video.

HARD CONSTRAINTS:
- Return only the final index.html code.
- One file only: inline CSS and inline JavaScript, no build step.
- Root element must be #scene exactly ${r.size[0]}x${r.size[1]} px.
- Duration is exactly ${r.durationSec}s at ${r.fps}fps.
- Implement window.__seek(t). Every frame must be a pure deterministic function of t.
- No CSS animations, no setTimeout, no request-based randomness, no Math.random in the frame loop.
- Do not fetch remote assets. Do not rely on external fonts, CDNs, images, audio, or video.

SOURCE / ASSET PLAN:
- Visual sources are generated inside this HTML: typography, CSS/SVG shapes, gradients, grids, counters, masks, and light texture.
- Text source is the scene copy below; keep spelling exact unless making tiny line-break changes for layout.
- If you need icons or marks, draw them with inline SVG/CSS only.
- Include window.__cupricSourceManifest = { sources, sequence, renderSpec } so Cupric AI can inspect how the video was generated.

STYLE:
${r.style}
${effectsPromptAppendix(effectIds)}

SEQUENCE / TIMELINE:
${sceneSequenceLines(r)}

IMPLEMENTATION NOTES:
- At t=0 the first scene must be visible and valid.
- All scene transitions must happen according to the timeline above.
- Use safe-area margins and responsive scaling inside the fixed #scene canvas.
- Expose clear variables for duration, fps, scenes, and sourceManifest.
- The piece should look like a finished video, not a placeholder: polished typography, motion hierarchy, background design, and a final hold.`
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
  const effectIds = FLAVOR_EFFECTS[flavor]

  const base: SceneRundown = {
    title: `${topic} — ${dur}s ${FLAVOR_LABEL[flavor]}`,
    durationSec: dur,
    fps: 30,
    size: [1920, 1080],
    style: STYLES[flavor],
    scenes: buildScenes(dur, flavor, topic),
    arenaPrompt: '',
  }
  base.arenaPrompt = arenaPromptOf(base, effectIds)

  if (askCount === 0) {
    const openers = [
      `Love this direction. I sketched a ${dur}s ${FLAVOR_LABEL[flavor]} — ${base.scenes.length} scenes, dark base with one lime accent. Effects: ${effectIds.join(', ')}. I'm filling the rundown on the right field by field. Tweak anything, or tell me to push the copy harder.`,
      `Good brief. Here's a first pass: a ${dur}s ${FLAVOR_LABEL[flavor]} in ${base.scenes.length} beats, opening big and landing on a clean CTA. Watch the rundown fill in — then ask me for revisions or lock it.`,
    ]
    return { text: pick(openers, seed), rundownPatch: { ...base } }
  }

  base.scenes = base.scenes.map((s) =>
    s.type === 'cta' ? { ...s, motion: 'counter ticks up in tabular numerals, fade to logo' } : s,
  )
  base.arenaPrompt = arenaPromptOf(base, effectIds)
  const refinements = [
    `Tightened the timing and punched up the copy — the CTA now ticks in on tabular numerals. Arena prompt includes effect cues (${effectIds.join(', ')}). Copy it into arena.ai/code, run the battle, vote, then drop the winning .zip into the Arena Desk.`,
    `Sharpened it. Every beat now has motion cues a renderer can follow deterministically. The Arena prompt is ready — paste into arena.ai/code. Win the battle, bring me the .zip.`,
  ]
  return { text: pick(refinements, seed), rundownPatch: { ...base } }
}

/** Local planner replies for the Ask panel when no live model is configured. */
export async function geminiChatLocal(
  text: string,
  ctx: { projectName: string | null; view: View },
): Promise<string> {
  await wait(700 + Math.random() * 600)
  const t = text.toLowerCase()
  const proj = ctx.projectName ? `“${ctx.projectName}”` : 'a project'

  if (/rundown|idea|bumper|sting|quote|concept|12s|short/.test(t)) {
    return `Happy to. Head to the Brief screen and type the raw idea — I'll draft the scene rundown there, field by field, and you can lock it when it feels right. Add a Gemini/OpenCode key or import OpenCode Desktop models in settings for live answers; web preview uses the local fallback.`
  }
  if (/import|zip|arena flow|how does the arena|battle|vote/.test(t)) {
    return `The Arena flow: 1) Lock a rundown in the Brief. 2) Copy the Arena prompt from the Arena Desk. 3) Paste it into arena.ai/code and let two models battle. 4) Vote, download the winner's .zip, and drop it into the Arena Desk — it lands as an imported asset you can preview and render.`
  }
  if (/caption|hormozi|subtitle/.test(t)) {
    return `Captions live on the Footage Desk. Pick a style per clip — Hormozi (big, punched, one lime word), Standard (clean white), or Minimal (quiet chip) — mark the silence cuts to drop, then Apply. The edit shows up on the Timeline.`
  }
  if (/render|export|mp4/.test(t)) {
    return `Rendering uses the desktop seek-and-FFmpeg pipeline when you run Cupric AI in Electron: Arena pieces are captured frame by frame, footage is trimmed/cropped, and progress streams back into the Render queue. Web preview keeps a local fallback.`
  }
  if (/effect|gradient|background|resource/.test(t)) {
    return `Open Library → Effects / Backgrounds. Those packs feed Arena prompts and local generation — soft grid, lime haze, Hormozi captions, mask wipes, tabular counters. App chrome stays flat; stage backgrounds are for the piece only.`
  }
  return `Noted — I'd start from ${proj} on the ${ctx.view === 'home' ? 'Home' : ctx.view} screen. Without a live model I answer from the local planner; imports, previews, and browser/desktop renders still use real local media where available.`
}

export async function askGemini(userText: string, askCount: number): Promise<GeminiResult> {
  const api = getIpc()
  if (api) {
    try {
      return (await api.invoke('gemini:ask', { prompt: userText, history: [], rundownContext: {} })) as GeminiResult
    } catch {
      /* local fallback */
    }
  }
  return askGeminiLocal(userText, askCount)
}

export async function askGeminiChat(text: string, ctx: { projectName: string | null; view: View }) {
  const api = getIpc()
  if (!api) {
    return 'Live chat needs the desktop app so Cupric AI can call Gemini or an OpenCode/OpenAI-compatible model securely. Video creation still works locally from the Brief screen.'
  }
  try {
    return await api.invoke('gemini:chat', { text, ctx })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '')
    return `No live AI model is connected yet. Open settings, choose a free OpenCode preset such as an OpenRouter “:free” model or local Ollama, then save your key/base URL. (${message})`
  }
}

export { arenaPromptOf, slugify }
