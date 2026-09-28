#!/usr/bin/env node
/**
 * Every resource in every pack must Apply.
 *
 * For each of the ~3,000 catalogue items this applies the resource to an
 * empty project and to a busy one (a clip on every track at the playhead) and
 * asserts the result is something that works: an edit whose clips never
 * overlap, stay within the track limit, reference only ids the renderer
 * knows, carry sorted keyframes and title-safe text — or one of the explicit
 * UI actions (Lab capture, HTML render, voice command, link). A refusal is a
 * failure unless it is for a malformed item.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, '.resource-apply-check.mjs')
await build({
  bundle: true,
  outfile: tmp,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
  stdin: {
    contents: `
      export { applyResource, applyLabel } from './src/lib/studio/resourceApply'
      export { emptyStudioDoc, defaultTextClip, defaultGlassClip, docDuration, MAX_TRACKS } from './src/lib/studio/doc'
      export { suggestTextLooks } from './src/lib/studio/fontStyles'
      export { drawStudioFrame } from './src/lib/studio/renderer'
      export { TEXT_ANIMATIONS, TRANSITIONS } from './src/lib/studio/transitions'
      export { STUDIO_BACKGROUNDS } from './src/lib/studio/backgrounds'
      export { GLASS_PRESETS } from './src/lib/glass'
    `,
    resolveDir: root,
    sourcefile: 'check-resource-apply.ts',
    loader: 'ts',
  },
})
const mod = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })

const ANIMS = new Set(mod.TEXT_ANIMATIONS.map((a) => a.id))
const TRANS = new Set([...mod.TRANSITIONS.map((t) => t.id), 'none'])
const BGS = new Set(mod.STUDIO_BACKGROUNDS.map((b) => b.id))
const GLASS = new Set(mod.GLASS_PRESETS.map((g) => g.id))
const lottieIndex = JSON.parse(await readFile(path.join(root, 'resources/lottie/index.json'), 'utf8'))
const STICKERS = new Set([...(Array.isArray(lottieIndex) ? lottieIndex : lottieIndex.items ?? lottieIndex.stickers ?? []).map((s) => s.id ?? s), 'custom'])
for (const id of ['pulse-ring', 'arrow-nudge']) assert.ok(STICKERS.has(id), `sticker ${id} must exist`)
const EASES = new Set(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back-out', 'back-in', 'expo-out', 'expo-in-out', 'elastic-out', 'hold'])

function emptyDoc(aspect = '16:9') {
  return { ...mod.emptyStudioDoc(), aspect }
}

/** A clip on every one of the default tracks around t=2s, plus footage. */
function busyDoc(aspect = '16:9') {
  const doc = emptyDoc(aspect)
  const clips = []
  for (let track = 0; track < doc.trackCount; track += 1) {
    const clip = mod.defaultTextClip(0, track)
    clip.id = `busy-${track}`
    clip.name = `Busy ${track}`
    clip.durationSec = 6
    clips.push(clip)
  }
  clips.push({
    ...mod.defaultTextClip(6, 0),
    id: 'footage',
    kind: 'image',
    name: 'Product shot',
    mediaId: 'media-1',
    fileName: 'product.png',
    localPath: null,
    trimInSec: 0,
    sourceDurationSec: 0,
    speed: 1,
    volume: 1,
    fit: 'cover',
    durationSec: 5,
  })
  return { ...doc, clips }
}

const failures = []
function fail(item, label, message) {
  if (failures.length < 40) failures.push(`${item.kind}:${item.id} [${label}] ${message}`)
  else if (failures.length === 40) failures.push('…more failures truncated')
}

