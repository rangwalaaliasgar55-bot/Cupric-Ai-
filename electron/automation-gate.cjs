'use strict'

function isManualArenaGateBlocked(job) {
  return job?.votingMode === 'manual-arena' && job?.manualVoteApproved !== true
}

function approveManualArenaGate(job, stepId, now = new Date().toISOString()) {
  if (!job) throw new Error('Automation job was not found')
  if (job.status !== 'waiting-for-user') throw new Error('This automation job is not waiting at a review gate')
  const step = job.steps?.find((candidate) => candidate.id === stepId)
  if (!step || step.status !== 'waiting-for-user') throw new Error('The requested review gate is no longer waiting')
  return {
    ...job,
    status: 'running',
    manualVoteApproved: true,
    waitingMessage: null,
    updatedAt: now,
    steps: job.steps.map((candidate) => candidate.id === stepId
      ? { ...candidate, status: 'done', progressPct: 100, message: 'Approved by reviewer', completedAt: now }
      : candidate),
  }
}

module.exports = { approveManualArenaGate, isManualArenaGateBlocked }
