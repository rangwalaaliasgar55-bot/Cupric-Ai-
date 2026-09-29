/**
 * Autonomous run — the review report.
 *
 * The desktop pipeline writes `review-report.json` + `review-report.md` next to
 * the MP4 so a run can be audited later. The local runner produces the same two
 * documents (in memory, plus a download) from the same facts, including a
 * mechanical render evaluation that never claims more than it measured.
 */
import type { AutomationJob, SceneRundown, StudioDoc } from '../../types/project'
import type { ReviewCheck } from '../production/types'
import type { DesignReport } from '../studio/design'
import type { CandidateResult, RunOutput } from './run'

export type RunArtefacts = {
  job: AutomationJob
  rundown: SceneRundown
  candidates: CandidateResult[]
  doc: StudioDoc
  review: ReviewCheck[]
  design: DesignReport
  output?: RunOutput
  warnings: string[]
  placeholders: number
  generatedAt: string
}

export type RenderEvaluation = {
  valid: boolean
  retryable: boolean
  score: number
  checks: { id: string; ok: boolean; detail: string; fatal?: boolean }[]
  durationSec?: number
  size?: [number, number] | null
  hasAudio?: boolean
}

/**
 * The mechanical gate, mirrored from the desktop pipeline: only things that can
 * be measured on the delivered file, split into fatal and advisory.
 */
export function evaluateOutput(output: RunOutput | undefined, rundown: SceneRundown, expected: { width: number; height: number; fps: number }): RenderEvaluation {
  const checks: RenderEvaluation['checks'] = []
  const add = (id: string, ok: boolean, detail: string, fatal = false) => checks.push({ id, ok: Boolean(ok), detail, fatal })
  add('file-exists', Boolean(output), output ? `Delivered ${output.fileName}` : 'No file was recorded (preview-only run)', true)
  if (!output) return { valid: false, retryable: false, score: 0, checks }
  add('file-size', output.bytes > 4096, `${output.bytes} bytes`, true)
  add('mime-type', /video\//.test(output.mimeType), output.mimeType || 'unknown container', false)
  const expectedDuration = Math.max(0.5, rundown.durationSec)
  add('duration', output.durationSec >= expectedDuration * 0.85, `${output.durationSec.toFixed(2)}s; expected at least ${expectedDuration.toFixed(2)}s`, false)
  add('render-size', expected.width > 0 && expected.height > 0, `recorded from a ${expected.width}×${expected.height} canvas at draft/full scale`, false)
  add('frame-rate', expected.fps === rundown.fps, `${expected.fps}fps matches the rundown`, false)
  const fatalFailed = checks.filter((c) => c.fatal && !c.ok)
  const passed = checks.filter((c) => c.ok).length
  return { valid: fatalFailed.length === 0, retryable: fatalFailed.length > 0, score: Math.round((passed / checks.length) * 100), checks, durationSec: output.durationSec, size: [expected.width, expected.height], hasAudio: false }
}

const bullet = (list: string[]) => (list.length ? list.map((l) => `- ${l}`).join('\n') : '- None')

/** The human-readable report — the same sections as the desktop's markdown. */
export function buildReport(a: RunArtefacts): { markdown: string; evaluation: RenderEvaluation; json: Record<string, unknown> } {
  const [width, height] = a.rundown.size
  const evaluation = evaluateOutput(a.output, a.rundown, { width, height, fps: a.rundown.fps })
  const scenes = a.design.scenes.map((s) => `- ${s.index + 1}. ${s.from}–${s.to}s · ${s.role} · “${s.headline}” — stage ${s.stage}, ${s.headlineFont}${s.emphasisFont ? ` + ${s.emphasisFont}` : ''}, ${s.layout} layout${s.scrim ? ', scrimmed' : ''}`)
  const candidates = a.candidates.map((c) => `- ${c.name}: ${c.score}/100 — ${c.reasons.join(' ')}`)
  const checks = a.review.map((c) => `- ${c.status.toUpperCase()} ${c.label}: ${c.detail}${c.fix ? ` → ${c.fix}` : ''}`)
  const fatal = evaluation.checks.filter((c) => !c.ok && c.fatal)
  const markdown = `# Cupric AI review report

## Brief
${a.job.brief}

## Rundown — ${a.rundown.title}
${a.rundown.durationSec}s · ${a.rundown.fps}fps · ${width}×${height} · ${a.rundown.style}

## Candidate battle (${a.candidates.length} directions, scored locally)
${bullet(candidates)}

Winner: **${a.candidates[0]?.name ?? 'n/a'}** — public voting was never used.

## Designed scenes (${a.design.scenes.length})
${bullet(a.design.notes)}
${scenes.join('\n') || '- No scenes'}

## Craft review — ${a.review.filter((c) => c.status === 'pass').length}/${a.review.length} checks pass
${bullet(checks)}

## Delivered render QA — ${evaluation.score}/100 · ${evaluation.valid ? 'PASS' : 'REVIEW REQUIRED'}
${evaluation.checks.map((c) => `- ${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}`).join('\n') || '- No checks recorded.'}
${fatal.length ? '\nThe render gate failed a required check; the file is delivered anyway so nothing is hidden — re-run when the cause is fixed.' : ''}

## What is left for you
${bullet([
    ...a.review.filter((c) => c.status !== 'pass').map((c) => `${c.label}: ${c.fix ?? c.detail}`),
    ...(a.placeholders ? [`${a.placeholders} placeholder scene(s) need real copy.`] : []),
  ])}

## Warnings
${bullet(a.warnings)}

Generated ${a.generatedAt} · engine: studio-canvas (preview/export parity) · ${a.doc.clips.length} clips on ${a.doc.trackCount} tracks
`
  const json = {
    brief: a.job.brief,
    mode: a.job.mode,
    votingMode: a.job.votingMode,
    rundown: a.rundown,
    design: { direction: a.design.direction.id, score: a.design.score, notes: a.design.notes, scenes: a.design.scenes.map((s) => ({ ...s, textClipIds: s.textClipIds.length })) },
    candidates: a.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score, designScore: c.design.score, reasons: c.reasons })),
    review: a.review,
    renderEvaluation: evaluation,
    output: a.output ? { fileName: a.output.fileName, bytes: a.output.bytes, mimeType: a.output.mimeType, durationSec: a.output.durationSec } : null,
    warnings: a.warnings,
    generatedAt: a.generatedAt,
  }
  return { markdown, evaluation, json }
}

/** A downloadable file for the report, when the browser can make one. */
export function reportFileName(job: Pick<AutomationJob, 'id' | 'brief'>): string {
  const slug = job.brief.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cupric-run'
  return `${slug}-review.md`
}
