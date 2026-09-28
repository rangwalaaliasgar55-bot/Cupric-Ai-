/**
 * Multi-file source-project import (e.g. a Vite/React film exported from an
 * AI builder): chapter map + one component per beat + keyframe engine +
 * audio/engine module + style constants.
 *
 * This is the second first-class ZIP shape next to the single-file Arena
 * export (index.html with #scene + window.__seek). It is decomposed into
 * Studio's own model rather than flattened to text:
 *
 *   chapter map        → one named clip + marker per chapter, at its time
 *   scene components   → one editable overlay clip each (its own copy + card)
 *   [t, value] arrays  → Studio keyframes (opacity/scale/x/y/rotation/blur/glow/hue)
 *   palette constants  → doc palette + text/card colours
 *   audio files        → audio track (synthesised audio is reported, not faked)
 *   WebGL / particles  → a background layer spanning the film (not dropped)
 *
 * Nothing in the zip is executed. Literals are read with a small parser that
 * understands JS object/array/number/string syntax and plain arithmetic over
 * constants it has already read — anything else is ignored.
 */
import type { StudioClip, StudioDoc, StudioKeyframe, StudioMarker } from '../../types/project'
import { chaptersFromTexts, extractTimedText, timedTextToSpecs, type SourceText } from './sourceFilm'

export type SourceFile = { path: string; text: string }
export type SourceChapter = { name: string; startSec: number; durationSec: number }
export type SourceTrack = { owner: string | null; param: string; channel: Channel | null; points: Array<[number, number]> }
export type SourceScene = { name: string; file: string; chapterIndex: number; lines: string[]; tracks: SourceTrack[] }
export type SourceProject = {
  framework: string
  durationSec: number
  fps: number | null
  chapters: SourceChapter[]
  scenes: SourceScene[]
  globalTracks: SourceTrack[]
  palette: Array<{ name: string; color: string }>
  fonts: string[]
  audio: { module: string | null; synthesized: boolean }
  webgl: { file: string; kind: 'three' | 'webgl' | 'particles' | 'canvas' } | null
  notes: string[]
  /** Every timed piece of copy the film draws (sourceFilm.ts). */
  texts: SourceText[]
  frame: { w: number; h: number }
}

type Channel = 'opacity' | 'scale' | 'x' | 'y' | 'rotation' | 'blur' | 'glow' | 'hue'

const CODE = /\.(?:[cm]?jsx?|tsx?)$/i
const CONFIG = /(?:^|\/)(?:vite|webpack|rollup|tailwind|postcss|eslint|babel|jest|vitest|tsconfig|next)\.config|\.d\.ts$|(?:^|\/)(?:setupTests|reportWebVitals)\./i

/* ——— safe literal reader ——— */

type Val = number | string | boolean | null | Val[] | { [k: string]: Val } | undefined

class Reader {
  i = 0
  constructor(private s: string, private consts: Map<string, Val>) {}
  ws() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i += 1
      if (this.s.startsWith('//', this.i)) { const e = this.s.indexOf('\n', this.i); this.i = e < 0 ? this.s.length : e }
      else if (this.s.startsWith('/*', this.i)) { const e = this.s.indexOf('*/', this.i); this.i = e < 0 ? this.s.length : e + 2 }
      else return
    }
  }
  value(): Val {
    this.ws()
    const c = this.s[this.i]
    if (c === '[') return this.array()
    if (c === '{') return this.object()
    if (c === '"' || c === "'" || c === '`') return this.string()
    return this.expr()
  }
  array(): Val[] {
    this.i += 1
    const out: Val[] = []
    for (let guard = 0; guard < 5000; guard += 1) {
      this.ws()
      if (this.s[this.i] === ']') { this.i += 1; return out }
      if (this.s.startsWith('...', this.i)) throw new Error('spread')
      out.push(this.value())
      this.ws()
      if (this.s[this.i] === ',') this.i += 1
      else if (this.s[this.i] !== ']') throw new Error('array')
    }
    throw new Error('array too long')
  }
  object(): { [k: string]: Val } {
    this.i += 1
    const out: { [k: string]: Val } = {}
    for (let guard = 0; guard < 2000; guard += 1) {
      this.ws()
      if (this.s[this.i] === '}') { this.i += 1; return out }
      let key: string
      const c = this.s[this.i]
      if (c === '"' || c === "'") key = this.string()
      else {
        const m = /^[A-Za-z_$][\w$]*|^\d+(?:\.\d+)?/.exec(this.s.slice(this.i, this.i + 80))
        if (!m) throw new Error('key')
        key = m[0]
        this.i += key.length
      }
      this.ws()
      if (this.s[this.i] === ':') { this.i += 1; out[key] = this.value() }
      else out[key] = this.consts.get(key) // shorthand { name }
      this.ws()
      if (this.s[this.i] === ',') this.i += 1
      else if (this.s[this.i] !== '}') throw new Error('object')
    }
    throw new Error('object too long')
  }
  string(): string {
    const q = this.s[this.i]
    this.i += 1
    let out = ''
    while (this.i < this.s.length && this.s[this.i] !== q) {
      if (this.s[this.i] === '\\') { out += this.s[this.i + 1] ?? ''; this.i += 2; continue }
      if (q === '`' && this.s.startsWith('${', this.i)) throw new Error('template')
      out += this.s[this.i]
      this.i += 1
    }
    this.i += 1
    return out
  }
  // expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)* ; unary := '-'? atom
  expr(): Val {
    let v = this.term()
    for (;;) {
      this.ws()
      const c = this.s[this.i]
      if (c !== '+' && c !== '-') return v
      this.i += 1
      const r = this.term()
      if (typeof v !== 'number' || typeof r !== 'number') throw new Error('non-numeric')
      v = c === '+' ? v + r : v - r
    }
  }
  term(): Val {
    let v = this.unary()
    for (;;) {
      this.ws()
      const c = this.s[this.i]
      if ((c !== '*' && c !== '/') || this.s[this.i + 1] === '/' || this.s[this.i + 1] === '*') return v
      this.i += 1
      const r = this.unary()
      if (typeof v !== 'number' || typeof r !== 'number') throw new Error('non-numeric')
      v = c === '*' ? v * r : v / r
    }
  }
  unary(): Val {
    this.ws()
    if (this.s[this.i] === '-') { this.i += 1; const v = this.unary(); if (typeof v !== 'number') throw new Error('neg'); return -v }
    if (this.s[this.i] === '(') { this.i += 1; const v = this.expr(); this.ws(); if (this.s[this.i] !== ')') throw new Error(')'); this.i += 1; return v }
    const rest = this.s.slice(this.i, this.i + 64)
    const num = /^(?:0x[0-9a-f]+|\d*\.?\d+(?:e[+-]?\d+)?)/i.exec(rest)
    if (num && num[0]) { this.i += num[0].length; return Number(num[0]) }
    const id = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(rest)
    if (id) {
      this.i += id[0].length
      if (id[0] === 'true') return true
      if (id[0] === 'false') return false
      if (id[0] === 'null' || id[0] === 'undefined') return null
      if (id[0] === 'Math.PI') return Math.PI
      const known = this.consts.get(id[0])
      if (known !== undefined) return known
      this.ws()
      if (this.s[this.i] === '(') throw new Error('call') // never evaluate calls
      return `@${id[0]}` // unresolved identifier (e.g. a component reference)
    }
    throw new Error('value')
  }
}