function checkDoc(item, label, before, doc) {
  if (doc.trackCount > mod.MAX_TRACKS) return fail(item, label, `trackCount ${doc.trackCount} > ${mod.MAX_TRACKS}`)
  const ids = new Set()
  const byTrack = new Map()
  for (const clip of doc.clips) {
    if (ids.has(clip.id)) return fail(item, label, `duplicate clip id ${clip.id}`)
    ids.add(clip.id)
    if (!(clip.track >= 0 && clip.track < doc.trackCount)) return fail(item, label, `${clip.name} on track ${clip.track} of ${doc.trackCount}`)
    if (!(clip.durationSec >= 0.2) || !Number.isFinite(clip.startSec) || clip.startSec < 0) return fail(item, label, `${clip.name} bad timing ${clip.startSec}+${clip.durationSec}`)
    if (!TRANS.has(clip.transitionIn) || !TRANS.has(clip.transitionOut)) return fail(item, label, `${clip.name} unknown transition ${clip.transitionIn}/${clip.transitionOut}`)
    if (clip.kind === 'text') {
      if (!ANIMS.has(clip.anim)) return fail(item, label, `${clip.name} unknown anim ${clip.anim}`)
      if (![400, 600, 800].includes(clip.weight)) return fail(item, label, `${clip.name} weight ${clip.weight}`)
      if (!clip.text.trim() || clip.text.length > 140) return fail(item, label, `${clip.name} text length ${clip.text.length}`)
      if (!(clip.fontSizePct >= 3 && clip.fontSizePct <= 14)) return fail(item, label, `${clip.name} size ${clip.fontSizePct}`)
    }
    if (clip.kind === 'background' && !BGS.has(clip.backgroundId)) return fail(item, label, `unknown background ${clip.backgroundId}`)
    if (clip.kind === 'glass' && !GLASS.has(clip.presetId)) return fail(item, label, `unknown glass preset ${clip.presetId}`)
    if (clip.kind === 'sticker' && !STICKERS.has(clip.stickerId)) return fail(item, label, `unknown sticker ${clip.stickerId}`)
    if ('x' in clip && (clip.x < 0 || clip.x > 1 || clip.y < 0 || clip.y > 1)) return fail(item, label, `${clip.name} off frame ${clip.x},${clip.y}`)
    if (clip.kind === 'glass' && (clip.w > 0.95 || clip.h > 0.95 || clip.w <= 0 || clip.h <= 0)) return fail(item, label, `${clip.name} panel ${clip.w}x${clip.h}`)
    let last = -1
    for (const key of clip.keyframes ?? []) {
      if (!(key.at >= 0 && key.at <= clip.durationSec + 1e-6)) return fail(item, label, `${clip.name} key at ${key.at} outside ${clip.durationSec}`)
      if (key.at < last) return fail(item, label, `${clip.name} keyframes unsorted`)
      if (key.ease && !EASES.has(key.ease)) return fail(item, label, `${clip.name} ease ${key.ease}`)
      last = key.at
    }
    const list = byTrack.get(clip.track) ?? []
    list.push(clip)
    byTrack.set(clip.track, list)
  }
  for (const [track, list] of byTrack) {
    list.sort((a, b) => a.startSec - b.startSec)
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].startSec < list[i - 1].startSec + list[i - 1].durationSec - 0.011) {
        return fail(item, label, `overlap on track ${track}: “${list[i - 1].name}” and “${list[i].name}”`)
      }
    }
  }
  // Existing clips survive (possibly lifted one track by a background).
  for (const old of before.clips) {
    const now = doc.clips.find((c) => c.id === old.id)
    if (!now) return fail(item, label, `existing clip ${old.id} was removed`)
    if (now.startSec !== old.startSec || now.durationSec !== old.durationSec) return fail(item, label, `existing clip ${old.id} was retimed`)
  }
  return true
}

const packDir = path.join(root, 'resources/packs')
const files = (await readdir(packDir)).filter((f) => f.endsWith('.json') && f !== 'index.json')
const tally = {}
let componentsQueued = 0
let total = 0
for (const file of files) {
  const pack = JSON.parse(await readFile(path.join(packDir, file), 'utf8'))
  for (const item of pack.items) {
    total += 1
    assert.ok(mod.applyLabel(item), `${item.id} needs an Apply label`)
    const cases = [
      ['empty 16:9', emptyDoc('16:9'), 1],
      ['busy 16:9', busyDoc('16:9'), 2],
      ['busy 9:16', busyDoc('9:16'), 2],
    ]
    for (const [label, doc, atSec] of cases) {
      const before = JSON.stringify(doc)
      let result
      try {
        result = mod.applyResource(doc, item, { atSec, selectedId: null, brief: [], hasLabDemo: () => true })
      } catch (error) {
        fail(item, label, `threw ${error?.stack?.split('\n').slice(0, 3).join(' | ') ?? error}`)
        continue
      }
      if (JSON.stringify(doc) !== before) fail(item, label, 'mutated the input document')
      if (!result.ok) {
        // Audited reference-only items (unsafe upstream source) must refuse, with the recorded reason.
        if (item.data?.referenceOnly === true && result.reason === item.data.refusal) { tally['reference-only→refused'] = (tally['reference-only→refused'] ?? 0) + 1; continue }
        fail(item, label, `refused: ${result.reason}`)
        continue
      }
      tally[`${item.kind}→${result.type}`] = (tally[`${item.kind}→${result.type}`] ?? 0) + 1
      if (result.type === 'doc') {
        if (checkDoc(item, label, JSON.parse(before), result.doc) !== true) continue
        if (result.focusId && !result.doc.clips.some((c) => c.id === result.focusId)) fail(item, label, 'focus clip missing')
        if (!(result.focusSec >= 0)) fail(item, label, `focusSec ${result.focusSec}`)
        // The playhead Apply jumps to must actually show the focused layer.
        const fc = result.focusId && result.doc.clips.find((c) => c.id === result.focusId)
        if (fc && !(fc.startSec <= result.focusSec + 1e-6 && result.focusSec < fc.startSec + fc.durationSec - 1e-6)) fail(item, label, `focus ${result.focusSec}s is outside the focused clip ${fc.startSec}–${fc.startSec + fc.durationSec}s`)
        if (fc && !(fc.opacity > 0)) fail(item, label, 'focused clip is invisible (opacity 0)')
        if (!result.message) fail(item, label, 'no message')
        if (JSON.stringify(result.doc) === before && item.kind !== 'font' && item.kind !== 'transition') fail(item, label, 'Apply changed nothing')
        if (item.kind === 'component' && result.needsStudio) {
          const placed = result.doc.clips.find((c) => c.id === result.focusId)
          if (!placed || placed.kind !== 'overlay' || placed.component?.slug !== item.id || placed.component.status !== 'pending') fail(item, label, 'component must arrive as a pending clip for the Studio recorder')
          else componentsQueued += 1
        }
      } else if (result.type === 'html-template') {
        assert.match(result.file, /^resources\/effects\/.+\.html$/)
      } else if (result.type === 'voice-command') {
        if (!result.phrase) fail(item, label, 'empty voice phrase')
      }
    }
  }
}

