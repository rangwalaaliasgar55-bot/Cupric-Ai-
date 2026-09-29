#!/usr/bin/env node
/**
 * check:creative-log — what a piece of footage has already been through.
 *
 * `studio/creativeLog.ts` records accepted/rejected looks per source clip, requires a reason
 * for both, keeps a corrupt store instead of overwriting it, and turns the history into the
 * prose a later creative round is given. Adapted from open-edit's `creative-log`
 * (Apache-2.0). Everything is pure except the storage helpers, which this check exercises
 * against a stubbed `localStorage`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.check-creative-log.mjs')

/* A localStorage stub, installed before the module is imported: the log's storage helpers
 * read `typeof localStorage` at call time, and Node has no browser. */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

await build({
  bundle: true, outfile: out, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: {
    contents: "export * from './src/lib/studio/creativeLog'\nexport * as design from './src/lib/studio/design'\nexport * as doc from './src/lib/studio/doc'",
    resolveDir: root, loader: 'ts',
  },
})
const m = await import(pathToFileURL(out).href)
await rm(out, { force: true })

let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const eq = (a, b, msg) => { assert.equal(a, b, msg); n += 1 }
const deepEq = (a, b, msg) => { assert.deepEqual(a, b, msg); n += 1 }
const read = (p) => readFileSync(path.join(root, p), 'utf8')

/* ——— identity: the footage, not the round ——— */

eq(m.creativeKeyOf({ localPath: '/v/a.mp4', fileName: 'a.mp4' }), '/v/a.mp4', 'the file path is the identity when there is one')
eq(m.creativeKeyOf({ localPath: '  ', fileName: 'a.mp4', mediaId: 'm1' }), 'a.mp4', 'a blank path falls back to the file name')
eq(m.creativeKeyOf({ fileName: '', mediaId: 'm1' }), 'm1', 'then to the media handle')
eq(m.creativeKeyOf({ mediaId: '', name: 'Clip 2' }), 'Clip 2', 'then to the clip name')
eq(m.creativeKeyOf({ name: '', id: 'c9' }), 'c9', 'and last to the clip id, so two unnamed clips stay apart')

const video = (id, startSec, durationSec, extra = {}) => ({
  id, kind: 'video', startSec, durationSec, track: 0, name: id, localPath: `/v/${id}.mp4`, fileName: `${id}.mp4`, mediaId: `m-${id}`,
  trimInSec: 0, sourceDurationSec: durationSec, speed: 1, volume: 1, fit: 'cover', transitionIn: 'none', transitionOut: 'none', opacity: 1, ...extra,
})
const textClip = (id, startSec, durationSec) => ({
  id, kind: 'text', startSec, durationSec, track: 1, name: id, text: 'Hello', fontFamily: 'Inter', fontSizePct: 6, x: 0.5, y: 0.5, color: '#fff',
  transitionIn: 'none', transitionOut: 'none', opacity: 1,
})

const docWith = (clips) => ({ ...m.doc.emptyStudioDoc(), clips })

const timeline = docWith([video('first', 0, 4), video('second', 4, 4)])
eq(m.footageKeyFor(timeline, 5, 1), '/v/second.mp4', 'the video under the clip’s midpoint owns the history')
eq(m.footageKeyFor(timeline, 4.9, 0.2), '/v/second.mp4', 'a clip straddling the cut belongs to the picture it mostly sits on')
eq(m.footageKeyFor(timeline, 0, 1), '/v/first.mp4', 'the first video owns the start')
eq(m.footageKeyFor(docWith([textClip('only-text', 0, 2)]), 0, 1), null, 'text over nothing has no footage identity')
eq(m.footageKeyFor(docWith([video('v', 10, 2)]), 1, 1), '/v/v.mp4', 'a clip before the first video takes that video')
eq(m.footageKeyFor(docWith([video('hidden', 0, 4, { hidden: true })]), 1, 1), null, 'hidden clips are not footage')

const underText = docWith([video('v', 0, 4), textClip('cap', 1, 1)])
eq(m.entryForClip(underText, underText.clips[1], {})?.source, '/v/v.mp4', 'a text clip reads the history of the picture under it')
eq(m.entryForClip(docWith([textClip('t', 0, 1)]), { startSec: 0, durationSec: 1 }, {}), null, 'and has none when there is no picture')