/** Read `const NAME = <literal>` declarations across files (in order), resolving earlier constants. */
export function readConstants(files: SourceFile[]): Map<string, Val> {
  const consts = new Map<string, Val>()
  const decl = /(?:^|[\n;])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]{1,80})?=\s*/g
  for (const f of files) {
    decl.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = decl.exec(f.text))) {
      const r = new Reader(f.text, consts)
      r.i = decl.lastIndex
      try {
        const v = r.value()
        r.ws()
        const next = f.text[r.i]
        if (next === undefined || next === ';' || next === '\n' || next === '\r' || /\s/.test(f.text[r.i - 1] ?? '') || next === 'e' /* export */) {
          if (v !== undefined && !(typeof v === 'string' && v.startsWith('@') && !/^[A-Z]/.test(m[1]))) consts.set(m[1], v)
        }
      } catch {
        /* not a literal (function, JSX, call…) — ignore */
      }
    }
  }
  return consts
}

/* ——— helpers ——— */

const isNum = (v: Val): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: Val): v is { [k: string]: Val } => !!v && typeof v === 'object' && !Array.isArray(v)
const norm = (s: string) => s.toLowerCase().replace(/scene|beat|chapter|section|component|act|\d+[_-]?/g, '').replace(/[^a-z]/g, '')
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/(^|[\s/+(])(\w)/g, (_m, a: string, c: string) => a + c.toUpperCase()).trim()

const NAME_KEYS = ['name', 'title', 'label', 'id', 'chapter', 'key', 'scene']
const START_KEYS = ['start', 'startSec', 'startTime', 't', 't0', 'at', 'time', 'from', 's', 'begin', 'startFrame', 'frame', 'startMs']
const END_KEYS = ['end', 'endSec', 'endTime', 't1', 'to', 'e', 'endFrame', 'endMs']
const DUR_KEYS = ['duration', 'durationSec', 'dur', 'len', 'length', 'd', 'durationFrames', 'frames', 'durationMs']

function pickKey(o: { [k: string]: Val }, keys: string[]) {
  for (const k of keys) if (k in o) return k
  return null
}

function channelFor(param: string): Channel | null {
  const p = param.toLowerCase()
  if (/^(opacity|alpha|fade|visibility|vis|a)$/.test(p) || /opacity|alpha/.test(p)) return 'opacity'
  if (/^(scale|zoom|size|s|sc)$/.test(p) || /scale|zoom/.test(p)) return 'scale'
  if (/^(x|tx|translatex|offsetx|panx|posx|dx)$/.test(p)) return 'x'
  if (/^(y|ty|translatey|offsety|pany|posy|dy|lift|rise)$/.test(p)) return 'y'
  if (/^(rotation|rotate|rot|angle|spin|r)$/.test(p) || /rotat/.test(p)) return 'rotation'
  if (/blur|focus|defocus|dof|bokeh/.test(p)) return 'blur'
  if (/bloom|glow|intensity|exposure|brightness|flare|light/.test(p)) return 'glow'
  if (/hue|colou?rdrift|drift|tint|shift|chroma/.test(p)) return 'hue'
  return null
}

