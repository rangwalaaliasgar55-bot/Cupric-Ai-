#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [main, preload, panel, browserClient] = await Promise.all([
  readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../src/app-shell/AskPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/lib/gemini.ts', import.meta.url), 'utf8'),
])
assert.match(main, /ipcMain\.handle\('ai:testConnection'/, 'desktop must expose provider connection tests')
assert.match(main, /provider === 'opencode'[\s\S]*?listOpenCodeModels/, 'OpenCode test must hit its model endpoint')
assert.match(main, /maxOutputTokens: 1/, 'Gemini test must use a minimal completion')
assert.match(preload, /'ai:testConnection'/, 'connection test IPC must be allowlisted')
assert.match(panel, /testConnection\('gemini'\)/, 'Settings must expose Gemini test action')
assert.match(panel, /testConnection\('opencode'\)/, 'Settings must expose OpenCode test action')
assert.match(panel, /providerStatus\[aiProvider\]/, 'active provider status must be visible before editing')
assert.match(main, /interactive-rundown-fallback/, 'interactive rundown failures must be instrumented')
assert.match(main, /source: 'local'[\s\S]*?fallbackReason/, 'interactive rundown must return an honest deterministic fallback')
assert.match(browserClient, /live\.source === 'local'/, 'renderer must preserve the main process fallback label')

console.log('AI connection check passed — provider tests, visible status and interactive deterministic fallback are wired')
