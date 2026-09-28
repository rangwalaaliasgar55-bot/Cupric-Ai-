#!/usr/bin/env node
/**
 * check:ui-audit — DESIGN.md rules for app UI (src/app-shell, src/screens,
 * src/components; the vendored UI Lab and engine showcases are excluded).
 *
 * Rules:
 *   raw-hex        #RRGGBB / #RGB in className or style of app UI (tokens only)
 *   motion         motion transitions with type:'spring' / stiffness / damping
 *                  (use EASE_SOFT, or EASE_SPRING on the six moments)
 *   button-name    <button> / <Button> whose only child is an icon and that has
 *                  no aria-label / title / visible text
 *   disabled-help  disabled control with no title / aria-describedby / nearby
 *                  helper text in the same element
 *   reduced-motion file animates (motion.* animate/initial or CSS animate-*)
 *                  but never consults reduced motion
 *   video-tokens   VIDEO_TOKENS in homeKit.ts must equal --color-video-* in @theme
 *
 * Existing debt is recorded per file and rule in scripts/ui-audit-baseline.json.
 * The check fails when any file gets WORSE than its baseline, so debt can only
 * go down. Run with --update-baseline after fixing debt to lock in the gain.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['src/app-shell', 'src/screens', 'src/components']
const EXCLUDE = [/src\/components\/lab\//, /src\/components\/ui\//, /\.worker\.ts$/]
const baselinePath = path.join(root, 'scripts/ui-audit-baseline.json')

async function walk(dir) {
  const out = []
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...(await walk(rel)))
    else if (/\.tsx$/.test(e.name) && !EXCLUDE.some((re) => re.test(rel))) out.push(rel)
  }
  return out
}

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/.*$/gm, '$1')

function audit(src) {
  const code = strip(src)
  const hits = { 'raw-hex': 0, motion: 0, 'button-name': 0, 'disabled-help': 0, 'reduced-motion': 0 }
  // raw hex inside className="…" / className={`…`} / style={{…}}
  for (const m of code.matchAll(/className=(?:"[^"]*"|\{`[^`]*`\})/g)) if (/#[0-9a-fA-F]{3,8}\b/.test(m[0])) hits['raw-hex']++
  for (const m of code.matchAll(/style=\{\{[^}]*\}\}/g)) if (/['"`]#[0-9a-fA-F]{3,8}['"`]/.test(m[0])) hits['raw-hex']++
  for (const m of code.matchAll(/transition=\{\{[^}]*\}\}/g)) if (/type:\s*['"]spring['"]|stiffness|damping/.test(m[0])) hits.motion++
  // Buttons: opening tag + children up to the close.
  for (const m of code.matchAll(/<(button|Button)\b([^>]*?)>([\s\S]*?)<\/\1>/g)) {
    const [, , attrs, children] = m
    const named = /aria-label=|title=|aria-labelledby=/.test(attrs)
    const text = children.replace(/<[^>]+\/>/g, '').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, (x) => (/['"`][A-Za-z]/.test(x) || /\w+\s*\?/.test(x) || /^\{[a-z][\w.?]*\}$/.test(x) ? 'x' : '')).trim()
    if (!named && !text) hits['button-name']++
    if (/\bdisabled(=|\s|$)/.test(attrs) && !/title=|aria-describedby=|aria-disabled/.test(attrs)) hits['disabled-help']++
  }
  // motion.* and animate-* utilities are covered globally (checked below);
  // per file, flag hand-rolled CSS animations that ignore reduced motion.
  const animates = /animation:\s*['"`]?[a-z]/.test(code) || /@keyframes/.test(code)
  const consults = /useReducedMotion|reducedMotion|prefers-reduced-motion|motion-safe|motion-reduce|reduced\b/.test(code)
  if (animates && !consults) hits['reduced-motion']++
  return hits
}

const files = (await Promise.all(DIRS.map(walk))).flat().sort()
const report = {}
for (const f of files) {
  const hits = audit(await readFile(path.join(root, f), 'utf8'))
  const nonzero = Object.fromEntries(Object.entries(hits).filter(([, v]) => v > 0))
  if (Object.keys(nonzero).length) report[f] = nonzero
}

// Video palette tokens must mirror @theme exactly.
const failures = []
{
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8')
  const kit = await readFile(path.join(root, 'src/lib/studio/homeKit.ts'), 'utf8')
  const block = kit.match(/export const VIDEO_TOKENS = \{([\s\S]*?)\}/)?.[1] ?? ''
  for (const [, name, hex] of block.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) {
    const theme = css.match(new RegExp(`--color-video-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
    if (!theme || theme.toUpperCase() !== hex.toUpperCase()) failures.push(`video-tokens: VIDEO_TOKENS.${name} ${hex} ≠ @theme ${theme ?? 'missing'}`)
  }
  const design = await readFile(path.join(root, 'DESIGN.md'), 'utf8')
  for (const [, name] of block.matchAll(/(\w+):\s*'#/g)) if (!design.includes(`--color-video-${name}`)) failures.push(`video-tokens: --color-video-${name} is not documented in DESIGN.md`)
}

// Global reduced-motion coverage.
{
  const layout = await readFile(path.join(root, 'src/app-shell/AppLayout.tsx'), 'utf8')
  if (!/<MotionConfig reducedMotion="user">/.test(layout)) failures.push('reduced-motion: AppLayout must wrap the app in <MotionConfig reducedMotion="user">')
  const css = await readFile(path.join(root, 'src/styles.css'), 'utf8')
  if (!/prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.animate-spin[\s\S]*?animation: none/.test(css)) failures.push('reduced-motion: styles.css must stop animate-* utilities under prefers-reduced-motion')
}

if (process.argv.includes('--update-baseline')) {
  await writeFile(baselinePath, JSON.stringify(report, null, 2) + '\n')
  console.log(`ui-audit baseline written (${Object.keys(report).length} files with debt)`)
  process.exit(0)
}

let baseline = {}
try { baseline = JSON.parse(await readFile(baselinePath, 'utf8')) } catch { /* first run */ }
const totals = {}
for (const [f, hits] of Object.entries(report)) {
  for (const [rule, n] of Object.entries(hits)) {
    totals[rule] = (totals[rule] ?? 0) + n
    const allowed = baseline[f]?.[rule] ?? 0
    if (n > allowed) failures.push(`${rule}: ${f} has ${n} (baseline ${allowed})`)
  }
}
let improved = 0
for (const [f, hits] of Object.entries(baseline)) for (const [rule, n] of Object.entries(hits)) if ((report[f]?.[rule] ?? 0) < n) improved++

if (failures.length) {
  console.error('ui-audit FAILED:')
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`ui-audit passed — ${files.length} files; remaining recorded debt: ${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${improved ? `; ${improved} entries now better than baseline (run --update-baseline)` : ''}`)
