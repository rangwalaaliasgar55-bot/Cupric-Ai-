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

/** The ffmpeg/ffprobe binaries the app itself uses, or a thrown explanation. */
export function mediaBinaries(): { ffmpeg: string; ffprobe: string } {
  const resolve = (moduleName: string, packageName: string): string => {
    const modulePath = require.resolve(`${moduleName}/package.json`)
    const dir = path.dirname(modulePath)
    const manifest = JSON.parse(fs.readFileSync(modulePath, 'utf8')) as { binary?: string }
    const candidates = [
      manifest.binary ? path.join(dir, manifest.binary) : null,
      // ffprobe-static keeps its binary under bin/<platform>/<arch>/
      path.join(dir, 'bin', process.platform, process.arch, process.platform === 'win32' ? `${moduleName}.exe` : moduleName),
      path.join(dir, `${moduleName}.exe`),
      path.join(dir, moduleName),
    ].filter((value): value is string => Boolean(value))
    const found = candidates.find((candidate) => fs.existsSync(candidate))
    if (!found) {
      throw new Error(
        [
          `E2E CANNOT RUN: no ${packageName} binary in this checkout.`,
          `  looked in: ${candidates.join(', ')}`,
          `  fix: \`npm ci\` on Windows downloads it; on a sandbox set CUPRIC_FFMPEG_PATH or install @ffmpeg-installer/ffmpeg.`,
        ].join('\n'),
      )
    }
    return found
  }
  // ffmpeg-static ships one binary at the package root; ffprobe-static under bin/.
  const ffmpeg = process.env.CUPRIC_FFMPEG_PATH && fs.existsSync(process.env.CUPRIC_FFMPEG_PATH)
    ? process.env.CUPRIC_FFMPEG_PATH
    : resolve('ffmpeg-static', 'ffmpeg-static')
  const ffprobe = process.env.CUPRIC_FFPROBE_PATH && fs.existsSync(process.env.CUPRIC_FFPROBE_PATH)
    ? process.env.CUPRIC_FFPROBE_PATH
    : resolve('ffprobe-static', 'ffprobe-static')
  return { ffmpeg, ffprobe }
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
