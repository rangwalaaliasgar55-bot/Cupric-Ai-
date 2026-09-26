#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
const require = createRequire(import.meta.url)
const { approveManualArenaGate, isManualArenaGateBlocked } = require('../electron/automation-gate.cjs')

const waiting = {
  id: 'job-1',
  votingMode: 'manual-arena',
  status: 'waiting-for-user',
  manualVoteApproved: false,
  waitingMessage: 'Vote, then approve',
  steps: [
    { id: 'candidates', status: 'waiting-for-user', progressPct: 70 },
    { id: 'footage', status: 'pending', progressPct: 0 },
  ],
}
assert.equal(isManualArenaGateBlocked(waiting), true)
const resumed = approveManualArenaGate(waiting, 'candidates', '2026-09-26T00:00:00.000Z')
assert.equal(isManualArenaGateBlocked(resumed), false, 'approval must bypass the gate on resumed pipeline run')
assert.equal(resumed.status, 'running')
assert.equal(resumed.steps[0].status, 'done')
assert.equal(resumed.steps[1].status, 'pending', 'the next stage must remain available to run')
assert.equal(waiting.status, 'waiting-for-user', 'approval must not mutate the persisted snapshot in place')
assert.throws(() => approveManualArenaGate(resumed, 'candidates'), /not waiting/)
assert.throws(() => approveManualArenaGate(waiting, 'footage'), /no longer waiting/)

const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8')
const approveHandler = main.match(/ipcMain\.handle\('automation:approveStep'[\s\S]*?\n}\)/)?.[0] ?? ''
assert.match(approveHandler, /approveManualArenaGate/, 'IPC approval must use the validated gate transition')
assert.match(approveHandler, /runAutomationPipeline\(job\.id\)/, 'IPC approval must schedule the next pipeline run')
assert.match(main, /automation-gate-resumed[\s\S]*?nextStep: 4/, 'pipeline must instrument arrival at the stage after the gate')

console.log('automation gate check passed — IPC approval clears the gate, schedules resume and exposes stage 4')
