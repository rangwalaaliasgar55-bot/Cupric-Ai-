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
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dismissOnboarding, launchApp, makeFixtureVideo, mediaBinaries, waitForToast } from './harness'
import type { LaunchedApp } from './harness'

/**
 * Not `mode: 'serial'`.
 *
 * The tests share one launched app (below), and `workers: 1` already runs them
 * one at a time, in order. Serial mode would add one thing: abort the rest of
 * the file after the first failure. On a Windows CI run that costs real
 * information — the first run reported "4 did not run" and the failures behind
 * that number were invisible. Each test below now gets itself into the state it
 * needs, so one failure does not hide the others.
 */

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

/**
 * Open a project if one is not open already. Idempotent, so a test can ask for
 * the state it needs without depending on which test ran before it.
 */
async function ensureProjectOpen(page: import('playwright').Page): Promise<void> {
  const nameField = page.locator('input[aria-label="Project name"]')
  if (await nameField.count()) return
  console.log('[e2e] no project open — creating one the way Home offers')
  await page.locator('[data-nav="home"]').click()
  await page.getByRole('button', { name: 'New project' }).first().click()
  await expect(nameField, 'Home did not open the project it just created').toBeVisible({ timeout: 30_000 })
}

/**
 * Click a sidebar entry, and refuse to pretend a locked one was clicked.
 *
 * Half the sidebar is deliberately locked without a project or a locked rundown
 * (`src/app-shell/Sidebar.tsx`), and a locked button says why in its title. When
 * a test wants a locked view it has to unlock it for real first — the failure
 * message names the app's own reason instead of a bare timeout.
 */
async function openNav(page: import('playwright').Page, view: string): Promise<void> {
  const button = page.locator(`[data-nav="${view}"]`)
  const reason = (await button.getAttribute('title')) ?? 'no reason given'
  await expect(button, `${view} is locked: ${reason}`).toBeEnabled({ timeout: 30_000 })
  await button.click()
  await page.waitForSelector(`main[data-view="${view}"]`, { timeout: 60_000 })
}

/**
 * Get the app to the state where both desks are open for business: one project,
 * one locked rundown.
 *
 * This is not test scaffolding — it is the product's own rule
 * (`src/app-shell/Sidebar.tsx`: Arena Desk needs `needProject` + `needLock`), so
 * a person has to do it too. The path below is the one they would take: create a
 * project, describe the video in the Brief, let the planner fill the rundown,
 * lock it. No key is configured on a CI runner, which is also the state of a
 * fresh install, so the local planner is what answers — and if it cannot, this
 * fails loudly instead of skipping.
 */
async function unlockDesks(page: import('playwright').Page): Promise<void> {
  const arena = page.locator('[data-nav="arena"]')
  if (await arena.isEnabled()) {
    console.log('[e2e] desks already unlocked — using the project that is open')
    return
  }

  await ensureProjectOpen(page)

  const idea = page.getByLabel('Brief idea')
  await expect(idea, 'creating a project did not land in the Brief').toBeVisible({ timeout: 30_000 })
  await idea.fill('12s SaaS launch bumper for Aurora — dark, lime, confident')
  await page.getByRole('button', { name: 'Generate rundown' }).click()

  // The rundown is filled in field by field, and "Lock rundown" stays disabled
  // until the planner has produced a title, scenes and an Arena prompt. Wait for
  // the product to say it is ready — not for a fixed delay.
  const lock = page.getByRole('button', { name: 'Lock rundown' })
  await expect(lock, 'the planner never filled enough of the rundown to lock it').toBeEnabled({ timeout: 120_000 })
  await lock.click()
  await expect(page.locator('[role="status"]').filter({ hasText: 'Rundown locked' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(arena, 'locking a rundown did not unlock the Arena Desk').toBeEnabled({ timeout: 30_000 })
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
  await dismissOnboarding(launched.page)
  // Both desks are locked until there is a project with a locked rundown
  // behind them — the app says why on the locked buttons. Unlock them the way a
  // person does; this also covers Brief → Generate → Lock end to end.
  await unlockDesks(launched.page)
  for (const [nav, purposeId] of [['arena', 'arena'], ['footage', 'footage']]) {
    await openNav(launched.page, nav)
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
  await dismissOnboarding(launched.page)
  await ensureProjectOpen(launched.page)

  // The Timeline screen only renders its ruler when the project has timeline
  // clips — with none it shows an empty state (`Timeline.tsx`). Those clips come
  // from the Footage Desk, so this walks the real path: import a raw video there,
  // let the app analyse it, apply the edit, and land on the Timeline with
  // something real to seek. That also covers two Phase 1 features nothing else
  // touches — footage import and the silence scan behind "Apply edit".
  const { ffmpeg } = mediaBinaries()
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-e2e-playhead-'))
  const source = makeFixtureVideo(ffmpeg, workspace, { seconds: 3 })

  await openNav(launched.page, 'footage')
  await launched.page.locator('input[type="file"][accept="video/*"]').first().setInputFiles(source)
  const scanned = await waitForToast(launched.page, /scanned/, 180_000)
  expect(scanned, 'the footage import must report what it found').toMatch(/silence cut/)
  await launched.page.getByRole('button', { name: 'Apply edit' }).click()
  await waitForToast(launched.page, /added to the Timeline/, 60_000)
  await launched.page.waitForSelector('main[data-view="timeline"]', { timeout: 60_000 })
  // `data-view` flips before AnimatePresence has finished swapping screens, and
  // the Studio has a slider with the same accessible name — so wait for the
  // Timeline screen's own element before asserting on its playhead.
  await launched.page.locator('[data-timeline-announcer]').waitFor({ state: 'attached', timeout: 30_000 })

  const slider = launched.page.getByRole('slider', { name: 'Playhead' })
  await expect(slider).toBeVisible()
  // Reachable with Tab, not skipped: this was tabIndex -1 before Phase 3.
  await expect(slider).toHaveAttribute('tabindex', '0')
  await slider.focus()
  await expect(slider).toBeFocused()

  const max = Number(await slider.getAttribute('aria-valuemax'))
  expect(Number.isFinite(max), `the playhead reports a range (aria-valuemax=${max})`).toBe(true)
  expect(max, 'the imported 3s clip must give the ruler a real range').toBeGreaterThan(0)
  await launched.page.keyboard.press('ArrowRight')
  await launched.page.keyboard.press('End')
  await expect(slider).toHaveAttribute('aria-valuenow', String(max))
  await launched.page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuenow', '0')
  const valueText = await slider.getAttribute('aria-valuetext')
  // `fmtClock` (src/lib/utils.ts) renders tenths: "0:00.0 of 0:03.0". Asserting a
  // whole-second shape failed against the app's own correct output.
  expect(valueText, 'the slider reads out a time').toMatch(/^\d+:\d{2}\.\d of \d+:\d{2}\.\d$/)
  expect(await slider.getAttribute('aria-keyshortcuts')).toContain('ArrowLeft')
})

test('the timeline announces what it cannot show', async () => {
  // Not inherited from the test above: this one opens the Timeline itself, so a
  // failure there cannot make this look like a broken live region.
  await dismissOnboarding(launched.page)
  await ensureProjectOpen(launched.page)
  await openNav(launched.page, 'timeline')
  const live = launched.page.locator('[data-timeline-announcer]')
  await expect(live).toHaveAttribute('aria-live', 'polite')
  await expect(live).toHaveAttribute('role', 'status')
})

test('a missing speech engine offers a real download, not just a sentence', async () => {
  await dismissOnboarding(launched.page)
  await ensureProjectOpen(launched.page)
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
