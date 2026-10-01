#!/usr/bin/env node
/**
 * check:readiness — what this machine can do, and what it is missing.
 *
 * `readiness.ts` is the wording and the blocking rules (adapted from open-edit's
 * `readiness` command, Apache-2.0); `readinessFacts.ts` is the gathering. The
 * point of the check is that a miss must always come with a remedy, must never
 * claim a capability the machine does not have, and must diagnose the
 * present-but-broken case differently from the absent one — because "install it"
 * is the wrong advice for a binary that is already there.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.check-readiness.mjs')
await build({
  bundle: true, outfile: out, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: { contents: "export * from './src/lib/readiness'\nexport * as facts from './src/lib/readinessFacts'", resolveDir: root, loader: 'ts' },
})
const m = await import(pathToFileURL(out).href)
await rm(out, { force: true })

let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const eq = (a, b, msg) => { assert.equal(a, b, msg); n += 1 }
const read = (p) => readFileSync(path.join(root, p), 'utf8')

const ideal = {
  desktop: true,
  ffmpeg: true,
  ffprobe: true,
  whisper: true,
  windowsSpeech: false,
  whisperModel: 'ggml-base.en-q5_1.bin',
  piper: { en: true, hi: true },
  localModel: true,
  aiConfigured: true,
  stock: { pixabay: true, pexels: false, proxy: false },
  missingMedia: 0,
  clips: 12,
  renderable: true,
}
const report = m.describeReadiness(ideal)

/* ——— a complete machine ——— */
{
  ok(report.ok, 'a machine with everything installed is ready')
  eq(report.blocking.length, 0, 'with nothing blocking')
  eq(report.optional.length, 0, 'and nothing optional missing')
  eq(report.checks.length, 8, 'every capability is reported, not just the failures')
  ok(report.checks.every((c) => c.detail.length > 0), 'each one says what it found')
  ok(report.checks.every((c) => c.ok || c.remedy), 'and a miss always carries a remedy')
  ok(/Ready/.test(report.summary), `the summary says so (${report.summary})`)
  eq(m.readinessLine(report), 'Ready', 'and the one-liner agrees')
  eq(m.readinessRemedies(report).length, 0, 'with nothing to remedy')
  ok(report.checks.some((c) => c.id === 'captions' && /model ggml-base\.en-q5_1\.bin/.test(c.detail)), 'the caption check names the model it will use')
}

/* ——— the browser build ——— */
{
  const web = m.describeReadiness({
    ...ideal,
    desktop: false,
    ffmpeg: false,
    ffprobe: false,
    whisper: false,
    whisperModel: null,
    piper: null,
    localModel: false,
    aiConfigured: false,
    webDraft: true,
  })
  const doc = web.checks.find((c) => c.id === 'desktop')
  ok(!doc.ok && doc.blocking, 'the browser build is blocking, and says why')
  ok(/browser build/.test(doc.detail) && /WebM draft/.test(doc.detail), `its detail names the real consequence (${doc.detail})`)
  ok(!web.ok, 'so the report is not ready')
  ok(web.blocking.length >= 3, `and every blocker is named (${web.blocking.map((c) => c.id).join(', ')})`)
  ok(/would stop a run/.test(web.summary), 'the summary counts the blockers')
  ok(!web.summary.includes('optional'), 'and does not bury the blocking ones under the optional list')
  ok(web.checks.every((c) => c.remedy || c.ok), 'every miss in the browser build still offers a remedy')
  // The voiceover row is desktop-only: a browser must not be nagged about Piper.
  ok(!web.checks.some((c) => c.id === 'voiceover'), 'a capability the platform cannot have is not reported as missing')
}

/* ——— present but broken ——— */
{
  const halfFfmpeg = m.describeReadiness({ ...ideal, ffprobe: false })
  const check = halfFfmpeg.checks.find((c) => c.id === 'ffmpeg')
  ok(!check.ok, 'one missing half is a miss')
  ok(check.broken === true, 'flagged as present-but-not-runnable, which is the case that needs a different remedy')
  ok(/not both halves/.test(check.detail), `and the detail says which half is missing (${check.detail})`)
  const absent = m.describeReadiness({ ...ideal, ffmpeg: false, ffprobe: false })
  const gone = absent.checks.find((c) => c.id === 'ffmpeg')
  ok(/Not found/.test(gone.detail) && gone.broken === undefined, 'a tool that is absent is diagnosed differently from one that is present')
  ok(/ffmpeg-static|NEWBRAND_FFMPEG_PATH/.test(gone.remedy), 'with the remedy for the absence')
  ok(/NEWBRAND_FFMPEG_PATH/.test(check.remedy) && !/Not found/.test(check.detail), 'and a different remedy for the broken case')
}

