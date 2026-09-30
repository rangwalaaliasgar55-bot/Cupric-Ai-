/**
 * Autonomous pipeline steps — pure, testable, and actually load-bearing.
 *
 * PHASE 0 AUDIT (docs/AUDIT_PHASE0.md §B2) found the eight steps lived inside a
 * closure in main.cjs, where two of them did nothing:
 *
 *   step 2 "Lock rundown"  rewrote rundown.json and patched the same object back
 *                          — no validation, no lock, nothing to fail.
 *   step 5 "Timeline built" wrote {winnerPath, footage, aspect, fps, quality} to
 *                          timeline-plan.json, and nothing ever read it. The
 *                          real timeline was derived later, inside the render,
 *                          from whatever segments the renderer happened to make.
 *
 * This module holds the step logic that can be pure — validation, locking, plan
 * building, plan checking, the mechanical render gate — so it runs in tests and
 * in scripts/check-automation-steps.mjs with real inputs, no Electron and no
 * network. main.cjs keeps only the parts that touch the disk, ffmpeg or the UI.
 *
 * The step ids and titles are also the single source of truth for the progress
 * UI: every step reports its own status, so the screen never shows one spinner
 * for eight pieces of work (the renderer's optimistic copy is a bug, not a spec).
 */
const crypto = require('node:crypto')

/** The eight steps, in order. `id` is stable across releases; `title` is user-facing. */
const STEP_DEFINITIONS = Object.freeze([
  { id: 'workspace', title: 'Project workspace', description: 'Create the job folder and asset directories.' },
  { id: 'rundown', title: 'Draft rundown', description: 'Build the deterministic scene list from the brief, then optionally refine it with the configured model.' },
  { id: 'lock', title: 'Lock the rundown', description: 'Validate every scene against the render contract and freeze it with a content hash.' },
  { id: 'candidates', title: 'Candidate battle', description: 'Write and score render candidates against the contract; the best one wins.' },
  { id: 'footage', title: 'Footage intake', description: 'Probe and prepare any supplied footage, or record honestly that none was supplied.' },
  { id: 'timeline', title: 'Timeline plan', description: 'Turn the locked rundown and the footage into a real, validated edit plan.' },
  { id: 'render', title: 'Render MP4', description: 'Render exactly the segments the plan specifies, in plan order.' },
  { id: 'review', title: 'Render review', description: 'Probe the delivered file against the mechanical gate and write the review report.' },
])

// A scene must carry a beat type and real times. Copy and motion are optional:
// the local planner legitimately writes copy-less visual beats, and refusing to
// lock them broke a real run (scripts/check-automation.mjs caught it).
const REQUIRED_SCENE_FIELDS = Object.freeze(['type', 'from', 'to'])
const MIN_SCENE_SEC = 0.3
const MAX_SCENE_SEC = 60
const COVERAGE_TOLERANCE_SEC = 0.05

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100

