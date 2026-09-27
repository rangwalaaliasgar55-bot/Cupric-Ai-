/**
 * Generated motion graphics, taken apart into editable clips.
 *
 * Until now an Arena piece arrived in the Studio as a single captured frame:
 * you could move it and scale it, and that was all. The thing the model spent
 * its effort on — the scene copy, the timings, the order — was locked inside
 * an HTML file the canvas cannot execute.
 *
 * Every piece Cupric generates is required to declare
 * `window.__cupricSourceManifest = { sources, sequence, renderSpec }`, and the
 * scene list is the sequence. So the output is not a black box: it is a
 * storyboard with a renderer attached, and this reads the storyboard back out
 * as real text clips the user can retime, rewrite and restyle.
 *
 * Nothing here executes the file. It is parsed as text, on purpose — running
 * generated JavaScript to find out what it says would be a security decision,
 * not a convenience.
 */
import type { SceneRundown, StudioClip, StudioDoc, StudioTextAnim, StudioTransition } from '../../types/project'
import { uid } from '../utils'
import { defaultTextClip, nextFreeStart } from './doc'

export type ImportedScene = {
  /** Seconds from the start of the piece. */
  from: number
  to: number
  copy: string
  /** Free-text motion description from the manifest, used to pick an animation. */
  motion?: string
  type?: string
  /** A supporting line that shares its scene's time (subtitle, kicker, body). */
  role?: 'title' | 'sub'
  /** Media the scene's own markup references (img/video src, background urls). */
  media?: string[]
}

export type ImportedPiece = {
  scenes: ImportedScene[]
  durationSec: number
  fps: 24 | 30 | 60 | null
  size: [number, number] | null
  /** What the manifest said the piece was built from. */
  sources: string[]
  /** How the scenes were recovered, so the UI can be honest about confidence. */
  via: 'manifest' | 'scene-array' | 'timed-markup' | 'scene-blocks' | 'headings' | 'script-copy' | 'title'
}

/** Pull the first balanced `{…}` or `[…]` literal starting at `from`. */
function balancedLiteral(text: string, from: number): string | null {
  const open = text[from]
  const close = open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) return null
  let depth = 0
  let inString: string | null = null
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(from, i + 1)
    }
  }
  return null
}

/**
 * Parse a JS object literal loosely enough to cope with what models write.
 *
 * Unquoted keys, single quotes and trailing commas are all normal in
 * hand-written JS and all invalid JSON. This repairs those three things and
 * nothing else — anything cleverer would be evaluating code by another name.
 */
function looseParse<T>(literal: string): T | null {
  const noComments = literal.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\"'])\/\/[^\n]*/g, '$1')
  const repaired = noComments
    // `template` strings without interpolation are just strings.
    .replace(/`([^`$\\]*(?:\\.[^`$\\]*)*)`/g, (_m, inner: string) => JSON.stringify(inner))
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner: string) => JSON.stringify(inner))
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1')
  const candidates = [literal, repaired]
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      /* try the next repair */
    }
  }
  return null
}

function literalAfter(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html)
  if (!match) return null
  const start = html.indexOf(match[0])
  const brace = html.slice(start).search(/[{[]/)
  if (brace < 0) return null
  return balancedLiteral(html, start + brace)
}

const num = (value: unknown, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))

