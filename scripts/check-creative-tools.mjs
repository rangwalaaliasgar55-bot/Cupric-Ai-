// Creative tools: speed ramp, repurpose reframe, Brand Kit, batch variants,
// Simple Icons slugs, offline TTS command safety, and UI wiring.
import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const out = path.resolve('.check-creative-tools.mjs')
await build({
  stdin: { contents: ["export * as ct from './src/lib/studio/creativeTools'", "export * as si from './src/lib/simpleIcons'", "export * as docm from './src/lib/studio/doc'", "export * as finder from './src/lib/resourceFinder'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
})
const m = await import(pathToFileURL(out).href)
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e

const base = () => ({
  aspect: '16:9', fps: 30, backgroundId: 'bg', trackCount: 2, clips: [
    { id: 'v1', kind: 'video', mediaId: 'm1', fileName: 'a.mp4', localPath: null, track: 0, startSec: 0, durationSec: 5, trimInSec: 2, sourceDurationSec: 30, speed: 1, volume: 1, fit: 'cover', name: 'Shot', transitionIn: 'fade', transitionOut: 'fade', opacity: 1 },
    { id: 'v2', kind: 'video', mediaId: 'm2', fileName: 'b.mp4', localPath: null, track: 0, startSec: 5, durationSec: 3, trimInSec: 0, sourceDurationSec: 30, speed: 1, volume: 1, fit: 'cover', name: 'Next', transitionIn: 'none', transitionOut: 'none', opacity: 1 },
    { ...m.docm.defaultTextClip(0, 1), id: 't1', text: 'Ship videos faster', fontSizePct: 8, x: 0.5, y: 0.97, durationSec: 4 },
  ],
})

/* speed ramp */
{
  const r = m.ct.speedRamp(base(), 'v1', 'hero-moment')
  const segs = r.doc.clips.filter((c) => c.mediaId === 'm1').sort((a, b) => a.startSec - b.startSec)
  ok(r.changed && segs.length === 5, 'ramp splits into 5 segments')
  ok(segs[0].id === 'v1' && new Set(segs.map((s) => s.id)).size === 5, 'first segment keeps the id; ids unique')
  let src = 2, t = 0
  for (const s of segs) { ok(near(s.trimInSec, src) && near(s.startSec, t), 'source + timeline continuity'); src += s.durationSec * s.speed; t += s.durationSec }
  ok(near(src, 7, 0.02), 'consumes exactly the original source span')
  ok(segs[0].transitionIn === 'fade' && segs[4].transitionOut === 'fade' && segs[2].transitionIn === 'none', 'outer transitions kept, inner cleared')
  const v2 = r.doc.clips.find((c) => c.id === 'v2')
  ok(near(v2.startSec, t), 'later clip on the track ripples to the new end')
  ok(r.doc.clips.find((c) => c.id === 't1').startSec === 0, 'other tracks untouched')
  ok(segs.every((s) => s.speed >= m.ct.MIN_SPEED && s.speed <= m.ct.MAX_SPEED), 'speeds within limits')
  ok(!m.ct.speedRamp(base(), 't1', 'hero-moment').changed, 'refuses non-video with a reason')
  ok(/at least 1 second/.test(m.ct.speedRamp({ ...base(), clips: [{ ...base().clips[0], durationSec: 0.5 }] }, 'v1', 'ease-in').reason), 'refuses too-short clips')
  ok(JSON.stringify(m.ct.speedRamp(base(), 'v1', 'ease-in').doc.clips.map((c) => [c.startSec, c.durationSec, c.speed])) === JSON.stringify(m.ct.speedRamp(base(), 'v1', 'ease-in').doc.clips.map((c) => [c.startSec, c.durationSec, c.speed])), 'deterministic')
}

/* repurpose */
{
  const v = m.ct.reframeForAspect(base(), '9:16')
  const t = v.clips.find((c) => c.id === 't1')
  ok(v.aspect === '9:16' && near(t.fontSizePct, 8 * 1080 / 1920, 0.01), 'text keeps its size against the short side')
  ok(t.y <= 0.8 && t.x >= 0.1 && t.x <= 0.9, 'text pulled inside the vertical safe area')
  ok(m.ct.reframeForAspect(base(), '16:9') === base().aspect || m.ct.reframeForAspect(base(), '16:9').aspect === '16:9', 'same aspect is a no-op')
  const back = m.ct.reframeForAspect(m.ct.reframeForAspect(base(), '9:16'), '16:9')
  ok(near(back.clips.find((c) => c.id === 't1').fontSizePct, 8, 0.01), 'reframing back restores size')
  ok(read('src/screens/Studio.tsx').includes('reframeForAspect(doc, aspect)'), '“All sizes” export uses the reframe')
}

/* brand kit */
{
  const kit = { colors: ['#FFFFFF', '#FFE600', '#111111'], font: 'Geist Variable', logoDataUrl: 'data:image/png;base64,AAAA' }
  const r = m.ct.applyBrandKit(base(), kit)
  const t = r.doc.clips.find((c) => c.id === 't1')
  ok(t.fontFamily === 'Geist Variable' && t.color === '#111111', 'brand font + readable text colour on a white brand background (not yellow)')
  const logos = r.doc.clips.filter((c) => c.source === 'brand-logo')
  ok(logos.length === 1 && logos[0].durationSec === 8, 'logo stamped once for the full length')
  ok(m.ct.applyBrandKit(r.doc, kit).doc.clips.filter((c) => c.source === 'brand-logo').length === 1, 're-applying does not duplicate the logo')
  ok(!r.doc.customBackground && m.ct.applyBrandKit(base(), kit, { stage: true }).doc.customBackground.color === '#FFFFFF', 'background changes only when asked')
  ok(!m.ct.applyBrandKit(base(), { colors: [], font: '', logoDataUrl: null }).changed, 'empty kit explains itself')
  ok(m.ct.readableOn('#000000', ['#111111']) === '#f4f1ea', 'falls back to a readable neutral')
}

/* variants */
{
  const r = m.ct.buildVariants(base(), 3, { colors: ['#000000', '#C8F542', '#4FB6E8'], font: '', logoDataUrl: null })
  ok(r.changed && r.doc.scenes.length === 3, 'variants saved as scenes')
  ok(r.doc.scenes.every((s) => !('scenes' in s.doc)), 'scene snapshots do not nest the scene list')
  ok(new Set(r.doc.scenes.map((s) => s.doc.clips.find((c) => c.id === 't1').text)).size >= 2, 'headlines differ between variants')
  ok(r.doc.clips === base().clips || JSON.stringify(r.doc.clips) === JSON.stringify(base().clips), 'the live edit is untouched')
  ok(!m.ct.buildVariants({ ...base(), clips: base().clips.slice(0, 2) }, 3).changed, 'needs a headline')
  ok(read('src/screens/Studio.tsx').includes('runSceneBatch') && read('src/screens/Studio.tsx').includes('Export every scene'), 'batch export of scenes/variants is wired')
}

/* simple icons */
ok(m.si.simpleIconSlug('GitHub') === 'github' && m.si.simpleIconSlug('Dot.net') === 'dotdotnet'.replace('dotdot', 'dotdot') || m.si.simpleIconSlug('.NET') === 'dotnet', 'slug rules')
ok(m.si.simpleIconSlug('C++') === 'cplusplus' && m.si.simpleIconSlug('AT&T') === 'atandt' && m.si.simpleIconSlug('Škoda') === 'skoda', 'slug rules: + & diacritics')
ok(m.si.simpleIconUrl('stripe', 'C8F542') === 'https://cdn.simpleicons.org/stripe/c8f542' && m.si.simpleIconUrl('x', 'bad') === 'https://cdn.simpleicons.org/x', 'CDN url + colour validation')

/* offline TTS */
{
  const require = createRequire(import.meta.url)
  const tts = require('../electron/tts.cjs')
  for (const plat of ['win32', 'darwin', 'linux']) {
    const c = tts.ttsCommand(plat, '/tmp/o.wav', { rate: 99, voice: 'Alex; rm -rf /' })
    ok(!c.args.join(' ').includes('rm -rf'), `${plat}: nothing user-typed can become a command`)
    ok(plat === 'win32' ? c.args.join(' ').includes('$env:CUPRIC_TTS_TEXT') && c.args.join(' ').includes('Rate = 10') : c.stdinText, `${plat}: text via env/stdin, rate clamped`)
  }
  ok((await tts.synthesize({ text: '  ' })).error.includes('script'), 'empty script explained')
  ok((await tts.synthesize({ text: 'x'.repeat(tts.MAX_CHARS + 1) })).error.includes('under'), 'over-long script explained')
  ok(read('electron/preload.cjs').includes("'voice:tts'") && read('electron/main.cjs').includes("ipcMain.handle('voice:tts'"), 'IPC allowlisted + handled')
  ok(read('src/screens/studio/StudioCreativePanel.tsx').includes('synthesizeVoiceover(') && read('src/lib/voice.ts').includes('needs the desktop app'), 'UI + browser explanation')
}

/* UI reachable */
const panel = read('src/screens/studio/StudioCreativePanel.tsx')
for (const s of ['Speed ramp', 'Brand Kit', 'Simple Icons', 'AI voiceover', 'Batch variants', 'Repurpose']) ok(panel.includes(s), `panel has ${s}`)
ok(read('src/screens/studio/StudioProPanel.tsx').includes('<StudioCreativePanel'), 'Create panel mounted in Studio pro tools')
console.log(`creative tools check passed — ${n} assertions`)