assert.ok(componentsQueued > 500, `real components must queue for live recording (got ${componentsQueued})`)

// Templates specifically: an all-media storyboard applies with placeholders on
// an empty project, and fills from project footage on a busy one.
const audiogram = JSON.parse(await readFile(path.join(packDir, 'remotion.json'), 'utf8')).items.find((i) => i.id === 'template-audiogram')
assert.ok(audiogram, 'Audiogram template must exist')
const recorder = JSON.parse(await readFile(path.join(packDir, 'remotion.json'), 'utf8')).items.find((i) => i.id === 'template-recorder')
assert.ok(recorder, 'Recorder template must exist')
const onEmpty = mod.applyResource(emptyDoc(), recorder, { atSec: 0 })
assert.equal(onEmpty.type, 'doc')
assert.ok(onEmpty.doc.clips.some((c) => c.kind === 'glass' && /drop your media/i.test(c.label ?? '')), 'empty project → placeholder panel')
const onBusy = mod.applyResource(busyDoc(), recorder, { atSec: 0 })
assert.ok(onBusy.doc.clips.some((c) => c.kind === 'image' && c.id !== 'footage'), 'busy project → media slot filled from footage')
const briefed = mod.applyResource(emptyDoc(), audiogram, { atSec: 0, brief: ['Cupric Weekly', 'We tried one habit for 30 days'] })
assert.ok(briefed.doc.clips.some((c) => c.kind === 'text' && c.text === 'Cupric Weekly'), 'brief copy fills the first text slot')

// A font applies to the selected text.
const fontItem = { kind: 'font', id: 'font-x', name: 'Sora', data: { family: 'Sora', weights: [400, 700] } }
const withText = busyDoc()
const fontApplied = mod.applyResource(withText, fontItem, { atSec: 1, selectedId: 'busy-1' })
assert.equal(fontApplied.doc.clips.find((c) => c.id === 'busy-1').fontFamily, 'Sora')

