/**
 * Launch E2E — the app starts, every view renders, and it reports its own
 * version.
 *
 * This is the suite that would have caught the 0.10.0 white screen on a PR
 * instead of in a release: it launches the real main process with the real
 * preload bridge (where that bug lived) and visits every view, failing on any
 * uncaught error.
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dismissOnboarding, expectNoAppErrors, launchApp } from './harness'

const VIEWS = ['home', 'auto', 'review', 'brief', 'arena', 'footage', 'timeline', 'studio', 'motion', 'lab', 'render', 'library'] as const

test.describe('the app launches', () => {
  test('opens a window on the cached view without an uncaught error', async () => {
    const app = await launchApp()
    try {
      await expect(app.page.locator('main[data-view]')).toBeVisible({ timeout: 60_000 })
      const view = await app.page.locator('main[data-view]').getAttribute('data-view')
      expect(['home', 'auto', 'review', 'brief', 'arena', 'footage', 'timeline', 'studio', 'motion', 'lab', 'render', 'library'])
        .toContain(view)
      expectNoAppErrors(app)
    } finally {
      await app.close()
    }
  })

  test('every view renders from the sidebar, with no uncaught error', async () => {
    const app = await launchApp()
    try {
      await expect(app.page.locator('main[data-view]')).toBeVisible({ timeout: 60_000 })
      // A profile with no projects is greeted by the first-run tour, which is a
      // real modal covering the sidebar. Close it the way a person does before
      // walking the nav — the sidebar underneath is "visible" to Playwright even
      // while the overlay intercepts every click, which is how this test failed
      // on the first Windows run.
      const dismissed = await dismissOnboarding(app.page)
      test.info().annotations.push({ type: 'first-run-tour', description: dismissed ? 'shown and dismissed' : 'not shown' })
      for (const view of VIEWS) {
        const button = app.page.locator(`[data-nav="${view}"]`).first()
        // A view can be legitimately unreachable on a fresh profile (nothing to
        // review yet, no project to brief). Locked buttons are disabled and say
        // why, so a disabled one is reported rather than clicked.
        if ((await button.count()) === 0 || (await button.isDisabled())) {
          const reason = await button.getAttribute('title').catch(() => null)
          test.info().annotations.push({ type: 'view-skipped', description: `${view}: ${reason ?? 'no button'}` })
          continue
        }
        await button.click()
        await app.page.waitForSelector(`main[data-view="${view}"]`, { timeout: 60_000 })
        const fallback = await app.page.locator('[data-cupric-fallback]').count()
        expect(fallback, `${view} rendered an error card instead of the view`).toBe(0)
      }
      expectNoAppErrors(app)
    } finally {
      await app.close()
    }
  })

  test('a corrupt saved project shows a real recovery path instead of a blank window', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const nodePath = await import('node:path')
    const { writeFileSync } = await import('node:fs')
    const userDataDir = await mkdtemp(nodePath.join(tmpdir(), 'cupric-e2e-corrupt-'))
    writeFileSync(nodePath.join(userDataDir, 'projects.json'), '{"projects": [ this is not json', 'utf8')
    const app = await launchApp({ userDataDir })
    try {
      // The app must still paint something with a way forward, whatever it
      // decided to do with the unreadable file.
      await expect(app.page.locator('main[data-view], [data-cupric-fallback]')).toBeVisible({ timeout: 60_000 })
      const rootChildren = await app.page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0)
      expect(rootChildren, 'the window went blank on a corrupt project file').toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  test('Settings reports the version this build actually is', async () => {
    const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
    const app = await launchApp()
    try {
      await expect(app.page.locator('main[data-view]')).toBeVisible({ timeout: 60_000 })
      await dismissOnboarding(app.page)
      // Settings is the app's own surface for the version the release gate
      // (scripts/check-version-sync.mjs) ties to package.json.
      const version = await app.page.evaluate(async () => {
        const bridge = (window as unknown as { cupric?: { ipc: { invoke: (channel: string) => Promise<unknown> } } }).cupric
        return bridge ? await bridge.ipc.invoke('app:info') : null
      })
      expect(version, 'no desktop bridge: app:info could not be reached').not.toBeNull()
      expect((version as { ok?: boolean }).ok).toBe(true)
      expect((version as { version?: string }).version).toBe(packageJson.version)
      // The UI must show it, not only the IPC.
      await app.page.locator('[data-nav="settings"], button[aria-label="Settings"]').first().click().catch(() => undefined)
      await expect(app.page.getByText(`v${packageJson.version}`, { exact: false }).first()).toBeVisible({ timeout: 30_000 })
    } finally {
      await app.close()
    }
  })

  test('a project created in the app is still there after a restart', async () => {
    // Why this changed: the old version hand-wrote a projects.json, then looked
    // for the project name in `localStorage` and in `document.body.innerText`.
    // Neither can work. On the desktop the store persists through the main
    // process (`state:save` → projects.json), not localStorage — and the project
    // name is an <input value>, which no `innerText` ever contains. It failed on
    // Windows for those reasons, not because anything was lost.
    //
    // What it does now: create the project through the app, rename it through
    // the same field a person uses, wait for the write to land on disk, restart,
    // and assert what is on screen and on disk.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-e2e-persist-'))
    const stateFile = path.join(userDataDir, 'projects.json')
    const name = 'E2E persistence'

    const first = await launchApp({ userDataDir })
    try {
      await expect(first.page.locator('main[data-view]')).toBeVisible({ timeout: 60_000 })
      await dismissOnboarding(first.page)
      await first.page.locator('[data-nav="home"]').click()
      await first.page.getByRole('button', { name: 'New project' }).first().click()

      const nameField = first.page.locator('input[aria-label="Project name"]')
      await expect(nameField, 'creating a project did not open one').toBeVisible({ timeout: 30_000 })
      await nameField.fill(name)
      await expect(nameField).toHaveValue(name)

      // The rename is only real once the main process has written it. Wait for
      // the file, never for a timer.
      await expect
        .poll(() => (fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : ''), {
          message: `the app never wrote "${name}" to ${stateFile}`,
          timeout: 30_000,
        })
        .toContain(name)
    } finally {
      await first.close()
    }

    const second = await launchApp({ userDataDir })
    try {
      await expect(second.page.locator('main[data-view]')).toBeVisible({ timeout: 60_000 })
      await dismissOnboarding(second.page)

      const restoredField = second.page.locator('input[aria-label="Project name"]')
      const shown = (await restoredField.count()) > 0
        ? await restoredField.inputValue()
        : '(no project name field — the app opened with no project)'
      const onDisk = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : '(no projects.json was written)'
      expect(shown, `after a restart the app shows ${JSON.stringify(shown)}. projects.json: ${onDisk.slice(0, 600)}`).toBe(name)

      // And the list a person would actually look at agrees.
      await second.page.locator('[data-nav="home"]').click()
      await expect(second.page.getByText(name).first(), 'Home does not list the project created before the restart').toBeVisible({ timeout: 30_000 })
    } finally {
      await second.close()
    }
  })
})
