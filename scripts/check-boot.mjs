#!/usr/bin/env node
/**
 * check:boot — boot the real renderer, visit every view, and fail on any
 * uncaught error or blank screen (v0.10.1).
 *
 * 0.10.0 shipped a Studio that went white on mount: it assigned to
 * `window.cupric`, which contextBridge defines read-only, so the effect threw,
 * React unmounted the whole tree and nothing was left on screen. Web builds
 * never saw it because there is no bridge there. This check therefore always
 * boots WITH a read-only bridge, and drives every view with good, empty and
 * corrupt saved projects.
 *
 * Modes (picked automatically, or with --mode=electron|browser):
 *   electron  Launches Electron (or the packaged app in CUPRIC_BOOT_EXE, e.g.
 *             "release/win-unpacked/Cupric AI.exe") with a throwaway userData
 *             dir and `--remote-debugging-port`, writes projects.json fixtures
 *             into it and drives the window over CDP. The real preload and
 *             main process run. The matrix runs with --disable-gpu (the 0.10.0
 *             repro flags) plus a GPU-enabled pass.
 *   browser   When no Electron binary is available (sandboxes/CI without the
 *             binary download), serves dist/ over HTTP and drives headless
 *             Chrome/Chromium (CUPRIC_BOOT_CHROME=path) with a stub bridge
 *             defined exactly like contextBridge defines it: non-writable,
 *             non-configurable, frozen. Assigning to it throws the same
 *             TypeError the packaged app threw.
 *   Neither available → the check FAILS with instructions (never a silent pass).
 *
 * Runs scripts/check-project-schema.mjs first (pure, instant), then
 * asserts per (fixture × view):
 *   - zero uncaught exceptions / unhandled rejections / console "Uncaught"
 *   - the app is not blank (the shell rendered, main[data-view] present)
 *   - no error-boundary fallback appeared
 * Plus: a forced render throw shows the fallback card (Copy error + Go to
 * Library), Go to Library recovers, and a forced global error shows the
 * global card instead of blanking.
 *
 * Flags: --no-build (reuse dist/), --mode=..., --views=studio,library,
 *        --no-bundle-scan (debug: skip the static dist scan to see the runtime failure),
 *        --keep (leave the temp userData dir for inspection)
 */
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

const ALL_VIEWS = ['home', 'auto', 'review', 'brief', 'arena', 'footage', 'timeline', 'studio', 'motion', 'lab', 'render', 'library']
const VIEWS = opt('views') ? opt('views').split(',') : ALL_VIEWS
const PERSIST_VERSION = Number(/PERSIST_VERSION\s*=\s*(\d+)/.exec(readFileSync(path.join(root, 'src/state/migrate.ts'), 'utf8'))?.[1] ?? 2)
const READY_TIMEOUT_MS = 20_000
const SETTLE_MS = 900

/* ——— fixtures ————————————————————————————————————————————————————————— */

const iso = '2026-09-01T10:00:00.000Z'
function project(id, studio, extra = {}) {
  return {
    id,
    name: `Boot check ${id}`,
    createdAt: iso,
    updatedAt: iso,
    brief: { messages: [], draftRundown: null, lockedRundown: null },
    arenaAssets: [],
    footageAssets: [],
    timeline: [],
    renderJobs: [],
    studio,
    brandKit: { colors: ['#C8F542'], font: 'Inter', logoDataUrl: null },
    ...extra,
  }
}
const wrap = (state) => JSON.stringify({ state, version: PERSIST_VERSION })

