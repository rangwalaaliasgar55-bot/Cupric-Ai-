/**
 * Timed on-screen copy from a code-generated film (React/Vite, canvas, Three.js
 * or GSAP), read without running any of it.
 *
 * `sourceProject.ts` finds the chapter map and scene components. This module
 * finds every piece of text the film actually draws, and when and where it
 * draws it. That way an import rebuilds the film's typography beat by beat as
 * native, editable Studio text clips instead of one title per chapter.
 *
 * Shapes it understands (all found in real AI-builder exports):
 *   JSX props       <KText text="CREATE." at={0.85} out={1.62} size={320} weight={700} variant="depth" />
 *                   <HudLabel x={80} y={70} text="001 — GENESIS" o={win(t, 0.6, 2.8)} />
 *   canvas calls    this.kinetic('ONE IDEA', W / 2, 520, { size: 180 }, p)  ·  ctx.fillText("10×", W / 2, H / 2)
 *   literal tables  { text: 'THINK', x: 124, y: 306, size: 169, color: WHITE }
 *   GSAP timelines  tl.fromTo('#text-create', {...}, {...}, 0.9)  +  <div id="text-create">CREATE.</div>
 *
 * The timing comes from the call's own props (at/out/start/end/from/to/delay).
 * Failing that, it comes from the nearest time window around the call, such as
 * prog(t, a, b), win(t, a, b), `t > a && t < b` or `if (t < a || t > b) return`.
 * Failing that, the enclosing function is matched to a chapter. Anything it
 * cannot time is reported instead of being guessed.
 */
import type { SourceChapter, SourceFile } from './sourceProject'

export type SourceText = {
  text: string
  startSec: number
  endSec: number
  /** 0–1 frame position of the text centre (null → caller default). */
  x: number | null
  y: number | null
  /** Font size in source pixels (relative to `frameH`). */
  sizePx: number | null
  weight: number | null
  color: string | null
  variant: string | null
  mono: boolean
  role: 'headline' | 'label' | 'body'
  file: string
  via: 'jsx' | 'canvas' | 'table' | 'gsap'
  /** Interface copy inside a mocked app screen (a JSX child with no size/position). */
  ui?: boolean
  /** 'exact' = the code states this text's own window; 'chapter' = inherited from its chapter. */
  timing?: 'exact' | 'chapter'
}