/** Stable content hash of what was locked, so a later edit is detectable. */
function rundownHash(rundown) {
  const canonical = JSON.stringify({
    title: String(rundown?.title || ''),
    durationSec: round2(rundown?.durationSec),
    fps: Number(rundown?.fps) || 0,
    size: Array.isArray(rundown?.size) ? rundown.size.map(Number) : [],
    scenes: (rundown?.scenes || []).map((scene) => ({
      type: String(scene?.type || ''),
      copy: String(scene?.copy || ''),
      from: round2(scene?.from),
      to: round2(scene?.to),
      motion: String(scene?.motion || ''),
    })),
  })
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * Step 2's real work: is this rundown renderable?
 *
 * Every issue is named. `ok: false` stops the pipeline at the lock step with a
 * message the user can act on, instead of the old behaviour of writing the file
 * and moving on regardless.
 */
function validateRundown(rundown, { aspect = '9:16', fps = 30 } = {}) {
  const issues = []
  const scenes = Array.isArray(rundown?.scenes) ? rundown.scenes : []
  const durationSec = Number(rundown?.durationSec)

  if (!rundown || typeof rundown !== 'object') issues.push('the rundown is missing entirely')
  if (!Number.isFinite(durationSec) || durationSec <= 0) issues.push('durationSec must be a positive number')
  if (![24, 25, 30, 60].includes(Number(fps))) issues.push(`fps ${fps} is not a supported frame rate`)
  if (!scenes.length) issues.push('the rundown has no scenes')
  if (String(rundown?.title || '').trim().length < 2) issues.push('the rundown has no title')

  const expectedSize = aspect === '9:16' ? [1080, 1920] : aspect === '1:1' ? [1080, 1080] : [1920, 1080]
  const size = Array.isArray(rundown?.size) ? rundown.size.map(Number) : []
  if (size.length !== 2 || size[0] !== expectedSize[0] || size[1] !== expectedSize[1]) {
    issues.push(`size ${JSON.stringify(size)} does not match aspect ${aspect} (${expectedSize.join('x')})`)
  }

  let covered = 0
  let withCopy = 0
  let previousTo = 0
  scenes.forEach((scene, index) => {
    const label = `scene ${index + 1}`
    for (const field of REQUIRED_SCENE_FIELDS) {
      if (scene?.[field] === undefined || scene?.[field] === null || scene?.[field] === '') issues.push(`${label} has no ${field}`)
    }
    const from = Number(scene?.from)
    const to = Number(scene?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      issues.push(`${label} has non-numeric times`)
      return
    }
    const length = to - from
    if (length < MIN_SCENE_SEC) issues.push(`${label} is ${round2(length)}s long (minimum ${MIN_SCENE_SEC}s)`)
    if (length > MAX_SCENE_SEC) issues.push(`${label} is ${round2(length)}s long (maximum ${MAX_SCENE_SEC}s)`)
    if (Math.abs(from - previousTo) > COVERAGE_TOLERANCE_SEC) {
      issues.push(`${label} starts at ${round2(from)}s but the previous scene ended at ${round2(previousTo)}s`)
    }
    if (Number.isFinite(durationSec) && to > durationSec + COVERAGE_TOLERANCE_SEC) issues.push(`${label} ends at ${round2(to)}s, past the ${round2(durationSec)}s rundown`)
    if (String(scene?.copy || '').length > 220) issues.push(`${label} copy is longer than 220 characters`)
    if (String(scene?.copy || '').trim()) withCopy += 1
    previousTo = to
    covered += Math.max(0, length)
  })

  // A rundown where no scene carries any text renders as a silent visual with
  // nothing to read — a planning failure, not a style choice.
  if (scenes.length > 0 && withCopy === 0) issues.push('the rundown has no on-screen copy in any scene')

  if (Number.isFinite(durationSec) && durationSec > 0) {
    const gap = Math.abs(durationSec - covered)
    if (gap > COVERAGE_TOLERANCE_SEC) issues.push(`the scenes cover ${round2(covered)}s of a ${round2(durationSec)}s rundown (${round2(gap)}s unaccounted for)`)
  }

  return {
    ok: issues.length === 0,
    issues,
    // What was checked, so the review report can say what "locked" meant.
    checks: [
      { id: 'duration', detail: `${round2(durationSec)}s` },
      { id: 'fps', detail: `${Number(fps)}fps` },
      { id: 'size', detail: size.join('x') },
      { id: 'scenes', detail: `${scenes.length} scenes covering ${round2(covered)}s` },
      { id: 'contiguous', detail: issues.some((issue) => /starts at/.test(issue)) ? 'gaps found' : 'no gaps or overlaps' },
    ],
  }
}

/** Step 2's output: the lock record that step 5 and the review report read. */
function lockRundown(rundown, { aspect, fps, at = new Date().toISOString() } = {}) {
  const validation = validateRundown(rundown, { aspect, fps })
  if (!validation.ok) return { ok: false, issues: validation.issues, validation }
  return {
    ok: true,
    issues: [],
    validation,
    lock: {
      schemaVersion: 1,
      hash: rundownHash(rundown),
      lockedAt: at,
      durationSec: round2(rundown.durationSec),
      fps: Number(fps),
      sceneCount: rundown.scenes.length,
      size: rundown.size.map(Number),
      checks: validation.checks,
    },
  }
}

/** True when a locked rundown still matches the file on disk. */
function lockMatches(lock, rundown) {
  if (!lock?.hash || !rundown) return false
  return rundownHash(rundown) === lock.hash
}

/**
 * Step 5's real work: the edit plan the render must follow.
 *
 * Structure mirrors what ships (`timeline.json` + `editing-plan.json`), so the
 * artifacts the user can open are produced from this plan rather than derived
 * a second time after the fact:
 *
 *   segments: ordered, each with a source, a duration, and the caption windows
 *             that belong to it. `source` is the candidate HTML for generated
 *             motion or a real footage file path.
 */
function buildTimelinePlan({ rundown, winnerPath, footage = null, aspect = '9:16', fps = 30, quality = 'high', maxDurationSec = 120 } = {}) {
  const issues = []
  if (!winnerPath) issues.push('no winning candidate file was supplied for the generated segment')
  const duration = Math.min(Number(maxDurationSec) || 120, Math.max(1, Number(rundown?.durationSec) || 0))
  if (!(duration > 0)) issues.push('the rundown has no usable duration')

  const captions = (rundown?.scenes || [])
    .map((scene) => ({
      start: round2(Math.max(0, Number(scene.from) || 0)),
      end: round2(Math.min(duration, Number(scene.to) || duration)),
      text: String(scene.copy || '').trim(),
      scene: String(scene.type || 'scene'),
    }))
    .filter((caption) => caption.end > caption.start && caption.text)

  const segments = []
  if (winnerPath) {
    segments.push({
      id: 'generated-1',
      kind: 'generated',
      source: winnerPath,
      durationSec: round2(duration),
      purpose: 'generated motion creative covering the locked rundown',
      transitionIn: 'hard_cut',
      captions: captions.map((caption) => ({ start: caption.start, end: caption.end, text: caption.text })),
    })
  }
  // The intake may describe one media file (`source`) or an explicit clip list;
  // either is enough for footage to take part in the plan.
  const footageClips = Array.isArray(footage?.clips) && footage.clips.length
    ? footage.clips
    : footage?.source
      ? [{ path: footage.source, durationSec: footage.durationSec }]
      : []
  if (footageClips.length) {
    // One segment per supplied file, in the order the intake produced, each
    // capped so the plan cannot silently produce a nine-minute short.
    const clips = footageClips
    clips.forEach((clip, index) => {
      const clipDuration = Math.min(60, Math.max(0.5, Number(clip.durationSec) || 0))
      if (!clip.path) {
        issues.push(`footage clip ${index + 1} has no path`)
        return
      }
      segments.push({
        id: `footage-${index + 1}`,
        kind: 'footage',
        source: String(clip.path),
        durationSec: round2(clipDuration),
        purpose: `supporting footage edit ${index + 1}`,
        transitionIn: index === 0 && segments.length ? 'dissolve' : 'hard_cut',
        captions: [],
      })
    })
  }

  const totalDurationSec = round2(segments.reduce((sum, segment) => sum + segment.durationSec, 0))
  const plan = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    aspect,
    fps: Number(fps),
    quality,
    targetDurationSec: round2(Number(rundown?.durationSec) || 0),
    totalDurationSec,
    generatedSource: winnerPath || null,
    footageUsed: segments.filter((segment) => segment.kind === 'footage').length,
    segments,
    captions: {
      enabled: captions.length > 0,
      mode: 'phrase',
      windows: captions,
      source: 'locked rundown copy',
    },
    inPoint: 0,
    rundownHash: rundown ? rundownHash(rundown) : null,
    issues,
  }
  plan.valid = issues.length === 0 && validateTimelinePlan(plan).ok
  return plan
}