const cleanLine = (raw: string) =>
  decodeEntities(raw.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\{[^{}]*\}/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** Names a scene list goes by in generated films, case-insensitive. */
const SCENE_LIST_NAMES = 'scenes|scene_list|sceneList|beats|shots|slides|timeline|storyboard|sequence|frames|chapters|steps|cards|panels|segments|clips|script|captions|lines'

/**
 * Every array literal that looks like it could be a scene list, across the
 * HTML and all the package's scripts. The caller keeps the best one.
 */
function sceneArrayCandidates(corpus: string): unknown[][] {
  const out: unknown[][] = []
  const re = new RegExp(`(?:\\b|["'])(?:${SCENE_LIST_NAMES})(?:["'])?\\s*[:=]\\s*(?=[\\[{])`, 'gi')
  let match: RegExpExecArray | null
  let guard = 0
  while ((match = re.exec(corpus)) && guard < 80) {
    guard += 1
    const at = match.index + match[0].length
    const literal = balancedLiteral(corpus, at)
    if (!literal || literal.length > 400_000) continue
    const parsed = looseParse<unknown>(literal)
    if (Array.isArray(parsed)) out.push(parsed)
    else if (parsed && typeof parsed === 'object') {
      // { intro: {...}, reveal: {...} } — a keyed scene map.
      const values = Object.values(parsed as Record<string, unknown>)
      if (values.length && values.every((v) => v && typeof v === 'object')) out.push(values)
      // { scenes: [...] } nested under a config object.
      for (const v of values) if (Array.isArray(v)) out.push(v)
    }
  }
  // A bare JSON document that is itself an array of scenes.
  for (const m of corpus.matchAll(/\/\* [^*]+\.json \*\/\n(\s*\[[\s\S]*?\])\s*(?=\n\/\* |$)/g)) {
    const parsed = looseParse<unknown>(m[1])
    if (Array.isArray(parsed)) out.push(parsed)
  }
  return out
}

/** Visible text in document (or JSX) order, script and style bodies removed. */
function visibleLines(markup: string): string[] {
  const body = markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:svg|noscript|template)\b[^>]*>[\s\S]*?<\/(?:svg|noscript|template)>/gi, ' ')
  const lines: string[] = []
  const tagRe = /<(h[1-6]|p|li|figcaption|blockquote|button|strong|em|label|caption|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>|<(span|div|small|a)\b[^>]*class(?:Name)?=["'][^"']*(?:title|headline|heading|caption|kicker|subtitle|eyebrow|tagline|copy|lead|text|word|line|cta)[^"']*["'][^>]*>([^<]{2,200})<\/\3>/gi
  for (const m of body.matchAll(tagRe)) {
    const line = cleanLine(m[2] ?? m[4] ?? '')
    if (line.length > 1 && line.length < 220 && /[A-Za-z0-9]/.test(line)) lines.push(line)
  }
  // Nested matches (a <strong> inside a <p>) produce fragments; keep a line
  // only if no longer kept line already contains it.
  const unique: string[] = []
  for (const line of lines) {
    if (unique.some((kept) => kept === line || (kept.length > line.length && kept.includes(line)))) continue
    for (let i = unique.length - 1; i >= 0; i -= 1) if (line.length > unique[i].length && line.includes(unique[i])) unique.splice(i, 1)
    unique.push(line)
  }
  return unique.slice(0, 40)
}

/* ——— Scene blocks ————————————————————————————————————————————————————————
 * Generated films are usually a stack of scene containers:
 *   <div class="scene" data-duration="3"><span class="kicker">…</span><div class="big">…</div></div>
 * A non-greedy regex cannot find the end of a <div> that contains <div>s, so
 * this walks the tags with a depth counter. Only markup is read; nothing is
 * executed.
 */

const SCENE_ATTR = /\bdata-(?:scene|slide|shot|duration|dur|length)\b|\b(?:class|className|id)\s*=\s*["'][^"']*\b(?:scene|slide|shot|beat|chapter|frame-\d|panel)s?(?:[-_]\w+)?\b[^"']*["']/i
const INLINE_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 'mark', 'br', 'sup', 'sub', 'small', 'wbr', 'abbr', 'code'])
const VOID_TAGS = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'area', 'col', 'embed', 'track', 'param'])

function stripNonVisual(markup: string) {
  return markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:svg|noscript|template|head)\b[^>]*>[\s\S]*?<\/(?:svg|noscript|template|head)>/gi, ' ')
}

type Block = { start: number; end: number; attrs: string; inner: string }

function sceneBlockList(markup: string): Block[] {
  const body = stripNonVisual(markup)
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g
  const stack: Array<{ name: string; attrs: string; innerStart: number; start: number; scene: boolean }> = []
  const blocks: Block[] = []
  for (const m of body.matchAll(tagRe)) {
    const [, closing, rawName, attrs, selfClose] = m
    const name = rawName.toLowerCase()
    const at = m.index ?? 0
    if (VOID_TAGS.has(name) || selfClose) continue
    if (!closing) {
      const scene = (name === 'section' || name === 'article' || name === 'div' || name === 'li') && (name === 'section' || SCENE_ATTR.test(attrs))
      stack.push({ name, attrs, innerStart: at + m[0].length, start: at, scene })
      continue
    }
    // Pop to the matching opener; tolerate sloppy markup by unwinding.
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].name !== name) continue
      const open = stack[i]
      stack.length = i
      if (open.scene) blocks.push({ start: open.start, end: at, attrs: open.attrs, inner: body.slice(open.innerStart, at) })
      break
    }
  }
  // Keep the innermost scene level: a "scenes" wrapper holding scenes is not
  // itself a scene.
  const inner = blocks.filter((b) => !blocks.some((o) => o !== b && o.start > b.start && o.end < b.end))
  return inner.sort((a, b) => a.start - b.start)
}

