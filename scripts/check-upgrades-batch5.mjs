// Upgrades batch 5: code-generated films (PR #20 shapes) import as full native
// timed typography; empty media slots render + fill; kinetic brand film recipe.
import { build } from 'esbuild'
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const out = path.resolve('.check-upgrades-batch5.mjs')
await build({ stdin: { contents: ["export * as sp from './src/lib/studio/sourceProject'", "export * as sf from './src/lib/studio/sourceFilm'", "export * as gp from './src/lib/studio/generatedPackage'", "export * as pe from './src/lib/production/engine'", "export * as bf from './src/lib/production/brandFilm'", "export * as docm from './src/lib/studio/doc'"].join('\n'), resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const m = await import(pathToFileURL(out).href).catch((e) => { rmSync(out, { force: true }); throw e })
rmSync(out, { force: true })
let n = 0
const ok = (c, msg) => { assert.ok(c, msg); n++ }
const read = (p) => readFileSync(p, 'utf8')
const noOverlap = (clips) => { const by = new Map(); for (const c of clips) { const l = by.get(c.track) ?? []; for (const o of l) if (c.startSec < o.startSec + o.durationSec - 1e-3 && o.startSec < c.startSec + c.durationSec - 1e-3) return `${c.name} × ${o.name} on track ${c.track}`; l.push(c); by.set(c.track, l) } return null }
const pkg = { path: 'package.json', text: '{"dependencies":{"react":"18","three":"0.160"},"devDependencies":{"vite":"5"}}' }

/* 1. React/KText shape (brand-film (1)) */
const jsx = [pkg,
  { path: 'src/film/ease.ts', text: 'export const DURATION = 6;\nexport const W = 1920;\nexport const H = 1080;\nexport const LIME = "#B6FF3B";' },
  { path: 'src/App.tsx', text: 'import { Hook, Directions } from "./film/Scenes";\nconst CHAPTERS = ["Hook", "Infinite Directions"];\nconst CH_T = [0, 3, 6];\nexport default function App() { return <div id="root" /> }' },
  { path: 'src/film/Scenes.tsx', text: `export function Hook({ t }: { t: number }) {\n  if (t > 3.1) return null;\n  return (<>\n    <Center><KText text="CREATE." t={t} at={0.85} out={1.62} size={320} weight={700} variant="depth" /></Center>\n    <Center y={-92}><KText text="WITH INTELLIGENCE." t={t} at={1.78} out={2.62} size={150} weight={600} variant="blur" /></Center>\n    <HudLabel x={80} y={70} text="001 — GENESIS" o={win2(t, 0.6, 2.8)} />\n  </>);\n}\nexport function Directions({ t }: { t: number }) {\n  if (t < 3.2 || t > 6.1) return null;\n  return (<><Center><KText text="ONE IDEA." t={t} at={3.3} out={4.2} size={230} weight={700} /></Center></>);\n}` },
]
const p1 = m.sp.detectSourceProject(jsx, '<div id="root"></div>')
ok(p1 && p1.texts.length >= 4, `JSX film: timed texts found (${p1?.texts.length})`)
const create = p1.texts.find((t) => t.text === 'CREATE.')
ok(create && create.startSec === 0.85 && create.endSec > 1.62 && create.endSec < 2.2 && create.sizePx === 320, 'KText at/out/size read exactly')
ok(p1.texts.find((t) => t.text === 'WITH INTELLIGENCE.').y < 0.5, '<Center y={-92}> becomes a position above centre')
ok(p1.texts.find((t) => t.text === '001 — GENESIS').role === 'label', 'HUD label recognised as a label')
const imp1 = m.sp.sourceProjectToClips(p1, { trackCount: 3 }, 0, (x) => `${x}-${Math.random()}`)
const tx = imp1.clips.filter((c) => c.kind === 'text')
ok(tx.length >= 4 && tx.every((c) => c.text && c.fontSizePct > 0 && c.x >= 0 && c.x <= 1), 'texts become native editable text clips')
ok(tx.find((c) => c.text === 'CREATE.').fontSizePct > 20, 'film size carried over (320px → ~30% frame height, clamped)')
ok(!imp1.clips.some((c) => c.kind === 'overlay'), 'no flattened scene-card pictures when real text exists')
ok(noOverlap(imp1.clips) === null, `no overlapping clips on a track: ${noOverlap(imp1.clips)}`)
ok(imp1.clips.some((c) => c.kind === 'background'), 'Three.js layer → native swappable backdrop')

/* 2. Canvas engine with dispatch + progress windows (brand-film.zip shape) */
const canvas = [pkg,
  { path: 'src/App.tsx', text: `const WIDTH = 1920;\nconst HEIGHT = 1080;\nconst scenes = [\n  { start: 0, end: 3, label: "THE HOOK" },\n  { start: 3, end: 6, label: "BUILD FASTER" },\n];\nfunction trackedText(ctx, text, x, y, size, color, tracking = 0, align = "center", weight = 500, opacity = 1) { ctx.fillText(text, x, y); }\nfunction drawHook(ctx, p, t) {\n  const centerX = WIDTH / 2; const centerY = HEIGHT / 2;\n  trackedText(ctx, "CREATE.", centerX, centerY - 28, 144, "#fff", 2, "center", 700, smooth(p, 0.34, 0.6));\n}\nfunction drawFast(ctx, p, t) {\n  trackedText(ctx, "FASTER.", 960, 900, 96, "#fff", 2, "center", 700, smooth(p, 0.2, 0.5));\n}\nfunction frame(ctx, i, p, time) { switch (i) {\n    case 0: drawHook(ctx, p, time); break;\n    case 1: drawFast(ctx, p, time); break;\n  } }\nexport default function App() { return <canvas /> }` },
  { path: 'src/main.tsx', text: 'import App from "./App"' },
]
const p2 = m.sp.detectSourceProject(canvas, '<div id="root"></div>')
const fast = p2?.texts.find((t) => t.text === 'FASTER.')
ok(fast && Math.abs(fast.startSec - 3.6) < 0.01 && fast.endSec === 6, `switch dispatch + smooth(p, a, b) → chapter-local window held to the cut (${fast?.startSec}-${fast?.endSec})`)
ok(Math.abs(p2.texts.find((t) => t.text === 'CREATE.').y - 512 / 1080) < 0.01, 'centerY - 28 evaluated safely')

/* 3. GSAP timeline with no chapter map (brand-film (3) shape) — used to be refused */
const gsap = [pkg,
  { path: 'src/App.tsx', text: `import gsap from "gsap";\nexport default function App() {\n  useEffect(() => { const tl = gsap.timeline();\n    tl.fromTo('#text-create', { opacity: 0 }, { opacity: 1 }, 1.2);\n    tl.to('#text-create', { opacity: 0, duration: 0.5 }, 2.1);\n    tl.fromTo('#text-idea', { opacity: 0 }, { opacity: 1 }, 3.4);\n    tl.fromTo('#text-brand', { opacity: 0 }, { opacity: 1 }, 6);\n  }, []);\n  return (<div><div id="text-create">CREATE<span>.</span></div><div id="text-idea">ONE IDEA.</div><div id="text-brand">CUPRIC AI</div></div>);\n}` },
  { path: 'src/main.tsx', text: 'import App from "./App"' },
]
const p3 = m.sp.detectSourceProject(gsap, '<div id="root"></div>')
ok(p3 && p3.chapters.length >= 2, 'GSAP film without chapter map is accepted, chapters built from its text')
ok(p3.texts.find((t) => t.text === 'CREATE.')?.startSec === 1.2 && p3.texts.find((t) => t.text === 'CREATE.').endSec === 2.6, 'GSAP position + fade-out read as the text window')

/* 4. isCopy rejects code */
ok(!m.sf.isCopy('0.2 && t') && !m.sf.isCopy('2d') && !m.sf.isCopy('translate(-50%,-50%)') && m.sf.isCopy('HUMAN INTENT.') && m.sf.isCopy('10×'), 'copy filter: code out, film copy in')

/* 5. The real PR #20 zips, when available locally */
const dir = process.env.PR20_DIR || '/tmp/pr20'
if (existsSync(dir)) {
  const zips = readdirSync(dir).filter((f) => f.endsWith('.zip'))
  for (const f of zips) {
    const g = await m.gp.readGeneratedPackage(new File([readFileSync(path.join(dir, f))], f))
    const p = m.sp.detectSourceProject(g.sources, g.html)
    ok(p && p.texts.length >= 15, `${f}: imports with ${p?.texts.length} timed text layers`)
    const imp = m.sp.sourceProjectToClips(p, { trackCount: 3 }, 0)
    ok(noOverlap(imp.clips) === null && imp.clips.every((c) => c.track < 24), `${f}: clips fit tracks without overlap`)
    ok(imp.clips.filter((c) => c.kind === 'text').length >= 15, `${f}: ${imp.clips.filter((c) => c.kind === 'text').length} native text clips (not just chapter titles)`)
  }
  console.log(`  (checked ${zips.length} PR #20 zips from ${dir})`)
} else console.log('  (PR #20 zips not present locally — synthetic fixtures only)')

/* 6. Empty media slot is drawn and fillable */
ok(/Add your media/.test(read('src/lib/studio/renderer.ts')), 'renderer paints an empty-slot panel inside the device screen')
const insp = read('src/screens/studio/StudioInspector.tsx')
ok(/Empty media slot/.test(insp) && /mediaId: handle\.id/.test(insp) && /registerFile\(file, clip\.mediaId \|\| undefined\)/.test(insp), 'inspector offers Add media for an empty slot and assigns a real media id')

/* 7. Kinetic brand film recipe */
ok(Math.abs(m.bf.BRAND_FILM_BEATS.reduce((s, b) => s + b.share, 0) - 1) < 1e-9 && m.bf.BRAND_FILM_BEATS.length === 14, '14 beats summing to the full duration')
const index = JSON.parse(read('resources/opus55/data/index.json'))
const intake = { ...m.pe.emptyIntake(), making: 'A 40 second cinematic brand film for Cupric AI', audience: 'builders', platform: 'YouTube', durationSec: 40, aspect: '16:9', cta: 'Start building at cupric.ai', referenceStyle: 'kinetic typography, dark, lime' }
const r = m.pe.runToApproval(index, intake)
ok(r.plan.skillId === 'kinetic-brand-film' && r.plan.shots.length === 14 && r.plan.shots.every((s) => s.typeShot), 'brand-film brief → type-led 14-shot plan')
ok(r.plan.decisions[0].area === 'Format' && /pull\/20/.test(r.plan.decisions[0].why), 'plan cites PR #20 as the learned source')
ok(r.plan.shots.find((s) => s.beat === 'Multiplier').onScreenText.startsWith('['), 'numeric claim never invented (placeholder)')
ok(r.plan.shots.find((s) => s.beat === 'Brand reveal').onScreenText === 'CUPRIC AI', 'brand name taken from the brief')
ok(!r.plan.unresolved.some((u) => /no footage/.test(u)), 'type-led shots are not flagged as missing footage')
let k = 0
const built = m.pe.planToDoc(m.docm.emptyStudioDoc(), r.plan, r.brief, { makeId: () => `b${k++}` })
ok(built.placeholders === 0 && built.doc.clips.some((c) => c.kind === 'background'), 'builds with a backdrop and zero media placeholders')
ok(built.doc.clips.filter((c) => c.kind === 'text').length >= 30, 'headlines + HUD labels + word cloud as native text clips')
ok(noOverlap(built.doc.clips) === null, `brand film build has no track overlaps: ${noOverlap(built.doc.clips)}`)
ok(built.doc.clips.every((c) => c.track < 24) && built.doc.trackCount <= 24, 'within track limit')
ok(JSON.stringify(m.pe.planToDoc(m.docm.emptyStudioDoc(), r.plan, r.brief, { makeId: (i) => `x${i}` }).doc) === JSON.stringify(m.pe.planToDoc(m.docm.emptyStudioDoc(), r.plan, r.brief, { makeId: (i) => `x${i}` }).doc), 'deterministic build')
const plain = m.pe.runToApproval(index, { ...intake, making: 'Launch reel for Penny budgeting app', referenceStyle: 'fast-cut' })
ok(plain.plan.skillId !== 'kinetic-brand-film', 'ordinary briefs keep the footage-led skills')
console.log(`upgrades batch5: ${n} assertions passed`)