/**
 * A plan is only usable if it can actually be rendered: segments exist, are
 * ordered, have real sources and plausible durations, and the generated segment
 * covers the rundown.
 */
function validateTimelinePlan(plan) {
  const issues = []
  const segments = Array.isArray(plan?.segments) ? plan.segments : []
  if (!plan) return { ok: false, issues: ['no plan was produced'] }
  if (!segments.length) issues.push('the plan has no segments')
  if (!(Number(plan.fps) > 0)) issues.push('the plan has no frame rate')
  if (!plan.generatedSource) issues.push('the plan has no generated segment source')

  segments.forEach((segment, index) => {
    const label = `segment ${index + 1} (${segment?.id || 'unnamed'})`
    if (!segment?.source) issues.push(`${label} has no source file`)
    if (!['generated', 'footage'].includes(segment?.kind)) issues.push(`${label} has an unknown kind "${segment?.kind}"`)
    const duration = Number(segment?.durationSec)
    if (!Number.isFinite(duration) || duration <= 0) issues.push(`${label} has no positive duration`)
    if (duration > 120) issues.push(`${label} is ${round2(duration)}s long (maximum 120s)`)
    if (index === 0 && segment?.kind !== 'generated') issues.push('the first segment must be the generated creative')
  })

  const total = round2(segments.reduce((sum, segment) => sum + (Number(segment?.durationSec) || 0), 0))
  if (Math.abs(total - (Number(plan.totalDurationSec) || 0)) > COVERAGE_TOLERANCE_SEC) {
    issues.push(`the plan claims ${plan.totalDurationSec}s but its segments add up to ${total}s`)
  }
  const expectedGenerated = segments.find((segment) => segment?.kind === 'generated')
  if (expectedGenerated && Math.abs(Number(expectedGenerated.durationSec) - (Number(plan.targetDurationSec) || 0)) > COVERAGE_TOLERANCE_SEC) {
    issues.push(`the generated segment is ${expectedGenerated.durationSec}s but the rundown is ${plan.targetDurationSec}s`)
  }
  return { ok: issues.length === 0, issues, totalDurationSec: total, segments: segments.length }
}