type Run = { text: string; hint: string }

/** Every run of visible text in a block, tagged with its element's tag + class. */
function textRuns(markup: string): Run[] {
  const runs: Run[] = []
  const stack: string[] = []
  let buffer = ''
  const flush = () => {
    const text = cleanLine(buffer)
    buffer = ''
    if (text.length > 1 && text.length < 220 && /[A-Za-z0-9]/.test(text)) runs.push({ text, hint: stack[stack.length - 1] ?? '' })
  }
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)\/?>/g
  let last = 0
  for (const m of markup.matchAll(tagRe)) {
    buffer += markup.slice(last, m.index)
    last = (m.index ?? 0) + m[0].length
    const name = m[2].toLowerCase()
    if (INLINE_TAGS.has(name)) { if (name === 'br') buffer += ' '; continue }
    flush()
    if (VOID_TAGS.has(name)) continue
    if (m[1]) stack.pop()
    else stack.push(`${name} ${m[3].match(/\bclass(?:Name)?\s*=\s*["']([^"']*)["']/i)?.[1] ?? ''}`)
  }
  buffer += markup.slice(last)
  flush()
  return runs
}

const HERO_HINT = /^(?:h1|h2|h3)\b|\b(?:big|title|headline|heading|hero|display|main|lead|cta|claim|tagline)\b/i

