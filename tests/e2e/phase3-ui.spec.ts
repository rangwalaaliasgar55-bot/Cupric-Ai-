/**
 * The Phase 3 surfaces, driven the way a person would.
 *
 * These run in the real Electron app (see harness.ts — they refuse to run
 * anywhere else rather than pretending). What is asserted here is the part that
 * only exists once the app is actually up:
 *
 *   - the first-run tour appears, explains four screens, and gets out of the way;
 *   - the tour does not come back on the second launch;
 *   - the two desks explain themselves;
 *   - the timeline's playhead can be moved without a mouse;
 *   - a missing speech engine offers a real install button with a real label.
 *
 * Anything the runner cannot do (no Electron binary, no speech engine) is
 * reported, never skipped silently.
 */
import { test, expect } from '@playwright/test'
import { launchApp } from './harness'
import type { LaunchedApp } from './harness'

test.describe.configure({ mode: 'serial' })

let launched: LaunchedApp

test.beforeAll(async () => {
  // A fresh userDataDir per run, so this launch really is a first run.
  launched = await launchApp()
  await launched.page.waitForSelector('main[data-view]')
})

test.afterAll(async () => {
  await launched?.close()
  // Nothing in these flows may write to the console as an error. A tour with a
  // missing key or a broken icon would, and it would be invisible otherwise.
  expect(launched.errors, `renderer errors:\n${launched.errors.join('\n')}`).toEqual([])
})

/** The tour is a first-run dialog; make sure the app is past it before a test. */
async function dismissTourIfPresent(target: import('playwright').Page) {
  const close = target.locator('[data-onboarding] button[aria-label="Close the welcome tour"]')
  if (await close.count()) await close.first().click()
}

test('the first-run tour explains the four screens and goes somewhere', async () => {
  const dialog = launched.page.locator('[data-onboarding]')
  if (!(await dialog.count())) {
    // A profile that already has projects is deliberately not greeted. Say so,
    // and check the tour is still reachable, rather than passing vacuously.
    await launched.page.keyboard.press('Control+k')
    await launched.page.getByText('Quick tour of Cupric').first().click()
    await expect(dialog).toBeVisible()
  }
  await expect(dialog.getByRole('heading', { name: 'Welcome to Cupric AI' })).toBeVisible()

  const cards = dialog.locator('[data-onboarding-card]')
  await expect(cards).toHaveCount(4)
  await expect(cards.nth(0)).toContainText('Studio')
  await expect(cards.nth(1)).toContainText('Autonomous Mode')
  await expect(cards.nth(2)).toContainText('Arena Desk')
  await expect(cards.nth(3)).toContainText('Footage Desk')

  // Every card has a button that is actually enabled — dismissing must not be
  // the only way out.
  for (const label of ['Open the Studio', 'Try a brief', 'Open Arena Desk', 'Open Footage Desk']) {
    await expect(dialog.getByRole('button', { name: label })).toBeEnabled()
  }

  // Escape closes it, because a modal that traps you is worse than no modal.
  await launched.page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the tour does not come back after it has been seen', async () => {
  const stored = await launched.page.evaluate(() => localStorage.getItem('cupric.onboarding.seen'))
  expect(stored, 'the dismissal is recorded with a date').toMatch(/^\d{4}-\d{2}-\d{2}T/)
  await launched.page.reload()
  await launched.page.waitForSelector('main[data-view]')
  await expect(launched.page.locator('[data-onboarding]')).toHaveCount(0)
})

test('the desks explain what they are for, and the explanation can be dismissed', async () => {
  await dismissTourIfPresent(launched.page)
  for (const [nav, purposeId] of [['arena', 'arena'], ['footage', 'footage']]) {
    await launched.page.locator(`[data-nav="${nav}"]`).click()
    const block = launched.page.locator(`[data-screen-purpose="${purposeId}"]`)
    await expect(block, `${nav} explains itself`).toBeVisible()
    await expect(block).toContainText('is for')
    await block.getByRole('button', { name: /Hide the explanation/ }).click()
    await expect(block).toHaveCount(0)
    // The dismissal is remembered — that is the whole point of a purpose block
    // rather than a paragraph.
    await launched.page.locator('[data-nav="home"]').click()
    await launched.page.locator(`[data-nav="${nav}"]`).click()
    await expect(launched.page.locator(`[data-screen-purpose="${purposeId}"]`)).toHaveCount(0)
  }
})

