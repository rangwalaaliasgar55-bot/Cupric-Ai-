#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [main, preload, panel] = await Promise.all([
  readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-shell/AskPanel.tsx', import.meta.url), 'utf8'),
])
assert.match(main, /autoUpdater\.autoDownload = true/, 'updates must download automatically')
assert.match(main, /UPDATE_CHECK_INTERVAL_MS = 4 \* 60 \* 60 \* 1000/, 'running app must check every four hours')
assert.match(main, /ipcMain\.handle\('updater:install'/, 'desktop must expose immediate install')
assert.match(main, /quitAndInstall\(false, true\)/, 'downloaded update must restart into the new release')
assert.match(preload, /'updater:install'/, 'install IPC must be allowlisted')
assert.match(panel, /Update & restart/, 'Settings must surface the immediate update action')
assert.match(panel, /event\?\.status === 'downloaded'/, 'downloaded event must reveal the update action')
console.log('updater check passed — automatic checks/downloads and explicit update-and-restart are wired')
