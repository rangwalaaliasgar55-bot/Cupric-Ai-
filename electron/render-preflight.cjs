/**
 * Export preflight and post-render verification.
 *
 * PHASE 0 AUDIT (docs/AUDIT_PHASE0.md §B6/B7) recorded that a render could only
 * fail *after* the encode: an unwritable folder, a full disk, a missing encoder,
 * a filename Windows will not accept, or a file that encodes but plays wrong,
 * all surfaced as "FFmpeg could not …" with ffmpeg's own text underneath.
 *
 * This module turns those into named failures with a stated fix, and verifies
 * the delivered file with ffprobe before the UI is told the export succeeded
 * (a "Render complete" toast over an unplayable file is the worst outcome the
 * product can produce). Everything here is pure or takes its side effects
 * injected, so `src/tests/render-preflight.test.ts` and
 * `scripts/check-export-preflight.mjs` run it with real files, a real statfs and
 * the real ffprobe.
 */

const fs = require('node:fs')
const path = require('node:path')

/** Named failures. Each one has its own message and its own stated fix. */
const RENDER_FAILURES = Object.freeze({
  PATH_INVALID: 'PATH_INVALID',
  PATH_NOT_ABSOLUTE: 'PATH_NOT_ABSOLUTE',
  PATH_BAD_EXTENSION: 'PATH_BAD_EXTENSION',
  PATH_RESERVED_NAME: 'PATH_RESERVED_NAME',
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  OUTPUT_DIR_MISSING: 'OUTPUT_DIR_MISSING',
  OUTPUT_NOT_WRITABLE: 'OUTPUT_NOT_WRITABLE',
  DISK_FULL: 'DISK_FULL',
  FFMPEG_MISSING: 'FFMPEG_MISSING',
  FFPROBE_MISSING: 'FFPROBE_MISSING',
  ENCODER_MISSING: 'ENCODER_MISSING',
  EMPTY_FILE: 'EMPTY_FILE',
  NO_OUTPUT_FILE: 'NO_OUTPUT_FILE',
  UNPLAYABLE: 'UNPLAYABLE',
  NO_VIDEO_STREAM: 'NO_VIDEO_STREAM',
  NO_AUDIO_STREAM: 'NO_AUDIO_STREAM',
  WRONG_DURATION: 'WRONG_DURATION',
  WRONG_SIZE: 'WRONG_SIZE',
})

