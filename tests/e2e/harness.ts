/**
 * E2E harness — launch the real app, drive it, and verify what it produced.
 *
 * Everything here runs the product: the real main process, the real preload
 * bridge, the real renderer, the real FFmpeg. Nothing is stubbed except the two
 * things a headless test cannot have — a native file dialog and a human.
 *
 * Two rules this file exists to enforce:
 *
 *  1. **No silent skips.** If Electron is not installed, the harness throws with
 *     the reason and the fix. A skipped E2E run that reports green is worse than
 *     no E2E run at all; the PR workflow installs Electron, so a throw here is a
 *     real failure there.
 *  2. **Real evidence.** Exports are verified by probing the file that appeared
 *     on disk with the same ffprobe the app uses, not by reading a toast.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The `electron` and `ffmpeg-static` packages resolve their binary paths through
// their CommonJS entry points, so the harness needs a real require.
const require = createRequire(import.meta.url)

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The Electron binary `npm ci` installed, or a thrown explanation. */
export function electronBinary(): string {
  try {
    // The `electron` package's main export is the path to the binary it
    // downloaded at install time.
    const resolved = require('electron') as unknown
    const candidate = typeof resolved === 'string' ? resolved : ''
    if (candidate && fs.existsSync(candidate)) return candidate
    throw new Error(`the electron package resolved to "${String(candidate)}", which does not exist`)
  } catch (error) {
    throw new Error(
      [
        'E2E CANNOT RUN: the Electron binary is not installed in this checkout.',
        `  reason: ${(error as Error).message}`,
        '  fix: run `npm ci` on Windows with network access (ELECTRON_MIRROR helps behind a proxy).',
        'This is a failure, not a skip: an E2E suite that cannot launch the app has verified nothing.',
      ].join('\n'),
    )
  }
}

/**
 * Resolve one media tool exactly the way `electron/main.cjs` resolves it:
 * environment, then the module the app itself requires, then PATH.
 *
 * This matters more than it looks. The previous version of this function
 * guessed at package *layouts* and ended up looking for
 * `node_modules/ffmpeg-static/ffmpeg-static.exe` — a path that has never
 * existed, because `ffmpeg-static`'s entry point computes `ffmpeg.exe` for the
 * running platform and exports it. The first Windows CI run therefore threw
 * "no ffmpeg-static binary in this checkout" while the binary was sitting right
 * there, which is the worst kind of failure: the test, not the product.
 *
 * Asking the same modules the app asks means the E2E can never verify a
 * different binary than the one the product would use.
 */
function resolveMediaTool(kind: 'ffmpeg' | 'ffprobe'): string {
  const tried: string[] = []
  const envNames = kind === 'ffmpeg' ? ['CUPRIC_FFMPEG_PATH', 'FFMPEG_PATH'] : ['CUPRIC_FFPROBE_PATH', 'FFPROBE_PATH']
  for (const name of envNames) {
    const value = process.env[name]
    if (!value) {
      tried.push(`${name}: unset`)
      continue
    }
    if (fs.existsSync(value)) return value
    tried.push(`${name}=${value} (does not exist)`)
  }

  const moduleName = kind === 'ffmpeg' ? 'ffmpeg-static' : 'ffprobe-static'
  try {
    const loaded = require(moduleName) as unknown
    // ffmpeg-static exports the path itself; ffprobe-static exports { path }.
    const candidate = typeof loaded === 'string' ? loaded : (loaded as { path?: string } | null)?.path
    if (candidate && fs.existsSync(candidate)) return candidate
    tried.push(`${moduleName}: resolved to ${candidate ?? 'nothing usable'}`)
  } catch (error) {
    tried.push(`${moduleName}: ${(error as Error).message}`)
  }

  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', [kind], { encoding: 'utf8' })
  const onPath = which.status === 0 ? String(which.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] : null
  if (onPath && fs.existsSync(onPath)) return onPath
  tried.push(`PATH: ${onPath ?? `${kind} is not on PATH`}`)

  throw new Error(
    [
      `E2E CANNOT RUN: no ${kind} binary in this checkout.`,
      '  the app resolves it the same three ways, so it would fail identically:',
      ...tried.map((line) => `    ${line}`),
      '  fix: `npm run ffmpeg:ensure` — ffmpeg-static is an OPTIONAL dependency whose binary is',
      '  downloaded by its postinstall script, and npm removes it silently if that download fails.',
    ].join('\n'),
  )
}

/** The ffmpeg/ffprobe binaries the app itself uses, or a thrown explanation. */
export function mediaBinaries(): { ffmpeg: string; ffprobe: string } {
  return { ffmpeg: resolveMediaTool('ffmpeg'), ffprobe: resolveMediaTool('ffprobe') }
}