/** The plan in the shapes that ship as timeline.json / editing-plan.json. */
function timelineArtifacts(plan) {
  let cursor = 0
  const timeline = plan.segments.map((segment, index) => {
    const clip = {
      id: `clip-${index + 1}`,
      startSec: round2(cursor),
      durationSec: round2(segment.durationSec),
      source: segment.source,
      kind: segment.kind,
      purpose: segment.purpose,
    }
    cursor += segment.durationSec
    return clip
  })
  const editingPlan = {
    schema_version: '1.0',
    project: { target_duration_s: plan.targetDurationSec, aspect_ratio: plan.aspect, fps: plan.fps },
    sections: [
      {
        role: 'autonomous-edit',
        clips: timeline.map((clip, index) => ({
          id: clip.id,
          source_file: clip.source,
          in_s: 0,
          out_s: clip.durationSec,
          purpose: clip.purpose,
          transition_in: plan.segments[index].transitionIn,
          captions: (plan.segments[index].captions || []).map((caption) => ({ start_s: caption.start, end_s: caption.end, text: caption.text })),
        })),
      },
    ],
    captions: { enabled: plan.captions.enabled, mode: plan.captions.mode, auto_from_transcript: false, source: plan.captions.source },
  }
  return { timeline, editingPlan }
}

/**
 * The mechanical half of the render gate: given what ffprobe reported, does the
 * delivered file satisfy the promise the job made? Pure, so the rules are
 * tested without ffprobe and can never be softened by a retry.
 */
function evaluateMechanicalRender(probe, job = {}, rundown = {}, plan = null) {
  const checks = []
  const add = (id, ok, detail, fatal = false) => checks.push({ id, ok: Boolean(ok), detail, fatal })
  const exists = Boolean(probe?.exists)
  add('file-exists', exists, exists ? `${probe.bytes} bytes` : 'the output file is missing', true)

  const duration = Number(probe?.durationSec) || 0
  const target = Number(rundown?.durationSec) || 0
  const minDuration = Math.max(0.5, target * 0.6)
  add('duration', duration >= minDuration, `${round2(duration)}s of an expected ${round2(target)}s`, true)

  const size = Array.isArray(rundown?.size) ? rundown.size.map(Number) : []
  if (size.length === 2) {
    add('width', Number(probe?.width) === size[0], `${probe?.width}px, expected ${size[0]}px`, true)
    add('height', Number(probe?.height) === size[1], `${probe?.height}px, expected ${size[1]}px`, true)
  }
  add('video-stream', Boolean(probe?.videoCodec), probe?.videoCodec ? `${probe.videoCodec}` : 'no video stream', true)
  add('audio-stream', Boolean(probe?.audioCodec), probe?.audioCodec ? `${probe.audioCodec}` : 'no audio stream', false)
  add('playable', Boolean(probe?.playable), probe?.playable ? 'ffprobe read the delivered file' : 'ffprobe could not read the delivered file', true)
  if (plan) {
    add('plan-followed', Math.abs((Number(probe?.durationSec) || 0) - (Number(plan.totalDurationSec) || 0)) <= Math.max(1, plan.totalDurationSec * 0.1), `delivered ${round2(duration)}s against a ${round2(plan.totalDurationSec)}s plan`, false)
    add('plan-segments', plan.segments.length > 0 && plan.valid !== false, `${plan.segments.length} planned segments`, false)
  }
  add('not-empty', (Number(probe?.bytes) || 0) > 20_000, `${probe?.bytes || 0} bytes`, true)

  const fatal = checks.filter((check) => check.fatal && !check.ok)
  return {
    valid: fatal.length === 0,
    checks,
    failures: fatal.map((check) => `${check.id}: ${check.detail}`),
    // A missing file or an unreadable one is worth exactly one retry; a wrong
    // duration or frame size is a fix, not a retry loop.
    retryable: fatal.some((check) => ['file-exists', 'playable', 'not-empty'].includes(check.id)),
  }
}

/**
 * A one-line summary of a finished (or failed) job, used by the report and by
 * the checks so "what happened" is measured rather than asserted.
 */
function summarizeJob(job, plan = null) {
  return {
    brief: String(job?.brief || '').slice(0, 120),
    steps: (job?.steps || []).map((step) => ({ id: step.id, status: step.status, message: step.message })),
    lockedHash: job?.rundownLock?.hash || null,
    segments: plan ? plan.segments.length : (job?.timelinePlan?.segments || []).length,
    totalDurationSec: plan ? plan.totalDurationSec : (job?.timelinePlan?.totalDurationSec ?? null),
    outputPath: job?.outputPath || null,
    valid: job?.renderEvaluation?.valid ?? null,
  }
}

module.exports = {
  STEP_DEFINITIONS,
  REQUIRED_SCENE_FIELDS,
  MIN_SCENE_SEC,
  MAX_SCENE_SEC,
  COVERAGE_TOLERANCE_SEC,
  rundownHash,
  validateRundown,
  lockRundown,
  lockMatches,
  buildTimelinePlan,
  validateTimelinePlan,
  timelineArtifacts,
  evaluateMechanicalRender,
  summarizeJob,
}
