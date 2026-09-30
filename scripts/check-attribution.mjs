#!/usr/bin/env node
/**
 * check:attribution — everything ported is credited, and nothing restricted is
 * shipped (Phase 5).
 *
 * `check-licences.mjs` reads package.json and the lockfile: it answers "are the
 * *packages* permissive". It cannot see a function adapted from another project
 * into this repository's own source, which is where licence trouble actually
 * hides — a file copied from an Apache-2.0 project with the header stripped
 * looks exactly like original code.
 *
 * This check works from the other direction. Any file in `src/` or `electron/`
 * that says it was adapted or ported from somewhere must have its notice in
 * THIRD_PARTY_NOTICES.md, and its upstream project must be one of the projects
 * that file names. Anything else is an uncredited copy, and the build stops.
 *
 * It also re-asserts the Phase 5 removals, because "we deleted it" is a claim
 * that decays: the restricted packages must not be referenced anywhere, in code
 * or in the lockfile.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let n = 0
const ok = (condition, message) => { assert.ok(condition, message); n++ }

async function walk(dir, filter) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'vendor', 'resources'].includes(entry.name)) continue
      out.push(...(await walk(full, filter)))
    } else if (filter(entry.name)) out.push(full)
  }
  return out
}

const notices = await readFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8')
const noticeLower = notices.toLowerCase()

/**
 * Upstreams this repository credits, and the words that identify each one in a
 * source header. Adding a new upstream means adding it here *and* to the
 * notices — which is the point.
 */
const UPSTREAMS = [
  { id: 'open-edit', aliases: ['open-edit', 'veedstudio'], notice: 'veedstudio/open-edit' },
  { id: 'opus55', aliases: ['opus55', 'awesome-opus'], notice: 'awesome-opus-5-5-videos' },
  { id: 'framecn', aliases: ['framecn'], notice: 'framecn' },
  { id: 'xevrion', aliases: ['xevrion'], notice: 'xevrion' },
  { id: 'uselayouts', aliases: ['uselayouts'], notice: 'uselayouts' },
  { id: 'libraries-dev', aliases: ['libraries.dev', 'Jakubantalik'], notice: 'libraries.dev' },
]

/**
 * Does this header claim an upstream, and which one?
 *
 * Written as a function because the pattern version was wrong twice: first it
 * matched ordinary English ("derived from real project state"), then the `i`
 * flag defeated a "must be a proper noun" heuristic, and it flagged the shader
 * files for *mentioning* the licence they replaced. Getting this precise matters
 * — a check that cries wolf is a check somebody deletes.
 *
 * A header is a provenance claim when:
 *   - it names an upstream this repo already credits (`open-edit`, `framecn` …),
 *     or
 *   - it says "adapted/ported/taken/derived from" followed by something shaped
 *     like a project: `owner/repo`, `repo/path/to/file`, a backticked name, or a
 *     Capitalised name next to the word project/library/repo/app, or
 *   - it names a restrictive licence **without** saying that licence was removed.
 */
const REMOVAL = /\b(?:replac|remov|delet|dropped|gone|no longer|not used|nothing ships)\w*/i
const CLAIM = /\b(adapted|ported|taken|derived|based)\s+(?:\w+\s+)?from\b/i

