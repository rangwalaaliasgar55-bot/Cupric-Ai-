/**
 * Agent-written animations (JOB 4) — the pure half. DOM-free, React-free.
 *
 * Contract: the agent writes ONE function
 *
 *   export default function Name({ t, seed, reducedMotion, props, h, mulberry32, ease, color }) {
 *     return h('div', { style: { ... } }, props.text)
 *   }
 *
 * - `t` is clip progress 0..1 and the ONLY source of motion;
 * - `h(tag, attrs, ...children)` builds a plain tree (no React, no DOM access);
 * - randomness only via `mulberry32(seed)`;
 * - colours only via `color('accent' | 'text' | …)` → design tokens (no raw hex);
 * - `reducedMotion` must be honoured: opacity-only (transforms constant over t).
 *
 * The validator runs static rules, then executes the function with every
 * dangerous global shadowed, and checks the output tree against a tag/style
 * allowlist, a node budget, double-render identity and the reduced-motion rule.
 * Rejections quote the rule verbatim so the repair round (and the user) see why.
 */

export const AGENT_CODE_MAX_BYTES = 15 * 1024
export const AGENT_ANIM_MIN_SEC = 0.5
export const AGENT_ANIM_MAX_SEC = 30
const MAX_NODES = 1500

export type AgentRule = { id: string; text: string }
export const AGENT_CODE_RULES: Record<string, AgentRule> = {
  size: { id: 'size', text: 'Code must be at most 15 KB.' },
  single: { id: 'single', text: 'Exactly one component: a single `export default function Name({ t, … })` and nothing else exported.' },
  onlyT: { id: 'only-t', text: 'Motion must be a pure function of t (0..1): no Date, Date.now, performance.now, timers or requestAnimationFrame.' },
  seeded: { id: 'seeded', text: 'Randomness must be seeded: use mulberry32(seed), never Math.random or crypto.' },
  network: { id: 'no-network', text: 'No network or code loading: no fetch, XMLHttpRequest, WebSocket, import(), require, eval or Function.' },
  dom: { id: 'no-dom', text: 'No DOM or browser globals: no document, window, globalThis, localStorage, navigator or refs — build the tree with h().' },
  imports: { id: 'no-imports', text: 'No imports: h, mulberry32, ease and color are passed in as arguments.' },
  hex: { id: 'no-raw-hex', text: "No raw colours (hex, rgb(), hsl()): use color('accent' | 'text' | 'muted' | 'danger' | 'info' | 'panel' | 'bg' | 'line')." },
  reduced: { id: 'reduced-motion', text: 'Honour reducedMotion: when it is true, only opacity may change over t (transforms, filters and positions stay constant).' },
  loops: { id: 'bounded-loops', text: 'Loops must be bounded: only braced for-loops (no while/do, no for(;;)), at most 100,000 iterations per frame, and no arrays or strings built larger than 1,000 items.' },
  pure: { id: 'double-render', text: 'Double-render identity: rendering the same t twice must produce exactly the same tree.' },
  tree: { id: 'allowlisted-tree', text: 'Only allowlisted tags (div, span, svg, g, path, rect, circle, ellipse, line, polyline, polygon, text) and style/SVG attributes, at most 1500 nodes.' },
  runs: { id: 'must-run', text: 'The component must render without throwing for every t in 0..1.' },
}

export type AgentRejection = { rule: string; quote: string; detail?: string }
export type AgentNode = { tag: string; attrs: Record<string, string | number>; children: Array<AgentNode | string> }

