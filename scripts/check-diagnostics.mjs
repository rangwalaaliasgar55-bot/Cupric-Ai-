#!/usr/bin/env node
/** Diagnostic report (2.27): useful content, zero secrets. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const d = require('../electron/diagnostics.cjs')
const home = '/home/alice'
const secrets = ['AIzaSyA1234567890abcdefghijklmnopqrstu', 'sk-or-v1-abcdef0123456789abcdef0123', 'sk-proj-ABCDEFGHIJKLMNOP1234', 'ghp_abcdefghijklmnopqrstuvwxyz0123']
const logLines = [
  JSON.stringify({ kind: 'render-error', message: `ffmpeg failed reading ${home}/Videos/a.mp4 key=${secrets[0]}` }),
  JSON.stringify({ kind: 'ai', message: `Authorization: Bearer ${secrets[1]}` }),
  JSON.stringify({ kind: 'info', message: 'boring line that is not a problem' }),
  `{"kind":"warn","message":"retry","extra":{"openCodeApiKey":"${secrets[2]}"}}`,
  `warn https://generativelanguage.googleapis.com/v1/models?key=${secrets[0]}`,
]
const report = d.buildReport({
  appVersion: '0.9.1', packaged: true, platform: 'win32', osRelease: '10.0.22631', arch: 'x64',
  versions: { electron: '33', chrome: '130', node: '20' },
  media: { ffmpeg: `${home}/ffmpeg.exe`, ffprobe: null },
  encoder: { name: 'h264_nvenc', hardware: true, tried: ['h264_nvenc'] },
  ai: { aiProvider: 'gemini', hasGeminiKey: true, openCodeBaseUrl: `https://openrouter.ai/api/v1?token=${secrets[3]}`, openCodeModel: 'qwen/qwen3:free', hasOpenCodeKey: false },
  recovery: { previousSessionCrashed: true, recoveredFrom: null },
  versionCount: 4,
  logLines,
  rendererErrors: [`TypeError x ${secrets[3]}`],
  homeDir: home,
})
for (const s of secrets) assert.ok(!report.includes(s), `leaked ${s.slice(0, 8)}…`)
assert.ok(!report.includes(home), 'home path redacted')
assert.match(report, /App version: 0\.9\.1/)
assert.match(report, /FFprobe: MISSING/)
assert.match(report, /h264_nvenc \(hardware\)/)
assert.match(report, /OpenCode endpoint: https:\/\/openrouter\.ai$/m)
assert.match(report, /unclean exit detected/)
assert.match(report, /render-error/)
assert.ok(!report.includes('boring line'), 'only problems are included')
console.log('diagnostics check passed — report is complete and contains no keys, tokens or home path')