const CODE = /\.(?:[cm]?jsx?|tsx?)$/i
const NUM = String.raw`-?\d+(?:\.\d+)?`
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** Real visible copy — not code, not a CSS value, not a number. */
export function isCopy(s: string): boolean {
  const t = s.trim()
  if (t.length < 1 || t.length > 90 || /^[a-z0-9]{1,3}$/.test(t)) return false
  if (!/[A-Za-z\u0900-\u097F×]/.test(t) && !/^\d+\s*[×x%]$/.test(t)) return false
  if (/&&|\|\||=>|[{};=<>]|^\w+\(|^[a-z]+[A-Z]\w*$|^(?:rgba?|hsla?|translate|scale|rotate|blur|linear|radial|var|calc)\(/.test(t)) return false
  if (/^(?:absolute|relative|fixed|flex|grid|block|none|auto|center|left|right|top|bottom|hidden|visible|inherit|transparent|bold|normal|italic|uppercase|pointer|solid|round|butt|miter|source-over|lighter|screen|multiply|middle|alphabetic|start|end|ltr|rtl|anonymous|use client)$/i.test(t)) return false
  if (/^[\w-]+\.(?:tsx?|jsx?|css|png|jpe?g|svg|mp3|wav|json)$/i.test(t)) return false
  if (/^(?:\d+(?:px|em|rem|%|deg|ms|s)\s*)+$/.test(t) || /^#[0-9a-f]{3,8}$/i.test(t)) return false
  if (/^\d{2,3}\s+\d+px\b/.test(t)) return false // canvas font shorthand
  return true
}

type Ctx = { W: number; H: number; consts: Map<string, unknown> }

/** Evaluate `W / 2 + 40`, `H * 0.3`, `960` — constants and + - * / only. */
function evalExpr(src: string | undefined, c: Ctx): number | null {
  if (!src) return null
  const s = src.trim().replace(/^\{|\}$/g, '').trim()
  if (!s || s.length > 40) return null
  const sub = s.replace(/[A-Za-z_$][\w$]*/g, (k) => {
    if (k === 'W' || /^(?:WIDTH|VW|FRAME_?W)$/i.test(k)) return String(c.W)
    if (k === 'H' || /^(?:HEIGHT|VH|FRAME_?H)$/i.test(k)) return String(c.H)
    if (/^(?:centerX|cx|midX|CX|CENTER_X)$/.test(k)) return String(c.W / 2)
    if (/^(?:centerY|cy|midY|CY|CENTER_Y)$/.test(k)) return String(c.H / 2)
    const v = c.consts.get(k)
    return typeof v === 'number' ? String(v) : '§'
  })
  if (sub.includes('§') || !/^[\d\s+\-*/.()]+$/.test(sub)) return null
  try {
    const v = Function(`"use strict";return (${sub})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Split `a, fn(b, c), { d: 1 }, 'x,y'` at top-level commas. */
function splitArgs(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let q: string | null = null
  let cur = ''
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue }
    if ('([{'.includes(ch)) depth += 1
    if (')]}'.includes(ch)) depth -= 1
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Text between a paren/brace at `open` and its partner. */
function balanced(text: string, open: number): string {
  const o = text[open]
  const cl = o === '(' ? ')' : o === '{' ? '}' : ']'
  let depth = 0
  let q: string | null = null
  for (let i = open; i < text.length && i < open + 4000; i++) {
    const ch = text[i]
    if (q) { if (ch === q && text[i - 1] !== '\\') q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue }
    if (ch === o) depth += 1
    else if (ch === cl) { depth -= 1; if (depth === 0) return text.slice(open + 1, i) }
  }
  return text.slice(open + 1, open + 400)
}

const unquote = (s: string | undefined) => {
  const m = s?.trim().match(/^(['"`])([\s\S]*)\1$/)
  return m && !/\$\{/.test(m[2]) ? m[2] : null
}

/** A time window stated near `at` in `text` — the closest one before it, within its function. */
function windowNear(text: string, at: number, fnStart: number, fracDur = 0): [number, number] | null {
  const body = text.slice(fnStart, Math.min(text.length, at + 200))
  const rel = at - fnStart
  const cands: Array<{ at: number; a: number; b: number }> = []
  const push = (i: number, a: number, b: number) => { if (Number.isFinite(a) && Number.isFinite(b) && b > a && b - a < 120) cands.push({ at: i, a, b }) }
  for (const m of body.matchAll(new RegExp(String.raw`\b(?:prog|progress|win2?|window|inRange|between|range|seg(?:ment)?|span|sub|remap|p|smooth(?:step)?|sstep|ease\w*|fade\w*|reveal|appear|ramp|lerpT|norm)\(\s*([A-Za-z_$][\w$.]*)\s*,\s*(${NUM})\s*,\s*(${NUM})`, 'g'))) {
    const frac = /^(?:p|pr|progress|localP|lp|k)$/.test(m[1]) && +m[3] <= 1
    if (frac && !fracDur) continue
    push(m.index!, frac ? +m[2] * fracDur : +m[2], frac ? +m[3] * fracDur : +m[3])
  }
  for (const m of body.matchAll(new RegExp(String.raw`\b(?:t|time|sec|now|lt|local)\s*>=?\s*(${NUM})\s*&&\s*(?:t|time|sec|now|lt|local)\s*<=?\s*(${NUM})`, 'g'))) push(m.index!, +m[1], +m[2])
  for (const m of body.matchAll(new RegExp(String.raw`\b(?:t|time|sec|now|lt|local)\s*<=?\s*(${NUM})\s*\|\|\s*(?:t|time|sec|now|lt|local)\s*>=?\s*(${NUM})`, 'g'))) push(m.index!, +m[1], +m[2])
  if (!cands.length) return null
  // Prefer the latest window that opens before the call; else the first after it.
  const before = cands.filter((c) => c.at <= rel).sort((x, y) => y.at - x.at)
  const pick = before[0] ?? cands[0]
  // A guard spanning the whole function is a coarser, still-valid window.
  return [pick.a, pick.b]
}

/** Start of the function/method enclosing `at` (best effort). */
function enclosingFn(text: string, at: number): { start: number; name: string | null } {
  const re = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[a-z_$][\w$]*)\s*(?::[^=]{1,40})?=>|^\s*(?:private\s+|public\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[\w<>[\]|, ]+)?\s*\{)/gm
  let best = { start: 0, name: null as string | null }
  for (const m of text.matchAll(re)) {
    if (m.index! > at) break
    const name = m[1] ?? m[2] ?? m[3] ?? null
    if (name && /^(?:if|for|while|switch|catch|return|constructor)$/.test(name)) continue
    best = { start: m.index!, name }
  }
  return best
}

const roleFor = (sizePx: number | null, text: string, mono: boolean, H: number): SourceText['role'] =>
  mono || /^\d{3}\s*[—–-]|\/|^[A-Z0-9 ]{2,}\s[—–-]\s/.test(text) || (sizePx !== null && sizePx < H * 0.035) ? 'label' : sizePx !== null && sizePx < H * 0.07 ? 'body' : 'headline'

function propMap(attrs: string): Map<string, string> {
  const map = new Map<string, string>()
  let i = 0
  while (i < attrs.length) {
    const m = /([A-Za-z_$][\w$]*)\s*=\s*/y
    m.lastIndex = i
    const hit = m.exec(attrs)
    if (!hit) { i += 1; continue }
    let j = m.lastIndex
    const ch = attrs[j]
    let val: string
    if (ch === '{') { val = `{${balanced(attrs, j)}}`; j += val.length }
    else if (ch === '"' || ch === "'") { const e = attrs.indexOf(ch, j + 1); val = attrs.slice(j, e + 1); j = e + 1 }
    else { i = j; continue }
    map.set(hit[1], val)
    i = j
  }
  return map
}

/**
 * Find every timed text the film draws. `chapters` lets untimed calls inside
 * a chapter-named function inherit that chapter's window.
 */
export function extractTimedText(files: SourceFile[], opts: { chapters?: SourceChapter[]; consts?: Map<string, unknown>; W?: number; H?: number; durationSec?: number } = {}): { texts: SourceText[]; untimed: string[] } {
  const c: Ctx = { W: opts.W ?? 1920, H: opts.H ?? 1080, consts: opts.consts ?? new Map() }
  const chapters = opts.chapters ?? []
  const total = opts.durationSec ?? (chapters.length ? chapters[chapters.length - 1].startSec + chapters[chapters.length - 1].durationSec : 0)
  const code = files.filter((f) => CODE.test(f.path) && !/\.config\.|\.d\.ts$|(?:^|\/)main\.[jt]sx?$/.test(f.path))
  const texts: SourceText[] = []
  const untimed: string[] = []
  const nrm = (s: string) => s.toLowerCase().replace(/scene|draw|render|chapter|beat|section|\d+/g, '').replace(/[^a-z]/g, '')
  // Dispatch tables: `case 3: drawTenX(…)` or `[drawHook, drawDirections, …]` → chapter index.
  const dispatch = new Map<string, number>()
  for (const f of code) {
    for (const m of f.text.matchAll(/case\s+(\d+)\s*:\s*(?:return\s+)?(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/g)) if (!dispatch.has(m[2])) dispatch.set(m[2], +m[1])
    for (const m of f.text.matchAll(/=\s*\[\s*((?:[A-Za-z_$][\w$]*\s*,\s*){3,}[A-Za-z_$][\w$]*)\s*,?\s*\]/g)) {
      const ids = m[1].split(',').map((x) => x.trim())
      if (chapters.length && Math.abs(ids.length - chapters.length) <= 1 && ids.every((x) => /^[a-zA-Z]/.test(x))) ids.forEach((x, i) => { if (!dispatch.has(x)) dispatch.set(x, i) })
    }
  }
  const chapterOf = (fnName: string | null) => {
    if (!fnName || !chapters.length) return null
    const di = dispatch.get(fnName)
    if (di !== undefined && chapters[di]) return chapters[di]
    const n = nrm(fnName)
    if (n.length < 3) return null
    return chapters.find((ch) => { const cn = nrm(ch.name); return cn.length >= 3 && (cn.includes(n) || n.includes(cn)) }) ?? null
  }
  /** Resolve a window to absolute seconds (local windows inside a chapter get its offset). */
  const place = (w: [number, number] | null, fnName: string | null, hold = false): [number, number] | null => {
    chapterOnly = false
    const ch = chapterOf(fnName)
    if (w) {
      let r: [number, number] = ch && ch.startSec > 0 && w[1] <= ch.durationSec + 0.25 && w[0] < ch.startSec - 0.25 ? [ch.startSec + w[0], ch.startSec + w[1]] : w
      // A reveal ramp (smooth(p, .2, .5)) says when text arrives, not when it
      // leaves: drawn text stays up until its chapter cuts away.
      const chEnd = ch ? ch.startSec + ch.durationSec : 0
      if (hold && ch && r[0] >= ch.startSec - 0.05 && r[1] < chEnd - 0.3) r = [r[0], chEnd]
      return r
    }
    if (ch) chapterOnly = true
    return ch ? [ch.startSec, ch.startSec + ch.durationSec] : null
  }
  let chapterOnly = false
  const add = (t: Omit<SourceText, 'role'>, windowSrc: [number, number] | null) => {
    if (!isCopy(t.text)) return
    if (!windowSrc) { untimed.push(t.text); return }
    let [a, b] = windowSrc
    if (total > 0) { a = Math.max(0, Math.min(a, total - 0.2)); b = Math.min(total, b) }
    if (!(b - a >= 0.15)) return
    texts.push({ ...t, text: t.text.trim(), startSec: round(a), endSec: round(b), role: roleFor(t.sizePx, t.text, t.mono, c.H), timing: chapterOnly ? 'chapter' : 'exact' })
  }

  for (const f of code) {
    const src = f.text

    // 1. JSX elements carrying a string `text` prop, or a plain text child.
    for (const m of src.matchAll(/<([A-Z][\w.]*|div|span|h[1-6]|p)\b((?:[^<>]|=>|\{[^{}]*\})*?)(\/?)>/g)) {
      const props = propMap(m[2])
      let text = unquote(props.get('text')) ?? unquote(props.get('text')?.replace(/^\{|\}$/g, ''))
      const fromChild = !text
      const selfClosing = m[3] === '/'
      if (!text && !selfClosing && /^(?:div|span|h[1-6]|p)$/.test(m[1])) {
        const rest = src.slice(m.index! + m[0].length, m.index! + m[0].length + 200)
        const child = rest.match(/^\s*([^<>{}]+?)\s*<\//)
        if (child && isCopy(child[1]) && /[A-Z]/.test(child[1])) text = child[1].replace(/\s+/g, ' ')
      }
      if (!text) continue
      const num = (k: string) => evalExpr(props.get(k), c)
      const fn = enclosingFn(src, m.index!)
      const at = num('at') ?? num('start') ?? num('from') ?? num('delay') ?? num('in')
      const out = num('out') ?? num('end') ?? num('to') ?? num('until')
      const dur = num('dur') ?? num('duration')
      let w: [number, number] | null = null
      const own = [...(props.get('o') ?? props.get('opacity') ?? props.get('show') ?? props.get('visible') ?? '').matchAll(new RegExp(String.raw`\(\s*[\w$.]+\s*,\s*(${NUM})\s*,\s*(${NUM})`, 'g'))][0]
      if (at !== null) w = [at, out !== null ? out + (num('outDur') ?? 0.35) : dur !== null ? at + dur : NaN]
      else if (own) w = [+own[1], +own[2]]
      if (w && !Number.isFinite(w[1])) { const nx = windowNear(src, m.index!, fn.start, chapterOf(fn.name)?.durationSec); w = [w[0], nx && nx[1] > w[0] ? nx[1] : w[0] + 2.5] }
      if (!w) w = windowNear(src, m.index!, fn.start, chapterOf(fn.name)?.durationSec)
      // Position: explicit x/y props (px), else an enclosing <Center y={-92}>.
      let x = num('x'), y = num('y')
      if (x === null && y === null) {
        const before = src.slice(Math.max(0, m.index! - 260), m.index!)
        const center = [...before.matchAll(/<Center\b([^>]*)>/g)].pop()
        if (center) { const cp = propMap(center[1]); const dy = evalExpr(cp.get('y'), c) ?? 0; const dx = evalExpr(cp.get('x'), c) ?? 0; x = c.W / 2 + dx; y = c.H / 2 + dy }
      }
      const align = unquote(props.get('align'))
      const size = num('size') ?? num('fontSize')
      const colorV = unquote(props.get('color'))
      add({
        text, startSec: 0, endSec: 0,
        x: x !== null ? clamp01(align === 'right' ? (x - 0.12 * c.W) / c.W : align === 'left' || /Hud|Label/.test(m[1]) ? (x + 0.12 * c.W) / c.W : x / c.W) : null,
        y: y !== null ? clamp01(y / c.H) : null,
        sizePx: size ?? (/Hud|Label|Mono|Caption/i.test(m[1]) ? 20 : null),
        weight: num('weight'), color: colorV && HEX.test(colorV) ? colorV : null,
        variant: unquote(props.get('variant')), mono: /Hud|Mono|Code/i.test(m[1]) || props.has('mono'),
        file: f.path, via: 'jsx', ui: fromChild && size === null && x === null && y === null,
      }, place(w, fn.name))
    }

    // 2. Canvas draw calls with a literal string first argument.
    for (const m of src.matchAll(/\b(?:(?:this|ctx|c|g)\.)?([A-Za-z_$]*(?:[Tt]ext|[Ll]abel|[Tt]itle|[Hh]eadline|kinetic|[Tt]ype[A-Z]\w*|[Ww]rite|txt|[Ww]ord|[Gg]lyphs?))\s*\(/g)) {
      const open = m.index! + m[0].length - 1
      const args = splitArgs(balanced(src, open))
      let ti = args.findIndex((a) => unquote(a) !== null)
      if (ti < 0 || ti > 1) continue
      const text = unquote(args[ti])!
      if (!isCopy(text) || /^(?:function|return)$/.test(text)) continue
      // Skip the helper's own per-letter call: fillText(letter, …) has no literal anyway.
      const fn = enclosingFn(src, m.index!)
      const optsArg = args.slice(ti + 1).find((a) => a.startsWith('{')) ?? ''
      const size = evalExpr(optsArg.match(/\bsize\s*:\s*([^,}]+)/)?.[1], c) ?? evalExpr(src.slice(Math.max(0, m.index! - 200), m.index!).match(/font\s*=\s*[`'"][^`'"]*?(\d+)px/g)?.pop()?.match(/(\d+)px/)?.[1], c)
      const weight = evalExpr(optsArg.match(/\bweight\s*:\s*([^,}]+)/)?.[1], c) ?? evalExpr(src.slice(Math.max(0, m.index! - 200), m.index!).match(/font\s*=\s*[`'"](\d{3})\s/g)?.pop()?.match(/(\d{3})/)?.[1], c)
      const colorArg = optsArg.match(/\bcolor\s*:\s*([^,}]+)/)?.[1]?.trim()
      const color = colorArg ? (unquote(colorArg) ?? (c.consts.get(colorArg) as string | undefined) ?? null) : null
      const x0 = evalExpr(args[ti + 1], c), y = evalExpr(args[ti + 2], c)
      const posSize = !optsArg ? evalExpr(args[ti + 3], c) : null
      const alignArg = args.map((a) => unquote(a)).find((a) => a === 'left' || a === 'center' || a === 'right' || a === 'start' || a === 'end')
      const alignSet = src.slice(Math.max(0, m.index! - 300), m.index!).match(/textAlign\s*=\s*['"](\w+)['"]/g)?.pop()?.match(/['"](\w+)['"]/)?.[1]
      const align = alignArg ?? alignSet ?? (/^(?:fillText|strokeText)$/.test(m[1]) ? 'start' : 'center')
      const px = size ?? posSize ?? null
      const wEst = px ? text.length * px * 0.56 : 0
      const x = x0 === null ? null : align === 'left' || align === 'start' ? x0 + wEst / 2 : align === 'right' || align === 'end' ? x0 - wEst / 2 : x0
      const colorPos = args.slice(ti + 1).map((a) => unquote(a) ?? (c.consts.get(a.trim()) as string | undefined)).find((v) => typeof v === 'string' && HEX.test(v))
      const mono = /mono|label|hud/i.test(m[1] + optsArg) || /Mono/.test(src.slice(Math.max(0, m.index! - 200), m.index!).split('\n').slice(-3).join(''))
      add({
        text, startSec: 0, endSec: 0, x: x !== null ? clamp01(x / c.W) : null, y: y !== null ? clamp01(y / c.H) : null,
        sizePx: px ?? (/label/i.test(m[1]) ? 16 : null), weight: weight ?? (!optsArg ? evalExpr(args.slice(ti + 4).find((a) => /^[4-9]00$/.test(a.trim())), c) : null), color: typeof color === 'string' && HEX.test(color) ? color : colorPos ?? null,
        variant: m[1] === 'kinetic' ? 'kinetic' : m[1] === 'typeText' ? 'typewriter' : null, mono, file: f.path, via: 'canvas',
      }, place(windowNear(src, m.index!, fn.start, chapterOf(fn.name)?.durationSec), fn.name, true))
    }

    // 3. Literal tables of text objects: { text: 'THINK', x: 124, y: 306, size: 169 }.
    for (const m of src.matchAll(/\{\s*text\s*:\s*(['"`])([^'"`$]{1,90})\1([^{}]*)\}/g)) {
      const rest = m[3]
      const g = (k: string) => evalExpr(rest.match(new RegExp(String.raw`\b${k}\s*:\s*([^,}]+)`))?.[1], c)
      const colorArg = rest.match(/\bcolor\s*:\s*([^,}]+)/)?.[1]?.trim()
      const color = colorArg ? (unquote(colorArg) ?? (c.consts.get(colorArg) as string | undefined) ?? null) : null
      const fn = enclosingFn(src, m.index!)
      // A table declared at module level is used by the function that reads it.
      let owner = fn
      let w = windowNear(src, m.index!, fn.start, chapterOf(fn.name)?.durationSec)
      const decl = src.slice(0, m.index!).match(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*\[[^\]]*$/)
      if (decl) {
        const use = src.indexOf(decl[1], m.index!)
        const useAt = use >= 0 ? src.indexOf(decl[1], src.indexOf(']', m.index!)) : -1
        if (useAt >= 0) { owner = enclosingFn(src, useAt); w = windowNear(src, useAt, owner.start, chapterOf(owner.name)?.durationSec) ?? w }
      }
      const ts = g('at') ?? g('start') ?? g('t0') ?? g('time') ?? g('from')
      const te = g('end') ?? g('t1') ?? g('to') ?? g('out')
      if (ts !== null) w = [ts, te ?? (g('dur') !== null ? ts + g('dur')! : w?.[1] ?? ts + 2)]
      add({
        text: m[2], startSec: 0, endSec: 0, x: g('x') !== null ? clamp01(g('x')! / c.W) : null, y: g('y') !== null ? clamp01(g('y')! / c.H) : null,
        sizePx: g('size') ?? g('fontSize'), weight: g('weight'), color: typeof color === 'string' && HEX.test(color) ? color : null,
        variant: null, mono: false, file: f.path, via: 'table',
      }, place(w, owner.name, ts === null))
    }

    // 4. GSAP timelines: position argument + the element's text in JSX.
    const idText = new Map<string, string>()
    for (const m of src.matchAll(/\bid=["']([\w-]+)["'][^>]*>([\s\S]{0,400}?)<\/(?:div|h\d|p|span)>/g)) {
      const t = m[2].replace(/<[^>]+>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim()
      if (isCopy(t)) idText.set(m[1], t.replace(/\s+([.,!?])/g, '$1'))
    }
    if (idText.size) {
      const timing = new Map<string, { a: number | null; b: number | null }>()
      for (const m of src.matchAll(/\b\w+\.(fromTo|from|to|set)\s*\(/g)) {
        const args = splitArgs(balanced(src, m.index! + m[0].length - 1))
        const sel = unquote(args[0])?.replace(/^#/, '')
        if (!sel || !idText.has(sel)) continue
        const pos = evalExpr(args[args.length - 1], c)
        if (pos === null) continue
        const last = args[args.length - 2] ?? ''
        const cur = timing.get(sel) ?? { a: null, b: null }
        const hides = /opacity\s*:\s*0\b/.test(last) && m[1] === 'to'
        if (hides) cur.b = cur.b === null ? pos + (evalExpr(last.match(/duration\s*:\s*([^,}]+)/)?.[1], c) ?? 0.4) : cur.b
        else if (cur.a === null) cur.a = pos
        timing.set(sel, cur)
      }
      for (const [idName, t] of timing) {
        if (t.a === null) continue
        add({ text: idText.get(idName)!, startSec: 0, endSec: 0, x: null, y: null, sizePx: null, weight: null, color: null, variant: null, mono: /label|hud|mono|tag/i.test(idName), file: f.path, via: 'gsap' },
          [t.a, t.b ?? t.a + 2.5])
      }
    }
  }

  // Same copy drawn twice in the same window (outline echo, glow pass) → once.
  const seen = new Set<string>()
  const uniq = texts.filter((t) => { const k = `${t.text}|${Math.round(t.startSec * 4)}`; if (seen.has(k)) return false; seen.add(k); return true })
  uniq.sort((a, b) => a.startSec - b.startSec || a.text.localeCompare(b.text))
  return { texts: uniq, untimed: [...new Set(untimed)].filter((u) => !uniq.some((t) => t.text === u)).slice(0, 20) }
}

const round = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.min(0.96, Math.max(0.04, n))

/** Map a source kinetic variant onto Studio's text animations. */
export function animForVariant(v: string | null, role: SourceText['role']): 'fade-up' | 'word-reveal' | 'pop' | 'typewriter' | 'slide-left' | 'kinetic' | 'none' {
  if (role === 'label') return v === 'typewriter' ? 'typewriter' : 'fade-up'
  switch (v) {
    case 'mask': case 'step': return 'word-reveal'
    case 'blur': case 'depth': return 'fade-up'
    case 'scale': return 'pop'
    case 'slide': return 'slide-left'
    case 'typewriter': return 'typewriter'
    case 'kinetic': return 'kinetic'
    default: return 'kinetic'
  }
}

/* ——— conversion to native Studio clips ——— */

export type TextClipSpec = {
  text: string; startSec: number; durationSec: number; track: number; name: string
  fontSizePct: number; fontFamily?: string; color: string; weight: 400 | 600 | 800
  align: 'left' | 'center' | 'right'; x: number; y: number; anim: ReturnType<typeof animForVariant>; textGlow?: number
}

/**
 * Lay timed texts onto text tracks (lowest free track first, never
 * overlapping) with the film's own sizes, weights, colours and fonts.
 */
export function timedTextToSpecs(texts: SourceText[], o: { base: number; firstTrack: number; maxTrack: number; fg: string; muted: string; accent: string; fonts: string[]; H?: number }): { specs: TextClipSpec[]; tracksUsed: number; dropped: number } {
  const H = o.H ?? 1080
  const display = o.fonts.find((f) => !/mono|code/i.test(f))
  const mono = o.fonts.find((f) => /mono|code/i.test(f)) ?? 'JetBrains Mono'
  const busy: Array<Array<[number, number]>> = []
  const specs: TextClipSpec[] = []
  let dropped = 0
  let maxUsed = o.firstTrack - 1
  const stackY = new Map<string, number>()
  // Mocked app screens: many small strings sharing one window become one
  // editable multi-line panel instead of a pile of centred titles.
  const groups = new Map<string, SourceText[]>()
  for (const t of texts) if (t.ui) { const k = `${t.startSec}|${t.endSec}`; groups.set(k, [...(groups.get(k) ?? []), t]) }
  const merged: SourceText[] = texts.filter((t) => !t.ui)
  for (const g of groups.values()) {
    if (g.length < 3) { merged.push(...g.map((t) => ({ ...t, role: 'body' as const, sizePx: t.sizePx ?? 30 }))); continue }
    merged.push({ ...g[0], text: g.map((t) => t.text).slice(0, 8).join('\n'), role: 'body', sizePx: 24, weight: 600, x: 0.5, y: 0.5, ui: true })
  }
  merged.sort((a, b) => a.startSec - b.startSec)
  for (const t of merged) {
    const a = o.base + t.startSec
    const b = o.base + t.endSec
    let track = -1
    for (let k = 0; k <= o.maxTrack - o.firstTrack; k++) {
      const lane = (busy[k] ??= [])
      if (lane.every(([s, e]) => b <= s + 1e-3 || a >= e - 1e-3)) { lane.push([a, b]); track = o.firstTrack + k; break }
    }
    if (track < 0) { dropped += 1; continue }
    maxUsed = Math.max(maxUsed, track)
    const px = t.sizePx
    const pct = px ? (px / H) * 100 : t.role === 'label' ? 1.9 : t.role === 'body' ? 3.4 : 9
    const fontSizePct = Math.round(Math.min(t.role === 'label' ? 4 : 30, Math.max(t.role === 'label' ? 1.4 : 2.2, pct)) * 10) / 10
    let y = t.y ?? (t.role === 'label' ? 0.07 : t.role === 'body' ? 0.64 : 0.5)
    let x = t.x ?? (t.role === 'label' ? 0.16 : 0.5)
    if (t.y === null && t.x === null) {
      // Two unplaced lines on screen at once must not sit on top of each other.
      const key = `${t.role}|${Math.round(t.startSec)}`
      const n = stackY.get(key) ?? 0
      stackY.set(key, n + 1)
      y = Math.min(0.9, y + n * (fontSizePct / 100) * 1.25)
    }
    x = Math.min(0.95, Math.max(0.05, x)); y = Math.min(0.95, Math.max(0.05, y))
    const w = t.weight ?? (t.role === 'headline' ? 700 : 600)
    const color = t.color ?? (t.role === 'label' ? o.muted : o.fg)
    specs.push({
      text: t.text, startSec: Math.round(a * 100) / 100, durationSec: Math.round((b - a) * 100) / 100, track,
      name: `${t.ui && t.text.includes('\n') ? 'UI panel' : t.role === 'label' ? 'Label' : t.role === 'body' ? 'Line' : 'Title'} · ${t.text.split('\n')[0].slice(0, 22)}`,
      fontSizePct, fontFamily: t.role === 'label' || t.mono ? mono : display, color,
      weight: w >= 650 ? 800 : w >= 500 ? 600 : 400, align: 'center', x, y,
      anim: animForVariant(t.variant, t.role),
      ...(t.role === 'headline' && color.toLowerCase() === o.accent.toLowerCase() ? { textGlow: 0.35 } : {}),
    })
  }
  return { specs, tracksUsed: maxUsed + 1, dropped }
}

/** Chapters from clusters of timed text, for films with no chapter map. */
export function chaptersFromTexts(texts: SourceText[]): SourceChapter[] {
  const heads = texts.filter((t) => t.role !== 'label').sort((a, b) => a.startSec - b.startSec)
  const out: SourceChapter[] = []
  for (const t of heads) {
    const last = out[out.length - 1]
    if (last && t.startSec < last.startSec + last.durationSec + 0.4) { last.durationSec = Math.max(last.durationSec, t.endSec - last.startSec); if (!/ · /.test(last.name) && last.name.length < 24) last.name = `${last.name} ${t.text}`.slice(0, 40); continue }
    out.push({ name: t.text.slice(0, 40), startSec: t.startSec, durationSec: t.endSec - t.startSec })
  }
  return out
}