/** Normalise a raw track's values into the Studio channel's units. */
function convertValues(channel: Channel, param: string, pts: Array<[number, number]>): Array<[number, number]> {
  const vals = pts.map((p) => p[1])
  const max = Math.max(...vals.map(Math.abs))
  const map = (f: (v: number) => number) => pts.map(([t, v]) => [t, f(v)] as [number, number])
  switch (channel) {
    case 'opacity': return map((v) => Math.max(0, Math.min(1, max > 1.5 ? v / 100 : v)))
    case 'scale': return map((v) => Math.max(0.01, max > 10 ? v / 100 : v))
    case 'x': return map((v) => (max > 2 ? 0.5 + v / 1920 : Math.abs(v) <= 1 && vals.every((u) => u >= 0) ? v : 0.5 + v))
    case 'y': return map((v) => (max > 2 ? 0.5 + v / 1080 : Math.abs(v) <= 1 && vals.every((u) => u >= 0) ? v : 0.5 + v))
    case 'rotation': return map((v) => (/rad/i.test(param) || (max <= Math.PI * 2 + 0.01 && max > 0 && vals.some((u) => u % 1 !== 0) && max < 7) ? (v * 180) / Math.PI : v))
    case 'blur':
      // "focus" 1 = sharp, 0 = soft; a blur/defocus param is already amount.
      if (/focus/i.test(param) && !/de/i.test(param) && max <= 1.0001) return map((v) => (1 - v) * 14)
      return map((v) => (max <= 1.0001 ? v * 14 : v))
    case 'glow': return map((v) => (max > 1 ? v / max : v))
    case 'hue': return map((v) => (max <= 1.0001 ? v * 360 : v))
  }
}

/** Find `[[t, v], …]` arrays by name inside a text span. */
function findTracks(text: string, owner: string | null, consts: Map<string, Val>): SourceTrack[] {
  const out: SourceTrack[] = []
  const re = /([A-Za-z_$][\w$]*)\s*[:=]\s*(\[\s*\[)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const r = new Reader(text, consts)
    r.i = m.index + m[0].length - m[2].length
    try {
      const v = r.value()
      if (!Array.isArray(v) || v.length < 2) continue
      if (!v.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]))) continue
      const pts = (v as number[][]).map((p) => [p[0], p[1]] as [number, number]).sort((a, b) => a[0] - b[0])
      const channel = channelFor(m[1])
      out.push({ owner, param: m[1], channel, points: channel ? convertValues(channel, m[1], pts) : pts })
      re.lastIndex = r.i
    } catch {
      /* skip */
    }
  }
  // Also `{ opacity: [[…]] }` nested under a named key: `intro: { opacity: [[…]] }`.
  return out
}

/** Nearest enclosing `name: {` key before position `at` (for keyframe objects keyed by scene). */
function enclosingKey(text: string, at: number): string | null {
  let depth = 0
  for (let i = at - 1; i >= 0 && at - i < 4000; i -= 1) {
    const c = text[i]
    if (c === '}') depth += 1
    else if (c === '{') {
      if (depth === 0) {
        const m = /([A-Za-z_$][\w$]*)\s*[:=]\s*$/.exec(text.slice(Math.max(0, i - 60), i))
        return m ? m[1] : null
      }
      depth -= 1
    }
  }
  return null
}

/* ——— detection ——— */

export type SourceScan = { codeFiles: number; hasReact: boolean; hasVite: boolean; shellHtml: boolean }

