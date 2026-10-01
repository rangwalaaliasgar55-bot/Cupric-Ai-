/**
 * Export preflight + verification rules (phase 1.6).
 *
 * These cover the pure half of `electron/render-preflight.cjs`: Windows name
 * rules, the size model, the disk and writability checks with injected side
 * effects, encoder selection, and the verdict on a finished file. The real
 * binaries — a real statfs, a read-only folder, a real ffprobe, a real encode —
 * are exercised by `scripts/check-export-preflight.mjs`, which is part of the
 * release chain.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const preflight = require('../../electron/render-preflight.cjs')

type Verdict = { ok: boolean; failures: Array<{ code: string; message: string; action: string }>; checks?: Array<{ id: string; ok: boolean; detail: string }> }
const codes = (verdict: Verdict) => verdict.failures.map((failure) => failure.code)

describe('output path rules (Windows)', () => {
  it('accepts an ordinary absolute path', () => {
    const verdict = preflight.classifyOutputPath('C:\\Users\\ana\\Videos\\launch.mp4')
    expect(verdict.ok).toBe(true)
    expect(verdict.failures).toEqual([])
  })

  it('refuses a relative name, a wrong extension and an empty value', () => {
    expect(codes(preflight.classifyOutputPath('launch.mp4'))).toContain('PATH_NOT_ABSOLUTE')
    expect(codes(preflight.classifyOutputPath('C:\\out\\launch.avi'))).toContain('PATH_BAD_EXTENSION')
    expect(codes(preflight.classifyOutputPath('   '))).toContain('PATH_INVALID')
  })

  it('refuses reserved characters, reserved device names and trailing dots/spaces', () => {
    expect(codes(preflight.classifyOutputPath('C:\\out\\launch|final.mp4'))).toContain('PATH_INVALID')
    expect(codes(preflight.classifyOutputPath('C:\\out\\CON.mp4'))).toContain('PATH_RESERVED_NAME')
    expect(codes(preflight.classifyOutputPath('C:\\out\\com1.mp4'))).toContain('PATH_RESERVED_NAME')
    // Windows silently drops a trailing space or dot in a *component*: the
    // folder here would become "out", so the file would land somewhere else.
    expect(codes(preflight.classifyOutputPath('C:\\out \\launch.mp4'))).toContain('PATH_INVALID')
    expect(codes(preflight.classifyOutputPath('C:\\out.\\launch.mp4'))).toContain('PATH_INVALID')
    // A space before the extension is legal Windows, and must not be refused.
    expect(preflight.classifyOutputPath('C:\\out\\launch .mp4').ok).toBe(true)
  })

  it('refuses a path Windows will not open without the long-path setting', () => {
    const long = `C:\\out\\${'a'.repeat(250)}.mp4`
    const verdict = preflight.classifyOutputPath(long)
    expect(codes(verdict)).toContain('PATH_TOO_LONG')
    expect(verdict.failures[0].message).toMatch(/Windows/)
  })

  it('carries a stated fix on every failure', () => {
    for (const bad of ['launch.mp4', 'C:\\out\\launch.avi', 'C:\\out\\CON.mp4', 'C:\\out \\launch.mp4', `C:\\out\\${'b'.repeat(250)}.mp4`]) {
      const verdict = preflight.classifyOutputPath(bad)
      expect(verdict.ok).toBe(false)
      for (const failure of verdict.failures) {
        expect(failure.action.length).toBeGreaterThan(10)
        expect(failure.message.length).toBeGreaterThan(10)
      }
    }
  })
})

describe('size estimate', () => {
  it('grows with duration, resolution and quality', () => {
    const base = preflight.estimateOutputBytes({ durationSec: 10, fps: 30, size: [1920, 1080], quality: 'balanced' }).bytes
    expect(preflight.estimateOutputBytes({ durationSec: 20, fps: 30, size: [1920, 1080], quality: 'balanced' }).bytes).toBeGreaterThan(base)
    expect(preflight.estimateOutputBytes({ durationSec: 10, fps: 30, size: [3840, 2160], quality: 'balanced' }).bytes).toBeGreaterThan(base)
    expect(preflight.estimateOutputBytes({ durationSec: 10, fps: 30, size: [1920, 1080], quality: 'final' }).bytes).toBeGreaterThan(base)
  })

  it('states the model it used', () => {
    const estimate = preflight.estimateOutputBytes({ durationSec: 8, fps: 30, size: [1080, 1920], quality: 'draft' })
    expect(estimate.model).toMatch(/1080x1920@30/)
    expect(estimate.note).toMatch(/MB estimated/)
  })
})

describe('disk space', () => {
  const statfsWith = (freeBytes: number) => () => ({ bsize: 4096, bavail: Math.floor(freeBytes / 4096) })

  it('passes when there is room and fails with the numbers when there is not', () => {
    const roomy = preflight.checkDiskSpace({ dir: '/tmp', needBytes: 100 * 1024 * 1024, statfs: statfsWith(50 * 1024 ** 3) })
    expect(roomy.ok).toBe(true)
    expect(roomy.note).toMatch(/MB free/)

    const tight = preflight.checkDiskSpace({ dir: '/tmp', needBytes: 4 * 1024 ** 3, statfs: statfsWith(1 * 1024 ** 3) })
    expect(tight.ok).toBe(false)
    expect(codes(tight)).toEqual(['DISK_FULL'])
    expect(tight.failures[0].message).toMatch(/MB free/)
    expect(tight.failures[0].action).toMatch(/Free some space/)
  })

  it('keeps a reserve clear instead of filling the drive to the last byte', () => {
    const exactly = preflight.checkDiskSpace({ dir: '/tmp', needBytes: 100 * 1024 * 1024, statfs: statfsWith(100 * 1024 * 1024 + preflight.DISK_RESERVE_BYTES - 4096) })
    expect(exactly.ok).toBe(false)
  })

  it('says so when the free space cannot be read, instead of guessing', () => {
    const verdict = preflight.checkDiskSpace({ dir: '/tmp', needBytes: 1, statfs: () => { throw new Error('EINVAL') } })
    expect(verdict.ok).toBe(true)
    expect(verdict.note).toMatch(/could not be read/)
  })
})

describe('writability', () => {
  it('reports a folder that cannot be created', () => {
    const verdict = preflight.checkWritable({ dir: '/nope/nope/nope', mkdir: () => { throw new Error('EACCES') } })
    expect(codes(verdict)).toEqual(['OUTPUT_DIR_MISSING'])
  })

  it('names permission failures and full-disk failures differently', () => {
    const denied = preflight.checkWritable({ dir: '/tmp', probe: () => { const err = Object.assign(new Error('denied'), { code: 'EACCES' }); throw err } })
    expect(codes(denied)).toEqual(['OUTPUT_NOT_WRITABLE'])
    expect(denied.failures[0].message).toMatch(/did not allow writing/)
    const full = preflight.checkWritable({ dir: '/tmp', probe: () => { const err = Object.assign(new Error('no space'), { code: 'ENOSPC' }); throw err } })
    expect(codes(full)).toEqual(['DISK_FULL'])
  })
})

describe('encoder selection', () => {
  it('parses an `ffmpeg -encoders` listing', () => {
    const list = preflight.parseEncoders([
      'Encoders:',
      ' V..... = Video',
      ' -----',
      ' V....D libx264              libx264 H.264 / AVC (codec h264)',
      ' V..... libvpx-vp9           libvpx VP9 (codec vp9)',
      ' A..... aac                  AAC (Advanced Audio Coding)',
    ].join('\n'))
    expect([...list]).toEqual(['libx264', 'libvpx-vp9', 'aac'])
  })

  it('accepts any hardware or software H.264 encoder and refuses an FFmpeg without one', () => {
    expect(preflight.checkEncoder({ container: 'mp4', codec: 'h264', encoders: new Set(['h264_nvenc']) }).ok).toBe(true)
    const missing = preflight.checkEncoder({ container: 'mp4', codec: 'h264', encoders: new Set(['libvpx-vp9', 'aac']) })
    expect(missing.ok).toBe(false)
    expect(codes(missing)).toEqual(['ENCODER_MISSING'])
    expect(missing.failures[0].action).toMatch(/NEWBRAND_FFMPEG_PATH/)
  })

  it('treats an unreadable encoder list as unknown, not as missing', () => {
    expect(preflight.checkEncoder({ container: 'mp4', codec: 'h264', encoders: null }).ok).toBe(true)
  })
})

describe('preflight verdict', () => {
  const base = {
    outputPath: 'C:\\out\\launch.mp4',
    durationSec: 12,
    fps: 30,
    size: [1080, 1920],
    quality: 'high',
    ffmpegPath: 'C:\\ff\\ffmpeg.exe',
    ffprobePath: 'C:\\ff\\ffprobe.exe',
    encoders: new Set(['libx264', 'aac']),
    statfs: () => ({ bsize: 4096, bavail: 1024 * 1024 }),
    probe: () => {},
  }

  it('passes when everything is in place and reports each check', () => {
    const verdict = preflight.buildPreflight(base)
    expect(verdict.ok).toBe(true)
    expect(verdict.checks?.map((check: { id: string }) => check.id)).toEqual(['path', 'ffmpeg', 'ffprobe', 'writable', 'disk', 'encoder'])
    expect(verdict.estimate?.note).toMatch(/MB estimated/)
  })

  it('collects every reason at once, so the user fixes one pass of problems', () => {
    const verdict = preflight.buildPreflight({
      ...base,
      outputPath: 'launch.avi',
      ffmpegPath: null,
      ffprobePath: null,
      encoders: new Set(['aac']),
      statfs: () => ({ bsize: 4096, bavail: 1 }),
    })
    expect(verdict.ok).toBe(false)
    const found = codes(verdict)
    expect(found).toContain('PATH_NOT_ABSOLUTE')
    expect(found).toContain('PATH_BAD_EXTENSION')
    expect(found).toContain('FFMPEG_MISSING')
    expect(found).toContain('FFPROBE_MISSING')
    expect(found).toContain('DISK_FULL')
    expect(found).toContain('ENCODER_MISSING')
  })

  it('turns the first failure into a thrown error that carries all of them', () => {
    const verdict = preflight.buildPreflight({ ...base, ffmpegPath: null })
    const error = preflight.failureError(verdict.failures)
    expect(error.code).toBe('FFMPEG_MISSING')
    expect(error.kind).toBe('render')
    expect(error.failures.length).toBeGreaterThan(0)
    expect(error.message).toMatch(/FFmpeg/)
  })
})

describe('finished-file verification', () => {
  const probe = {
    durationSec: 12.02,
    hasAudio: true,
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920 },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  }

  it('passes a file that matches what was asked for', () => {
    const verdict = preflight.verifyExport(probe, { durationSec: 12, width: 1080, height: 1920, needsVideo: true, needsAudio: true, sizeBytes: 1024 * 1024 })
    expect(verdict.ok).toBe(true)
    expect(verdict.checks?.map((check: { id: string }) => check.id)).toEqual(['size', 'probe', 'video', 'audio', 'duration', 'size'])
  })

  it('fails a zero-byte file before it even probes', () => {
    const verdict = preflight.verifyExport(null, { sizeBytes: 0 })
    expect(codes(verdict)).toContain('EMPTY_FILE')
  })

  it('fails a file ffprobe cannot read', () => {
    const verdict = preflight.verifyExport(null, { sizeBytes: 4096 })
    expect(codes(verdict)).toEqual(['UNPLAYABLE'])
  })

  it('fails a missing picture track, a missing sound track, the wrong length and the wrong size', () => {
    const noVideo = preflight.verifyExport({ ...probe, streams: [probe.streams[1]] }, { durationSec: 12, needsVideo: true })
    expect(codes(noVideo)).toContain('NO_VIDEO_STREAM')

    const noAudio = preflight.verifyExport({ ...probe, streams: [probe.streams[0]] }, { needsAudio: true })
    expect(codes(noAudio)).toContain('NO_AUDIO_STREAM')

    const short = preflight.verifyExport({ ...probe, durationSec: 3 }, { durationSec: 12 })
    expect(codes(short)).toContain('WRONG_DURATION')

    const wrongSize = preflight.verifyExport(probe, { width: 1920, height: 1080 })
    expect(codes(wrongSize)).toContain('WRONG_SIZE')
    expect(wrongSize.failures.find((failure: { code: string }) => failure.code === 'WRONG_SIZE')?.message).toMatch(/1920×1080/)
  })

  it('tolerates a fraction of a second of encoder drift', () => {
    expect(preflight.verifyExport(probe, { durationSec: 12.5, toleranceSec: 0.75 }).ok).toBe(true)
    expect(preflight.verifyExport(probe, { durationSec: 14, toleranceSec: 0.75 }).ok).toBe(false)
  })

  it('does not demand sound when the timeline had none', () => {
    const silent = preflight.verifyExport({ ...probe, hasAudio: false, streams: [probe.streams[0]] }, { needsAudio: false, needsVideo: true })
    expect(silent.ok).toBe(true)
    expect(silent.checks?.find((check: { id: string; detail: string }) => check.id === 'audio')?.detail).toBe('none')
  })
})
