/**
 * The full flow, on the real product: import a real video → see it on the
 * timeline → render MP4 with the bundled FFmpeg → probe the file that landed on
 * disk.
 *
 * Why this is the suite that matters: every earlier defect in this project was a
 * seam between two things that each worked alone — the renderer and the bridge
 * (0.10.0's white screen), the timeline and the exporter, the encoder and the
 * file it announced. This test crosses all of those seams in one run, and it
 * verifies the *output file*, not the app's opinion of it.
 */
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expectNoAppErrors, filesNewestFirst, launchApp, makeFixtureVideo, mediaBinaries, probeFile, seedState } from './harness'

test.describe.configure({ mode: 'serial' })

test.describe('Studio: import a real clip and render a real MP4', () => {
  test('imports a generated MP4, shows it on the timeline, and exports a playable file', async () => {
    const { ffmpeg, ffprobe } = mediaBinaries()
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-e2e-media-'))
    const source = makeFixtureVideo(ffmpeg, workspace, { seconds: 3 })
    const sourceProbe = probeFile(ffprobe, source)
    expect(sourceProbe.ok, `the fixture video is not readable: ${sourceProbe.raw}`).toBe(true)
    expect(sourceProbe.video, 'the fixture has no video stream').toBeTruthy()
    expect(sourceProbe.audio, 'the fixture has no audio stream').toBeTruthy()

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-e2e-export-'))
    seedState(userDataDir, {
      projects: [{
        id: 'e2e-export',
        name: 'E2E export',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        doc: null,
      }],
      activeProjectId: 'e2e-export',
      view: 'studio',
      theme: 'dark',
      soundCues: false,
      automationJobs: [],
    })

    const app = await launchApp({ userDataDir })
    try {
      await app.page.waitForSelector('main[data-view="studio"]', { timeout: 90_000 })
      const startedAt = Date.now()

      // ── import through the real file input ────────────────────────────────
      const input = app.page.locator('input[type="file"][accept*="video"]').first()
      await expect(input, 'the Studio import input is missing').toHaveCount(1)
      await input.setInputFiles(source)

      const importToast = await (async () => {
        const toast = app.page.locator('[role="status"]').filter({ hasText: /Imported/i }).first()
        await toast.waitFor({ state: 'visible', timeout: 180_000 })
        return (await toast.innerText()).trim()
      })()
      expect(importToast, 'the import did not report what it did').toMatch(/Imported/i)
      // An import that failed says so in an error toast; a success toast plus a
      // non-zero-duration timeline is the evidence the clip is really there.
      const emptyHint = await app.page.locator('[data-studio-empty-hint]').count()
      expect(emptyHint, 'the Studio still shows its empty-project hint after an import').toBe(0)

      // ── render MP4 with the bundled FFmpeg ────────────────────────────────
      const renderButton = app.page.getByRole('button', { name: /Render MP4|MP4 needs desktop/ }).first()
      await expect(renderButton, 'no Render MP4 button in the Studio toolbar').toBeVisible()
      if (await renderButton.isDisabled()) {
        const title = await renderButton.getAttribute('title')
        throw new Error(`Render MP4 is disabled after importing a clip — the Studio does not think there is anything to render (title: "${title}")`)
      }
      await renderButton.click()

      const savedToast = await (async () => {
        // Success and failure both arrive as toasts; whichever lands first is
        // the result. Waiting only for success would make a failed export look
        // like a timeout.
        const outcome = app.page.locator('[role="status"]').filter({ hasText: /Saved|failed|could not|Refusing|error/i }).first()
        await outcome.waitFor({ state: 'visible', timeout: 300_000 })
        return (await outcome.innerText()).trim()
      })()
      expect(savedToast, `the export failed:\n${savedToast}`).toMatch(/Saved/i)

      // ── verify the file the app actually wrote ────────────────────────────
      const rendersDir = path.join(userDataDir, 'renders')
      const produced = filesNewestFirst(rendersDir, (name) => name.toLowerCase().endsWith('.mp4'))
        .filter((file) => fs.statSync(file).mtimeMs >= startedAt)
      expect(produced.length, `no MP4 was written under ${rendersDir} (the toast said: "${savedToast}")`).toBeGreaterThan(0)

      const output = produced[0]
      const probe = probeFile(ffprobe, output)
      expect(probe.ok, `ffprobe refused the exported file:\n${probe.raw}`).toBe(true)
      expect(probe.video, 'the exported MP4 has no video stream').toBeTruthy()
      expect(probe.audio, 'the source had audio, so the export must too').toBeTruthy()
      expect(probe.sizeBytes, 'the exported file is suspiciously small').toBeGreaterThan(10_000)
      // The clip is 3 s; allowing half a second covers frame rounding without
      // accepting a stub or a truncated file.
      expect(probe.durationSec ?? 0, `exported duration ${probe.durationSec}s does not match the 3s source`).toBeGreaterThan(2.5)
      expect(probe.durationSec ?? 99, `exported duration ${probe.durationSec}s is longer than the 3s source`).toBeLessThan(3.6)

      // ── the app's own claim must match the file ───────────────────────────
      const reportedKb = Number(savedToast.match(/\((\d+) KB\)/)?.[1] ?? NaN)
      if (Number.isFinite(reportedKb)) {
        const actualKb = Math.round(probe.sizeBytes / 1024)
        expect(Math.abs(actualKb - reportedKb), `the toast said ${reportedKb} KB, the file on disk is ${actualKb} KB`).toBeLessThanOrEqual(2)
      }

      expectNoAppErrors(app, [/net::ERR_/, /Failed to load resource/])
    } finally {
      await app.close()
    }
  })

  test('refuses to export an empty timeline instead of writing an empty file', async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cupric-e2e-empty-'))
    seedState(userDataDir, {
      projects: [{ id: 'e2e-empty', name: 'E2E empty', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doc: null }],
      activeProjectId: 'e2e-empty',
      view: 'studio',
      theme: 'dark',
      soundCues: false,
      automationJobs: [],
    })
    const app = await launchApp({ userDataDir })
    try {
      await app.page.waitForSelector('main[data-view="studio"]', { timeout: 90_000 })
      const renderButton = app.page.getByRole('button', { name: /Render MP4|MP4 needs desktop/ }).first()
      await expect(renderButton).toBeVisible()
      // With nothing on the timeline the button must be disabled and explain
      // itself — the alternative (a button that starts a render that fails) is
      // the "wired to nothing" pattern Phase 0 was about.
      expect(await renderButton.isDisabled(), 'Render MP4 is enabled with an empty timeline').toBe(true)
      const reason = await renderButton.getAttribute('title')
      expect(reason && reason.length, 'the disabled render button does not say why').toBeTruthy()

      const rendersDir = path.join(userDataDir, 'renders')
      const before = filesNewestFirst(rendersDir, (name) => name.endsWith('.mp4')).length
      await app.page.waitForTimeout(2000)
      const after = filesNewestFirst(rendersDir, (name) => name.endsWith('.mp4')).length
      expect(after, 'an empty timeline produced a render').toBe(before)
    } finally {
      await app.close()
    }
  })
})
