#!/usr/bin/env node
/**
 * 2.7 video proxies. Pure rules always; with a real FFmpeg (CUPRIC_FFMPEG_PATH
 * or ffmpeg-static) it transcodes a real 1440p clip and verifies the proxy:
 * 540p short side, even dims, a keyframe every 12 frames, audio kept.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const px = require(path.join(root, 'electron/proxies.cjs'))
let n = 0
const ok = (c, m) => { assert.ok(c, m); n += 1 }

// Renderer rule must match the main-process rule.
const tmp = path.join(root, '.proxies-check.mjs')
await build({ bundle: true, outfile: tmp, format: 'esm', platform: 'node', logLevel: 'error', stdin: { contents: "export { shouldAutoProxy } from './src/lib/studio/proxy'", resolveDir: root, loader: 'ts' } })
const { shouldAutoProxy } = await import(`${pathToFileURL(tmp).href}?t=${Date.now()}`)
await rm(tmp, { force: true })
for (const c of [
  { width: 3840, height: 2160, bytes: 1 }, { width: 1920, height: 1080, bytes: 10e6 }, { width: 1920, height: 1080, bytes: 200e6 },
  { width: 1080, height: 1920, bytes: 80e6 }, { width: 1280, height: 720, bytes: 900e6 }, { width: 2160, height: 3840, bytes: 1 },
]) ok(px.needsProxy(c) === shouldAutoProxy(c), `renderer and main agree on ${c.width}x${c.height}/${c.bytes}`)
ok(px.needsProxy({ width: 3840, height: 2160 }) && !px.needsProxy({ width: 1920, height: 1080, bytes: 1e6 }), '4K proxied, small 1080p not')

assert.throws(() => px.validateSource('relative.mp4'), /real path/); n += 1
assert.throws(() => px.validateSource('/etc/passwd'), /video files only/); n += 1
assert.throws(() => px.validateSource('/nope/missing.mp4'), /missing/); n += 1
ok(px.progressFrom('frame=10\nout_time_us=2500000\n', 10) === 0.25, 'progress parse')
ok(px.progressFrom('garbage', 10) === null, 'progress ignores noise')

const dir = mkdtempSync(path.join(os.tmpdir(), 'cupric-proxy-'))
try {
  const src = path.join(dir, 'source 4k.mp4')
  writeFileSync(src, 'x')
  const st = statSync(src)
  const k1 = px.proxyKey(src, st)
  ok(k1 === px.proxyKey(src, st) && k1 !== px.proxyKey(src, { ...st, mtimeMs: st.mtimeMs + 5000 }), 'cache key changes when the source changes')

  let ffmpeg = process.env.CUPRIC_FFMPEG_PATH
  if (!ffmpeg || !existsSync(ffmpeg)) { try { ffmpeg = require('ffmpeg-static') } catch { ffmpeg = null } }
  if (!ffmpeg || !existsSync(ffmpeg)) {
    console.log(`video proxy check passed — ${n} assertions (FFmpeg not found: real transcode skipped)`)
    process.exit(0)
  }
  const gen = spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=2560x1440:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src])
  assert.equal(gen.status, 0, String(gen.stderr))
  const out = path.join(dir, 'proxy.mp4')
  const run = spawnSync(ffmpeg, px.proxyArgs(src, out), { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  ok(/out_time_us=\d+/.test(run.stdout) && px.progressFrom(run.stdout.split('progress=').slice(-2)[0], 2) > 0.5, 'real -progress output parses')
  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr
  ok(/Video: h264[^\n]*\b960x540\b/.test(info), `proxy is 960x540 H.264 (${(info.match(/Video:[^\n]*/) || [''])[0]})`)
  ok(/Audio: aac/.test(info), 'proxy keeps audio for preview playback')
  ok(statSync(out).size < statSync(src).size, 'proxy is smaller than the source')
  const keys = spawnSync(ffmpeg, ['-hide_banner', '-skip_frame', 'nokey', '-i', out, '-vf', 'showinfo', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const pts = [...keys.matchAll(/n:\s*\d+\s+pts:\s*(\d+)/g)].length
  ok(pts >= 5, `keyframe every 12 frames → ≥5 keyframes in 60 frames (got ${pts})`)
  // Portrait source → 540 wide.
  const psrc = path.join(dir, 'portrait.mp4')
  spawnSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1440x2560:rate=30:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', psrc])
  const pout = path.join(dir, 'p.mp4')
  assert.equal(spawnSync(ffmpeg, px.proxyArgs(psrc, pout)).status, 0, 'video with no audio track still proxies')
  ok(/\b540x960\b/.test(spawnSync(ffmpeg, ['-hide_banner', '-i', pout], { encoding: 'utf8' }).stderr), 'portrait proxy is 540x960')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

const read = (p) => readFileSync(path.join(root, p), 'utf8')
ok(read('electron/main.cjs').includes("ipcMain.handle('media:proxy'") && read('electron/preload.cjs').includes("'media:proxy'"), 'IPC wired')
ok(read('src/lib/studio/renderer.ts').includes("quality === 'preview' && handle.previewVideo"), 'preview draws the proxy')
ok(read('src/lib/studio/export.ts').includes('previewVideo?.pause()') && !/previewVideo(?!\?\.pause)/.test(read('src/lib/studio/export.ts')), 'export never draws the proxy')
ok(read('src/screens/studio/StudioPreview.tsx').includes('previewVideoOf(handle)'), 'preview drives the proxy element')
console.log(`video proxy check passed — ${n} assertions, real FFmpeg transcode verified`)