/* ——— reject / accept: the reason is the point ——— */

const key = '/v/a.mp4'
let log = {}

const noWhat = m.rejectLook(log, key, { what: '   ', why: 'too busy' })
eq(noWhat.ok, false, 'a rejection with nothing described is refused')
ok(/Say what was tried/.test(noWhat.message), 'and says what is missing')
eq(m.logEntry(noWhat.log, key).rejected.length, 0, 'nothing is written for it')

const noWhy = m.rejectLook(log, key, { what: 'Typographic stack on a lime void', why: '' })
eq(noWhy.ok, false, 'a rejection with no reason is refused')
ok(/reason is required/.test(noWhy.message), 'with the upstream wording: a list without reasons cannot tell a later pass what to avoid')
eq(m.logEntry(noWhy.log, key).rejected.length, 0, 'nothing is written for it either')

const first = m.rejectLook(log, key, { what: 'Typographic stack on a lime void', why: 'the type fought the logo', directionId: 'typography' }, 1000)
eq(first.ok, true, 'a rejection with a reason is recorded')
eq(first.entry.rejected.length, 1, 'and kept on the footage')
eq(first.entry.rejected[0].why, 'the type fought the logo', 'with its reason')
eq(first.entry.rejected[0].directionId, 'typography', 'and the direction it names, when it names one')
eq(first.entry.rejected[0].at, 1000, 'stamped when it was recorded')

const second = m.rejectLook(first.log, key, { what: 'Full-bleed gradient with centred caps', why: 'reads as a stock template' }, 2000)
eq(second.entry.rejected.length, 2, 'rejections accumulate')
deepEq(second.entry.rejected.map((r) => r.what), ['Typographic stack on a lime void', 'Full-bleed gradient with centred caps'], 'in the order they were tried')

const again = m.rejectLook(second.log, key, { what: 'Typographic stack on a lime void', why: 'the type fought the logo' }, 3000)
eq(again.ok, true, 'the same look reported twice is accepted as a no-op record')
eq(again.entry.rejected.length, 2, 'a re-run does not inflate the history')
ok(/already on the rejected list/.test(again.message), 'and the caller is told it changed nothing')

const other = m.rejectLook(again.log, '/v/b.mp4', { what: 'Hard cut to white', why: 'flashy' }, 3100)
eq(m.logEntry(other.log, '/v/a.mp4').rejected.length, 2, 'the log is per footage: another clip’s rejection does not touch this one')
eq(m.logEntry(other.log, '/v/b.mp4').rejected.length, 1, 'and is kept on its own clip')

const noAcceptWhy = m.acceptLook(other.log, key, { what: 'Composition-led grid', why: ' ' })
eq(noAcceptWhy.ok, false, 'an acceptance with no reason is refused — “why it landed” is the bar for the next round')
const accepted = m.acceptLook(other.log, key, { what: 'Composition-led grid', why: 'graphic, bright and punchy', directionId: 'composition' }, 4000)
eq(accepted.entry.accepted.what, 'Composition-led grid', 'an acceptance is recorded')
eq(accepted.entry.rejected.length, 2, 'and the rejections survive it — they only ever accumulate')
const replaced = m.acceptLook(accepted.log, key, { what: 'Atmosphere-led haze', why: 'calmer, and it suits the B-roll' }, 5000)
eq(replaced.entry.accepted.what, 'Atmosphere-led haze', 'a later acceptance replaces the previous one')
eq(replaced.entry.rejected.length, 2, 'still without touching the rejections')

/* ——— the brief: what a later round is told ——— */

eq(m.creativeBrief(null), '', 'no footage means no brief')
eq(m.creativeBrief(m.emptyEntry(key)), '', 'and a first round carries no ceremony')
const brief = m.creativeBrief(replaced.entry)
ok(/WHAT WAS ACCEPTED ON THIS FOOTAGE, AND WHY — this is the bar, not a thing to copy:/.test(brief), 'the accepted block names itself as the bar rather than a thing to copy')
ok(/Atmosphere-led haze/.test(brief) && /calmer, and it suits the B-roll/.test(brief), 'the accepted look and its reason are both in it')
ok(/ALREADY TRIED ON THIS FOOTAGE AND REJECTED — do not land on any of these again:/.test(brief), 'the rejected block says not to land on them again')
ok(/· Typographic stack on a lime void — rejected because the type fought the logo/.test(brief), 'each rejection carries its reason')
ok(brief.indexOf('WHAT WAS ACCEPTED') < brief.indexOf('ALREADY TRIED'), 'the accepted look is stated first')
eq(brief.split('\n\n').length, 2, 'and the two blocks are separated by one blank line')