/* ——— optional is not blocking, and blocking is not optional ——— */
{
  const quiet = m.describeReadiness({ ...ideal, whisper: false, windowsSpeech: false, piper: null, stock: { pixabay: false, pexels: false, proxy: false } })
  ok(quiet.ok, 'no captions engine and no stock keys do not stop a render')
  eq(quiet.optional.length, 3, 'the three optional misses are counted')
  eq(quiet.blocking.length, 0, 'and none of them is blocking')
  ok(/Ready to render/.test(quiet.summary), `so the summary says ready (${quiet.summary})`)
  eq(m.readinessLine(quiet), 'Ready · 3 optional', 'the one-liner counts the optional ones')
  eq(m.readinessRemedies(quiet).length, 3, 'and each has something to do about it')

  const missingMedia = m.describeReadiness({ ...ideal, missingMedia: 4 })
  const check = missingMedia.checks.find((c) => c.id === 'media')
  ok(!check.ok && check.blocking, 'clips whose files are gone are blocking: they render black')
  ok(/4 clip\(s\)/.test(check.detail), `the count is in the detail (${check.detail})`)
  ok(/Relink/.test(check.remedy), 'with relinking as the remedy')

  const empty = m.describeReadiness({ ...ideal, clips: 0, renderable: false })
  const nothing = empty.checks.find((c) => c.id === 'timeline')
  ok(!nothing.ok && nothing.blocking, 'a project with no timeline is blocking too')
  ok(/empty video/.test(nothing.detail), 'and says what would actually happen')
  ok(m.describeReadiness({ ...ideal, clips: 0, renderable: true }).ok, 'unless a locked rundown makes it renderable — clips are not the only way')

  const noAi = m.describeReadiness({ ...ideal, aiConfigured: false, localModel: false })
  const ai = noAi.checks.find((c) => c.id === 'ai')
  ok(!ai.ok && ai.blocking, 'without a provider, writing and planning cannot work')
  ok(/local model/.test(ai.remedy), `and the free option is offered first (${ai.remedy})`)
  ok(m.describeReadiness({ ...ideal, aiConfigured: true, localModel: false }).ok, 'a configured key is enough')
}

/* ——— the gathering, as far as it can be tested without Electron ——— */
{
  // Reading a project's clips against the (empty) media registry is pure.
  const clip = (kind, mediaId) => ({ id: `c-${mediaId ?? kind}`, kind, name: 'Clip', track: 0, startSec: 0, durationSec: 1, ...(mediaId ? { mediaId } : {}) })
  const doc = { clips: [clip('video', 'm1'), clip('video', 'm2'), clip('text', null), clip('audio', 'm3')], trackCount: 3 }
  eq(m.facts.missingMediaCount(doc), 3, 'every clip whose media is not loaded is counted')
  eq(m.facts.missingMediaCount({ clips: [clip('text', null)] }), 0, 'text clips are not media')
  eq(m.facts.missingMediaCount(null), 0, 'and no project is not an error')

  // No IPC in this process: the gatherer must answer the browser-shaped subset
  // rather than throwing, and must not claim a desktop capability.
  const facts = await m.facts.gatherReadinessFacts(doc)
  eq(facts.desktop, false, 'without IPC the facts say so')
  eq(facts.ffmpeg, false, 'and nothing the desktop would have found is claimed')
  eq(facts.whisper, false, 'including the offline recogniser')
  eq(facts.missingMedia, 3, 'while the project facts still come from the document')
  ok(facts.renderable === true, 'and something to render is inferred from the clips')
  const rendered = await m.facts.gatherReadinessFacts(doc, { renderable: false })
  eq(rendered.renderable, false, 'unless the caller knows better')

  const panel = read('src/app-shell/ReadinessPanel.tsx')
  ok(/gatherReadinessFacts/.test(panel) && /describeReadiness/.test(panel), 'the panel gathers and describes')
  ok(/Re-check/.test(panel), 'and can re-probe without reopening the drawer — a stale “no FFmpeg” is worse than none')
  ok(!/localStorage\.setItem|ipc\.invoke\('settings:set'/.test(panel), 'it is read-only: nothing here writes or installs')
  ok(/ReadinessPanel/.test(read('src/app-shell/AskPanel.tsx')), 'and it is reachable from the settings drawer')
}

console.log(`readiness check passed — ${n} assertions`)
