/**
 * JOB 4 — ask the brain (JOB 1 router, strong route) for a NEW animation,
 * validate it with agentCode.ts, and repair at most twice. Anything else is an
 * honest refusal: nothing is added, and the reason quotes the rule.
 */
import { getIpc } from '../bridge'
import { AGENT_ANIMATION_FEWSHOTS } from './agentCodeExamples'
import { AGENT_CODE_RULES, describeRejections, readAgentAnimation, validateAgentCodeIsolated, type AgentAnimationSpec } from './agentCode'

export const MAX_REPAIR_ROUNDS = 2

export async function writeAgentAnimation(instruction: string, durationSec: number): Promise<{ ok: true; spec: AgentAnimationSpec; rounds: number } | { ok: false; message: string }> {
  const ipc = getIpc()
  if (!ipc) return { ok: false, message: 'Writing new animations needs the desktop app’s brain; nothing was added.' }
  const rules = Object.values(AGENT_CODE_RULES).map((r) => `- ${r.id}: ${r.text}`).join('\n')
  let previous: { code: string; problems: string } | null = null
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    let raw: unknown
    try {
      raw = await ipc.invoke('agent:generateAnimation', { instruction, durationSec, rules, fewShots: AGENT_ANIMATION_FEWSHOTS, previous })
    } catch {
      return { ok: false, message: 'offline brain — writing a new animation needs a live model, so nothing was added. Existing components still work.' }
    }
    const value = { ...(raw && typeof raw === 'object' ? raw : {}), durationSec } as Record<string, unknown>
    try {
      // Off-thread first (hard 2 s timeout), so hostile or runaway code can never freeze the app.
      const isolated = await validateAgentCodeIsolated(String(value.code || ''), (value.props && typeof value.props === 'object' ? value.props : {}) as Record<string, unknown>)
      if (!isolated.ok) throw new Error(describeRejections(isolated.rejections))
      return { ok: true, spec: readAgentAnimation(value), rounds: round }
    } catch (e) {
      previous = { code: String(value.code || '').slice(0, 16_000), problems: (e as Error).message }
    }
  }
  return { ok: false, message: `Cupric could not write an animation that passes its safety rules after ${MAX_REPAIR_ROUNDS} repairs, so nothing was added.\n${previous?.problems ?? ''}` }
}
