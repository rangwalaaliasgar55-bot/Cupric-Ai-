#!/usr/bin/env node
/**
 * The offline voiceover path (electron/tts.cjs), checked without pretending.
 *
 * This check used to write fake `espeak-ng` and `piper` executables into a temp
 * folder, put them on PATH and run the real synthesis code against them. That
 * proved the argument contract, but it proved it with a fabricated engine —
 * exactly the kind of test that made Phase 0's "fake logic" audit necessary. It
 * has been reworked:
 *
 *   - No invented executables, no PATH injection, no script that pretends to
 *     write a WAV. Nothing in this file fabricates a success.
 *   - The command lines, language routing, discovery rules and blocker copy are
 *     asserted directly, because they are pure functions of the platform and the
 *     language — that is the whole contract a real engine sees.
 *   - The synthesis chain is then run for real with no engine present, and the
 *     *failure* is asserted: the honest blocker sentence and the record of what
 *     was tried. A missing engine is the one case this machine can reproduce
 *     truthfully.
 *
 * What this file cannot prove, and says so on exit: that a real Windows voice
 * produces real audio. That needs a Windows machine with a voice installed, and
 * is listed as UNVERIFIED in the phase report.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const tts = require('../electron/tts.cjs')
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
/** The TTS module's own source, without comments — for structural assertions. */
const ttsSource = () => readFileSync('electron/tts.cjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// ── language routing (pure) ──────────────────────────────────────────────────
ok(tts.resolveLanguage('auto', 'नमस्ते दोस्तों') === 'hi' && tts.resolveLanguage('auto', 'Hello friends') === 'en', 'auto: Devanagari → hi, Latin → en')
ok(tts.resolveLanguage('hi', 'Hello') === 'hi' && tts.resolveLanguage('xx', 'Hello') === 'en', 'explicit language wins; unknown → en')
ok(tts.resolveLanguage(undefined, '') === 'en', 'no language and no text still resolves, never throws')

// ── the Windows command line: the only one that ships ────────────────────────
const win = tts.ttsCommand('win32', 'C:\\out.wav', { language: 'hi', rate: 3 })
ok(win.cmd === 'powershell.exe' && win.args.includes('-NoProfile') && win.args.includes('-NonInteractive'), 'Windows synthesis runs PowerShell without a profile')
const winScript = win.args[win.args.length - 1]
ok(/Add-Type -AssemblyName System\.Speech/.test(winScript) && /SetOutputToWaveFile\(\$env:NEWBRAND_TTS_OUT\)/.test(winScript), 'Windows writes a real WAV through System.Speech')
ok(/Culture\.Name -like/.test(winScript), 'Windows picks a voice by culture, not by guessing a name')
ok(/\$s\.Rate = 3/.test(winScript), 'rate is applied')
ok(/exit 3/.test(winScript) && /no-voice-for-language/.test(winScript), 'Windows refuses to read Hindi with an English voice (exit 3, explicit reason)')
ok(/Speak\(\$env:NEWBRAND_TTS_TEXT\)/.test(winScript), 'the script speaks the environment variable, so the text never reaches a command line')
ok(win.args[2] === '-Command' && win.args.length === 4, 'the script is one argument after -Command, handed to PowerShell as an argv entry')
ok(!/shell:\s*true/.test(ttsSource()), 'processes are spawned with an argument array and no shell, so no string is re-parsed')
ok(win.args[win.args.length - 1].length > 200, 'the script is a real statement list, not a stub')
const clamped = tts.ttsCommand('win32', 'C:\\out.wav', { rate: 99 }).args.join(' ')
ok(/\$s\.Rate = 10/.test(clamped), 'an absurd rate is clamped to System.Speech’s range')

// ── blocker copy: every miss names the fix ───────────────────────────────────
const hiBlocker = tts.blockerFor('win32', 'hi')
ok(/Time & language/.test(hiBlocker) && /Piper/.test(hiBlocker) && hiBlocker.length > 80, 'missing Hindi voice → where to add it, plus the Piper alternative')
ok(/OneCore/.test(hiBlocker), 'the known Windows trap (OneCore-only voices hidden from System.Speech) is stated')
const withDetail = tts.blockerFor('win32', 'en', 'Access denied')
ok(withDetail.includes('Access denied'), 'a real engine error is carried into the message, not dropped')
ok(tts.blockerFor('win32', 'en') === 'The system voice could not speak.', 'with no detail the copy stays plain')

// ── Piper discovery: real filesystem, real rules ─────────────────────────────
const dir = mkdtempSync(path.join(os.tmpdir(), 'newbrand-tts-'))
try {
  ok(tts.piperSetup({ platform: 'win32', dirs: [] }) === null, 'no folder → no Piper, rather than a hopeful guess')

  const pdir = path.join(dir, 'piper')
  mkdirSync(pdir, { recursive: true })
  ok(tts.piperSetup({ platform: 'win32', dirs: [pdir] }) === null, 'a folder with no executable is not an install')

  // A fixture for the discovery function: the loader only looks at names and
  // extensions, and this file is never executed. It is not a fake engine — the
  // code under test decides *whether* to run something, and the answer for this
  // fixture must be "yes, this is where Piper lives".
  writeFileSync(path.join(pdir, 'piper.exe'), '')
  const setup = tts.piperSetup({ platform: 'win32', dirs: [pdir] })
  ok(setup && setup.bin === path.join(pdir, 'piper.exe'), 'piper.exe in the folder is found')
  ok(setup.models.en === undefined || setup.models.en === null, 'no model files → no English voice claimed')

  for (const name of ['en_US-lessac-medium.onnx', 'hi_IN-pratham-medium.onnx']) {
    writeFileSync(path.join(pdir, name), '')
    writeFileSync(path.join(pdir, `${name}.json`), '{}')
  }
  const withModels = tts.piperSetup({ platform: 'win32', dirs: [pdir] })
  ok(withModels.models.en && withModels.models.hi, 'both language models are seen once their .onnx and .json exist')
  writeFileSync(path.join(pdir, 'fr_FR-upmc-medium.onnx'), '')
  writeFileSync(path.join(pdir, 'fr_FR-upmc-medium.json'), '{}')
  ok(!('fr' in tts.piperSetup({ platform: 'win32', dirs: [pdir] }).models), 'a language NewBrand does not offer is not invented')

  // piperCommand is the argv a real Piper receives.
  const cmd = tts.piperCommand(withModels, 'hi', 'C:\\hi.wav', { rate: 0 })
  ok(cmd.cmd === path.join(pdir, 'piper.exe') && cmd.args.includes('--output_file') && cmd.args.includes('C:\\hi.wav'), 'Piper gets the resolved binary and an explicit output path')
  ok(cmd.args[cmd.args.indexOf('--model') + 1] === withModels.models.hi && /hi_IN/.test(cmd.args.join(' ')), 'the Hindi request uses the Hindi model')
  ok(cmd.stdinText === true, 'text goes to Piper over stdin, so it never appears in the process list')
  const scale = (rate) => tts.piperCommand(withModels, 'en', 'C:\\en.wav', { rate }).args[tts.piperCommand(withModels, 'en', 'C:\\en.wav', { rate }).args.indexOf('--length_scale') + 1]
ok(scale(0) === '1.00' && scale(5) === '0.80', 'rate maps onto Piper’s length_scale')
ok(scale(25) === scale(10) && scale(10) === '0.60', 'an out-of-range rate is clamped to the range Piper accepts, not passed through')
  ok(tts.piperCommand(null, 'en', 'C:\\en.wav', {}) === null, 'no Piper → no Piper command, and the caller falls through to the system voice')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// ── the chain, run for real ──────────────────────────────────────────────────
//
// This runs the shipped chain with no Piper and no fabricated binary, and then
// asserts the *contract* rather than a particular outcome, because the outcome
// depends on the machine:
//
//   * on a Linux container (where this was written) there is no Windows Speech
//     and no eSpeak NG, so the call really fails and the failure is asserted
//     line by line — a sentence, the engine named, the attempts recorded, the
//     raw spawn error kept out of the user-facing copy;
//   * on a Windows runner System.Speech *does* exist, so the call can really
//     succeed — and then what is asserted is that it produced a real RIFF/WAVE
//     payload from a named engine.
//
// The first version asserted the failure unconditionally, which would have gone
// red the first time it ran on Windows. A check that only passes on the machine
// it was written on is not a check.
const chain = await tts.synthesize({ text: 'Save smarter', language: 'en' }, 'win32', { piper: null })

if (chain.ok) {
  // Real audio came back. Assert it is audio, not just a truthy object.
  const bytes = Buffer.from(chain.base64 || '', 'base64')
  ok(bytes.length > 64, `the engine returned real bytes (${bytes.length})`)
  ok(bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', 'the payload is a RIFF/WAVE file, not an empty buffer')
  ok(typeof chain.engine === 'string' && chain.engine.length > 2, `the result names the engine that produced it (${chain.engine})`)
  ok(chain.mime === 'audio/wav', 'and the mime type matches the bytes')
  ok(chain.language === 'en', 'the language is reported back')
} else {
  ok(chain.error && chain.error.trim().length > 0, 'with no engine present, the failure carries a sentence a person can act on')
  ok(!/^\s*at\s|\bError:|\bENOENT\b/.test(chain.error), 'the sentence is not a raw stack frame or errno')
  ok(/could not start Windows Speech/.test(chain.error) && /execution policy/.test(chain.error), 'a failure to start the engine is reported as that, with the likely causes')
  ok(chain.engine === 'Windows Speech', 'the result says which engine failed, so the UI does not have to guess')
  ok(typeof chain.detail === 'string' && chain.detail.length > 0, 'the engine’s own words are kept in a separate field, not lost')
  ok(!chain.error.includes(String(chain.detail)), 'the technical detail is not pasted into the sentence a person reads')
  ok(Array.isArray(chain.tried) && chain.tried.length >= 1, 'the engines that were tried are recorded')
  ok(chain.tried.every((line) => typeof line === 'string' && line.includes(':')), 'each attempt names the engine and what it said')

  // The regression this check found: a request with no reachable engine must not
  // be answered with "add a Hindi voice" — the engine never started.
  const hiNoEngine = await tts.synthesize({ text: 'नमस्ते', language: 'hi' }, 'win32', { piper: null })
  if (!hiNoEngine.ok) {
    ok(!/Add a Hindi voice|no Hindi voice is installed/i.test(hiNoEngine.error), 'a missing engine is not reported as a missing Hindi voice')
    ok(/could not start Windows Speech|No Hindi voice/i.test(hiNoEngine.error), 'Hindi with no engine names the real problem')
  } else {
    ok(/RIFF/.test(Buffer.from(hiNoEngine.base64 || '', 'base64').toString('ascii', 0, 4)), 'a Windows Hindi voice produced real audio when one is installed')
  }
}
// And the copy for a genuinely missing Hindi voice is unchanged, on every machine.
ok(/Add a Hindi voice/.test(tts.blockerFor('win32', 'hi')), 'the Hindi-voice blocker still gives the Windows settings path')

ok(tts.MAX_CHARS > 0 && (await tts.synthesize({ text: '' }, 'win32', { piper: null })).ok === false, 'empty script is refused up front')
ok((await tts.synthesize({ text: 'x'.repeat(tts.MAX_CHARS + 1) }, 'win32', { piper: null })).error.includes(String(tts.MAX_CHARS)), 'an over-long script names the limit')

// ── the path stays offline ───────────────────────────────────────────────────
const src = readFileSync('electron/tts.cjs', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
ok(!/https?:\/\/|fetch\(|ollama|localhost/i.test(src), 'no network, Ollama or local server in the TTS path')
// The installer is the only place that talks to the network, and only to the
// two published hosts it names.
const installer = readFileSync('electron/voice-install.cjs', 'utf8')
const hosts = [...installer.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1])
ok(hosts.length > 0 && hosts.every((h) => ['github.com', 'huggingface.co'].includes(h)), 'engine downloads go only to github.com and huggingface.co')
ok(!/localhost|127\.0\.0\.1/.test(installer), 'the installer never falls back to a local server')
ok(readFileSync('src/screens/studio/StudioCreativePanel.tsx', 'utf8').includes('Hindi (हिन्दी)'), 'UI offers Hindi')

console.log(`tts languages: ${n} assertions passed — no fake engines were used.`)
// Say what actually happened on this machine rather than a blanket disclaimer.
// On a Linux container there is no engine, so real audio is unverified; on the
// Windows runner there is one, and the payload above was checked byte for byte.
console.log(
  chain.ok
    ? `VERIFIED on this machine: ${chain.engine} produced ${Buffer.from(chain.base64 || '', 'base64').length} bytes of ${chain.mime} for an English line.`
    : 'UNVERIFIED here: real audio out of a real engine. That needs a Windows machine with a voice installed (/voice/status + a WAV that plays).',
)