/* ——— JOB 5: every suggested look has a name, and Apply changes the frame ———
 *
 * The screenshot showed six look cards that all read "Dynamic" with captions
 * cut to "Socia…" / "Clea…" / "Need…", and an Apply that seemed to do nothing.
 * This block proves the opposite on both counts: each of the six looks has a
 * real name and a real reason, and applying it changes what the renderer
 * actually paints — measured by hashing the real draw calls, not by reading
 * the source.
 */
{
  const { createHash } = await import('node:crypto')

  /**
   * A 2D context that records instead of painting.
   *
   * Every property set and every method call is appended to a log, so the hash
   * of that log is a faithful signature of the frame: if two looks paint the
   * same pixels they produce the same log, and if a look changes nothing the
   * hash does not move. No canvas library needed.
   */
  const hashOf = (doc, t) => {
    const log = []
    const width = 1280, height = 720
    const target = {
      canvas: { width, height },
      measureText: (text) => ({ width: String(text).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 3 }),
      createLinearGradient: () => ({ addColorStop: (o, c) => log.push(`grad.stop ${o} ${c}`) }),
      createRadialGradient: () => ({ addColorStop: (o, c) => log.push(`rgrad.stop ${o} ${c}`) }),
      createPattern: () => null,
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: () => {},
      setLineDash: (d) => log.push(`setLineDash ${d}`),
      getLineDash: () => [],
      isPointInPath: () => false,
      drawImage: (...a) => log.push(`drawImage ${a.slice(1).join(',')}`),
    }
    const ctx = new Proxy(target, {
      get(obj, prop) {
        if (prop in obj) return obj[prop]
        if (typeof prop !== 'string') return undefined
        return (...args) => { log.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(3) : String(a))).join(',')})`) }
      },
      set(obj, prop, value) { log.push(`${String(prop)}=${typeof value === 'number' ? value.toFixed(3) : String(value)}`); obj[prop] = value; return true },
    })
    try { mod.drawStudioFrame(ctx, doc, t, width, height, { images: new Map(), videos: new Map(), lottie: new Map() }) } catch (err) {
      throw new Error(`drawStudioFrame threw while hashing a look: ${err.message}`)
    }
    return { hash: createHash('sha1').update(log.join('\n')).digest('hex'), calls: log.length }
  }

  const base = emptyDoc()
  const clip = { ...mod.defaultTextClip(0, 0), id: 'look-clip', text: 'Dynamic motion for social', durationSec: 4 }
  base.clips = [clip]
  const before = hashOf(base, 1.0)
  assert.ok(before.calls > 20, `the recording context saw a real frame (${before.calls} draw calls)`)

  const looks = mod.suggestTextLooks('Dynamic motion for social', { available: () => true, includeMissing: true }).slice(0, 6)
  assert.equal(looks.length, 6, 'the panel offers six looks')

  const seenNames = new Set()
  const seenStems = new Set()
  const seenHashes = new Map([[before.hash, 'unchanged clip']])
  for (const look of looks) {
    // 1. A card that cannot be named cannot be chosen.
    assert.ok(look.name && look.name.trim().length >= 3, `look ${look.id} has a real name`)
    assert.ok(!/^(dynamic|look|style|untitled|preset)$/i.test(look.name.trim()), `look name "${look.name}" is specific, not a generic label`)
    assert.ok(look.why && look.why.trim().length >= 20, `look "${look.name}" explains itself in a full sentence`)
    assert.ok(!seenNames.has(look.name), `look name "${look.name}" is not a duplicate of another card`)
    seenNames.add(look.name)
    // Six cards must be six *recipes*, not three recipes shown twice.
    const stem = look.name.split(' · ')[0]
    assert.ok(!seenStems.has(stem), `"${look.name}" is a different pairing, not a recolour of ${stem}`)
    seenStems.add(stem)
    assert.ok(look.patch.fontFamily && look.patch.emphasisFont, `look "${look.name}" names both of its fonts`)

    // 2. Applying it must change what the renderer paints.
    const after = hashOf({ ...base, clips: [{ ...clip, ...look.patch }] }, 1.0)
    assert.notEqual(after.hash, before.hash, `applying "${look.name}" changes the rendered frame`)
    const clash = seenHashes.get(after.hash)
    assert.ok(!clash, `"${look.name}" renders differently from ${clash}`)
    seenHashes.set(after.hash, `"${look.name}"`)
  }
  assert.equal(seenHashes.size, 7, 'six looks produce six distinct frames, all different from the untouched clip')

  // 3. The UI shows the name in full and names it again on apply.
  const fontStudio = await readFile(path.join(root, 'src/screens/studio/FontStudio.tsx'), 'utf8')
  const chip = fontStudio.slice(fontStudio.indexOf('function LookChip'), fontStudio.indexOf('export function FontStudio'))
  assert.match(chip, /\{look\.name\}/, 'the card renders the look name')
  assert.doesNotMatch(chip, /truncate[^\n]*\{look\.name\}/, 'the name is not truncated')
  assert.ok(!/className="[^"]*truncate[^"]*"[^>]*>\{look\.name\}/.test(chip), 'the name span carries no truncate class')
  assert.match(fontStudio, /pushToast\('success', `Applied “\$\{look\.name\}”/, 'applying a look raises a toast that names it')
  console.log(`JOB 5 check passed — 6 named looks (${[...seenNames].join(', ')}), each with a reason, each producing a distinct rendered frame`)
}

if (failures.length) {
  console.error(`resource apply check FAILED (${failures.length}):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`resource apply check passed — ${total} items × 3 projects: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`)