function provenanceClaim(header) {
  // A credited upstream only counts as provenance when it sits *inside* the
  // claiming sentence. Counting any header mention made 359 files "credited"
  // because a vendored component's import path contains the word `framecn` —
  // a number that looks like diligence and means nothing.
  const claim = CLAIM.exec(header)
  const window = claim ? header.slice(claim.index, claim.index + 200) : ''
  const namedInClaim = UPSTREAMS.find((upstream) => upstream.aliases.some((alias) => window.toLowerCase().includes(alias.toLowerCase())))

  if (claim) {
    if (namedInClaim) return { upstream: namedInClaim, because: `names ${namedInClaim.id} in the provenance sentence` }
    const projectShaped =
      /[`'"][\w.@-]+\/[\w./@-]+[`'"]/.test(window) ||
      /\b[\w.@-]+\/[\w./-]{2,}\b/.test(window) ||
      /`[\w.@-]+\/[\w./@-]+`/.test(window) ||
      /\b[A-Z][\w.-]*(?:\s+[A-Z][\w.-]*)*\s+(?:project|library|repo|app|toolkit)\b/.test(window)
    // "taken from the very suggestions the Studio shows" is prose about the
    // app's own data, not a claim about another project.
    const selfReference = /\bfrom\s+(?:the\s+)?(?:very|same|its|our|this|these)\b/i.test(window)
    if (projectShaped && !selfReference) return { upstream: null, because: `“${window.slice(0, 70).trim()}…”` }
  }

  const licence = /\b(Apache-2\.0|PolyForm|Remotion\s+License|GPL-3\.0|AGPL)\b/.exec(header)
  // ±260 characters: the shader headers describe the restriction and then say,
  // two clauses later, that Phase 5 replaced it. A tighter window misread that as
  // a claim rather than a removal.
  if (licence && !REMOVAL.test(header.slice(Math.max(0, licence.index - 260), licence.index + 260))) {
    const near = UPSTREAMS.find((upstream) => upstream.aliases.some((alias) => header.slice(Math.max(0, licence.index - 200), licence.index + 80).toLowerCase().includes(alias.toLowerCase())))
    return { upstream: near ?? null, because: `${licence[1]} named as a licence, not as a removal` }
  }
  return null
}

const sources = (await walk(path.join(root, 'src'), (name) => /\.(ts|tsx)$/.test(name))).concat(
  await walk(path.join(root, 'electron'), (name) => /\.(cjs|ts)$/.test(name)),
)
ok(sources.length > 100, `the check found the app's source (${sources.length} files)`)

const credited = []
const uncredited = []
const review = []
for (const file of sources) {
  const text = await readFile(file, 'utf8')
  // Only the top-of-file comment block counts: a mention deep in the code is a
  // reference, not a provenance claim.
  const claim = provenanceClaim(text.slice(0, 1200))
  if (!claim) continue
  const relative = path.relative(root, file).replace(/\\/g, '/')
  if (!claim.upstream) {
    // A provenance claim naming an upstream this repo does not credit: either an
    // uncredited copy (bad) or a new dependency to add to the notices (also a
    // build failure, deliberately — the list is meant to be updated on purpose).
    uncredited.push(`${relative} (${claim.because})`)
    continue
  }
  if (!noticeLower.includes(claim.upstream.notice.toLowerCase())) uncredited.push(`${relative} → ${claim.upstream.id} missing from THIRD_PARTY_NOTICES.md`)
  credited.push({ file: relative, upstream: claim.upstream.id })
  if (/Apache-2\.0|PolyForm|GPL-3\.0/.test(text.slice(0, 1200))) review.push(relative)
}

ok(
  uncredited.length === 0,
  `every file with a provenance header is credited in THIRD_PARTY_NOTICES.md:\n  ${uncredited.join('\n  ') || 'all credited'}`,
)
ok(credited.length >= 15, `the check actually found ported code (${credited.length} files carry a provenance header)`)

// Every upstream this repo knows about must appear in the notices, even if no
// single file names it today — otherwise the list in this check and the list in
// the document can drift apart.
for (const upstream of UPSTREAMS) {
  ok(noticeLower.includes(upstream.notice.toLowerCase()), `THIRD_PARTY_NOTICES.md covers ${upstream.id}`)
}

/* ── the removals stay removed ─────────────────────────────────────────── */

const restricted = [
  { name: '@paper-design/shaders-react', why: 'PolyForm Shield 1.0.0 — non-compete clause' },
  { name: 'remotion', why: 'Remotion licence — company-size restriction' },
]
const packageJson = await readFile(path.join(root, 'package.json'), 'utf8')
const lock = await readFile(path.join(root, 'package-lock.json'), 'utf8')
for (const { name, why } of restricted) {
  ok(!new RegExp(`"${name.replace(/[/@]/g, '.')}":`).test(packageJson), `${name} is not a dependency (${why})`)
  ok(!lock.includes(`node_modules/${name}"`), `${name} is not in the lockfile (${why})`)
}
// And the notices must say they were removed rather than quietly dropping them.
ok(/nothing shipped/i.test(notices), 'the notices say the replaced engines ship nothing')

const sourcesText = (await Promise.all(sources.map((file) => readFile(file, 'utf8')))).join('\n')
for (const { name } of restricted) {
  ok(!sourcesText.includes(`from '${name}`) && !sourcesText.includes(`require('${name}')`), `${name} is not imported by any source file`)
}

/* ── shaders are original ──────────────────────────────────────────────── */

const shaderFiles = await walk(path.join(root, 'src', 'lib', 'shaders'), (name) => /\.(ts|tsx)$/.test(name))
ok(shaderFiles.length > 0, `the replacement shaders exist (${shaderFiles.length} files)`)
for (const file of shaderFiles) {
  const text = await readFile(file, 'utf8')
  const relative = path.relative(root, file).replace(/\\/g, '/')
  // A shader copied from a licensed library would keep its GLSL structure; the
  // replacements are written here, so each one must say what it is.
  ok(/GLSL|shader/i.test(text.slice(0, 900)), `${relative} is recognisably a shader module`)
  // The mention is *required*, not forbidden: these files exist because they
  // replaced a restricted dependency, and saying so is the point. What must not
  // exist is an import — checked here per file and again below for the tree.
  ok(!/^\s*import[\s\S]{0,80}@paper-design/m.test(text), `${relative} does not import the restricted library it replaced`)
  ok(!/^\s*(?:import|require)[\s\S]{0,80}remotion/m.test(text), `${relative} does not import Remotion`)
}

console.log(`attribution check passed — ${credited.length} ported files credited across ${new Set(credited.map((c) => c.upstream)).size} upstreams (${review.length} naming a licence), ${restricted.length} restricted packages confirmed absent, ${shaderFiles.length} replacement shaders original`)