const OUTPUT_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv']
/** Windows device names: a file called `CON.mp4` is not a file. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])
/** Windows forbids these anywhere in a path component. */
const RESERVED_CHARS = /[<>:"|?*\u0000-\u001f]/
/** A path longer than this is not guaranteed to open without the long-path opt-in. */
const WINDOWS_PATH_LIMIT = 240
/** Kept free so a nearly-full disk does not produce a truncated file. */
const DISK_RESERVE_BYTES = 512 * 1024 * 1024

const MB = 1024 * 1024

function failure(code, message, action, detail) {
  return { code, message, action, ...(detail === undefined ? {} : { detail }) }
}

function failureError(failures) {
  const first = Array.isArray(failures) ? failures[0] : failures
  const err = new Error(first?.message || 'The export could not start.')
  err.code = first?.code || 'RENDER_FAILED'
  err.action = first?.action
  err.failures = Array.isArray(failures) ? failures : first ? [first] : []
  err.kind = 'render'
  return err
}

/**
 * Windows path rules, applied to the *file* the user asked for.
 *
 * `platform` is a parameter because the rules are Windows rules: the checker
 * runs them everywhere and says so, rather than pretending POSIX would accept
 * these names.
 */
function classifyOutputPath(outputPath, options = {}) {
  const issues = []
  const value = typeof outputPath === 'string' ? outputPath.trim() : ''
  if (!value) {
    return { ok: false, failures: [failure(RENDER_FAILURES.PATH_INVALID, 'No output file name was given.', 'Choose where the export should be saved.')] }
  }
  const platform = options.platform || 'win32'
  const absolute = platform === 'win32' ? /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) : value.startsWith('/')
  if (!absolute) {
    issues.push(failure(RENDER_FAILURES.PATH_NOT_ABSOLUTE, `“${value}” is not a full path, so there is nowhere to write it.`, 'Pick a folder in the save dialog instead of typing a relative name.', value))
  }
  const ext = path.extname(value).toLowerCase()
  if (!OUTPUT_EXTENSIONS.includes(ext)) {
    issues.push(failure(RENDER_FAILURES.PATH_BAD_EXTENSION, `NewBrand writes ${OUTPUT_EXTENSIONS.join(', ')} files, not “${ext || 'no extension'}”.`, `Rename the export so it ends in ${OUTPUT_EXTENSIONS[0]}.`, value))
  }
  if (platform === 'win32') {
    const withoutDrive = value.replace(/^[a-zA-Z]:/, '')
    if (RESERVED_CHARS.test(withoutDrive)) {
      const offending = withoutDrive.match(RESERVED_CHARS)?.[0]
      issues.push(failure(RENDER_FAILURES.PATH_INVALID, `Windows does not allow “${offending}” in a file name.`, 'Remove it from the name and export again.', value))
    }
    for (const part of withoutDrive.split(/[\\/]/)) {
      const stem = part.replace(/\.[^.]*$/, '')
      if (RESERVED_NAMES.has(stem.toLowerCase())) {
        issues.push(failure(RENDER_FAILURES.PATH_RESERVED_NAME, `“${part}” is a reserved Windows device name, so it cannot be created.`, 'Pick a different name.', value))
        break
      }
    }
    const badSegment = withoutDrive.split(/[\\/]/).find((part) => part && /[ .]$/.test(part))
    if (badSegment) {
      issues.push(failure(RENDER_FAILURES.PATH_INVALID, `“${badSegment}” ends with a space or a dot, which Windows silently drops.`, 'Remove the trailing character and export again.', value))
    }
    if (value.length > WINDOWS_PATH_LIMIT) {
      issues.push(failure(RENDER_FAILURES.PATH_TOO_LONG, `That path is ${value.length} characters; Windows will refuse to open files past ${WINDOWS_PATH_LIMIT} without the long-path setting.`, 'Save into a shorter folder (for example directly under Videos).', value))
    }
  }
  return { ok: issues.length === 0, failures: issues }
}

/**
 * A conservative size estimate for the disk check.
 *
 * The bitrate model is stated rather than guessed: bits per pixel per frame at
 * the chosen quality, plus 192 kbps of audio, rounded up. It is deliberately
 * pessimistic — refusing a render that would have fitted is a smaller failure
 * than filling the user's disk and writing a truncated file.
 */
const BITS_PER_PIXEL = Object.freeze({ draft: 0.06, balanced: 0.1, final: 0.16 })

function estimateOutputBytes({ durationSec, fps = 30, size = [1920, 1080], quality = 'balanced', audioKbps = 192 } = {}) {
  const seconds = Math.max(0.1, Number(durationSec) || 0)
  const rate = Math.max(1, Number(fps) || 30)
  const [width, height] = Array.isArray(size) && size.length === 2 ? [Number(size[0]) || 1920, Number(size[1]) || 1080] : [1920, 1080]
  const bpp = BITS_PER_PIXEL[quality] ?? BITS_PER_PIXEL.balanced
  const videoBytes = (width * height * rate * bpp * seconds) / 8
  const audioBytes = (audioKbps * 1000 * seconds) / 8
  const bytes = Math.ceil((videoBytes + audioBytes) * 1.15)
  return { bytes, model: `${width}x${height}@${rate} · ${bpp} bpp · ${quality}`, note: `≈ ${(bytes / MB).toFixed(1)} MB estimated` }
}