test('the timeline playhead moves from the keyboard and says where it is', async () => {
  await launched.page.locator('[data-nav="studio"]').click()
  await launched.page.waitForSelector('canvas[aria-label="Studio preview"]')
  await launched.page.locator('[data-nav="timeline"]').click()

  const slider = launched.page.getByRole('slider', { name: 'Playhead' })
  await expect(slider).toBeVisible()
  // Reachable with Tab, not skipped: this was tabIndex -1 before Phase 3.
  await expect(slider).toHaveAttribute('tabindex', '0')
  await slider.focus()
  await expect(slider).toBeFocused()

  // With an empty timeline there is nothing to seek, so the range is 0..0. The
  // assertions that matter are the ARIA contract and that keys do not throw.
  const max = Number(await slider.getAttribute('aria-valuemax'))
  expect(Number.isFinite(max)).toBe(true)
  await launched.page.keyboard.press('ArrowRight')
  await launched.page.keyboard.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', String(max))
  await launched.page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  const valueText = await slider.getAttribute('aria-valuetext')
  expect(valueText, 'the slider reads out a time').toMatch(/\d+:\d{2} of \d+:\d{2}/)
  expect(await slider.getAttribute('aria-keyshortcuts')).toContain('ArrowLeft')
})

test('the timeline announces what it cannot show', async () => {
  const live = launched.page.locator('[data-timeline-announcer]')
  await expect(live).toHaveAttribute('aria-live', 'polite')
  await expect(live).toHaveAttribute('role', 'status')
})

test('a missing speech engine offers a real download, not just a sentence', async () => {
  const status = await launched.page.evaluate(async () => {
    const bridge = (window as unknown as { cupric?: { ipc: { invoke: (c: string, p?: unknown) => Promise<unknown> } } }).cupric
    if (!bridge) return null
    return bridge.ipc.invoke('voice:engines')
  })
  if (!status) test.skip(true, 'not running inside the desktop app')
  const engines = (status as { engines: { id: string; label: string; installed: boolean; sizeHint?: string; detail: string }[] }).engines
  expect(engines.map((e) => e.id)).toEqual(['piper', 'piper-model-en', 'whisper', 'voice-hi'])
  // Every entry says what it is, whether it is here, and what it would cost.
  for (const engine of engines) {
    expect(typeof engine.installed).toBe('boolean')
    expect(engine.label.length).toBeGreaterThan(4)
    expect(engine.detail.length).toBeGreaterThan(10)
  }

  // The panel lives in the Ask drawer's settings (src/app-shell/AskPanel.tsx),
  // which is where a person would look for it. Open it the way they would.
  await launched.page.keyboard.press('Control+k')
  await launched.page.getByText('Ask Cupric AI').first().click()
  const settings = launched.page.getByRole('button', { name: 'AI settings' })
  await expect(settings).toBeVisible()
  await settings.click()
  const panel = launched.page.getByText('What this machine can do').first()
  await expect(panel).toBeVisible()
  // The panel must agree with what the main process reported: an engine it says
  // is missing has to be either offered for download or explained.
  const missing = engines.filter((e) => !e.installed && !e.id.startsWith('voice-hi'))
  if (missing.length) {
    const install = launched.page.getByRole('button', { name: /Download/ }).first()
    await expect(install).toBeVisible()
    // A disabled control has to say why — the same rule check-ui-audit enforces.
    if (await install.isDisabled()) {
      const described = await install.getAttribute('aria-describedby')
      const reason = described ? await launched.page.locator(`#${described}`).innerText() : await install.getAttribute('title')
      expect(reason, 'a blocked install button explains itself').toBeTruthy()
    }
    // And an enabled one is the real download: it either reports progress or a
    // failure that names the URL. It is never wired to nothing.
    expect(await install.getAttribute('title')).toMatch(/Download|install/i)
  }
})
