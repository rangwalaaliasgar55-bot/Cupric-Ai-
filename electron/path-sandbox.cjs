/**
 * F-2 — one containment rule for every path that leaves the main process.
 *
 * 0.13.0 shipped a raw-string prefix test (`path.relative(root, p)`) against a
 * single root (`userData/projects`). Two things broke in production, seven
 * times in one export batch:
 *
 *   1. legitimate Cupric-written media lives in sibling roots — a finished
 *      render is `userData/renders/<jobId>/clip.mp4`, a proxy is
 *      `userData/proxies/<hash>.mp4` — and every one of those was rejected
 *      with "Preview path is outside Cupric AI project data";
 *   2. on Windows the *same* file has several spellings. Explorer, the file
 *      picker and `app.getPath` disagree about case (`C:\Users\…` vs
 *      `c:\users\…`), about 8.3 short names (`ALIASG~1`, `CUPRIC~1`) and
 *      about junctions/symlinks (`%APPDATA%` redirected to another volume).
 *      A raw string prefix says "outside" for all three.
 *
 * So: canonicalise both sides first (real path where the OS can resolve it,
 * nearest existing ancestor otherwise, because a render target may not exist
 * yet), then compare segment-wise, case-insensitively on Windows.
 *
 * Pure and dependency-free — `realpath`, `platform` and `sep` are injected, so
 * `check-sandbox.mjs` exercises the Windows spellings on Linux CI.
 */

const nodePath = require('node:path')

/** The userData subtrees Cupric itself writes. NEVER the userData root: that
 *  holds settings.json, and a file:// URL to it would hand the renderer keys. */
const PROJECT_DATA_DIRS = Object.freeze([
  'projects',       // per-project: arena/<assetId>, footage/, stock/
  'renders',        // renders/<jobId>/ — studio exports, the F-2 regression
  'proxies',        // transcoded editing proxies
  'stock-cache',    // stock provider cache
  'automation',     // automation job artefacts
  'agent-generated',// agent-written animations
  'voice-tmp',      // TTS + transcription scratch
])

function pathApi(platform) {
  return platform === 'win32' ? nodePath.win32 : nodePath.posix
}

/**
 * Resolve a path as far as the filesystem allows.
 *
 * `realpath` throws for anything that does not exist yet, which is normal for
 * a render target mid-write, so we canonicalise the deepest existing ancestor
 * and re-attach the rest. That keeps symlink/junction/8.3/case normalisation
 * for the part that exists without inventing anything for the part that does not.
 */
function canonicalize(input, { realpath, platform = process.platform } = {}) {
  const p = pathApi(platform)
  const resolved = p.resolve(String(input || ''))
  if (typeof realpath !== 'function') return resolved
  try { return p.resolve(realpath(resolved)) } catch { /* not created yet */ }
  const tail = []
  let dir = resolved
  for (let depth = 0; depth < 64; depth += 1) {
    const parent = p.dirname(dir)
    if (!parent || parent === dir) break
    tail.unshift(p.basename(dir))
    dir = parent
    try { return p.resolve(p.join(realpath(dir), ...tail)) } catch { /* keep walking up */ }
  }
  return resolved
}

/** Windows compares paths case-insensitively; POSIX does not. */
function comparable(value, platform) {
  return platform === 'win32' ? String(value).toLowerCase() : String(value)
}

/**
 * Is `child` the same as, or inside, `parent`? Segment-wise, so
 * `…/renders-private` is never accepted as a child of `…/renders`.
 */
function isInside(child, parent, { platform = process.platform } = {}) {
  const p = pathApi(platform)
  const rel = p.relative(comparable(p.resolve(parent), platform), comparable(p.resolve(child), platform))
  if (rel === '') return true
  if (!rel) return false
  if (p.isAbsolute(rel)) return false
  return !rel.split(p.sep).includes('..')
}

/**
 * Decide whether a path may be handed to the renderer as a file:// URL.
 * Returns `{ ok, canonical, root }` or `{ ok:false, canonical, reason }`.
 */
function resolveInsideRoots(candidate, roots, { realpath, platform = process.platform } = {}) {
  const raw = String(candidate || '').trim()
  if (!raw) return { ok: false, canonical: '', reason: 'empty' }
  const canonical = canonicalize(raw, { realpath, platform })
  for (const root of roots) {
    const canonicalRoot = canonicalize(root, { realpath, platform })
    if (isInside(canonical, canonicalRoot, { platform })) return { ok: true, canonical, root: canonicalRoot }
  }
  return { ok: false, canonical, reason: 'outside' }
}

/**
 * The sentence a user reads when a path really is outside. It names the file,
 * says which folders are allowed, and the caller pairs it with "Reveal folder"
 * — never a bare IPC rejection string.
 */
function outsideMessage(canonical, roots) {
  const folders = roots.map((r) => String(r).split(/[\\/]/).filter(Boolean).pop()).filter(Boolean).join(', ')
  return `Cupric can only preview files it wrote itself. “${canonical}” is outside its ${folders} folders — move or re-import the file, or use Reveal folder to find it.`
}

module.exports = { PROJECT_DATA_DIRS, canonicalize, isInside, resolveInsideRoots, outsideMessage, comparable }