export function scanSources(files: SourceFile[], html = ''): SourceScan {
  const code = files.filter((f) => CODE.test(f.path) && !CONFIG.test(f.path))
  const pkg = files.find((f) => /(?:^|\/)package\.json$/i.test(f.path))?.text ?? ''
  const hasReact = /["']react["']/.test(pkg) || code.some((f) => /from\s+['"]react['"]|React\.createElement|<\/?[A-Z][A-Za-z]*[\s/>]/.test(f.text))
  const hasVite = /["']vite["']/.test(pkg) || files.some((f) => /vite\.config/i.test(f.path))
  // A Vite/CRA shell page: a root div and a module script, but no scene of its own.
  const shellHtml = !!html && /id=["'](?:root|app)["']/.test(html) && !/id=["']scene["']|window\.__seek/.test(html)
  return { codeFiles: code.length, hasReact, hasVite, shellHtml }
}

/**
 * Recognise and decompose a multi-file source project. Returns null when the
 * files are not that shape (the caller then reports it explicitly).
 */
export function detectSourceProject(files: SourceFile[], html = ''): SourceProject | null {
  const scan = scanSources(files, html)
  if (scan.codeFiles < 2) return null
  const code = files.filter((f) => CODE.test(f.path) && !CONFIG.test(f.path))
  const consts = readConstants(code)
  const notes: string[] = []

  // Style constants.
  const numConst = (re: RegExp) => { for (const [k, v] of consts) if (re.test(k) && isNum(v) && v > 0) return v; return null }
  const fps = numConst(/^(?:FPS|FRAME_?RATE|framerate|fps)$/i)
  let duration = numConst(/^(?:TOTAL(?:_?(?:DUR(?:ATION)?|SEC(?:ONDS)?|TIME|LEN(?:GTH)?))?|DUR(?:ATION)?(?:_?SEC(?:ONDS)?)?|LENGTH|FILM_?(?:DUR(?:ATION)?|LEN(?:GTH)?)|T_?END|END_?TIME)$/i)
  const durationFrames = numConst(/^(?:TOTAL_?FRAMES|DURATION_?IN_?FRAMES|FRAMES)$/i)
  if (!duration && durationFrames && fps) duration = durationFrames / fps
  if (duration && duration > 1000) duration /= 1000 // ms

  // Chapters.
  let chapters: SourceChapter[] = []
  const toSec = (v: number, key: string) => (/frame/i.test(key) && fps ? v / fps : /ms$/i.test(key) ? v / 1000 : v)
  for (const [name, v] of consts) {
    if (!Array.isArray(v) || v.length < 2 || chapters.length) continue
    if (v.every(isObj)) {
      const rows = v as Array<{ [k: string]: Val }>
      const sk = pickKey(rows[0], START_KEYS)
      const nk = pickKey(rows[0], NAME_KEYS)
      if (!sk || !nk || !rows.every((r) => isNum(r[sk]))) continue
      if (!/chap|section|beat|scene|act|timeline|cue|part|segment|story/i.test(name)) continue
      const ek = pickKey(rows[0], END_KEYS)
      const dk = pickKey(rows[0], DUR_KEYS)
      chapters = rows.map((r) => {
        const start = toSec(r[sk] as number, sk)
        const end = ek && isNum(r[ek]) ? toSec(r[ek] as number, ek) : dk && isNum(r[dk]) ? start + toSec(r[dk] as number, dk) : NaN
        return { name: String(r[nk] ?? '').replace(/^@/, ''), startSec: start, durationSec: end - start }
      })
    }
  }
  if (!chapters.length) {
    // Parallel arrays: CH_T = [0, 4.2, …] + CHAPTERS = ['Hook', …].
    const timeArr = [...consts].find(([k, v]) => /(?:^|_)(?:CH_?T|T|TIMES?|STAMPS?|CUTS?|STARTS?|MARKS?)$|chap.*(?:time|start|t)$|^(?:ch|chapter|section)_?(?:t|times|starts)$/i.test(k) && Array.isArray(v) && v.length >= 2 && v.every(isNum))
    const nameArr = [...consts].find(([k, v]) => /chap|section|names|titles|beats|labels/i.test(k) && Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'string'))
    if (timeArr) {
      const times = (timeArr[1] as number[]).map((t) => (t > 600 ? t / 1000 : t))
      const names = (nameArr?.[1] as string[] | undefined) ?? []
      // n+1 times (with an end) or n starts.
      const n = names.length && times.length === names.length + 1 ? names.length : times.length
      chapters = Array.from({ length: n }, (_, i) => ({ name: names[i] ?? `Chapter ${i + 1}`, startSec: times[i], durationSec: (times[i + 1] ?? NaN) - times[i] }))
    }
  }
  chapters = chapters.filter((c) => Number.isFinite(c.startSec)).sort((a, b) => a.startSec - b.startSec)
  if (!duration && chapters.length) {
    const last = chapters[chapters.length - 1]
    duration = Number.isFinite(last.durationSec) ? last.startSec + last.durationSec : last.startSec + 4
  }
  chapters = chapters.map((c, i) => ({ ...c, name: titleCase(c.name) || `Chapter ${i + 1}`, durationSec: Number.isFinite(c.durationSec) && c.durationSec > 0 ? c.durationSec : Math.max(0.5, (chapters[i + 1]?.startSec ?? duration ?? c.startSec + 4) - c.startSec) }))

  // Scene components: capitalised functions taking time, or named like beats.
  type Found = { name: string; file: string; start: number; end: number; text: string }
  const found: Found[] = []
  const compRe = /(?:export\s+(?:default\s+)?)?(?:function\s+([A-Z][\w]*)\s*\(([^)]*)\)|(?:const|let)\s+([A-Z][\w]*)\s*(?::[^=]{1,60})?=\s*(?:React\.memo\()?\(?\s*(\{[^)]*\}|[a-z_$][\w$]*)?\s*\)?\s*(?::[^=]{1,40})?=>)/g
  const EXCLUDE = /^(?:App|Root|Main|Engine|Player|Timeline|Canvas|Stage|Layout|Provider|Router|Controls?|Scrubber|Audio\w*|Gl\w*|WebGL\w*|Three\w*|Particles?\w*|Background\w*|Icon\w*|Button|Text|Box|Wrapper|Container|Frame)$/
  for (const f of code) {
    compRe.lastIndex = 0
    const hits: Array<{ name: string; params: string; at: number }> = []
    let m: RegExpExecArray | null
    while ((m = compRe.exec(f.text))) hits.push({ name: m[1] ?? m[3], params: m[2] ?? m[4] ?? '', at: m.index })
    hits.forEach((h, i) => {
      const timeParam = /\b(?:t|time|local|lt|progress|p|frame|elapsed|now|sec|seconds)\b/.test(h.params)
      const sceneName = /scene|beat|chapter|act|intro|outro|hook|cta|reveal|finale|opening|closing|title|problem|solution|feature|proof|logo/i.test(h.name) || /(?:^|\/)(?:scenes?|beats?|chapters?)\//i.test(f.path)
      if (EXCLUDE.test(h.name) || !(timeParam || sceneName) || !/return\s*\(?\s*<|=>\s*\(?\s*</.test(f.text.slice(h.at, hits[i + 1]?.at ?? f.text.length))) return
      found.push({ name: h.name, file: f.path, start: h.at, end: hits[i + 1]?.at ?? f.text.length, text: f.text.slice(h.at, hits[i + 1]?.at ?? f.text.length) })
    })
  }
  const unique = found.filter((s, i) => found.findIndex((o) => o.name === s.name) === i)

  const frameW = numConst(/^(?:W|WIDTH|FRAME_?W(?:IDTH)?|VIDEO_?W(?:IDTH)?)$/) ?? 1920
  const frameH = numConst(/^(?:H|HEIGHT|FRAME_?H(?:EIGHT)?|VIDEO_?H(?:EIGHT)?)$/) ?? 1080
  const withHtml = html ? [...files, { path: 'index.html.jsx', text: html }] : files
  let early: SourceText[] | null = null
  if (!chapters.length && unique.length < 2) {
    // No chapter map and no scene components — but a GSAP/canvas film still
    // has timed copy. Build the chapters from it rather than refusing.
    early = extractTimedText(withHtml, { consts: consts as Map<string, unknown>, W: frameW, H: frameH }).texts
    if (early.length < 3) return null
    chapters = chaptersFromTexts(early)
    if (!duration) duration = Math.max(...early.map((t) => t.endSec))
    notes.push('No chapter map was found — chapters were built from when its text appears.')
  }

  // Order hint: an array/object of component references (SCENES = [Intro, Problem]).
  let order: string[] = []
  for (const v of consts.values()) {
    const refs = Array.isArray(v) ? v : isObj(v) ? Object.values(v) : []
    const names = refs.flatMap((x) => (typeof x === 'string' && x.startsWith('@') ? [x.slice(1)] : isObj(x) ? Object.values(x).filter((y): y is string => typeof y === 'string' && y.startsWith('@')).map((y) => y.slice(1)) : []))
    if (names.filter((n) => unique.some((s) => s.name === n)).length >= 2) { order = names; break }
  }

  const sceneChapter = (s: Found, idx: number): number => {
    if (!chapters.length) return -1
    const byOrder = order.indexOf(s.name)
    if (byOrder >= 0 && byOrder < chapters.length) return byOrder
    const n = norm(s.name)
    const byName = chapters.findIndex((c) => { const cn = norm(c.name); return !!n && !!cn && (cn.includes(n) || n.includes(cn)) })
    if (byName >= 0) return byName
    return Math.min(idx, chapters.length - 1)
  }

  // Keyframe tracks: scene-local ones inside a component body, the rest global
  // (or owned by the scene/chapter whose key encloses them).
  const globalTracks: SourceTrack[] = []
  const inScene = new Set<string>()
  const scenes: SourceScene[] = unique.map((s, idx) => {
    const tracks = findTracks(s.text, s.name, consts)
    tracks.forEach((t) => inScene.add(`${s.file}:${t.param}:${t.points[0]?.[0]}`))
    return { name: s.name, file: s.file, chapterIndex: sceneChapter(s, idx), lines: visibleCopy(s.text), tracks }
  })
  for (const f of code) {
    for (const t of findTracks(f.text, null, consts)) {
      if (inScene.has(`${f.path}:${t.param}:${t.points[0]?.[0]}`)) continue
      const at = f.text.indexOf(t.param)
      const key = at >= 0 ? enclosingKey(f.text, at) : null
      const owner = key ? scenes.find((s) => norm(s.name) === norm(key) || norm(s.name).includes(norm(key)))?.name ?? (chapters.find((c) => norm(c.name) === norm(key)) ? key : null) : null
      if (owner && scenes.some((s) => s.name === owner)) scenes.find((s) => s.name === owner)!.tracks.push({ ...t, owner })
      else globalTracks.push({ ...t, owner: key })
    }
  }
  const unsupported = [...new Set([...scenes.flatMap((s) => s.tracks), ...globalTracks].filter((t) => !t.channel).map((t) => t.param))]
  if (unsupported.length) notes.push(`Keyframe tracks with no Studio equivalent were left out: ${unsupported.slice(0, 6).join(', ')}.`)

  // Palette + fonts.
  const palette: Array<{ name: string; color: string }> = []
  const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
  for (const [k, v] of consts) {
    if (typeof v === 'string' && HEX.test(v)) palette.push({ name: k, color: v })
    else if (isObj(v) && /colou?r|palette|theme|token|brand|^c$|^col$|style/i.test(k)) for (const [kk, vv] of Object.entries(v)) if (typeof vv === 'string' && HEX.test(vv)) palette.push({ name: kk, color: vv })
  }
  const fonts = [...new Set(code.concat(files.filter((f) => /\.(?:css|html)$/i.test(f.path))).flatMap((f) => [...f.text.matchAll(/font-?family\s*[:=]\s*['"`]?\s*['"]?([A-Za-z][\w ]+?)['"]?\s*[,;'"`}]/gi)].map((m) => m[1].trim())))].filter((n) => !/^(?:inherit|sans-serif|serif|monospace|system-ui|var)$/i.test(n)).slice(0, 4)

  // Audio / engine module.
  const audioFile = code.find((f) => /AudioContext|createOscillator|new Audio\(|Howl|Tone\./.test(f.text))
  const synthesized = !!audioFile && /createOscillator|Tone\.(?:Synth|Oscillator)/.test(audioFile.text)
  // WebGL / particles.
  const glFile = code.find((f) => /from\s+['"](?:three|@react-three\/[\w-]+|regl|pixi\.js|ogl)['"]|getContext\(\s*['"]webgl2?['"]|THREE\./.test(f.text))
    ?? code.find((f) => /particle/i.test(f.path) || /particles?\s*[=:]\s*(?:\[|new|Array)/i.test(f.text))
  const webgl = glFile ? { file: glFile.path, kind: (/three|THREE\./.test(glFile.text) ? 'three' : /webgl|regl|ogl|pixi/i.test(glFile.text) ? 'webgl' : /particle/i.test(glFile.text + glFile.path) ? 'particles' : 'canvas') as 'three' | 'webgl' | 'particles' | 'canvas' } : null

  const film = duration ?? Math.max(6, unique.length * 4)
  if (!chapters.length) {
    // Scenes but no map: lay them end to end, evenly.
    const each = film / Math.max(1, scenes.length)
    chapters = scenes.map((s, i) => ({ name: titleCase(s.name.replace(/Scene$/, '')), startSec: i * each, durationSec: each }))
    scenes.forEach((s, i) => { s.chapterIndex = i })
    notes.push('No chapter/timestamp map was found — scenes were spaced evenly; retime them on the timeline.')
  }

  const durationSec = Math.max(film, ...chapters.map((c) => c.startSec + c.durationSec))
  const extracted = extractTimedText(withHtml, { chapters, consts: consts as Map<string, unknown>, W: frameW, H: frameH, durationSec })
  const texts = extracted.texts.length >= (early?.length ?? 0) ? extracted.texts : early ?? []
  if (extracted.untimed.length) notes.push(`${extracted.untimed.length} interface/HUD string${extracted.untimed.length === 1 ? '' : 's'} had no timing in the code and were left out: ${extracted.untimed.slice(0, 4).map((u) => `“${u}”`).join(', ')}${extracted.untimed.length > 4 ? '…' : ''}.`)
  return {
    texts, frame: { w: frameW, h: frameH },
    framework: scan.hasVite ? 'Vite + React' : scan.hasReact ? 'React' : 'JavaScript',
    durationSec,
    fps, chapters, scenes, globalTracks, palette: palette.slice(0, 12), fonts,
    audio: { module: audioFile?.path ?? null, synthesized },
    webgl, notes,
  }
}

/** Human-readable strings a component renders (JSX text + quoted phrases). */
export function visibleCopy(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(/>\s*([^<>{}]*[A-Za-z][^<>{}]*?)\s*</g)) {
    const t = m[1].replace(/\s+/g, ' ').trim()
    if (t.length >= 2 && !/^[\w.]+\(|=>|;/.test(t)) out.push(t)
  }
  for (const m of body.matchAll(/\b(?:text|title|label|heading|copy|caption|subtitle|line)\s*[:=]\s*['"`]([^'"`$]{3,120})['"`]/g)) out.push(m[1].trim())
  return [...new Set(out)].slice(0, 6)
}

/* ——— conversion to Studio ——— */

/** Merge tracks into Studio keyframes; each channel sampled at every key time (no holes). */
export function tracksToKeyframes(tracks: SourceTrack[], offsetSec: number, windowSec: number): StudioKeyframe[] | null {
  const usable = tracks.filter((t) => t.channel && t.points.length)
  if (!usable.length) return null
  // Scene-local tracks written in 0..1 progress are scaled to the window.
  const local = usable.map((t) => {
    const maxT = Math.max(...t.points.map((p) => p[0]))
    const scaled = maxT <= 1.0001 && windowSec > 1.5 ? t.points.map(([a, v]) => [a * windowSec, v] as [number, number]) : t.points.map(([a, v]) => [a - offsetSec, v] as [number, number])
    return { ...t, points: scaled }
  })
  const times = [...new Set(local.flatMap((t) => t.points.map((p) => Math.round(p[0] * 1000) / 1000)))].filter((t) => t >= -0.001 && t <= windowSec + 0.001).sort((a, b) => a - b)
  if (!times.length) return null
  const sample = (pts: Array<[number, number]>, t: number) => {
    if (t <= pts[0][0]) return pts[0][1]
    const last = pts[pts.length - 1]
    if (t >= last[0]) return last[1]
    for (let i = 0; i < pts.length - 1; i += 1) if (t >= pts[i][0] && t <= pts[i + 1][0]) { const s = pts[i + 1][0] - pts[i][0]; return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (s > 0 ? (t - pts[i][0]) / s : 1) }
    return last[1]
  }
  return times.map((at) => {
    const key: StudioKeyframe = { at: Math.max(0, at), ease: 'ease-in-out' }
    for (const t of local) (key as unknown as Record<string, number>)[t.channel as string] = Math.round(sample(t.points, at) * 10000) / 10000
    return key
  })
}

/** A still card for a scene component: pure SVG data URL in the project palette. */
export function sceneCardDataUrl(title: string, lines: string[], colors: { bg: string; fg: string; accent: string }): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const body = lines.slice(0, 3).map((l, i) => `<text x="60" y="${190 + i * 64}" font-size="${i === 0 ? 52 : 36}" font-weight="${i === 0 ? 800 : 500}" fill="${i === 0 ? colors.fg : colors.fg}" fill-opacity="${i === 0 ? 1 : 0.75}">${esc(l.slice(0, 44))}</text>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420"><rect width="960" height="420" rx="36" fill="${colors.bg}" fill-opacity="0.88"/><rect x="60" y="64" width="${Math.min(700, 26 + title.length * 15)}" height="44" rx="22" fill="${colors.accent}"/><text x="82" y="94" font-size="24" font-weight="700" fill="${colors.bg}" font-family="Inter, sans-serif">${esc(title.slice(0, 40))}</text><g font-family="Inter, sans-serif">${body}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const luminance = (hex: string) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const n = parseInt(full, 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

export function paletteRoles(palette: Array<{ name: string; color: string }>) {
  const find = (re: RegExp) => palette.find((p) => re.test(p.name))?.color
  const sorted = [...palette].sort((a, b) => luminance(a.color) - luminance(b.color))
  const bg = find(/^(?:bg|background|base|dark|ink|night|void)/i) ?? sorted[0]?.color ?? '#0B0B10'
  const fg = find(/^(?:fg|text|ink|light|paper|white|cream|foreground)/i) ?? sorted[sorted.length - 1]?.color ?? '#F4F1EA'
  const accent = find(/accent|primary|brand|highlight|lime|gold|glow|key/i) ?? palette.find((p) => p.color !== bg && p.color !== fg)?.color ?? '#C8F542'
  return { bg, fg: luminance(fg) - luminance(bg) > 0.35 || luminance(bg) - luminance(fg) > 0.35 ? fg : luminance(bg) > 0.5 ? '#0B0B10' : '#F4F1EA', accent }
}

/** Pick the closest Studio animated background for a WebGL/particle layer. */
export function backgroundForLayer(kind: 'three' | 'webgl' | 'particles' | 'canvas', accent: string): string {
  if (kind === 'particles') return 'dot-field'
  if (kind === 'three') return luminance(accent) > 0.6 ? 'liquid-lime' : 'liquid-chrome'
  return 'aurora'
}

export type SourceImport = { clips: StudioClip[]; markers: StudioMarker[]; tracksUsed: number; palette: Array<{ name: string; color: string }>; summary: string; notes: string[] }

let uid = 0
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(uid++).toString(36)}`

/**
 * Turn a detected project into Studio clips starting at `base` seconds.
 * Tracks (bottom → top): background layer, chapter copy, scene components.
 */
export function sourceProjectToClips(p: SourceProject, doc: Pick<StudioDoc, 'trackCount'>, base: number, makeId: (prefix: string) => string = id): SourceImport {
  const roles = paletteRoles(p.palette)
  const clips: StudioClip[] = []
  const bgTrack = 0
  let chapterTrack = Math.min(21, Math.max(1, doc.trackCount))
  let sceneTrack = Math.min(22, chapterTrack + 1)
  const common = { transitionIn: 'fade' as const, transitionOut: 'fade' as const, opacity: 1 }

  if (!p.webgl && p.texts?.length) {
    // A 2D canvas film paints its own backdrop; a native one stands in so the type never sits on empty black.
    clips.push({ ...common, id: makeId('bg'), kind: 'background', backgroundId: backgroundForLayer('canvas', roles.accent), track: bgTrack, startSec: base, durationSec: p.durationSec, name: 'Film backdrop (swap in the inspector)' } as unknown as StudioClip)
  }
  if (p.webgl) {
    clips.push({ ...common, id: makeId('bg'), kind: 'background', backgroundId: backgroundForLayer(p.webgl.kind, roles.accent), track: bgTrack, startSec: base, durationSec: p.durationSec, name: `${p.webgl.kind === 'three' ? '3D' : p.webgl.kind === 'particles' ? 'Particle' : 'WebGL'} layer (${p.webgl.file.split('/').pop()})` } as unknown as StudioClip)
  }

  // The film's own typography, beat by beat, as native text clips.
  // Copy timed only by its chapter stays on that chapter's scene card when the
  // chapter has a scene component (the card keeps its keyframes); otherwise it
  // comes in as real text.
  const sceneChapters = new Set(p.scenes.map((sc) => sc.chapterIndex))
  const chapterIdx = (sec: number) => p.chapters.findIndex((c) => sec >= c.startSec - 1e-3 && sec < c.startSec + c.durationSec - 1e-3)
  const film = timedTextToSpecs((p.texts ?? []).filter((t) => t.timing !== 'chapter' || !sceneChapters.has(chapterIdx(t.startSec))), { base, firstTrack: 1, maxTrack: 20, fg: roles.fg, muted: mutedOf(roles), accent: roles.accent, fonts: p.fonts, H: p.frame?.h })
  const covered = (c: SourceChapter) => film.specs.some((sp) => sp.startSec < base + c.startSec + c.durationSec - 0.05 && sp.startSec + sp.durationSec > base + c.startSec + 0.05)
  for (const sp of film.specs) {
    clips.push({ ...common, id: makeId('tx'), kind: 'text', track: sp.track, startSec: sp.startSec, durationSec: Math.max(0.2, sp.durationSec), name: sp.name,
      text: sp.text, fontSizePct: sp.fontSizePct, fontFamily: sp.fontFamily, color: sp.color, weight: sp.weight, align: sp.align, x: sp.x, y: sp.y, anim: sp.anim,
      captionStyle: null, highlightWord: null, legibility: 'off', ...(sp.textGlow ? { textGlow: sp.textGlow } : {}) } as unknown as StudioClip)
  }
  const textTop = Math.max(0, film.tracksUsed)
  if (film.specs.length) { chapterTrack = Math.min(21, Math.max(chapterTrack, textTop)); sceneTrack = Math.min(22, chapterTrack + 1) }

  const globalKeys = p.globalTracks.filter((t) => t.channel)
  p.chapters.forEach((c, i) => {
    if (covered(c)) return
    const scene = p.scenes.find((s) => s.chapterIndex === i)
    const copy = scene?.lines[0] ?? c.name
    const chapterKeys = tracksToKeyframes(globalKeys.filter((t) => !t.owner || norm(t.owner) === norm(c.name)).filter((t) => t.channel === 'opacity' || t.channel === 'y' || t.channel === 'scale'), c.startSec, c.durationSec)
    clips.push({
      ...common, id: makeId('ch'), kind: 'text', track: chapterTrack, startSec: base + c.startSec, durationSec: c.durationSec, name: `${String(i + 1).padStart(2, '0')} ${c.name}`,
      text: copy, fontSizePct: 7, color: roles.fg, weight: 800, align: 'center', x: 0.5, y: 0.78, anim: 'fade-up', captionStyle: null, highlightWord: null,
      keyframes: chapterKeys,
    } as unknown as StudioClip)
  })

  for (const s of p.scenes) {
    const ch = p.chapters[s.chapterIndex] ?? p.chapters[0]
    if (!ch) continue
    // Its copy already came in as real text clips; a picture of that copy would duplicate it.
    if (covered(ch)) continue
    const keys = tracksToKeyframes([...s.tracks, ...globalKeys.filter((t) => t.owner && norm(t.owner) === norm(s.name))], 0, ch.durationSec)
      ?? tracksToKeyframes(globalKeys.filter((t) => !t.owner), ch.startSec, ch.durationSec)
    clips.push({
      ...common, id: makeId('scene'), kind: 'overlay', track: sceneTrack, startSec: base + ch.startSec, durationSec: ch.durationSec, name: titleCase(s.name),
      dataUrl: sceneCardDataUrl(titleCase(s.name.replace(/Scene$/, '')), s.lines.length ? s.lines : [ch.name], roles), source: `${s.file}#${s.name}`, x: 0.5, y: 0.42, scale: 0.62,
      keyframes: keys,
    } as unknown as StudioClip)
  }

  const markers: StudioMarker[] = p.chapters.map((c) => ({ id: makeId('mk'), at: base + c.startSec, label: c.name, color: 'lime' as const }))
  const keyed = clips.filter((c) => c.keyframes?.length).length
  const notes = [...p.notes]
  if (p.webgl) notes.push(`${p.webgl.file} draws with ${p.webgl.kind === 'three' ? 'Three.js' : p.webgl.kind}; it can't run inside Studio, so it came in as a swappable animated background layer.`)
  if (p.audio.synthesized && p.audio.module) notes.push(`The sound in ${p.audio.module} is synthesised in code, so there is no audio file to import — add a music track or voiceover.`)
  if (film.dropped) notes.push(`${film.dropped} overlapping text layer${film.dropped === 1 ? '' : 's'} did not fit on the timeline's tracks.`)
  const summary = `${p.framework} project: ${p.chapters.length} chapters, ${film.specs.length} timed text layers, ${p.scenes.length} scene components, ${keyed} clips with converted keyframes${p.palette.length ? `, ${p.palette.length} palette colours` : ''}${p.webgl ? ', 1 background layer' : ''}`
  return { clips, markers, tracksUsed: Math.max(sceneTrack + 1, textTop), palette: p.palette, summary, notes }
}

const mutedOf = (r: { fg: string }) => (luminance(r.fg) > 0.5 ? '#9AA3AD' : '#5B616B')

/** The explicit "neither format" message. */
export function unrecognizedMessage(fileName: string, files: SourceFile[], html: string): string {
  const scan = scanSources(files, html)
  const kinds = [scan.codeFiles ? `${scan.codeFiles} source file${scan.codeFiles === 1 ? '' : 's'}` : '', html ? '1 HTML page' : ''].filter(Boolean).join(' and ') || 'no code'
  return `${fileName}: found ${kinds}, but no importable scene format — it isn't a single-file Arena export (no #scene root with window.__seek) and it isn't a React/Vite film project (no chapter/timestamp map and fewer than two scene components). Nothing was imported.`
}