deepEq(m.avoidedDirections(replaced.entry), ['typography'], 'the rejected direction is the one to avoid')
deepEq(m.avoidedDirections(m.emptyEntry(key)), [], 'nothing recorded means nothing to avoid')
const dupes = m.rejectLook(replaced.log, key, { what: 'Another type-led pass', why: 'same problem', directionId: 'typography' }, 6000)
deepEq(m.avoidedDirections(dupes.entry), ['typography'], 'and the list is deduplicated')

/* ——— the design battle honours the log ——— */

const designDoc = docWith([
  { ...video('shot', 0, 6), kind: 'text', text: 'Ship faster', words: null },
])
const ids = designDoc.clips.map((c) => c.id)
const makeId = (() => { let k = 0; return () => `n${k++}` })()
const all = m.design.designAll(designDoc, { aspect: '16:9' }, ids, makeId)
eq(all.skipped.length, 0, 'nothing is skipped without a log')
eq(all.battle.length, 3, 'and all three directions are scored')
eq(all.skippedNote, undefined, 'with nothing to explain')

const avoided = m.design.designAll(designDoc, { aspect: '16:9' }, ids, makeId, { avoid: ['typography'] })
eq(avoided.battle.length, 2, 'a rejected direction is not scored again')
deepEq(avoided.skipped.map((s) => s.id), ['typography'], 'and the caller is told which one was skipped')
ok(avoided.battle.every((b) => b.id !== 'typography'), 'the skipped direction is absent from the battle')
ok(avoided.report.direction.id !== 'typography', 'and cannot win it')

const explicit = m.design.designAll(designDoc, { aspect: '16:9' }, ids, makeId, { only: 'typography', avoid: ['typography'] })
eq(explicit.battle.length, 1, 'an explicit direction wins over the skip list — the user asked for that one')
eq(explicit.skipped.length, 0, 'so nothing is reported as skipped')

const allRejected = m.design.designAll(designDoc, { aspect: '16:9' }, ids, makeId, { avoid: ['typography', 'composition', 'atmosphere'] })
eq(allRejected.battle.length, 3, 'when every direction has been rejected the battle runs them all rather than nothing')
eq(allRejected.skipped.length, 0, 'and reports no skips')
ok(/Every direction has been rejected on this footage/.test(allRejected.skippedNote ?? ''), 'with a note saying so and how to stop it')
eq(m.design.designAll(designDoc, { aspect: '16:9' }, ids, makeId, {}).doc.clips.length, all.doc.clips.length, 'the design result is unchanged by an empty avoid list')

/* ——— storage: read through a corrupt log, never write through it ——— */

store.clear()
eq(m.readCreativeLog().log && Object.keys(m.readCreativeLog().log).length, 0, 'an empty store reads as empty')
eq(m.readCreativeLog().corrupt, false, 'and is not flagged')

const stored = m.recordRejection('/v/a.mp4', { what: 'Lime void', why: 'too loud', directionId: 'atmosphere' })
eq(stored.ok, true, 'recording through the storage helpers works')
eq(JSON.parse(store.get('cupric.creative-log.v1'))['/v/a.mp4'].rejected.length, 1, 'and lands in the store')
eq(JSON.parse(store.get('cupric.creative-log.v1'))['/v/a.mp4'].rejected[0].what, 'Lime void', 'with the look described')
eq(m.readCreativeLog().log['/v/a.mp4'].rejected.length, 1, 'a fresh read sees it')
eq(m.briefForKey('/v/a.mp4').includes('Lime void'), true, 'the brief for a footage key is the stored history')

