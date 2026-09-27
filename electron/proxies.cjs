/**
 * Video proxies (2.7).
 *
 * A proxy is a small, scrub-friendly copy of a heavy source: ≤540 px on the
 * short side, H.264 with a keyframe every 12 frames (every seek lands close
 * to a keyframe, so scrubbing is instant), CRF 28. The Studio PREVIEW plays
 * the proxy; EXPORT always reads the original, so quality never drops.
 *
 * Proxies are cached by (path, size, mtime) — re-importing the same file is
 * instant, and editing the source invalidates its proxy automatically.
 */
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const PROXY_SHORT_SIDE = 540
const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mxf)$/i

/** Worth proxying: anything bigger than 1080p, or any 1080p+ file over ~60 MB. */
function needsProxy({ width, height, bytes }) {
  const short = Math.min(Number(width) || 0, Number(height) || 0)
  const long = Math.max(Number(width) || 0, Number(height) || 0)
  if (long > 1920 || short > 1080) return true
  return short >= 1080 && Number(bytes) > 60 * 1024 * 1024
}

function proxyKey(sourcePath, stat) {
  return crypto.createHash('sha1').update(`${path.resolve(sourcePath)}|${stat.size}|${Math.floor(stat.mtimeMs)}`).digest('hex').slice(0, 20)
}

/** ffmpeg arguments for one proxy. Even dimensions, audio kept (preview plays it). */
function proxyArgs(sourcePath, outPath) {
  return [
    '-y', '-hide_banner', '-v', 'error', '-progress', 'pipe:1', '-nostats',
    '-i', sourcePath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale='if(gt(iw,ih),-2,${PROXY_SHORT_SIDE})':'if(gt(iw,ih),${PROXY_SHORT_SIDE},-2)':flags=bilinear,setsar=1`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
    '-movflags', '+faststart',
    outPath,
  ]
}

/** Parse ffmpeg `-progress` output: out_time_us → 0..1 of `durationSec`. */
function progressFrom(chunk, durationSec) {
  const m = /out_time_(?:us|ms)=(\d+)/.exec(String(chunk))
  if (!m || !(durationSec > 0)) return null
  return Math.max(0, Math.min(1, Number(m[1]) / 1e6 / durationSec))
}

/**
 * Validate a source path coming over IPC: must be absolute, an existing
 * regular file, and look like video. Returns the fs.Stats.
 */
function validateSource(sourcePath) {
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw new Error('A proxy needs the file’s real path (desktop import).')
  if (!VIDEO_EXT.test(sourcePath)) throw new Error('Proxies are made for video files only.')
  const stat = fs.statSync(sourcePath, { throwIfNoEntry: false })
  if (!stat || !stat.isFile()) throw new Error('The source video is missing — relink it first.')
  return stat
}

module.exports = { PROXY_SHORT_SIDE, needsProxy, proxyKey, proxyArgs, progressFrom, validateSource }