/** Free space on the volume that will hold the export. */
function checkDiskSpace({ dir, needBytes, statfs = fs.statfsSync, reserveBytes = DISK_RESERVE_BYTES } = {}) {
  try {
    const stats = statfs(dir)
    const blockSize = Number(stats.bsize) || 0
    const freeBytes = blockSize * (Number(stats.bavail) || 0)
    const required = Number(needBytes) + reserveBytes
    if (!blockSize) {
      return { ok: true, freeBytes: null, needBytes: Number(needBytes) || 0, failures: [], note: 'free space could not be read; the write itself will report failure' }
    }
    if (freeBytes < required) {
      return {
        ok: false,
        freeBytes,
        needBytes: Number(needBytes) || 0,
        failures: [failure(
          RENDER_FAILURES.DISK_FULL,
          `This drive has ${(freeBytes / MB).toFixed(0)} MB free and the export needs about ${((Number(needBytes) || 0) / MB).toFixed(0)} MB, plus ${(reserveBytes / MB).toFixed(0)} MB kept clear.`,
          'Free some space on that drive, or export to a drive with more room.',
          dir,
        )],
      }
    }
    return { ok: true, freeBytes, needBytes: Number(needBytes) || 0, failures: [], note: `${(freeBytes / MB).toFixed(0)} MB free` }
  } catch (err) {
    return { ok: true, freeBytes: null, needBytes: Number(needBytes) || 0, failures: [], note: `free space could not be read (${err?.code || err?.message || err})` }
  }
}

/**
 * Is the destination folder there, and can this process actually write in it?
 *
 * The probe writes and deletes a real file: an access() check lies on Windows
 * when a file is open elsewhere, and on a full disk the write is what fails.
 */
function checkWritable({ dir, probe, mkdir = (target) => fs.mkdirSync(target, { recursive: true }) } = {}) {
  const failures = []
  try {
    if (!fs.existsSync(dir)) mkdir(dir)
  } catch (err) {
    return {
      ok: false,
      failures: [failure(RENDER_FAILURES.OUTPUT_DIR_MISSING, `The export folder “${dir}” does not exist and could not be created: ${err?.message || err}`, 'Pick an existing folder, or create it and try again.', dir)],
    }
  }
  const writeProbe = probe || ((target) => {
    const file = path.join(target, `.newbrand-write-probe-${process.pid}-${Date.now()}`)
    fs.writeFileSync(file, 'ok')
    fs.rmSync(file, { force: true })
  })
  try {
    writeProbe(dir)
    return { ok: true, failures: [] }
  } catch (err) {
    const code = err?.code || ''
    if (code === 'ENOSPC') {
      failures.push(failure(RENDER_FAILURES.DISK_FULL, `There is no space left on the drive holding “${dir}”.`, 'Free some space, or export to another drive.', dir))
    } else if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      failures.push(failure(RENDER_FAILURES.OUTPUT_NOT_WRITABLE, `Windows did not allow writing in “${dir}” (${code}).`, 'Choose a folder you can write to (Videos or Desktop), or close the app that has the file open.', dir))
    } else {
      failures.push(failure(RENDER_FAILURES.OUTPUT_NOT_WRITABLE, `“${dir}” could not be written to: ${err?.message || err}`, 'Choose a different folder and export again.', dir))
    }
    return { ok: false, failures }
  }
}

/** Encoder names from `ffmpeg -encoders` output. */
function parseEncoders(text) {
  const names = new Set()
  for (const line of String(text || '').split(/\r?\n/)) {
    // ` V....D libx264   libx264 H.264 …` — the legend lines (` V..... = Video`)
    // and the `Encoders:` header have a single space and are not encoders.
    const match = /^\s*[A-Z.]{6}\s+(\S+)\s{2,}\S/.exec(line)
    if (match) names.add(match[1])
  }
  return names
}

/** Which encoder a container needs, and what to do when it is missing. */
function requiredEncoders({ container = 'mp4', codec = 'h264' } = {}) {
  if (codec === 'av1') return ['libsvtav1', 'libaom-av1', 'librav1e']
  if (container === 'webm') return ['libvpx-vp9', 'libvpx']
  return ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf']
}