export type LaunchedApp = {
  app: ElectronApplication
  page: Page
  userDataDir: string
  /** Everything the app (or its renderer) reported as a problem. */
  errors: string[]
  close: () => Promise<void>
}

export type LaunchOptions = {
  /** Reuse a directory to test persistence across restarts. */
  userDataDir?: string
  env?: Record<string, string>
  /** Extra argv for the Electron main process. */
  args?: string[]
}

/**
 * Launch the app. The userData directory is isolated by default, because a test
 * that writes into the developer's real project store is not a test anybody can
 * run twice.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const binary = electronBinary()
  const userDataDir = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-e2e-'))
  const errors: string[] = []

  const app = await electron.launch({
    executablePath: binary,
    args: [repoRoot, ...(options.args ?? [])],
    cwd: repoRoot,
    env: {
      ...process.env,
      // No dev server: the app loads dist/index.html from disk, exactly as the
      // packaged build does.
      ELECTRON_START_URL: '',
      CUPRIC_USER_DATA_DIR: userDataDir,
      // The boot check uses this to disable the single-instance lock interplay
      // with a developer's running copy; harmless here and consistent with CI.
      CUPRIC_BOOT_CHECK: '1',
      ...options.env,
    } as Record<string, string>,
  })

  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  await page.waitForLoadState('domcontentloaded')

  // The window size is a fact about the machine, and it decides which layout the
  // app renders (`lg` is 1024px). A CI runner's virtual display is 1024x768, and
  // Electron's `minWidth: 1120` is only a request — the OS clamps the window to
  // the work area. Printing it makes "the panel was missing" measurable instead
  // of inferred.
  const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  console.log(`[e2e] window is ${size.width}x${size.height} css px (lg breakpoint = 1024)`)

  return {
    app,
    page,
    userDataDir,
    errors,
    close: async () => {
      try {
        await app.close()
      } catch (error) {
        // A window that refuses to close is a result worth knowing about, not a
        // reason to fail an otherwise finished test.
        errors.push(`close: ${(error as Error).message}`)
      }
    },
  }
}

/** Open a view the way the app itself restores one: through its saved state. */
export async function openView(page: Page, view: string): Promise<void> {
  await page.waitForSelector('main[data-view]', { timeout: 60_000 })
  await page.evaluate((target) => {
    const main = document.querySelector('main[data-view]')
    if (main?.getAttribute('data-view') === target) return
    // The shell exposes its own navigation through history + the store; clicking
    // the sidebar is the honest path, so this only handles the initial route.
    throw new Error(`the app opened "${main?.getAttribute('data-view')}" instead of "${target}"`)
  }, view).catch(async (error: Error) => {
    // Falling back to the sidebar click keeps this usable when the saved view is
    // something else (fresh profile), without hiding a real mismatch.
    const button = page.locator(`[data-nav="${view}"]`).first()
    if (await button.count()) {
      await button.click()
      await page.waitForSelector(`main[data-view="${view}"]`, { timeout: 60_000 })
      return
    }
    throw error
  })
  await page.waitForSelector(`main[data-view="${view}"]`, { timeout: 60_000 })
}

/** Seed the app's own saved state file before launch (the app reads it). */
export function seedState(userDataDir: string, state: Record<string, unknown>): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'projects.json'), JSON.stringify(state), 'utf8')
}

/** Wait for a toast whose text matches, and return it. Fails with what was shown. */
export async function waitForToast(page: Page, pattern: RegExp, timeoutMs = 120_000): Promise<string> {
  const toast = page.locator('[role="status"]').filter({ hasText: pattern }).first()
  try {
    await toast.waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    const shown = await page.locator('[role="status"]').allInnerTexts()
    throw new Error(`no toast matching ${pattern} within ${timeoutMs}ms. Shown: ${JSON.stringify(shown)}`)
  }
  return (await toast.innerText()).trim()
}

/** Every file under `dir`, newest first by mtime. */
export function filesNewestFirst(dir: string, filter: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (filter(entry.name)) out.push(full)
    }
  }
  walk(dir)
  return out.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

export type Probe = {
  ok: boolean
  durationSec: number | null
  video: string | null
  audio: string | null
  width: number | null
  height: number | null
  sizeBytes: number
  raw: string
}

/**
 * Probe a real media file with the real ffprobe — the same evidence the app's
 * own export verification uses, so a passing E2E means the file is playable and
 * not merely present.
 */
