import { defineConfig } from '@playwright/test'

/**
 * Playwright config for the Electron E2E suite (Phase 2).
 *
 * Notes on the shape:
 *   - **No browser projects.** This suite drives the packaged Electron app via
 *     Playwright's `_electron`, so no browser download is needed; the CI job
 *     installs Electron through `npm ci`, like every other check.
 *   - **One worker, no parallelism.** Every test launches a real app that takes
 *     the single-instance lock and writes to its own userData directory. Running
 *     two at once would test the lock, not the product.
 *   - **No retries.** A retry turns a flaky product into a green suite. Flaky
 *     here means the app is flaky, and that is worth seeing on the PR.
 *   - **Traces and screenshots on failure**, kept only for failures so the
 *     artifact is small enough to read.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 5 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  outputDir: 'test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'electron-windows' }],
})