function checkEncoder({ container, codec, encoders }) {
  if (!encoders || encoders.size === 0) {
    return { ok: true, encoder: null, failures: [], note: 'the encoder list could not be read; the encode will report its own failure' }
  }
  const wanted = requiredEncoders({ container, codec })
  const found = wanted.find((name) => encoders.has(name))
  if (found) return { ok: true, encoder: found, failures: [], note: found }
  return {
    ok: false,
    encoder: null,
    failures: [failure(
      RENDER_FAILURES.ENCODER_MISSING,
      `This build of FFmpeg has no ${wanted[0]} encoder, so it cannot write the ${container.toUpperCase()} you asked for.`,
      'Install the full FFmpeg build (or point NEWBRAND_FFMPEG_PATH at one) and export again.',
      wanted.join(' / '),
    )],
  }
}

/**
 * Everything that must be true before a single frame is encoded.
 * Side effects are injected (`statfs`, `probe`, `encoders`) so this is testable
 * and so the checks can run it against real files and a real disk.
 */
function buildPreflight(options = {}) {
  const {
    outputPath,
    dir = outputPath ? path.dirname(outputPath) : '',
    durationSec = 0,
    fps = 30,
    size = [1920, 1080],
    quality = 'balanced',
    container = 'mp4',
    codec = 'h264',
    ffmpegPath = null,
    ffprobePath = null,
    encoders = null,
    statfs,
    probe,
    platform = 'win32',
  } = options

  const checks = []
  const failures = []

  const pathVerdict = classifyOutputPath(outputPath, { platform })
  checks.push({ id: 'path', ok: pathVerdict.ok, detail: pathVerdict.ok ? 'name rules ok' : pathVerdict.failures.map((f) => f.code).join(', ') })
  failures.push(...pathVerdict.failures)

  if (!ffmpegPath) {
    failures.push(failure(RENDER_FAILURES.FFMPEG_MISSING, 'FFmpeg is not available, so nothing can be encoded.', 'Install the full build, or set NEWBRAND_FFMPEG_PATH to ffmpeg.exe and restart NewBrand.'))
    checks.push({ id: 'ffmpeg', ok: false, detail: 'missing' })
  } else {
    checks.push({ id: 'ffmpeg', ok: true, detail: ffmpegPath })
  }
  if (!ffprobePath) {
    failures.push(failure(RENDER_FAILURES.FFPROBE_MISSING, 'FFprobe is not available, so the finished file could not be verified.', 'Install the full build, or set NEWBRAND_FFPROBE_PATH to ffprobe.exe and restart NewBrand.'))
    checks.push({ id: 'ffprobe', ok: false, detail: 'missing' })
  } else {
    checks.push({ id: 'ffprobe', ok: true, detail: ffprobePath })
  }

  if (dir) {
    const writable = checkWritable({ dir, probe })
    checks.push({ id: 'writable', ok: writable.ok, detail: writable.ok ? dir : writable.failures.map((f) => f.code).join(', ') })
    failures.push(...writable.failures)
  }

  const estimate = estimateOutputBytes({ durationSec, fps, size, quality })
  if (dir) {
    const space = checkDiskSpace({ dir, needBytes: estimate.bytes, statfs })
    checks.push({ id: 'disk', ok: space.ok, detail: space.note || '' })
    failures.push(...space.failures)
  }

  const encoder = checkEncoder({ container, codec, encoders })
  checks.push({ id: 'encoder', ok: encoder.ok, detail: encoder.note || '' })
  failures.push(...encoder.failures)

  return { ok: failures.length === 0, checks, failures, estimate }
}

/**
 * The delivered file, checked against what the export was asked to produce.
 *
 * `probe` is what `probeMedia()` returns (ffprobe JSON, parsed) or null when the
 * probe could not run. `sizeBytes` is the file size on disk.
 */
