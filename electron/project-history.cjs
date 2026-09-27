/**
 * Project autosave, crash recovery and version history (2.26).
 *
 * No Electron imports: every function takes the directory it works in, so
 * scripts/check-project-history.mjs exercises the real code against a temp
 * folder.
 *
 *  - Writes are atomic (temp file + rename), so a crash or power cut mid-save
 *    leaves the previous good file, never a half-written one.
 *  - Every save may also roll a snapshot into `history/`: at most one per
 *    `minIntervalMs`, newest `keep` kept. That is a rolling set of recent
 *    states, not one overwrite.
 *  - A load that finds the main file unreadable falls back to the newest
 *    snapshot that parses, and says so.
 *  - A "session open" marker detects that the previous run did not exit
 *    cleanly, so the UI can offer the version list.
 */
const fs = require('node:fs')
const path = require('node:path')

const DEFAULTS = { keep: 30, minIntervalMs: 2 * 60 * 1000 }
const SNAPSHOT_RE = /^projects-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:-([a-z0-9-]{1,40}))?\.json$/

function historyDir(dir) {
  return path.join(dir, 'history')
}

function stateFile(dir) {
  return path.join(dir, 'projects.json')
}

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function stampToIso(s) {
  // 2026-09-27T11-34-18-241Z → 2026-09-27T11:34:18.241Z
  return s.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

function parses(text) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** A short, human summary of a persisted store blob — project names, counts. */
function summarise(text) {
  try {
    const parsed = JSON.parse(text)
    const state = parsed && parsed.state ? parsed.state : parsed
    const projects = Array.isArray(state && state.projects) ? state.projects : []
    const clips = projects.reduce((n, p) => n + ((p && p.studio && Array.isArray(p.studio.clips)) ? p.studio.clips.length : 0), 0)
    return {
      projects: projects.length,
      clips,
      names: projects.slice(0, 4).map((p) => String((p && p.name) || 'Untitled')),
      schemaVersion: typeof (parsed && parsed.version) === 'number' ? parsed.version : null,
    }
  } catch {
    return { projects: 0, clips: 0, names: [], schemaVersion: null }
  }
}

function listVersions(dir) {
  const hdir = historyDir(dir)
  let names = []
  try {
    names = fs.readdirSync(hdir)
  } catch {
    return []
  }
  return names
    .map((name) => {
      const m = SNAPSHOT_RE.exec(name)
      if (!m) return null
      const full = path.join(hdir, name)
      let bytes = 0
      let text = ''
      try {
        bytes = fs.statSync(full).size
        text = fs.readFileSync(full, 'utf8')
      } catch {
        return null
      }
      return { id: name, at: stampToIso(m[1]), label: m[2] || 'autosave', bytes, valid: parses(text), ...summarise(text) }
    })
    .filter(Boolean)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}

function prune(dir, keep) {
  const versions = listVersions(dir)
  // Labelled snapshots (before-restore, manual) are pruned last.
  const autos = versions.filter((v) => v.label === 'autosave')
  const others = versions.filter((v) => v.label !== 'autosave')
  const drop = [...autos.slice(keep), ...others.slice(Math.max(5, Math.floor(keep / 3)))]
  for (const v of drop) {
    try {
      fs.rmSync(path.join(historyDir(dir), v.id), { force: true })
    } catch {}
  }
}

/** Copy `text` into history now, with an optional label. Returns the id. */
function snapshot(dir, text, label, now = new Date()) {
  if (!text || !parses(text)) return null
  const safeLabel = label ? String(label).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : ''
  const name = `projects-${stamp(now)}${safeLabel && safeLabel !== 'autosave' ? `-${safeLabel}` : ''}.json`
  writeAtomic(path.join(historyDir(dir), name), text)
  return name
}

/**
 * Save the store. Atomic, and rolls an autosave snapshot when the newest one
 * is older than `minIntervalMs`. Refuses to overwrite good data with text that
 * does not parse.
 */
function save(dir, text, opts = {}) {
  const { keep, minIntervalMs } = { ...DEFAULTS, ...opts }
  const now = opts.now || new Date()
  const value = String(text)
  if (!parses(value)) throw new Error('Refusing to save project data that is not valid JSON.')
  writeAtomic(stateFile(dir), value)
  const newest = listVersions(dir).find((v) => v.label === 'autosave')
  const due = !newest || now.getTime() - Date.parse(newest.at) >= minIntervalMs
  let snap = null
  if (due) {
    snap = snapshot(dir, value, 'autosave', now)
    prune(dir, keep)
  }
  return { saved: true, snapshot: snap }
}

/** Load the store, recovering from the newest valid snapshot when needed. */
function load(dir) {
  let text = null
  try {
    text = fs.readFileSync(stateFile(dir), 'utf8')
  } catch {
    text = null
  }
  if (text !== null && parses(text)) return { text, recoveredFrom: null }
  const fallback = listVersions(dir).find((v) => v.valid)
  if (!fallback) return { text: null, recoveredFrom: null, corrupt: text !== null }
  const recovered = fs.readFileSync(path.join(historyDir(dir), fallback.id), 'utf8')
  if (text !== null) {
    // Keep the unreadable file for inspection rather than destroying it.
    try {
      fs.renameSync(stateFile(dir), path.join(dir, `projects.corrupt-${stamp(new Date())}.json`))
    } catch {}
  }
  writeAtomic(stateFile(dir), recovered)
  return { text: recovered, recoveredFrom: fallback.id, corrupt: text !== null }
}

/** Restore a snapshot as the current state; the current state is kept as "before-restore". */
function restore(dir, id) {
  if (!SNAPSHOT_RE.test(String(id)) || path.basename(String(id)) !== String(id)) throw new Error('Unknown version.')
  const file = path.join(historyDir(dir), id)
  const text = fs.readFileSync(file, 'utf8')
  if (!parses(text)) throw new Error('That version is damaged and cannot be restored.')
  try {
    const current = fs.readFileSync(stateFile(dir), 'utf8')
    snapshot(dir, current, 'before-restore')
  } catch {}
  writeAtomic(stateFile(dir), text)
  return { restored: id }
}

/* ——— unclean-exit detection ——— */

function markerFile(dir) {
  return path.join(dir, 'session.open')
}

/** Call at startup. Returns true when the previous session did not close cleanly. */
function beginSession(dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true })
  const crashed = fs.existsSync(markerFile(dir))
  fs.writeFileSync(markerFile(dir), now.toISOString(), 'utf8')
  return crashed
}

function endSession(dir) {
  try {
    fs.rmSync(markerFile(dir), { force: true })
  } catch {}
}

module.exports = { save, load, restore, snapshot, listVersions, beginSession, endSession, writeAtomic, DEFAULTS }
