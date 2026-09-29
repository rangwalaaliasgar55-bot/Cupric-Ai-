#!/usr/bin/env node
/**
 * check:scoped-edit — "I told you to move nothing".
 *
 * `scopedEdit.ts` compares two revisions of one edit and names every change,
 * flagging the ones nobody asked for. Ported from open-edit's `scoped-edit`
 * command, whose point is that this class of defect is decidable from the two
 * documents alone: both are valid, both render, and only the diff shows that a
 * caption moved 40 ms when it was not supposed to. The check runs the diff over
 * documents built here, one case per rule, plus the wiring that makes it matter
 * (Studio's "Fix all" allows exactly the clips the report named).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rm } from 'node:fs/promises'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, '.check-scoped-edit.mjs')
await build({
  bundle: true, outfile: out, format: 'esm', platform: 'node', logLevel: 'error',
  stdin: { contents: "export * from './src/lib/studio/scopedEdit'\nexport * as doc from './src/lib/studio/doc'", resolveDir: root, loader: 'ts' },
})
const m = await import(pathToFileURL(out).href)
await rm(out, { force: true })

let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n += 1 }
const eq = (a, b, msg) => { assert.equal(a, b, msg); n += 1 }

const base = () => {
  const doc = m.doc.emptyStudioDoc()
  doc.clips = [
    { ...m.doc.defaultTextClip(0, 0), id: 'hook', name: 'Hook', text: 'STOP SCROLLING', color: '#FFFFFF' },
    { ...m.doc.defaultTextClip(2, 0), id: 'lower', name: 'Lower third', text: 'Guest name', color: '#FFFFFF' },
    { ...m.doc.defaultTextClip(4, 0), id: 'cta', name: 'CTA', text: 'Follow for more', color: '#FFFFFF' },
  ]
  return doc
}
const edit = (doc, fn) => { const next = JSON.parse(JSON.stringify(doc)); fn(next); return next }

/* ——— nothing changed ——— */
{
  const r = m.diffStudioDoc(base(), base())
  eq(r.changes.length, 0, 'an untouched document reports no changes')
  ok(r.ok, 'and nothing is unexpected')
  eq(r.summary, 'nothing changed', 'the summary says so in words')
}

/* ——— the asked-for change, and the one nobody asked for ——— */
{
  const before = base()
  // Allowed: the hook's colour. Not allowed: the CTA drifted 40 ms — the exact
  // defect upstream names ("a caption that moved 40ms is exactly as renderable").
  const after = edit(before, (d) => {
    d.clips.find((c) => c.id === 'hook').color = '#000000'
    d.clips.find((c) => c.id === 'cta').startSec = 4.04
  })
  const r = m.diffStudioDoc(before, after, { allow: ['hook'] })
  eq(r.changes.length, 2, 'both changes are reported')
  eq(r.unexpected.length, 1, 'only one of them was unasked for')
  eq(r.unexpected[0].clipId, 'cta', 'and it is the one that drifted')
  eq(r.unexpected[0].fields[0].field, 'startSec', 'with the field that moved')
  ok(/0.04|4\.04/.test(r.unexpected[0].label), `the label carries the numbers (${r.unexpected[0].label})`)
  ok(!r.ok, 'the report is not ok while something unasked-for changed')
  ok(/not asked for/.test(r.summary), 'and the summary names it')

  // Naming a target by its title works as well as by its id: a report says
  // "Lower third", a caller says `lower`.
  const byName = m.diffStudioDoc(before, edit(before, (d) => { d.clips.find((c) => c.id === 'lower').text = 'Guest: A. Person' }), { allow: ['Lower third'] })
  ok(byName.ok, 'a clip may be allowed by name')
  const byNameCase = m.diffStudioDoc(before, edit(before, (d) => { d.clips.find((c) => c.id === 'lower').text = 'Guest: A. Person' }), { allow: ['lower third'] })
  ok(byNameCase.ok, 'and matching a name ignores case')
}

/* ——— add, remove, and the fields nobody watches ——— */
{
  const before = base()
  const after = edit(before, (d) => {
    d.clips = d.clips.filter((c) => c.id !== 'lower')
    d.clips.push({ ...m.doc.defaultTextClip(6, 0), id: 'outro', name: 'Outro', text: 'Thanks for watching' })
    d.clips.find((c) => c.id === 'hook').favourite = true // not a Studio field
  })
  const r = m.diffStudioDoc(before, after)
  eq(r.changes.length, 2, 'a removal and an addition are two changes')
  ok(r.changes.some((c) => c.kind === 'clip-removed' && c.clipId === 'lower'), 'the removal names the clip')
  ok(r.changes.some((c) => c.kind === 'clip-added' && c.clipId === 'outro'), 'the addition names the clip and its track')
  eq(r.unexpected.length, 2, 'with an empty allow-list everything is unexpected')
  const allowed = m.diffStudioDoc(before, after, { allow: ['lower', 'outro'] })
  ok(allowed.ok, 'and allowing both clears the report')
  eq(m.diffStudioDoc(before, after, { ignoreFields: ['startSec', 'text'] }).changes.length, 2, 'ignored fields do not hide a clip-level change')
}