export function probeFile(ffprobe: string, file: string): Probe {
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,format_name',
    '-show_entries', 'stream=codec_type,codec_name,width,height',
    '-of', 'json',
    file,
  ], { encoding: 'utf8', timeout: 60_000 })
  const raw = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (result.status !== 0) return { ok: false, durationSec: null, video: null, audio: null, width: null, height: null, sizeBytes: fs.existsSync(file) ? fs.statSync(file).size : 0, raw }
  const parsed = JSON.parse(result.stdout) as {
    format?: { duration?: string; size?: string }
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
  }
  const streams = parsed.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const audio = streams.find((stream) => stream.codec_type === 'audio')
  return {
    ok: true,
    durationSec: parsed.format?.duration ? Number(parsed.format.duration) : null,
    video: video?.codec_name ?? null,
    audio: audio?.codec_name ?? null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    sizeBytes: parsed.format?.size ? Number(parsed.format.size) : 0,
    raw,
  }
}

/**
 * Close the first-run tour the way a person does, if this profile is showing
 * it.
 *
 * A profile with no projects is greeted by the tour, and the tour is a real
 * modal: it covers the sidebar. Playwright's `toBeVisible` does not care about
 * overlays (the button under it is still "visible"), but `click()` does, so a
 * test that does not dismiss it fails with "…intercepts pointer events" — which
 * is exactly what the first Windows run reported for the sidebar walk.
 *
 * Returns whether it actually dismissed something, so a caller can tell "this
 * profile was already past it" from "the tour was closed", instead of assuming.
 * Never throws: an absent tour is a normal state, not a failure.
 */
export async function dismissOnboarding(page: Page, timeoutMs = 8_000): Promise<boolean> {
  const dialog = page.locator('[data-onboarding]')
  try {
    await dialog.waitFor({ state: 'visible', timeout: timeoutMs })
  } catch {
    console.log(`[e2e] first-run tour not shown (waited ${timeoutMs}ms) — this profile is already past it`)
    return false
  }
  await page.locator('[data-onboarding] button[aria-label="Close the welcome tour"]').first().click()
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 })
  console.log('[e2e] first-run tour dismissed')
  return true
}

/**
 * The tail of the app's own log file, for when something fails and the reason
 * only exists in the main process.
 *
 * `electron/main.cjs` writes every render, export and load decision to
 * `userData/logs/<date>.log`. The renderer cannot see any of it, and a CI
 * artifact cannot be downloaded from this environment, so a failure that does
 * not quote this is a failure nobody can diagnose.
 */
export function appLogTail(userDataDir: string, lines = 40): string {
  const dir = path.join(userDataDir, 'logs')
  if (!fs.existsSync(dir)) return `(no logs directory at ${dir})`
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.log')).sort()
  if (!files.length) return `(no .log files in ${dir}: ${fs.readdirSync(dir).join(', ') || 'empty'})`
  const newest = path.join(dir, files[files.length - 1])
  const all = fs.readFileSync(newest, 'utf8').split(/\r?\n/).filter(Boolean)
  return `${files[files.length - 1]} (${all.length} lines, last ${Math.min(lines, all.length)}):\n${all.slice(-lines).join('\n')}`
}

/**
 * Everything a person can see about an export in progress: the toasts, the
 * export state the toolbar shows, and where the app is writing.
 */
export async function exportEvidence(page: Page, userDataDir: string): Promise<string> {
  const toasts = await page.locator('[role="status"]').allInnerTexts().catch(() => ['(toasts unreadable)'])
  const exportState = await page.locator('text=/Exporting|Queued|percent|%/').allInnerTexts().catch(() => [])
  const rendersDir = path.join(userDataDir, 'renders')
  const files = filesNewestFirst(rendersDir, () => true).map((file) => `${file} (${fs.existsSync(file) ? fs.statSync(file).size : '?'} bytes)`)
  return [
    `  toasts on screen: ${JSON.stringify(toasts)}`,
    `  export state on screen: ${JSON.stringify(exportState.slice(0, 6))}`,
    `  files under ${rendersDir}: ${JSON.stringify(files.slice(0, 8))}`,
    `  app log tail:\n${appLogTail(userDataDir, 30)}`,
  ].join('\n')
}

/**
 * A real source video for the import test: FFmpeg testsrc2 (a moving pattern,
 * so a still-frame export is obviously wrong) with a real sine tone.
 */
export function makeFixtureVideo(ffmpeg: string, dir: string, { seconds = 3, size = '320x180' } = {}): string {
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'e2e-source.mp4')
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-shortest',
    out,
  ], { encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0 || !fs.existsSync(out)) {
    throw new Error(`E2E CANNOT RUN: could not create the fixture video with ${ffmpeg}\n${`${result.stdout}${result.stderr}`.trim().slice(-800)}`)
  }
  return out
}

/** Assert the app never reported an uncaught error, and say what it was if so. */
export function expectNoAppErrors(app: LaunchedApp, allow: RegExp[] = []): void {
  const unexpected = app.errors.filter((line) => !allow.some((pattern) => pattern.test(line)))
  expect(unexpected, `the app reported errors:\n${unexpected.join('\n')}`).toEqual([])
}