store.set('cupric.creative-log.v1', '{ this is not json')
const corruptRead = m.readCreativeLog()
eq(corruptRead.corrupt, true, 'a corrupt store is flagged on read — history is a helper, not a gate')
eq(Object.keys(corruptRead.log).length, 0, 'and reads as empty rather than throwing')
const wrote = m.writeCreativeLog({ '/v/c.mp4': m.emptyEntry('/v/c.mp4') })
eq(wrote.preserved, 'cupric.creative-log.v1.corrupt', 'writing preserves the unparsable text instead of erasing it')
eq(store.get('cupric.creative-log.v1.corrupt'), '{ this is not json', 'the corrupt text is kept verbatim')
ok(store.get('cupric.creative-log.v1').startsWith('{"/v/c.mp4"'), 'and the new store is written')

store.set('cupric.creative-log.v1', 'still not json')
// A read is what flags it — the same order the app uses (read, then write).
eq(m.readCreativeLog().corrupt, true, 'a later corruption is flagged on its own read')
const secondCorruption = m.writeCreativeLog({})
eq(secondCorruption.preserved, 'cupric.creative-log.v1.corrupt.1', 'a second corruption gets its own name')
eq(store.get('cupric.creative-log.v1.corrupt'), '{ this is not json', 'so it never replaces the first one')
eq(m.readCreativeLog().corrupt, false, 'and the flag clears once the text has been kept')

store.clear()
const many = {}
for (let i = 0; i < m.CREATIVE_LOG_LIMIT + 3; i += 1) {
  many[`/v/${i}.mp4`] = { source: `/v/${i}.mp4`, rejected: [{ what: `look ${i}`, why: 'rejected', at: 1000 + i }] }
}
m.writeCreativeLog(many)
const kept = m.readCreativeLog().log
eq(Object.keys(kept).length, m.CREATIVE_LOG_LIMIT, `the log keeps ${m.CREATIVE_LOG_LIMIT} footage entries`)
eq(Boolean(kept['/v/0.mp4']), false, 'the oldest activity is the first to go')
eq(Boolean(kept[`/v/${m.CREATIVE_LOG_LIMIT + 2}.mp4`]), true, 'and the newest is kept')
const stats = m.creativeLogStats(kept)
eq(stats.footage, m.CREATIVE_LOG_LIMIT, 'the stats count the footage with a history')
eq(stats.rejected, m.CREATIVE_LOG_LIMIT, 'and the rejections on file')
eq(stats.accepted, 0, 'and the accepted looks, of which there are none')
m.resetCreativeMemory()
store.clear()

/* ——— prompt wording survives the storage round trip ——— */

const prompt = m.creativeBrief(replaced.entry)
const aiText = read('src/lib/studio/aiText.ts')
ok(/requestTextVariants\(text: string, brief = ''\)/.test(aiText), 'the rewrite request takes the footage history')
ok(/The text sits over footage with a history\. Treat it as a constraint, not as material to reuse/.test(aiText), 'and attaches it to the model prompt as a constraint')
ok(/PROMPT\(clean, brief\)/.test(aiText), 'passing it through both the IPC and the OpenCode paths')
ok(prompt.trim().length > 0, 'the brief is non-empty when there is history')

const clipFields = read('src/screens/studio/ClipProFields.tsx')
ok(/briefForClip\(doc, clip\)/.test(clipFields), 'so a text clip’s rewrites are asked to avoid what this footage already rejected')

/* ——— the panel: record, avoid, and show the history ——— */

const panel = read('src/screens/studio/StudioCreativePanel.tsx')
ok(/recordRejection\(footageKey/.test(panel) && /recordAcceptance\(footageKey/.test(panel), 'the Create panel records both directions against the footage')
ok(/avoid: avoided/.test(panel), 'and the design battle it runs is given the directions this footage rejected')
ok(/Avoided|Skipped \$\{battle\.skipped/.test(panel), 'the panel says which direction it skipped')
ok(/Copy brief/.test(panel), 'a brief can be copied out of the panel')
ok(/footageKeyFor\(doc, selected \? selected\.startSec : 0/.test(panel), 'the history shown is the selected clip’s footage')
ok(/Nothing recorded on this footage yet/.test(panel), 'and an empty history says so instead of looking broken')

console.log(`creative-log check passed — ${n} assertions`)
