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
import { expectNoAppErrors, launchApp, seedState } from './harness'

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

  test('a seeded project survives a restart', async () => {
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const nodePath = await import('node:path')
    const userDataDir = await mkdtemp(nodePath.join(tmpdir(), 'cupric-e2e-persist-'))
    seedState(userDataDir, {
      projects: [{ id: 'e2e-project', name: 'E2E persistence', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doc: null }],
      activeProjectId: 'e2e-project',
      view: 'studio',
      theme: 'dark',
      soundCues: false,
      automationJobs: [],
    })
    const first = await launchApp({ userDataDir })
    try {
      await first.page.waitForSelector('main[data-view="studio"]', { timeout: 60_000 })
      // Let the app flush its own state before closing.
      await first.page.waitForTimeout(1500)
    } finally {
      await first.close()
    }

    const second = await launchApp({ userDataDir })
    try {
      await second.page.waitForSelector('main[data-view="studio"]', { timeout: 60_000 })
      const restored = await second.page.evaluate(() => {
        const raw = localStorage.getItem('cupric-projects') ?? ''
        return raw.includes('E2E persistence') || document.body.innerText.includes('E2E persistence')
      })
      expect(restored, 'the project was not restored after a restart').toBe(true)
    } finally {
      await second.close()
    }
  })
})