function secondsAttr(attrs: string): number | null {
  const m = attrs.match(/data-(?:duration|dur|length)\s*=\s*["']?([\d.]+)\s*(ms|s)?/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  return m[2]?.toLowerCase() === 'ms' || n > 120 ? n / 1000 : n
}

/** Scenes from scene containers: one hero line each, the rest as supporting lines. */
function sceneBlocks(markup: string): ImportedScene[] {
  const blocks = sceneBlockList(markup)
  if (blocks.length < 2) return []
  const scenes: ImportedScene[] = []
  let cursor = 0
  for (const block of blocks) {
    const runs = textRuns(block.inner)
    if (!runs.length) continue
    const heroIndex = runs.reduce((best, run, i) => {
      const score = (HERO_HINT.test(run.hint) ? 100 : 0) + Math.min(run.text.length, 60)
      const bestScore = (HERO_HINT.test(runs[best].hint) ? 100 : 0) + Math.min(runs[best].text.length, 60)
      return score > bestScore ? i : best
    }, 0)
    const hero = runs[heroIndex].text
    const words = runs.reduce((n, r) => n + r.text.split(/\s+/).length, 0)
    const dur = secondsAttr(block.attrs) ?? Math.max(2.2, Math.min(6, 0.9 + words * 0.3))
    const from = Math.round(cursor * 100) / 100
    const to = Math.round((cursor + dur) * 100) / 100
    const media = [...block.inner.matchAll(/<(?:img|video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi)]
      .map((m) => (m[1] ?? m[2] ?? '').trim())
      .filter((src) => src && !/^(?:data:|https?:|\/\/)/i.test(src))
    scenes.push({ from, to, copy: hero, role: 'title', ...(media.length ? { media } : {}) })
    for (const [i, run] of runs.entries()) {
      if (i === heroIndex || run.text === hero) continue
      scenes.push({ from, to, copy: run.text, role: 'sub' })
    }
    cursor += dur
  }
  return scenes.filter((s) => s.role === 'title').length >= 2 ? scenes : []
}

/** Elements that declare their own timing: data-start / data-end / data-duration. */
function timedMarkup(markup: string): ImportedScene[] {
  const scenes: ImportedScene[] = []
  const re = /<(\w+)\b([^>]*\bdata-(?:start|from|at|in|time)\s*=\s*["']?([\d.]+)(?:ms|s)?["']?[^>]*)>([\s\S]*?)<\/\1>/gi
  for (const m of markup.matchAll(re)) {
    const attrs = m[2]
    const copy = cleanLine(visibleLines(m[4]).join(' ') || m[4])
    if (!copy || copy.length > 300) continue
    const ms = /ms["'\s>]/.test(attrs) || Number(m[3]) > 600
    const from = Number(m[3]) / (ms ? 1000 : 1)
    const endRaw = attrs.match(/data-(?:end|to|out)\s*=\s*["']?([\d.]+)/i)?.[1]
    const durRaw = attrs.match(/data-(?:duration|dur|length)\s*=\s*["']?([\d.]+)/i)?.[1]
    const to = endRaw ? Number(endRaw) / (ms ? 1000 : 1) : from + (durRaw ? Number(durRaw) / (ms || Number(durRaw) > 600 ? 1000 : 1) : 3)
    if (to > from) scenes.push({ from, to, copy })
  }
  return scenes.sort((a, b) => a.from - b.from)
}

/**
 * Copy hiding in JavaScript strings — `typeText("Built for creators")`,
 * `const lines = ['Meet Cupric', ...]` without a recognisable key. Only
 * sentence-like strings survive: words and spaces, no code, CSS or URLs.
 */
function scriptCopy(corpus: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of corpus.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.){8,160})\1/g)) {
    const raw = m[2].replace(/\\n/g, ' ').replace(/\\(.)/g, '$1').trim()
    if (!/^[A-Z0-9"“‘¡¿]/.test(raw)) continue
    if (!/\s/.test(raw) || raw.split(/\s+/).length < 2 || raw.split(/\s+/).length > 24) continue
    if (/[{}<>;=\\]|\$\{|https?:|www\.|\.(?:png|jpe?g|mp4|svg|js|css|json)\b|\b(?:px|rem|em|vh|vw|rgba?|hsla?|var|calc|translate|rotate|scale|cubic-bezier|linear-gradient|function|return|const|import|export|undefined|null|true|false|console|document|window|querySelector|addEventListener)\b/.test(raw)) continue
    const letters = (raw.match(/[A-Za-z\u00C0-\u024F]/g) ?? []).length
    if (letters / raw.length < 0.6) continue
    if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(raw)) continue // CamelCase identifiers
    const key = raw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw)
    if (out.length >= 16) break
  }
  return out
}

function titleCard(name: string): string {
  const base = name
    .replace(/\.(?:zip|html?)$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!base) return 'Untitled film'
  return base.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bAi\b/g, 'AI').replace(/\bUi\b/g, 'UI')
}

/** Even-ish timings that respect how long each line takes to read. */
function paced(lines: string[], total?: number): ImportedScene[] {
  const need = lines.map((line) => Math.max(2.2, Math.min(6, 0.9 + line.split(/\s+/).length * 0.32)))
  const sum = need.reduce((a, b) => a + b, 0)
  const scale = total && total > 1 ? total / sum : 1
  let cursor = 0
  return lines.map((copy, i) => {
    const from = cursor
    cursor += need[i] * scale
    return { from: Math.round(from * 100) / 100, to: Math.round(cursor * 100) / 100, copy }
  })
}

export type ParseOptions = {
  /** Scripts and data from the same package, scanned for scene lists too. */
  scripts?: string
  /** File name, for the last-resort title card. */
  name?: string
}

/**
 * Read whatever structure the file is willing to admit to.
 *
 * With `opts.name` this never returns null: after every structured source is
 * exhausted it still produces a title card, because "your import failed" is
 * a worse outcome than "here is one editable clip, rename it".
 */
export function parseGeneratedHtml(html: string, opts: ParseOptions = {}): ImportedPiece | null {
  const text = String(html || '')
  const scripts = String(opts.scripts || '')
  const corpus = `${text}\n${scripts}`
  if (!corpus.trim() && !opts.name) return null

  const manifestLiteral = literalAfter(corpus, /__cupricSourceManifest\s*=\s*/)
  const manifest = manifestLiteral
    ? looseParse<{ sequence?: unknown[]; sources?: unknown[]; renderSpec?: Record<string, unknown> }>(manifestLiteral)
    : null

  const spec = manifest?.renderSpec ?? {}
  const fpsRaw = num((spec as { fps?: unknown }).fps, num(corpus.match(/\bfps\s*[:=]\s*(24|30|60)\b/i)?.[1], 0))
  const fps = fpsRaw === 24 || fpsRaw === 30 || fpsRaw === 60 ? (fpsRaw as 24 | 30 | 60) : null
  const sizeRaw = (spec as { size?: unknown }).size
  const wh = corpus.match(/\bwidth\s*[:=]\s*(\d{3,4})\b[\s\S]{0,80}?\bheight\s*[:=]\s*(\d{3,4})\b/i)
  const size = Array.isArray(sizeRaw) && sizeRaw.length >= 2
    ? ([num(sizeRaw[0], 1920), num(sizeRaw[1], 1080)] as [number, number])
    : wh ? ([Number(wh[1]), Number(wh[2])] as [number, number]) : null
  const declaredTotal = num((spec as { durationSec?: unknown }).durationSec, num(corpus.match(/\b(?:total)?duration(?:Sec|Seconds|_s)?\s*[:=]\s*(\d+(?:\.\d+)?)\b/i)?.[1], 0))

  const sources = Array.isArray(manifest?.sources)
    ? manifest.sources.map((s) => (typeof s === 'string' ? s : String((s as { name?: string })?.name ?? ''))).filter(Boolean)
    : []
  const piece = (scenes: ImportedScene[], via: ImportedPiece['via']): ImportedPiece => ({ scenes: scenes.slice(0, 60), durationSec: endOf(scenes), fps, size, sources, via })

  const fromSequence = normaliseScenes(manifest?.sequence, fps ?? 30)
  if (fromSequence.length) return piece(fromSequence, 'manifest')

  // Scene lists by any common name, in the HTML or any script / JSON file.
  // Keep the list with the most usable scenes.
  const best = sceneArrayCandidates(corpus)
    .map((list) => normaliseScenes(list, fps ?? 30))
    .sort((a, b) => b.filter((s) => s.role !== 'sub').length - a.filter((s) => s.role !== 'sub').length)[0]
  if (best?.length) return piece(best, 'scene-array')

  const timed = timedMarkup(text)
  if (timed.length) return piece(timed, 'timed-markup')

  // Scene containers (<section>, .scene, data-duration…) with their own copy.
  const blocks = sceneBlocks(text)
  if (blocks.length) return piece(blocks, 'scene-blocks')

  // The words on screen, in order — from the HTML and any JSX components.
  const lines = [...visibleLines(text), ...visibleLines(scripts.replace(/\/\* [^*]+\.(?:css|json|md|txt) \*\/[\s\S]*?(?=\n\/\* |$)/g, ''))]
  const uniqueLines = [...new Set(lines)].slice(0, 30)
  if (uniqueLines.length) return piece(paced(uniqueLines, declaredTotal || undefined), 'headings')

  const copy = scriptCopy(corpus)
  if (copy.length) return piece(paced(copy.slice(0, 12), declaredTotal || undefined), 'script-copy')

  const title = cleanLine(text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
  const og = text.match(/<meta[^>]+(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*content=["']([^"']+)["']/i)?.[1]
  const description = text.match(/<meta[^>]+name=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i)?.[1]
  const meta = [og ?? title, description].map((line) => cleanLine(line ?? '')).filter((line) => line.length > 1)
  if (meta.length) return piece(paced([...new Set(meta)], declaredTotal || undefined), 'title')

  if (!opts.name) return null
  return piece(paced([titleCard(opts.name)], declaredTotal || 4), 'title')
}

function endOf(scenes: ImportedScene[]) {
  return scenes.reduce((max, s) => Math.max(max, s.to), 0)
}

const PRIMARY_COPY_KEYS = ['copy', 'text', 'title', 'headline', 'heading', 'hero', 'line', 'message', 'quote', 'label', 'name', 'content', 'caption', 'words', 'value']
const SECONDARY_COPY_KEYS = ['subtitle', 'sub', 'subhead', 'subheading', 'kicker', 'eyebrow', 'tagline', 'body', 'description', 'desc', 'detail', 'support', 'cta']

function readCopy(value: unknown): string {
  if (typeof value === 'string') return cleanLine(value)
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(readCopy).filter(Boolean).join(' ')
  return ''
}

/** Accept the several shapes a scene list turns up in, reject the rest. */
function normaliseScenes(input: unknown, fps = 30): ImportedScene[] {
  if (!Array.isArray(input)) return []
  const out: ImportedScene[] = []
  let cursor = 0
  // Decide units once per list: timings above 600 are milliseconds.
  const numbers = input.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const r = raw as Record<string, unknown>
    return [r.from, r.start, r.at, r.in, r.t0, r.begin, r.startTime, r.to, r.end, r.out, r.t1, r.endTime, r.duration, r.dur].map(Number).filter(Number.isFinite)
  })
  const unit = numbers.length && Math.max(...numbers) > 600 ? 1000 : 1
  for (const raw of input.slice(0, 80)) {
    // "Just a line" lists: ["Meet Cupric", "Edit at the speed of thought"].
    if (typeof raw === 'string') {
      const copy = cleanLine(raw)
      if (!copy || copy.length > 300) continue
      const duration = Math.max(2.2, Math.min(6, 0.9 + copy.split(/\s+/).length * 0.32))
      out.push({ from: cursor, to: cursor + duration, copy })
      cursor += duration
      continue
    }
    // ["COPY", durationSec, "anim"] — the shape the SaaS blueprints use.
    if (Array.isArray(raw)) {
      const copy = String(raw[0] ?? '').trim()
      const duration = num(raw[1], 3)
      if (!copy) continue
      out.push({ from: cursor, to: cursor + duration, copy, motion: typeof raw[2] === 'string' ? raw[2] : undefined })
      cursor += duration
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const scene = raw as Record<string, unknown>
    let copy = ''
    for (const key of PRIMARY_COPY_KEYS) {
      copy = readCopy(scene[key])
      if (copy) break
    }
    let secondary = ''
    for (const key of SECONDARY_COPY_KEYS) {
      secondary = readCopy(scene[key])
      if (secondary) break
    }
    // Copy nested one level down: { layers: [{ type: 'text', text: '…' }] }.
    if (!copy) {
      for (const nestKey of ['lines', 'layers', 'elements', 'texts', 'items', 'content', 'children']) {
        const nested = scene[nestKey]
        if (Array.isArray(nested)) {
          const texts = nested.map((item) => (typeof item === 'string' ? cleanLine(item) : item && typeof item === 'object' ? readCopy((item as Record<string, unknown>).text ?? (item as Record<string, unknown>).copy ?? (item as Record<string, unknown>).title) : '')).filter(Boolean)
          if (texts.length) {
            copy = texts[0]
            if (!secondary && texts[1]) secondary = texts.slice(1, 3).join(' ')
            break
          }
        }
      }
    }
    if (!copy && secondary) {
      copy = secondary
      secondary = ''
    }
    if (!copy || copy.length > 400) continue
    const fromRaw = scene.from ?? scene.start ?? scene.at ?? scene.in ?? scene.t0 ?? scene.begin ?? scene.startTime ?? scene.startSec ?? scene.time
    const from = fromRaw !== undefined ? num(fromRaw, cursor * unit) / unit : cursor
    const explicitTo = scene.to ?? scene.end ?? scene.out ?? scene.t1 ?? scene.endTime ?? scene.endSec
    const frames = num(scene.durationInFrames ?? scene.frames, 0)
    const durationMs = num(scene.durationMs ?? scene.ms, 0)
    const durationRaw = scene.durationSec ?? scene.duration ?? scene.dur ?? scene.length ?? scene.seconds ?? scene.hold
    const duration = frames > 0 ? frames / fps : durationMs > 0 ? durationMs / 1000 : durationRaw !== undefined ? num(durationRaw, 3) / unit : Math.max(2.2, Math.min(6, 0.9 + copy.split(/\s+/).length * 0.32))
    const to = explicitTo !== undefined ? num(explicitTo, (from + 3) * unit) / unit : from + duration
    if (!(to > from)) continue
    const motion = typeof scene.motion === 'string' ? scene.motion : typeof scene.animation === 'string' ? scene.animation : typeof scene.anim === 'string' ? scene.anim : typeof scene.transition === 'string' ? scene.transition : undefined
    out.push({ from, to, copy, motion, type: typeof scene.type === 'string' ? scene.type : undefined, role: 'title' })
    if (secondary && secondary !== copy && secondary.length < 300) out.push({ from, to, copy: secondary, motion, role: 'sub' })
    cursor = to
  }
  return out.sort((a, b) => a.from - b.from || (a.role === 'sub' ? 1 : 0) - (b.role === 'sub' ? 1 : 0))
}

/** Map the model's prose motion description onto an animation we actually have. */
export function animForMotion(motion: string | undefined, index: number): StudioTextAnim {
  const text = (motion ?? '').toLowerCase()
  if (/type|typewriter|keyed/.test(text)) return 'typewriter'
  if (/word|per-word|stagger/.test(text)) return 'word-reveal'
  if (/pop|punch|scale|spring/.test(text)) return 'pop'
  if (/wave|liquid|fluid/.test(text)) return 'liquid-wave'
  if (/shimmer|shine|gloss/.test(text)) return 'shimmer'
  if (/glass|frost|blur/.test(text)) return 'glass-rise'
  if (/slide|push|swipe/.test(text)) return 'slide-left'
  if (/up|rise|fade/.test(text)) return 'fade-up'
  // No description: alternate between two safe entrances so consecutive
  // scenes do not all move identically.
  return index % 2 === 0 ? 'fade-up' : 'pop'
}

/** Headline first, then progressively smaller — the hierarchy a viewer expects. */
function sizeFor(copy: string, index: number): number {
  const words = copy.trim().split(/\s+/).length
  if (index === 0 && words <= 6) return 11
  if (words <= 4) return 10
  if (words <= 10) return 7.5
  return 6
}

/**
 * Build editable clips from a parsed piece.
 *
 * The clips are the real thing — the same text clips the Studio makes when you
 * press Text — so everything already built works on them: keyframes, grades,
 * masks, rotation, the checks panel. Nothing about them remembers they came
 * from a model.
 */
export function rundownToStudioClips(rundown: SceneRundown, doc: StudioDoc, label = 'Generated'): StudioClip[] {
  return piecesToStudioClips({
    scenes: rundown.scenes.map((scene) => ({
      from: scene.from,
      to: scene.to,
      copy: scene.copy,
      motion: scene.motion,
      type: scene.type,
    })),
    durationSec: rundown.durationSec,
    fps: rundown.fps === 24 || rundown.fps === 30 || rundown.fps === 60 ? rundown.fps : null,
    size: rundown.size,
    sources: ['automation-rundown'],
    via: 'manifest',
  }, doc, label)
}

export function piecesToStudioClips(piece: ImportedPiece, doc: StudioDoc, label = 'Generated'): StudioClip[] {
  const track = Math.max(1, Math.min(doc.trackCount - 1, 1))
  const base = nextFreeStart(doc, track, 0, Math.max(1, piece.durationSec))
  const clips: StudioClip[] = []
  let sceneIndex = 0

  piece.scenes.forEach((scene) => {
    const sub = scene.role === 'sub'
    const template = defaultTextClip(0, sub ? track + 1 : track)
    const index = sub ? Math.max(0, sceneIndex - 1) : sceneIndex
    const transitionIn: StudioTransition = sub ? 'none' : index === 0 ? 'fade' : 'liquid-dissolve'
    clips.push({
      ...template,
      id: uid(),
      // Named by what it says, so the timeline reads like a script.
      name: scene.copy.length > 32 ? `${scene.copy.slice(0, 31)}…` : scene.copy,
      startSec: Math.round((base + scene.from + (sub ? 0.25 : 0)) * 100) / 100,
      durationSec: Math.max(0.4, Math.round((scene.to - scene.from - (sub ? 0.25 : 0)) * 100) / 100),
      text: scene.copy,
      fontSizePct: sub ? 4.8 : sizeFor(scene.copy, index),
      weight: sub ? 600 : 800,
      y: sub ? 0.64 : 0.46,
      anim: sub ? 'fade-up' : animForMotion(scene.motion, index),
      transitionIn,
      transitionOut: 'fade',
    })
    if (!sub) sceneIndex += 1
  })

  return clips
}
