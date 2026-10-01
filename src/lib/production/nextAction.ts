/**
 * The agent's single recommended next step, derived only from saved session
 * state. It never approves anything: when approval is next, it says so and
 * points at the manual approval control.
 */
import type { ProductionSession } from './types'
import { openQuestions } from './engine'

export type NextActionId = 'answer' | 'run-all' | 'brief' | 'research' | 'plan' | 'approve' | 'finish' | 'fix' | 'export'
export type NextAction = { id: NextActionId; title: string; why: string; runnable: boolean }

export function nextAction(s: ProductionSession): NextAction {
  const open = openQuestions(s.intake).filter((q) => q.required)
  if (!s.intake.making.trim()) return { id: 'answer', title: 'Tell NewBrand what you are making', why: 'Everything else (structure, pacing, copy slots) is chosen from this one answer. A format starter fills the rest.', runnable: false }
  if (!s.brief) {
    return open.length
      ? { id: 'run-all', title: 'Plan it all up to the preview', why: `${open.length} key question(s) are still blank; they'll become visible assumptions you can edit.`, runnable: true }
      : { id: 'run-all', title: 'Plan it all up to the preview', why: 'All key questions are answered. Brief, research and plan run in one go and stop before approval.', runnable: true }
  }
  if (!s.research) return { id: 'research', title: 'Research references', why: 'Finds matching catalogue cases and resources to cite in the plan.', runnable: true }
  if (!s.plan) return { id: 'plan', title: 'Generate the plan', why: 'Turns the brief and research into shots with confidence levels.', runnable: true }
  if (!s.approved) {
    const low = s.plan.needsApproval.length
    return { id: 'approve', title: 'Review the plan and approve it yourself', why: low ? `${low} item(s) are flagged for your attention. Approval is manual; NewBrand never approves on your behalf.` : 'Nothing is flagged. Approval is still manual; NewBrand never approves on your behalf.', runnable: false }
  }
  if (!s.builtClipIds.length) return { id: 'finish', title: 'Build and polish', why: 'Builds editable clips as one undo step, then runs review-and-fix rounds.', runnable: true }
  const fails = (s.review ?? []).filter((r) => r.status === 'fail')
  if (fails.length) return { id: 'fix', title: `Fix ${fails.length} review issue(s)`, why: fails.slice(0, 2).map((f) => f.label).join(', ') + '. Polish fixes what it safely can and lists the rest for you.', runnable: true }
  return { id: 'export', title: 'Export from Render', why: 'Review passes. Preview and export use the same renderer.', runnable: false }
}