/** Deterministic PRNG — the only randomness agent code may use. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let r = Math.imul(a ^ (a >>> 15), 1 | a)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export const AGENT_EASES = {
  linear: (x: number) => x,
  'ease-in': (x: number) => x * x * x,
  'ease-out': (x: number) => 1 - (1 - x) ** 3,
  'ease-in-out': (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  'expo-out': (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  'back-out': (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
} as const
export type AgentEase = keyof typeof AGENT_EASES

const TOKENS = new Set(['accent', 'accent-text', 'accent-ink', 'text', 'muted', 'danger', 'info', 'panel', 'panel-alt', 'bg', 'line', 'surface', 'stage', 'stage-text'])
export const agentColor = (name: unknown): string => `var(--color-${TOKENS.has(String(name)) ? String(name) : 'text'})`

const TAGS = new Set(['div', 'span', 'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text'])
const STYLE_KEYS = new Set(['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'display', 'alignItems', 'justifyContent', 'flexDirection', 'gap', 'padding', 'margin', 'opacity', 'transform', 'transformOrigin', 'color', 'background', 'backgroundColor', 'border', 'borderRadius', 'boxShadow', 'fontSize', 'fontWeight', 'fontFamily', 'letterSpacing', 'lineHeight', 'textAlign', 'textShadow', 'whiteSpace', 'overflow', 'filter', 'mixBlendMode', 'clipPath', 'zIndex', 'inset', 'textTransform'])
const SVG_ATTRS = new Set(['viewBox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'fill', 'stroke', 'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset', 'opacity', 'transform', 'fontSize', 'textAnchor'])
const MOTION_STYLE = ['transform', 'filter', 'left', 'top', 'right', 'bottom', 'clipPath', 'x', 'y', 'cx', 'cy', 'd', 'points', 'strokeDashoffset', 'width', 'height']

const reject = (rule: AgentRule, detail?: string): AgentRejection => ({ rule: rule.id, quote: rule.text, ...(detail ? { detail } : {}) })

/** Remove comments and string contents so rules match code, not prose. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0])
}

/** Static rules only (fast, no execution). */
export function staticAgentCodeCheck(code: string): AgentRejection[] {
  const out: AgentRejection[] = []
  const R = AGENT_CODE_RULES
  if (typeof code !== 'string' || !code.trim()) return [reject(R.single, 'empty code')]
  if (new TextEncoder().encode(code).length > AGENT_CODE_MAX_BYTES) out.push(reject(R.size))
  const src = codeOnly(code)
  // Hex/rgb/hsl are checked on the raw code: a colour inside a string is still a raw colour.
  if (/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/.test(code)) out.push(reject(R.hex))
  if (/^\s*import\b|\bimport\s*\(|\bimport\s*\*\s*as\b/m.test(src)) out.push(reject(R.imports))
  const defaults = src.match(/export\s+default\s+function\s+[A-Z][A-Za-z0-9]*\s*\(/g) || []
  const exportsAll = src.match(/\bexport\b/g) || []
  if (defaults.length !== 1 || exportsAll.length !== 1) out.push(reject(R.single, `${defaults.length} default component(s), ${exportsAll.length} export(s)`))
  else if (!/export\s+default\s+function\s+[A-Z]\w*\s*\(\s*\{[^}]*\bt\b[^}]*\}/.test(src)) out.push(reject(R.single, 'the component must destructure t from its props'))
  if (/\bDate\b|\bperformance\b|requestAnimationFrame|setTimeout|setInterval|queueMicrotask/.test(src)) out.push(reject(R.onlyT))
  if (/Math\s*\.\s*random|\bcrypto\b/.test(src)) out.push(reject(R.seeded))
  if (/\bfetch\b|XMLHttpRequest|WebSocket|EventSource|\brequire\s*\(|\beval\b|\bFunction\b|\bimportScripts\b/.test(src)) out.push(reject(R.network))
  if (/\bdocument\b|\bwindow\b|\bglobalThis\b|\bself\b|localStorage|sessionStorage|\bnavigator\b|\bprocess\b|\bref\s*[:=]|innerHTML|__proto__|\bconstructor\b|\bprototype\b/.test(src)) out.push(reject(R.dom))
  if (/\bwhile\s*\(|\bdo\s*\{|for\s*\(\s*;?\s*;/.test(src)) out.push(reject(R.loops))
  else if (!instrumentLoops(code).ok) out.push(reject(R.loops, 'every for-loop needs a { … } body'))
  const tooBig = (re: RegExp) => [...code.matchAll(re)].some((m) => !/^\d+$/.test(m[1].trim()) || Number(m[1]) > 1000)
  if (/\bArray\s*\(|\bArray\s*\.\s*(?!from\b)\w+/.test(src) || tooBig(/Array\s*\.\s*from\s*\(\s*\{\s*length\s*:\s*([^}]*)\}/g) || (/Array\s*\.\s*from\s*\(/.test(src) && !/Array\s*\.\s*from\s*\(\s*\{\s*length\s*:/.test(src))) out.push(reject(R.loops, 'use Array.from({ length: N }) with a literal N ≤ 1000'))
  if (tooBig(/\.\s*(?:repeat|padStart|padEnd)\s*\(\s*([^,)]*)/g)) out.push(reject(R.loops, 'repeat/padStart/padEnd need a literal count ≤ 1000'))
  if (/__tick/.test(src)) out.push(reject(R.dom, '__tick is reserved'))
  if (/\basync\b|\bawait\b|function\s*\*|\byield\b|\bclass\b|\bnew\s+[A-Z]|\bthis\b|\bwith\s*\(|\bReflect\b|\bProxy\b|\bSymbol\b/.test(src)) out.push(reject(R.dom, 'async, generators, classes, new, this, with, Reflect, Proxy and Symbol are not allowed'))
  const bodyOnly = src.replace(/export\s+default\s+function\s+[A-Z]\w*\s*\(\s*\{[^}]*\}\s*\)/, '')
  if (!/\breducedMotion\b/.test(bodyOnly)) out.push(reject(R.reduced, 'reducedMotion is never read'))
  // Rule-level dedupe.
  return out.filter((r, i) => out.findIndex((o) => o.rule === r.rule) === i)
}

/**
 * Insert an iteration guard at the top of every for-loop body. Works on the
 * length-preserving code view so strings/comments are never touched. Returns
 * ok:false when a loop has no braced body (the guard could not be placed).
 */
export function instrumentLoops(code: string): { ok: boolean; code: string } {
  const view = codeOnly(code)
  const inserts: number[] = []
  const re = /\bfor\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(view))) {
    let depth = 0
    let i = m.index + m[0].length - 1
    for (; i < view.length; i += 1) {
      if (view[i] === '(') depth += 1
      else if (view[i] === ')') { depth -= 1; if (depth === 0) break }
    }
    let j = i + 1
    while (j < view.length && /\s/.test(view[j])) j += 1
    if (view[j] !== '{') return { ok: false, code }
    inserts.push(j + 1)
  }
  let out = code
  for (const at of inserts.reverse()) out = `${out.slice(0, at)} __tick();${out.slice(at)}`
  return { ok: true, code: out }
}

export const MAX_LOOP_ITERATIONS = 100_000

type RenderFn = (input: Record<string, unknown>) => unknown
const SHADOWED = ['window', 'document', 'globalThis', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'localStorage', 'sessionStorage', 'navigator', 'Date', 'performance', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'crypto', 'require', 'process', 'importScripts', 'Function']

/** Turn validated code into a callable. Only call after staticAgentCodeCheck passed. */
export function compileAgentCode(code: string): RenderFn {
  const guarded = instrumentLoops(code)
  if (!guarded.ok) throw new Error('every for-loop needs a { … } body')
  const body = guarded.code.replace(/export\s+default\s+function/, 'return function')
  // Every dangerous global is a parameter bound to undefined; Math.random is replaced.
  // eslint-disable-next-line no-new-func
  const factory = new Function(...SHADOWED, 'Math', '__tick', `"use strict";\n${body}`) as (...args: unknown[]) => RenderFn
  const safeMath = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(Object.getOwnPropertyNames(Math).map((k) => [k, (Math as unknown as Record<string, unknown>)[k]])), { random: undefined }))
  let ticks = 0
  const tick = () => { if (++ticks > MAX_LOOP_ITERATIONS) throw new Error(`loop ran more than ${MAX_LOOP_ITERATIONS.toLocaleString('en')} iterations in one frame`) }
  const inner = factory(...SHADOWED.map(() => undefined), safeMath, tick)
  if (typeof inner !== 'function') throw new Error('no component function')
  // While agent code runs, the Function constructor is unreachable through any
  // function's `.constructor` (the classic sandbox escape via computed keys).
  return (input) => {
    const proto = Function.prototype as unknown as { constructor: unknown }
    const original = Object.getOwnPropertyDescriptor(Function.prototype, 'constructor')!
    Object.defineProperty(Function.prototype, 'constructor', { value: undefined, configurable: true, writable: false })
    ticks = 0
    try { return inner(input) } finally { Object.defineProperty(Function.prototype, 'constructor', original); void proto }
  }
}

/** Build the tree for one t. Throws on disallowed tags/attrs or an exhausted node budget. */
export function renderAgentTree(fn: RenderFn, input: { t: number; seed: number; reducedMotion: boolean; props: Record<string, unknown> }): AgentNode {
  let budget = MAX_NODES
  const h = (tag: unknown, attrs: unknown, ...children: unknown[]): AgentNode => {
    if (--budget < 0) throw new Error('node budget exceeded')
    const name = String(tag)
    if (!TAGS.has(name)) throw new Error(`tag “${name}” is not allowlisted`)
    const clean: Record<string, string | number> = {}
    const a = (attrs && typeof attrs === 'object' ? attrs : {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(a)) {
      if (k === 'style' && v && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (!STYLE_KEYS.has(sk)) throw new Error(`style “${sk}” is not allowlisted`)
          if (typeof sv !== 'string' && typeof sv !== 'number') throw new Error(`style “${sk}” must be a string or number`)
          if (typeof sv === 'string' && /url\s*\(|expression|javascript:|#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(sv)) throw new Error(`style “${sk}” uses a forbidden value`)
          clean[`style.${sk}`] = typeof sv === 'number' ? Math.round(sv * 1e4) / 1e4 : sv
        }
      } else if (SVG_ATTRS.has(k)) {
        if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`attribute “${k}” must be a string or number`)
        if (typeof v === 'string' && /url\s*\(|javascript:|#[0-9a-f]{3,8}\b|rgba?\(/i.test(v)) throw new Error(`attribute “${k}” uses a forbidden value`)
        clean[k] = typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v
      } else if (k !== 'key') throw new Error(`attribute “${k}” is not allowlisted`)
    }
    const flat: Array<AgentNode | string> = []
    const push = (c: unknown) => {
      if (c === null || c === undefined || c === false || c === true) return
      if (Array.isArray(c)) { c.forEach(push); return }
      if (typeof c === 'string' || typeof c === 'number') { flat.push(String(c).slice(0, 400)); return }
      if (c && typeof c === 'object' && 'tag' in (c as object)) { flat.push(c as AgentNode); return }
      throw new Error('children must be h() nodes, strings or numbers')
    }
    push(children)
    return { tag: name, attrs: clean, children: flat }
  }
  const t = Math.min(1, Math.max(0, Number(input.t) || 0))
  const tree = fn(Object.freeze({ t, seed: input.seed >>> 0, reducedMotion: input.reducedMotion, props: Object.freeze({ ...input.props }), h, mulberry32, ease: AGENT_EASES, color: agentColor }))
  if (!tree || typeof tree !== 'object' || !('tag' in (tree as object))) throw new Error('the component must return an h() tree')
  return tree as AgentNode
}

function motionSignature(node: AgentNode): string {
  const own = MOTION_STYLE.map((k) => `${k}=${node.attrs[`style.${k}`] ?? node.attrs[k] ?? ''}`).join(';')
  return `${node.tag}[${own}](${node.children.map((c) => (typeof c === 'string' ? '' : motionSignature(c))).join(',')})`
}

const SAMPLE_T = [0, 0.13, 0.37, 0.5, 0.71, 0.9, 1]

/** Full validation: static rules, sandboxed execution, allowlist, identity, reduced motion. */
export function validateAgentCode(code: string, props: Record<string, unknown> = {}, seed = 7): { ok: true; fn: RenderFn } | { ok: false; rejections: AgentRejection[] } {
  const R = AGENT_CODE_RULES
  const statics = staticAgentCodeCheck(code)
  if (statics.length) return { ok: false, rejections: statics }
  let fn: RenderFn
  try { fn = compileAgentCode(code) } catch (e) { return { ok: false, rejections: [reject(R.runs, `does not compile: ${(e as Error).message}`)] } }
  const rejections: AgentRejection[] = []
  const reducedSigs = new Set<string>()
  for (const t of SAMPLE_T) {
    for (const reducedMotion of [false, true]) {
      let a: AgentNode, b: AgentNode
      try {
        a = renderAgentTree(fn, { t, seed, reducedMotion, props })
        b = renderAgentTree(fn, { t, seed, reducedMotion, props })
      } catch (e) {
        const msg = (e as Error).message
        rejections.push(reject(/iterations in one frame|call stack/i.test(msg) ? R.loops : /allowlisted|budget|forbidden|must be/.test(msg) ? R.tree : R.runs, `t=${t}: ${msg}`))
        return { ok: false, rejections }
      }
      if (JSON.stringify(a) !== JSON.stringify(b)) { rejections.push(reject(R.pure, `t=${t}`)); return { ok: false, rejections } }
      if (reducedMotion) reducedSigs.add(motionSignature(a))
    }
  }
  if (reducedSigs.size > 1) rejections.push(reject(R.reduced, 'transforms/positions change over t while reducedMotion is true'))
  return rejections.length ? { ok: false, rejections } : { ok: true, fn }
}

/** One human line per rejection, quoting the rule. */
export function describeRejections(rejections: AgentRejection[]): string {
  return rejections.map((r) => `Rejected — rule “${r.rule}”: ${r.quote}${r.detail ? ` (${r.detail})` : ''}`).join('\n')
}

export function agentSlug(name: string): string {
  const base = String(name || 'animation').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'animation'
  return `gen-${base}`
}

export type AgentAnimationSpec = { name: string; kind: string; durationSec: number; code: string; props: Record<string, string | number | boolean>; ease: AgentEase }

/** Validate the addAnimation op payload (shape + code). Throws with quoted rules. */
export function readAgentAnimation(value: unknown): AgentAnimationSpec {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const name = String(raw.name || '').trim().slice(0, 60)
  if (!name) throw new Error('addAnimation needs a name')
  const kind = String(raw.kind || 'title').trim().slice(0, 30)
  const d = Number(raw.durationSec)
  if (!Number.isFinite(d)) throw new Error('addAnimation needs durationSec')
  const durationSec = Math.round(Math.min(AGENT_ANIM_MAX_SEC, Math.max(AGENT_ANIM_MIN_SEC, d)) * 100) / 100
  const ease = (String(raw.ease || 'ease-out') in AGENT_EASES ? String(raw.ease || 'ease-out') : 'ease-out') as AgentEase
  const props: Record<string, string | number | boolean> = {}
  if (raw.props && typeof raw.props === 'object' && !Array.isArray(raw.props)) {
    for (const [k, v] of Object.entries(raw.props as Record<string, unknown>).slice(0, 12)) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(k)) continue
      if (typeof v === 'string') props[k] = v.slice(0, 200)
      else if (typeof v === 'number' && Number.isFinite(v)) props[k] = v
      else if (typeof v === 'boolean') props[k] = v
    }
  }
  const code = String(raw.code || '')
  const result = validateAgentCode(code, props)
  if (!result.ok) throw new Error(describeRejections(result.rejections))
  return { name, kind, durationSec, code, props, ease }
}

/** Does this instruction ask for a NEW animation? Returns the requested length when it does. */
export function animationIntent(instruction: string): { durationSec: number } | null {
  const s = String(instruction || '')
  const explicit = /\b(new|write|create|custom|generate|design|code)\b[^.]{0,60}\b(animation|effect|title|intro|transition)\b/i.test(s)
  const shorthand = /\b[\w-]+\s+(title|animation|effect|text|intro)\s+\d+(?:\.\d+)?\s*(s|sec|secs|seconds?)\b/i.test(s)
  if (!explicit && !shorthand) return null
  const m = /(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?)\b/i.exec(s)
  const d = m ? Number(m[1]) : 2
  return { durationSec: Math.round(Math.min(AGENT_ANIM_MAX_SEC, Math.max(AGENT_ANIM_MIN_SEC, d)) * 100) / 100 }
}

/** The user explicitly asked for something the rules forbid → refuse up front, quoting the rule. */
export function forbiddenRequest(instruction: string): AgentRejection | null {
  const s = String(instruction || '')
  const R = AGENT_CODE_RULES
  if (/\bDate\.now\b|\bnew Date\b|performance\.now|setInterval|setTimeout|requestAnimationFrame|wall.?clock|current time/i.test(s)) return reject(R.onlyT, 'requested in the instruction')
  if (/Math\.random|\bunseeded\b/i.test(s)) return reject(R.seeded, 'requested in the instruction')
  if (/\bfetch\b|\bapi call\b|websocket|load (?:a |an )?(?:script|url)/i.test(s)) return reject(R.network, 'requested in the instruction')
  if (/\bdocument\.|\bwindow\.|localStorage/i.test(s)) return reject(R.dom, 'requested in the instruction')
  return null
}

/**
 * Validate in a Web Worker with a hard timeout (renderer only). A timeout is a
 * rejection quoting the loop rule; environments without workers (Node checks)
 * fall back to the in-thread validator, which is itself loop/stack guarded.
 */
export function validateAgentCodeIsolated(code: string, props: Record<string, unknown> = {}, timeoutMs = 2000): Promise<{ ok: true } | { ok: false; rejections: AgentRejection[] }> {
  if (typeof Worker === 'undefined') {
    const r = validateAgentCode(code, props)
    return Promise.resolve(r.ok ? { ok: true } : { ok: false, rejections: r.rejections })
  }
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./agentCode.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      const r = validateAgentCode(code, props)
      resolve(r.ok ? { ok: true } : { ok: false, rejections: r.rejections })
      return
    }
    const timer = setTimeout(() => { worker.terminate(); resolve({ ok: false, rejections: [reject(AGENT_CODE_RULES.loops, `validation exceeded ${timeoutMs} ms`)] }) }, timeoutMs)
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); resolve(e.data) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); resolve({ ok: false, rejections: [reject(AGENT_CODE_RULES.runs, 'validator worker crashed')] }) }
    worker.postMessage({ code, props })
  })
}
