// Offline English + Hindi voiceover (electron/tts.cjs). Real engines aren't in
// CI, so fake `espeak-ng` and `piper` executables run end to end. That checks
// the argument contract, language routing, Piper discovery and the "never
// read Hindi with an English voice" rule for real.
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const tts = require('../electron/tts.cjs')
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }

ok(tts.resolveLanguage('auto', 'नमस्ते दोस्तों') === 'hi' && tts.resolveLanguage('auto', 'Hello friends') === 'en', 'auto: Devanagari → hi, Latin → en')
ok(tts.resolveLanguage('hi', 'Hello') === 'hi' && tts.resolveLanguage('xx', 'Hello') === 'en', 'explicit language wins; unknown → en')
ok(tts.ttsCommand('linux', '/o.wav', { language: 'hi' }).args.join(' ').includes('-v hi'), 'linux Hindi → espeak -v hi')
ok(tts.ttsCommand('darwin', '/o.wav', { language: 'hi' }).args.includes('Lekha'), 'macOS Hindi → Lekha')
const win = tts.ttsCommand('win32', '/o.wav', { language: 'hi' }).args.join(' ')
ok(/Culture\.Name -like/.test(win) && /exit 3/.test(win) && !win.includes('नमस्ते'), 'Windows: voice by culture, refuses Hindi without a Hindi voice, text via env')
for (const p of ['win32', 'darwin', 'linux']) ok(tts.blockerFor(p, 'hi').length > 40, `${p}: Hindi blocker explains the fix`)

const dir = mkdtempSync(path.join(os.tmpdir(), 'cupric-tts-'))
const log = path.join(dir, 'calls.log')
const fakeWav = `const fs=require('fs');const a=process.argv.slice(2);let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({bin:require('path').basename(process.argv[1]),a,t})+'\\n');`
const writeBin = (name, body) => { const p = path.join(dir, name); writeFileSync(p, `#!${process.execPath}\n${fakeWav}${body}})`); chmodSync(p, 0o755); return p }
const hdr = "const b=Buffer.alloc(80);b.write('RIFF',0);b.write('WAVE',8);"
writeBin('espeak-ng', `if(a.includes('hi')&&process.env.FAIL_HI){process.stderr.write('Invalid voice');process.exit(1)}${hdr}fs.writeFileSync(a[a.indexOf('-w')+1],b)`)
const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }
const withEnv = async (extra, fn) => { const old = { ...process.env }; Object.assign(process.env, env, extra); try { return await fn() } finally { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old) } }

const en = await withEnv({}, () => tts.synthesize({ text: 'Save smarter', language: 'auto' }, 'linux', { piper: null }))
ok(en.ok && en.language === 'en' && en.engine === 'eSpeak NG', 'English via eSpeak end to end')
const hi = await withEnv({}, () => tts.synthesize({ text: 'स्मार्ट बचत करें', language: 'auto' }, 'linux', { piper: null }))
ok(hi.ok && hi.language === 'hi', 'Hindi via eSpeak end to end')
const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
ok(calls[1].a.join(' ').includes('-v hi') && calls[1].t === 'स्मार्ट बचत करें', 'Hindi text reaches the engine intact over stdin with -v hi')
const miss = await withEnv({ FAIL_HI: '1' }, () => tts.synthesize({ text: 'नमस्ते', language: 'hi' }, 'linux', { piper: null }))
ok(!miss.ok && /Hindi/.test(miss.error) && /Piper/.test(miss.error), 'missing Hindi voice → honest blocker, no English fallback')

// Piper discovery + preference.
const pdir = path.join(dir, 'piper'); mkdirSync(pdir)
const pbin = path.join(pdir, 'piper')
writeFileSync(pbin, `#!${process.execPath}\n${fakeWav}${hdr}fs.writeFileSync(a[a.indexOf('--output_file')+1],b)})`); chmodSync(pbin, 0o755)
for (const m of ['hi_IN-test-medium.onnx', 'en_US-test-medium.onnx']) { writeFileSync(path.join(pdir, m), 'x'); writeFileSync(path.join(pdir, `${m}.json`), '{}') }
writeFileSync(path.join(pdir, 'fr_FR-x.onnx'), 'x'); writeFileSync(path.join(pdir, 'fr_FR-x.onnx.json'), '{}')
const setup = tts.piperSetup({ platform: 'linux', env: {}, dirs: [dir] })
ok(setup && setup.models.hi.endsWith('hi_IN-test-medium.onnx') && setup.models.en && !JSON.stringify(setup).includes('fr_FR'), 'Piper: finds en/hi models only')
const ph = await withEnv({}, () => tts.synthesize({ text: 'नमस्ते', language: 'hi' }, 'linux', { piper: setup }))
ok(ph.ok && /Piper \(hi_IN/.test(ph.engine), 'Piper preferred when a Hindi model exists')
ok(tts.piperCommand(setup, 'hi', '/o.wav', { rate: 99 }).args.includes('0.60'), 'Piper rate clamped via length_scale')
ok(tts.piperSetup({ platform: 'linux', env: {}, dirs: [path.join(dir, 'none')] }) === null, 'no Piper → null (falls back to OS voice)')
rmSync(dir, { recursive: true, force: true })

const src = readFileSync('electron/tts.cjs', 'utf8')
ok(!/https?:\/\/|fetch\(|ollama|localhost/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'no network, Ollama or local server in the TTS path')
ok(readFileSync('src/screens/studio/StudioCreativePanel.tsx', 'utf8').includes('Hindi (हिन्दी)'), 'UI offers Hindi')
console.log(`tts languages: ${n} assertions passed`)