const FIXTURES = {
  // Exactly the projects.json from the 0.10.0 bug report.
  'empty-project': (view) =>
    wrap({
      projects: [project('p-empty', { aspect: '9:16', fps: 30, backgroundId: 'lime-void', clips: [], trackCount: 3 })],
      activeProjectId: 'p-empty',
      view,
      theme: 'dark',
      soundCues: false,
      automationJobs: [],
    }),
  // Fresh install: nothing saved yet except the view.
  'no-projects': (view) => wrap({ projects: [], activeProjectId: null, view, theme: 'dark', soundCues: false, automationJobs: [] }),
  // Valid JSON, garbage shape, same persist version (so zustand skips migrate).
  'bad-shape': (view) =>
    wrap({
      projects: [
        {
          id: 'p-bad',
          name: 42,
          brief: null,
          arenaAssets: 'nope',
          footageAssets: null,
          timeline: null,
          renderJobs: [null],
          studio: {
            aspect: '3:2',
            fps: 7,
            backgroundId: 'missing-background',
            clips: [
              { kind: 'hologram', id: 'h1', track: 0, startSec: 0, durationSec: 2 },
              { kind: 'text', id: 't1', track: 9, startSec: -3, durationSec: 'x', text: null, fontFamily: 42 },
              { kind: 'text', id: 't2', track: 1, startSec: 0, durationSec: 2, text: 'Missing font', fontFamily: 'Totally Missing Font 3000' },
              null,
              'string-clip',
              { kind: 'video', id: 'v1', track: 0, startSec: 0, durationSec: 3, mediaId: 'gone' },
            ],
            trackCount: 0,
          },
        },
        'not-a-project',
        null,
      ],
      activeProjectId: 'p-bad',
      view,
      theme: 'sepia',
      soundCues: 'loud',
      automationJobs: null,
    }),
  // Zero tracks, empty everything.
  'zero-tracks': (view) =>
    wrap({
      projects: [project('p-zero', { aspect: '16:9', fps: 60, backgroundId: 'lime-void', clips: [], trackCount: 0 }, { timeline: [] })],
      activeProjectId: 'p-zero',
      view,
    }),
}
// Not JSON at all — one run, view comes from the default.
const CORRUPT_TEXT = '{"state": {"projects": [ this is not json'

/* ——— build ———————————————————————————————————————————————————————————— */

