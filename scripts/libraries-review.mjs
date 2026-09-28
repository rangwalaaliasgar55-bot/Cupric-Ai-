#!/usr/bin/env node
// `libraries review`: a read-only scan of the Cupric repo for places where each
// Libraries.dev library fits. The signals come from the skill's own
// "Detecting a fit in a codebase" tables (resources/libraries-dev/references/*).
// Nothing is edited. The report goes to resources/libraries-dev/review.json and
// the Library → Libraries tab shows it.
//
//   node scripts/libraries-review.mjs           # write the report
//   node scripts/libraries-review.mjs --print   # also print it
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath, not new URL(import.meta.url).pathname: on Windows the URL
// path is '/C:/a/b/scripts/x.mjs', which resolves to the bogus root '\C:\a\b'
// and every read below throws ENOENT. The release build runs on windows-latest.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillDir = path.join(root, 'resources', 'libraries-dev')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

/* ——— inventory (from SKILL.md quick-reference table — never invented) ——— */
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
const rows = [...skill.matchAll(/^\| \*\*(.+?)\*\* \| `(.+?)` \| `(.+?)` \| (.+?) \| \[(.+?)\]\(references\/(.+?)\) \|$/gm)]
// npm metadata verified with `npm view <pkg> license version repository.url` on 2026-09-28.
const NPM = {
  'border-beam': { version: '1.4.1', license: 'MIT', homepage: 'https://libraries.dev/beam', repository: 'https://github.com/Jakubantalik/Libraries.dev', cost: 'light' },
  'thinking-orbs': { version: '0.3.2', license: 'MIT', homepage: 'https://libraries.dev/orbs', repository: 'https://github.com/Jakubantalik/Libraries.dev', cost: 'light' },
  'liquid-gooey': { version: '0.2.2', license: 'MIT', homepage: 'https://libraries.dev/gooey', repository: 'https://github.com/Jakubantalik/Libraries.dev', cost: 'moderate' },
  'voice-glow': { version: '0.2.1', license: 'MIT', homepage: 'https://libraries.dev', repository: 'https://github.com/Jakubantalik/Libraries.dev', cost: 'moderate' },
  'bot-avatars': { version: '0.1.1', license: 'MIT', homepage: 'https://libraries.dev/bots', repository: 'https://github.com/Jakubantalik/Libraries.dev', cost: 'moderate' },
  'metal-fx': { version: '2.0.11', license: 'MIT', homepage: 'https://metal.jakubantalik.com', repository: 'https://github.com/Jakubantalik/metal-fx', cost: 'webgl' },
  'img-fx': { version: '0.5.1', license: 'MIT', homepage: 'https://image.jakubantalik.com', repository: 'https://github.com/Jakubantalik/img-fx', cost: 'webgl', peer: 'three' },
}
const libraries = rows.map((m) => ({
  name: m[1], package: m[2], component: m[3], useFor: m[4], reference: `resources/libraries-dev/references/${m[6]}`,
  installed: Boolean(pkg.dependencies?.[m[2]] || pkg.devDependencies?.[m[2]]),
  ...(NPM[m[2]] ?? { license: 'unknown' }),
}))
if (libraries.length !== 7) throw new Error(`Expected the skill to list 7 libraries, parsed ${libraries.length}. Is resources/libraries-dev/SKILL.md intact?`)

/* ——— signals (condensed from each reference's detection table) ——— */
const SIGNALS = [
  { pkg: 'thinking-orbs', target: 'Waiting state', re: /Thinking…|Thinking\.\.\.|isThinking|Loader2[^\n]*animate-spin|typing-dots|nf-typing|Planning…|Searching|Generating/, variant: 'state from the activity (composing / searching / weaving), size 20 inline', why: 'An AI wait of 2 s or more gets an orb next to its label (skill decision rule).' },
  { pkg: 'border-beam', target: 'Chat input', re: /<textarea[^>]*(Ask|Message|prompt)|placeholder="Ask|onSubmit=\{[^}]*send/i, variant: 'md beam, active while the reply is pending', why: 'Composers with replies over 3 s get a beam on the element doing the work.' },
  { pkg: 'border-beam', target: 'Search input (loads after submit)', re: /type="search"|aria-label="(Stock|Pack) search"|isSearching|placeholder="Search/i, variant: 'line beam, active from submit until results', why: 'An input that loads after you submit gets a line beam.' },
  { pkg: 'voice-glow', target: 'Mic button', re: /getUserMedia|MediaRecorder|SpeechRecognition|<Mic\b|MicOff|isListening|Transcribing/, variant: 'VoiceBeam around the recording UI (stream while listening, processing while transcribing)', why: 'The skill maps anything voice or recording related to Voice.' },
  { pkg: 'bot-avatars', target: 'Bot avatar', re: /role === 'gemini'|role: 'assistant'|AssistantMessage|<Bot\b|BotIcon|Sparkles[^\n]*assistant/, variant: "BotAvatar size 32, state 'working' while the reply is pending", why: 'Bot/agent avatars get a BotAvatar driven by real status.' },
  { pkg: 'img-fx', target: 'Image placeholder', re: /animate-pulse|<Skeleton|posterUrl|aspect-square bg-|placeholderOnly|isGenerating/, variant: "ImageGeneration preset 'sweep-gradient', strength 0.5", why: 'Images that are generated or lazy-loaded get Image placeholders.' },
  { pkg: 'metal-fx', target: 'Primary button', re: /Upgrade|Get Pro|Go Pro|variant="primary"[^\n]*(Render|Export)|<Badge[^>]*>\s*(New|Beta|Pro)\b/, variant: 'MetalFx button variant on ONE selling CTA, or MetalBadge on a New/Pro badge', why: 'Selling CTAs and New/Pro badges get Liquid metal, one per page.' },
  { pkg: 'liquid-gooey', target: 'Plus menu / segmented control', re: /aria-expanded=\{[^}]*(shapeOpen|loaderOpen|menu)|role="tablist"|layoutId=/, variant: "Liquid 'morph' plus menu or 'move' indicator/thumb", why: 'Plus menus, sliding indicators and slider thumbs match Gooey signals.' },
]
// Cupric-specific UI surfaces the user asked about, with the honest verdict.
const SURFACE_HINTS = [
  { file: 'src/screens/studio/StudioTimeline.tsx', target: 'Studio timeline controls', pkg: null, why: 'Scrubbing and trimming are sub-2 s direct-manipulation interactions. The skill says to add nothing under 2 s.' },
  { file: 'src/screens/library/PackBrowser.tsx', target: 'Resource cards', pkg: 'img-fx', why: 'Remote uselayouts posters load lazily; an Image placeholder could replace the blank area. Watch the WebGL cost across many cards.' },
  { file: 'src/components/ProgressBar.tsx', target: 'Progress indicators', pkg: null, why: 'Determinate progress. The skill says to use a progress bar, not an orb.' },
]

const RISK = {
  light: 'Low: a 2D canvas or CSS layer. Check it pauses when hidden.',
  moderate: 'Medium: a per-frame canvas/SVG filter. Keep it to one instance per area.',
  webgl: 'Higher: WebGL context per instance, so avoid it in long lists. Every metal element on a page shares one colour.',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name)
    if (/node_modules|\.test\.|framecn|lab\/components|engine-showcase|app\/|shims/.test(abs)) continue
    const st = statSync(abs)
    if (st.isDirectory()) walk(abs, out)
    else if (/\.(tsx)$/.test(name)) out.push(abs)
  }
  return out
}