/* ——— document-level changes are not covered by a clip allow-list ——— */
{
  const before = base()
  const flipped = before.aspect === '16:9' ? '9:16' : '16:9'
  const after = edit(before, (d) => { d.aspect = flipped; d.trackCount = 6 })
  const r = m.diffStudioDoc(before, after, { allow: ['hook', 'lower', 'cta'] })
  eq(r.changes.length, 1, 'the edit itself changed: one finding, not one per field')
  eq(r.changes[0].kind, 'doc-changed', 'reported as a document change')
  ok(!r.ok, 'and an allowed clip list does not cover it')
  ok(new RegExp(`aspect ${before.aspect.replace(':', ':')} \u2192 ${flipped}`).test(r.changes[0].label), `the label names both fields and both values (${r.changes[0].label})`)
  ok(m.diffStudioDoc(before, after, { allowDoc: ['aspect', 'trackCount'] }).ok, 'unless the caller allows those fields')
  ok(!m.diffStudioDoc(before, after, { allowDoc: ['aspect'] }).ok, 'allowing one document field does not allow the others')
}

/* ——— values are compared by value, not by identity ——— */
{
  const before = base()
  const same = edit(before, (d) => { d.clips.find((c) => c.id === 'hook').wordDelaysMs = [0, 400, 800] })
  const r1 = m.diffStudioDoc(before, same, { allow: ['hook'] })
  ok(r1.changes.some((c) => c.fields.some((f) => f.field === 'wordDelaysMs')), 'a word-timing array is compared and reported')
  const identical = edit(before, (d) => { d.clips.find((c) => c.id === 'hook').wordDelaysMs = before.clips[0].wordDelaysMs ?? null })
  ok(m.diffStudioDoc(before, identical).changes.length === 0 || m.diffStudioDoc(before, identical).changes.every((c) => c.fields.every((f) => f.field === 'wordDelaysMs')), 'setting a field to its own value is not two different changes')
  const reordered = edit(same, (d) => { d.clips.find((c) => c.id === 'hook').wordDelaysMs = [0, 800, 400] })
  ok(m.diffStudioDoc(same, reordered, { allow: ['hook'] }).changes.length === 1, 'a changed array is one field change')

  // undefined and null are the same absence: a document that was saved before a
  // field existed must not report a phantom change when it is loaded again.
  const missing = edit(before, (d) => { delete d.clips.find((c) => c.id === 'hook').timingSource })
  const nulled = edit(before, (d) => { d.clips.find((c) => c.id === 'hook').timingSource = null })
  eq(m.diffStudioDoc(missing, nulled).changes.length, 0, 'unset and null are the same thing')
}

/* ——— the allow-list a gate report implies ——— */
{
  const report = {
    findings: [
      { clipId: 'hook', id: 'contrast:hook' },
      { clipId: 'hook', id: 'safezones:hook' },
      { clipId: undefined, id: 'deliver:silent' },
      { id: 'lint:no-media' },
    ],
  }
  const allow = m.allowListOfReport(report)
  eq(allow.join(','), 'hook', 'only the clips a report proposes fixing are allowed to change')
  ok(m.diffStudioDoc(base(), edit(base(), (d) => { d.clips.find((c) => c.id === 'hook').color = '#000000' }), { allow }).ok, 'so the fix it actually makes is inside its own scope')
  ok(!m.diffStudioDoc(base(), edit(base(), (d) => { d.clips.find((c) => c.id === 'cta').text = 'changed' }), { allow }).ok, 'and anything else is reported')
}

/* ——— the wiring: Studio proves its own "Fix all" ——— */
{
  const studio = readFileSync(path.join(root, 'src/screens/Studio.tsx'), 'utf8')
  ok(/diffStudioDoc\(doc, fixed, \{ allow: allowListOfReport\(audit\.report\) \}\)/.test(studio), 'Fix all diffs what it changed against the report’s own clip ids')
  ok(/not asked to/.test(studio), 'and says so in the toast when the fix drifted')
  const runner = readFileSync(path.join(root, 'src/lib/studio/gateRunner.ts'), 'utf8')
  ok(/applyAuditFixes/.test(runner) && /runGates/.test(runner), 'the audit path it guards is the gate runner the Studio button uses')
}

console.log(`scoped-edit check passed — ${n} assertions`)