function verifyExport(probe, expectations = {}) {
  const {
    durationSec = null,
    toleranceSec = 0.75,
    width = null,
    height = null,
    needsVideo = true,
    needsAudio = false,
    sizeBytes = null,
  } = expectations
  const checks = []
  const failures = []

  if (sizeBytes !== null && Number(sizeBytes) <= 0) {
    failures.push(failure(RENDER_FAILURES.EMPTY_FILE, 'The export produced a zero-byte file.', 'Render again; if it repeats, check that the drive has free space and that the timeline is not empty.'))
    checks.push({ id: 'size', ok: false, detail: '0 bytes' })
  } else if (sizeBytes !== null) {
    checks.push({ id: 'size', ok: true, detail: `${(Number(sizeBytes) / MB).toFixed(1)} MB` })
  }

  if (!probe || !Array.isArray(probe.streams) || probe.streams.length === 0) {
    failures.push(failure(RENDER_FAILURES.UNPLAYABLE, 'The finished file could not be read back, so it is not playable video.', 'Render again; if it repeats, the encoder or the drive is failing — check the log for the FFmpeg output.'))
    checks.push({ id: 'probe', ok: false, detail: 'not readable' })
    return { ok: false, checks, failures }
  }
  checks.push({ id: 'probe', ok: true, detail: `${probe.streams.length} stream(s)` })

  const video = probe.streams.find((stream) => stream.codec_type === 'video')
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio')
  if (needsVideo && !video) {
    failures.push(failure(RENDER_FAILURES.NO_VIDEO_STREAM, 'The finished file has no picture track.', 'This is an encoder failure — render again and send the log if it repeats.'))
  }
  checks.push({ id: 'video', ok: Boolean(video), detail: video ? `${video.codec_name || 'video'} ${video.width || '?'}x${video.height || '?'}` : 'none' })
  if (needsAudio && !audio) {
    failures.push(failure(RENDER_FAILURES.NO_AUDIO_STREAM, 'The timeline has audio, but the finished file has no sound track.', 'Export again; if it repeats, check the clip volumes are above zero.'))
  }
  checks.push({ id: 'audio', ok: needsAudio ? Boolean(audio) : true, detail: audio ? `${audio.codec_name || 'audio'}` : 'none' })

  const actualDuration = Number(probe.durationSec) || 0
  if (durationSec !== null && durationSec > 0 && actualDuration > 0) {
    const drift = Math.abs(actualDuration - Number(durationSec))
    const ok = drift <= toleranceSec
    checks.push({ id: 'duration', ok, detail: `${actualDuration.toFixed(2)}s vs ${Number(durationSec).toFixed(2)}s expected` })
    if (!ok) {
      failures.push(failure(RENDER_FAILURES.WRONG_DURATION, `The finished file is ${actualDuration.toFixed(1)}s long, but the timeline is ${Number(durationSec).toFixed(1)}s.`, 'Render again; if it repeats, a source clip may be unreadable part-way through.', `${drift.toFixed(2)}s`))
    }
  }

  if (width && height && video) {
    const ok = Number(video.width) === Number(width) && Number(video.height) === Number(height)
    checks.push({ id: 'size', ok, detail: `${video.width}x${video.height} vs ${width}x${height} expected` })
    if (!ok) {
      failures.push(failure(RENDER_FAILURES.WRONG_SIZE, `The finished file is ${video.width}×${video.height}, but the export was set to ${width}×${height}.`, 'Render again with the same settings; if the size keeps changing, report it with the log.', `${video.width}x${video.height}`))
    }
  }

  return { ok: failures.length === 0, checks, failures }
}

module.exports = {
  RENDER_FAILURES,
  OUTPUT_EXTENSIONS,
  RESERVED_NAMES,
  WINDOWS_PATH_LIMIT,
  DISK_RESERVE_BYTES,
  failureError,
  makeFailure: failure,
  classifyOutputPath,
  estimateOutputBytes,
  checkDiskSpace,
  checkWritable,
  parseEncoders,
  requiredEncoders,
  checkEncoder,
  buildPreflight,
  verifyExport,
}
