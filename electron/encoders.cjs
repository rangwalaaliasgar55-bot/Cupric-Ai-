/**
 * Hardware-accelerated H.264 export (2.24).
 *
 * The render pipeline used to configure libx264 only. This picks a hardware
 * encoder when the machine has one that actually works — NVENC (Nvidia),
 * Quick Sync (Intel), AMF (AMD), VideoToolbox (Apple) — and falls back to
 * libx264 otherwise. "Listed by `ffmpeg -encoders`" is not proof: a build can
 * list NVENC on a PC without an Nvidia GPU, so each candidate is confirmed by
 * a tiny real test encode before it is trusted.
 *
 * No Electron imports; `detect` takes a process runner so
 * scripts/check-encoders.mjs can test the selection logic without FFmpeg.
 */

const SOFTWARE = 'libx264'

/** Candidates in preference order, per platform. */
function candidatesFor(platform) {
  if (platform === 'darwin') return ['h264_videotoolbox']
  if (platform === 'win32') return ['h264_nvenc', 'h264_qsv', 'h264_amf']
  return ['h264_nvenc', 'h264_qsv']
}

/**
 * Encoder arguments for a quality tier. Every encoder emits yuv420p High
 * profile so segments from different encoders stay compatible.
 */
function videoArgs(name, quality) {
  const final = quality === 'final'
  const common = ['-pix_fmt', 'yuv420p']
  switch (name) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', final ? 'p6' : 'p3', '-rc', 'vbr', '-cq', final ? '19' : '27', '-b:v', '0', '-profile:v', 'high', ...common]
    case 'h264_qsv':
      // QSV takes NV12 (same 4:2:0 8-bit bitstream as yuv420p once encoded).
      return ['-c:v', 'h264_qsv', '-preset', final ? 'slower' : 'veryfast', '-global_quality', final ? '20' : '27', '-profile:v', 'high', '-pix_fmt', 'nv12']
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', final ? 'quality' : 'speed', '-rc', 'cqp', '-qp_i', final ? '19' : '26', '-qp_p', final ? '21' : '28', '-profile:v', 'high', ...common]
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-q:v', final ? '68' : '52', '-profile:v', 'high', '-allow_sw', '1', ...common]
    default:
      return ['-c:v', SOFTWARE, '-preset', final ? 'slow' : 'veryfast', '-crf', final ? '18' : '28', '-profile:v', 'high', ...common]
  }
}

function isHardware(name) {
  return name !== SOFTWARE
}

/** Names from `ffmpeg -hide_banner -encoders` output. */
function listedEncoders(text) {
  const out = new Set()
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s*V[.A-Z]{5}\s+(\S+)/.exec(line)
    if (m) out.add(m[1])
  }
  return out
}

/** Arguments for a 3-frame throwaway encode that proves an encoder opens. */
function probeArgs(name) {
  return ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=0.2', '-frames:v', '3', ...videoArgs(name, 'draft'), '-f', 'null', '-']
}

/**
 * Pick the encoder. `run(args)` must resolve with { stdout } or reject.
 * `mode` 'off' forces software. Never throws: any failure means libx264.
 */
async function detect(run, platform, mode = 'auto') {
  const tried = []
  if (mode === 'off') return { name: SOFTWARE, hardware: false, tried, reason: 'Hardware encoding is turned off in settings.' }
  let listed
  try {
    const { stdout, stderr } = await run(['-hide_banner', '-encoders'])
    listed = listedEncoders(`${stdout || ''}\n${stderr || ''}`)
  } catch (err) {
    return { name: SOFTWARE, hardware: false, tried, reason: `Could not list encoders: ${err?.message || err}` }
  }
  for (const name of candidatesFor(platform)) {
    if (!listed.has(name)) continue
    tried.push(name)
    try {
      await run(probeArgs(name))
      return { name, hardware: true, tried, reason: `${name} passed a test encode.` }
    } catch {
      /* listed but unusable on this machine (no GPU, old driver) — next */
    }
  }
  return { name: SOFTWARE, hardware: false, tried, reason: tried.length ? `No hardware encoder worked (${tried.join(', ')}); using libx264.` : 'No hardware encoder in this FFmpeg build; using libx264.' }
}

/**
 * 2.4 — export loudness normalisation. Single-pass EBU R128 `loudnorm` to a
 * target in LUFS (true peak −1.5 dBTP). Anything outside −30…−8 is ignored so
 * a corrupt setting can never crush or blow up the mix.
 */
function loudnormArgs(target) {
  const t = Number(target)
  if (!Number.isFinite(t) || t < -30 || t > -8) return []
  return ['-af', `loudnorm=I=${Math.round(t)}:TP=-1.5:LRA=11`]
}

module.exports = {
  loudnormArgs, SOFTWARE, candidatesFor, videoArgs, isHardware, listedEncoders, probeArgs, detect }