const findings = []
for (const abs of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, abs).split(path.sep).join('/')
  const lines = readFileSync(abs, 'utf8').split('\n')
  const seen = new Set()
  for (const sig of SIGNALS) {
    const idx = lines.findIndex((l) => !/^\s*import\b/.test(l) && sig.re.test(l))
    if (idx < 0 || seen.has(sig.pkg + sig.target)) continue
    seen.add(sig.pkg + sig.target)
    const lib = libraries.find((l) => l.package === sig.pkg)
    const existing = lines[idx].trim().replace(/\s+/g, ' ').slice(0, 120)
    const already = lines.some((l) => l.includes(`from '${sig.pkg}'`))
    findings.push({
      file: rel, line: idx + 1, target: sig.target, existingComponent: existing, suggestedLibrary: lib.name, package: sig.pkg, variant: sig.variant,
      why: sig.why, risks: RISK[lib.cost] ?? 'Unknown', license: lib.license, status: already ? 'applied' : 'suggested',
    })
  }
}
// Placements already applied (a real import of the package), so the review shows what's live.
for (const abs of walk(path.join(root, 'src'))) {
  const rel = path.relative(root, abs).split(path.sep).join('/')
  const lines = readFileSync(abs, 'utf8').split('\n')
  for (const lib of libraries) {
    const idx = lines.findIndex((l) => l.includes(`from '${lib.package}'`))
    if (idx < 0) continue
    const used = lines.findIndex((l, i) => i !== idx && l.includes(`<${lib.component}`))
    findings.push({ file: rel, line: (used >= 0 ? used : idx) + 1, target: 'Existing placement', existingComponent: lines[used >= 0 ? used : idx].trim().slice(0, 120), suggestedLibrary: lib.name, package: lib.package, variant: null, why: 'Already installed and rendered here.', risks: RISK[lib.cost], license: lib.license, status: 'applied' })
  }
}
for (const hint of SURFACE_HINTS) {
  const lib = hint.pkg ? libraries.find((l) => l.package === hint.pkg) : null
  findings.push({ file: hint.file, line: null, target: hint.target, existingComponent: null, suggestedLibrary: lib ? lib.name : 'None', package: hint.pkg, variant: null, why: hint.why, risks: lib ? RISK[lib.cost] : 'No change recommended', license: lib ? lib.license : null, status: lib ? 'suggested' : 'no-fit' })
}
// Impact order: waiting states first, then inputs/voice, then decoration (skill rule 3).
const ORDER = ['thinking-orbs', 'border-beam', 'voice-glow', 'bot-avatars', 'img-fx', 'liquid-gooey', 'metal-fx', null]
findings.sort((a, b) => ORDER.indexOf(a.package) - ORDER.indexOf(b.package) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))

const report = {
  generatedBy: 'scripts/libraries-review.mjs (read-only)',
  skill: 'Jakubantalik/Libraries.dev (installed with: npx skills add Jakubantalik/Libraries.dev)',
  stack: { framework: 'React ' + (pkg.dependencies?.react ?? '?') + ' + Vite (Electron renderer)', styling: 'Tailwind v4 + DESIGN.md tokens', typescript: true, ssr: false, webgl: 'available in Electron/Chromium' },
  libraries,
  findings,
  counts: { findings: findings.length, applied: findings.filter((f) => f.status === 'applied').length, files: new Set(findings.map((f) => f.file)).size },
  footer: 'Run `libraries apply` on any line to install it.',
}
writeFileSync(path.join(skillDir, 'review.json'), `${JSON.stringify(report, null, 2)}\n`)
if (process.argv.includes('--print')) for (const f of findings) console.log(`${f.file}${f.line ? `:${f.line}` : ''} — ${f.target} → ${f.suggestedLibrary}${f.variant ? ` (${f.variant})` : ''} — ${f.why} [${f.status}]`)
console.log(`libraries review: ${libraries.length} libraries · ${findings.length} findings in ${report.counts.files} files · ${report.counts.applied} already applied (read-only; nothing edited)`)