function run(cmd, cmdArgs, { env = {}, shell = process.platform === 'win32' } = {}) {
  // `npx` needs a shell on Windows; absolute executables must not get one
  // (a space in "C:\Program Files\nodejs\node.exe" would split the command).
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell, env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.status})`)
}

// Fast pure check first: projects.json schema validation (no browser needed).
run(process.execPath, [path.join(root, 'scripts/check-project-schema.mjs')], { shell: false })

if (!flag('no-build') && !process.env.CUPRIC_BOOT_EXE) {
  console.log('check:boot — building renderer (vite build)…')
  run('npx', ['vite', 'build', '--logLevel', 'warn'])
}
const distIndex = path.join(root, 'dist', 'index.html')
if (!process.env.CUPRIC_BOOT_EXE && !existsSync(distIndex)) throw new Error('dist/index.html is missing — run without --no-build')

// The minified bundle is where 0.10.0's `nt.cupric={...}` lived; scan it too.
if (!flag('no-bundle-scan') && existsSync(path.join(root, 'dist', 'assets'))) {
  const bad = []
  for (const f of readdirSync(path.join(root, 'dist', 'assets')).filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(path.join(root, 'dist', 'assets', f), 'utf8')
    const re = /[\w$\])]\.(cupric|northframe)\s*=(?!=)|delete\s+[\w$.]+\.(cupric|northframe)\b/g
    let m
    while ((m = re.exec(text))) bad.push(`${f}: …${text.slice(Math.max(0, m.index - 40), m.index + 60)}…`)
  }
  if (bad.length) {
    console.error('check:boot FAILED — the built bundle writes to the read-only bridge:\n' + bad.join('\n'))
    process.exit(1)
  }
}

/* ——— launch ——————————————————————————————————————————————————————————— */

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error('check:boot FAILED — puppeteer-core is not installed. Run `npm install`.')
  process.exit(1)
}

function electronBinary() {
  if (process.env.CUPRIC_BOOT_EXE) return existsSync(process.env.CUPRIC_BOOT_EXE) ? process.env.CUPRIC_BOOT_EXE : null
  try {
    const p = require('electron')
    return typeof p === 'string' && existsSync(p) ? p : null
  } catch {
    return null
  }
}

function chromeBinary() {
  const candidates = [
    process.env.CUPRIC_BOOT_CHROME,
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean)
  return candidates.find((c) => existsSync(c)) ?? null
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connectWithRetry(browserURL, child, timeoutMs = 30_000) {
  const until = performance.now() + timeoutMs
  let lastErr
  while (performance.now() < until) {
    if (child && child.exitCode !== null) throw new Error(`app exited early (code ${child.exitCode})`)
    try {
      return await puppeteer.connect({ browserURL, defaultViewport: null })
    } catch (err) {
      lastErr = err
      await sleep(400)
    }
  }
  throw new Error(`could not connect to ${browserURL}: ${lastErr?.message}`)
}

/**
 * Stub bridge for browser mode. Defined the way contextBridge defines it —
 * non-writable, non-configurable, frozen — so `window.cupric = …` throws
 * "Cannot assign to read only property 'cupric'" exactly as in 0.10.0.
 * Saved state lives in localStorage under __boot_state (the runner seeds it).
 */
const STUB_BRIDGE = `(() => {
  const ok = (v) => Promise.resolve(v)
  const answers = {
    'state:load': () => ok(localStorage.getItem('__boot_state')),
    'state:save': (p) => { localStorage.setItem('__boot_state', typeof p === 'string' ? p : p && p.value); return ok(true) },
    'state:clear': () => { localStorage.removeItem('__boot_state'); return ok(true) },
    'state:recoveryInfo': () => ok({ previousSessionCrashed: false, recoveredFrom: null }),
    'state:listVersions': () => ok([]),
    'settings:get': () => ok({ hasKey: false, provider: 'gemini', model: '', hardwareEncoding: 'auto' }),
    'settings:hasKey': () => ok(false),
    'log:write': () => ok(true),
    'media:status': () => ok({ ffmpeg: false, ffprobe: false, ffmpegPath: null, ffprobePath: null }),
    'voice:status': () => ok({ engines: [] }),
    'automation:list': () => ok([]),
    'opencode:listModels': () => ok([]),
    'updater:check': () => ok({ status: 'dev' }),
  }
  const bridge = Object.freeze({
    isDesktop: true,
    platform: 'win32',
    versions: Object.freeze({ electron: 'boot-check', chrome: 'boot-check', node: 'boot-check' }),
    filePathFor: () => null,
    ipc: Object.freeze({
      invoke: (channel, payload) => (answers[channel] ? answers[channel](payload) : Promise.reject(new Error('boot-check: ' + channel + ' is not available'))),
      on: () => () => {},
    }),
    paths: Object.freeze({ arenaPreviewUrl: () => ok(null) }),
  })
  for (const name of ['cupric', 'northframe']) Object.defineProperty(window, name, { value: bridge, writable: false, configurable: false, enumerable: true })
})()`

function serveDist() {
  const dist = path.join(root, 'dist')
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg' }
  const server = createServer((req, res) => {
    const url = decodeURIComponent(String(req.url || '/').split('?')[0])
    const base = url.startsWith('/resources/') ? root : dist
    let file = path.join(base, url === '/' ? 'index.html' : url)
    if (!file.startsWith(base)) return res.writeHead(403).end()
    try {
      if (!statSync(file).isFile()) throw new Error('dir')
    } catch {
      file = null
    }
    if (!file) return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/* ——— driving ——————————————————————————————————————————————————————————— */

// Noise that is not an app failure: missing favicon, blocked remote fonts or
// catalogues in an offline sandbox, and the stub refusing native-only channels.
const IGNORE = [/favicon/i, /net::ERR_/i, /Failed to load resource/i, /boot-check: .* is not available/, /fonts\.googleapis|fontshare|raw\.githubusercontent/i]
const ignorable = (text) => IGNORE.some((re) => re.test(text))

function watch(page) {
  const problems = []
  page.on('pageerror', (err) => {
    const text = `Uncaught ${err?.message ?? err}`
    if (!ignorable(text)) problems.push(text)
  })
  page.on('console', (msg) => {
    const text = msg.text()
    if (/Uncaught/i.test(text) && !ignorable(text)) problems.push(`console: ${text}`)
  })
  return problems
}

async function waitReady(page, view) {
  // The shell sets main[data-view]; a fallback card also counts as "not blank".
  await page
    .waitForFunction(
      (v) => Boolean(document.querySelector(`main[data-view="${v}"]`) || document.querySelector('[data-cupric-fallback]') || document.querySelector('main[data-view]')),
      { timeout: READY_TIMEOUT_MS },
      view,
    )
    .catch(() => undefined)
  await sleep(SETTLE_MS)
  return page.evaluate(() => {
    const rootEl = document.getElementById('root')
    const main = document.querySelector('main[data-view]')
    const fallbacks = [...document.querySelectorAll('[data-cupric-fallback]')].map((el) => ({ kind: el.getAttribute('data-cupric-fallback'), text: el.textContent?.slice(0, 300) }))
    return {
      view: main?.getAttribute('data-view') ?? null,
      rootChildren: rootEl?.childElementCount ?? 0,
      textLength: (document.body?.innerText ?? '').trim().length,
      fallbacks,
      warnings: [...document.querySelectorAll('[data-cupric-notice]')].map((el) => el.textContent?.trim()),
    }
  })
}

const failures = []
const fail = (label, why) => {
  failures.push(`${label}: ${why}`)
  console.log(`  ✗ ${label} — ${why}`)
}
const pass = (label, extra = '') => console.log(`  ✓ ${label}${extra ? ` (${extra})` : ''}`)

/**
 * `seed(text|null)` parks the window on a blank page (so no running app
 * instance can autosave over the fixture) and stores the saved-project text
 * where the app reads it; `load({ forceThrow })` boots the app.
 */
async function runMatrix({ label, page, seed, load }) {
  const reload = () => load({})
  console.log(`\n${label}`)
  const problems = watch(page)
  const scenarios = []
  for (const [name, make] of Object.entries(FIXTURES)) for (const view of VIEWS) scenarios.push({ name, view, text: make(view) })
  scenarios.push({ name: 'corrupt-json', view: null, text: CORRUPT_TEXT })
  scenarios.push({ name: 'fresh-install', view: null, text: null })

  for (const s of scenarios) {
    const tag = `${s.name}${s.view ? ` → ${s.view}` : ''}`
    problems.length = 0
    await seed(s.text)
    await reload()
    const state = await waitReady(page, s.view ?? 'home')
    const errs = [...problems]
    if (errs.length) fail(tag, errs.slice(0, 3).join(' | '))
    else if (!state.rootChildren || !state.view) fail(tag, `blank screen (root children ${state.rootChildren}, view ${state.view})`)
    else if (state.fallbacks.length) fail(tag, `fallback shown: ${state.fallbacks.map((f) => f.text).join(' / ')}`)
    else if (s.view && s.name !== 'bad-shape' && state.view !== s.view) fail(tag, `opened ${state.view} instead of ${s.view}`)
    else pass(tag, state.warnings.length ? `notices: ${state.warnings.slice(0, 2).join(' · ').slice(0, 120)}` : '')
  }

  // The Studio must still be there after a "restart" with view:studio.
  {
    const tag = 'restart with view:studio stays on Studio'
    problems.length = 0
    await seed(FIXTURES['empty-project']('studio'))
    await reload()
    await waitReady(page, 'studio')
    await sleep(400) // let the first boot's autosave land
    await reload() // second boot reads what the first one saved
    const state = await waitReady(page, 'studio')
    const hasCanvas = await page.evaluate(() => Boolean(document.querySelector('canvas[aria-label="Studio preview"], [data-cupric-dom-preview]')))
    const hasHint = await page.evaluate(() => Boolean(document.querySelector('[data-studio-empty-hint]')))
    if (problems.length) fail(tag, problems.join(' | '))
    else if (state.view !== 'studio') fail(tag, `view is ${state.view}`)
    else if (!hasCanvas) fail(tag, 'no Studio preview (canvas or DOM fallback) on an empty project')
    else if (!hasHint) fail(tag, 'empty project shows no drop hint')
    else pass(tag, 'preview + drop hint visible')
  }

  // Forced render throw → per-route fallback card, never white.
  for (const view of ['studio', 'library', 'render', 'lab', 'brief']) {
    const tag = `forced throw in ${view} shows fallback card`
    problems.length = 0
    await seed(FIXTURES['empty-project'](view))
    await load({ forceThrow: view })
    const state = await waitReady(page, view)
    await page.evaluate(() => sessionStorage.removeItem('cupric:debug:forceThrow'))
    const card = state.fallbacks.find((f) => f.kind === 'route')
    const buttons = await page.evaluate(() => [...document.querySelectorAll('[data-cupric-fallback] button')].map((b) => b.textContent?.trim()))
    if (problems.length) fail(tag, `uncaught despite boundary: ${problems.join(' | ')}`)
    else if (!card) fail(tag, `no fallback card (fallbacks: ${JSON.stringify(state.fallbacks)})`)
    else if (!buttons.some((b) => /copy error/i.test(b ?? '')) || !buttons.some((b) => /go to library/i.test(b ?? ''))) fail(tag, `card is missing buttons: ${buttons.join(', ')}`)
    else if (!/p-empty/.test(card.text ?? '')) fail(tag, 'card does not show the project id')
    else {
      if (view !== 'library') {
        await page.evaluate(() => [...document.querySelectorAll('[data-cupric-fallback] button')].find((b) => /go to library/i.test(b.textContent ?? ''))?.click())
        const after = await waitReady(page, 'library')
        if (after.view !== 'library' || after.fallbacks.length) {
          fail(tag, `Go to Library did not recover (view ${after.view}, fallbacks ${after.fallbacks.length})`)
          continue
        }
      }
      pass(tag, view === 'library' ? 'card + buttons' : 'card + buttons, Go to Library recovered')
    }
  }

  // Global error outside React → global card, app still there.
  {
    const tag = 'uncaught global error shows global card'
    problems.length = 0
    await seed(FIXTURES['empty-project']('studio'))
    await reload()
    await waitReady(page, 'studio')
    // Injected as a same-origin inline script: errors from CDP-evaluated code
    // reach window.onerror muted ("Script error."), app errors do not.
    await page.evaluate(() => {
      const s = document.createElement('script')
      s.textContent = "setTimeout(function () { throw new Error('boot-check forced global error') }, 0); setTimeout(function () { Promise.reject(new Error('boot-check forced rejection')) }, 5)"
      document.head.appendChild(s)
    })
    await sleep(600)
    const state = await waitReady(page, 'studio')
    const unexpected = problems.filter((p) => !/boot-check forced/.test(p))
    if (unexpected.length) fail(tag, unexpected.join(' | '))
    else if (!state.fallbacks.some((f) => f.kind === 'global' && /boot-check forced/.test(f.text ?? ''))) fail(tag, `no global error card with the error message (fallbacks: ${JSON.stringify(state.fallbacks)})`)
    else if (!state.rootChildren || state.view !== 'studio') fail(tag, 'app blanked')
    else pass(tag)
  }
}

let mode = opt('mode') ?? 'auto'
const electronPath = electronBinary()
const chromePath = chromeBinary()
if (mode === 'auto') mode = electronPath ? 'electron' : chromePath ? 'browser' : 'none'
if (mode === 'none' || (mode === 'electron' && !electronPath) || (mode === 'browser' && !chromePath)) {
  console.error(
    [
      'check:boot FAILED — nothing to boot the app with.',
      '  • Electron: `npm install` downloads it (set ELECTRON_MIRROR if GitHub downloads are blocked),',
      '    or point CUPRIC_BOOT_EXE at a packaged "Cupric AI.exe".',
      '  • Browser: set CUPRIC_BOOT_CHROME to a Chrome/Chromium/Edge executable.',
    ].join('\n'),
  )
  process.exit(1)
}

const cleanups = []
try {
  if (mode === 'electron') {
    const passes = [
      { label: 'Electron (--enable-logging --v=1 --disable-gpu, the 0.10.0 repro flags)', extra: ['--enable-logging', '--v=1', '--disable-gpu'] },
      { label: 'Electron (GPU enabled)', extra: [] },
    ]
    for (const p of passes) {
      const userData = mkdtempSync(path.join(os.tmpdir(), 'cupric-boot-'))
      if (!flag('keep')) cleanups.push(() => rmSync(userData, { recursive: true, force: true }))
      const port = await freePort()
      const appArgs = process.env.CUPRIC_BOOT_EXE ? [] : [root]
      const child = spawn(electronPath, [...appArgs, `--remote-debugging-port=${port}`, ...p.extra], {
        cwd: root,
        env: { ...process.env, CUPRIC_USER_DATA_DIR: userData, ELECTRON_START_URL: '', CUPRIC_BOOT_CHECK: '1', ELECTRON_ENABLE_LOGGING: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const appLog = []
      child.stdout.on('data', (d) => appLog.push(String(d)))
      child.stderr.on('data', (d) => appLog.push(String(d)))
      cleanups.push(() => child.exitCode === null && child.kill())
      const browser = await connectWithRetry(`http://127.0.0.1:${port}`, child)
      let page
      for (let i = 0; i < 60 && !page; i++) {
        page = (await browser.pages()).find((pg) => /index\.html|^http/.test(pg.url()) && !pg.url().startsWith('devtools'))
        if (!page) await sleep(250)
      }
      if (!page) throw new Error('the app window never appeared')
      const stateFile = path.join(userData, 'projects.json')
      await page.waitForFunction(() => document.readyState !== 'loading', { timeout: READY_TIMEOUT_MS }).catch(() => undefined)
      const appUrl = page.url()
      await runMatrix({
        label: p.label,
        page,
        seed: async (text) => {
          await page.goto('about:blank')
          await sleep(150) // in-flight state:save IPC from the previous boot
          mkdirSync(userData, { recursive: true })
          // Autosave snapshots would "recover" a corrupt file; clear them so
          // the renderer sees exactly the fixture.
          rmSync(path.join(userData, 'history'), { recursive: true, force: true })
          rmSync(path.join(userData, 'versions'), { recursive: true, force: true })
          if (text === null) rmSync(stateFile, { force: true })
          else writeFileSync(stateFile, text)
        },
        load: async ({ forceThrow } = {}) => {
          await page.goto(appUrl, { waitUntil: 'domcontentloaded' })
          if (forceThrow) {
            await page.evaluate((v) => sessionStorage.setItem('cupric:debug:forceThrow', v), forceThrow)
            await page.reload({ waitUntil: 'domcontentloaded' })
          }
        },
      })
      // The main process must have logged no uncaught renderer errors either.
      const uncaught = appLog.join('').split(/\r?\n/).filter((l) => /Uncaught/.test(l) && !/boot-check forced/.test(l))
      if (uncaught.length) fail(`${p.label} — process output`, uncaught.slice(0, 3).join(' | '))
      const logsDir = path.join(userData, 'logs')
      if (!existsSync(logsDir) || !readdirSync(logsDir).some((f) => f.endsWith('.log'))) fail(`${p.label} — logging`, 'no log file under userData/logs')
      else pass(`${p.label} — log files written to userData/logs`)
      await browser.disconnect()
      child.kill()
    }
  } else {
    const server = await serveDist()
    cleanups.push(() => server.close())
    const url = `http://127.0.0.1:${server.address().port}/index.html`
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      // --disable-gpu matches the 0.10.0 repro launch flags.
      args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--single-process', '--disable-dev-shm-usage', '--window-size=1440,900'],
      defaultViewport: { width: 1440, height: 900 },
    })
    cleanups.push(() => browser.close())
    const page = await browser.newPage()
    await page.evaluateOnNewDocument(STUB_BRIDGE)
    const blank = url.replace('/index.html', '/__blank') // same origin, no app running
    await runMatrix({
      label: 'Headless Chromium, --disable-gpu, read-only contextBridge-style bridge',
      page,
      seed: async (text) => {
        await page.goto(blank)
        await page.evaluate((t) => {
          localStorage.clear()
          sessionStorage.clear()
          if (t !== null) localStorage.setItem('__boot_state', t)
        }, text)
      },
      load: async ({ forceThrow } = {}) => {
        if (forceThrow) await page.evaluate((v) => sessionStorage.setItem('cupric:debug:forceThrow', v), forceThrow)
        await page.goto(url, { waitUntil: 'domcontentloaded' })
      },
    })
  }
} finally {
  for (const c of cleanups.reverse()) {
    try {
      await c()
    } catch {}
  }
}

if (failures.length) {
  console.error(`\ncheck:boot FAILED — ${failures.length} problem(s):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log(`\ncheck:boot passed — ${mode} mode, ${VIEWS.length} views × ${Object.keys(FIXTURES).length + 2} saved-state fixtures, forced-throw fallbacks and global error card verified, zero uncaught errors.`)
