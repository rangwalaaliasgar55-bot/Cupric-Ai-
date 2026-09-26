/** Adapter contract for indexed third-party resources.
 * The video renderer receives a cue, not arbitrary remote code. This makes
 * icons/blocks editable as normal Studio text/effect clips and keeps the agent
 * from executing untrusted website JavaScript.
 */
export type ExternalResourceCue = {
  resourceId: string
  title: string
  kind: 'icon' | 'block' | 'provider'
  source: string
  editable: boolean
  agentUsable: boolean
  videoInstruction: string
}

export function makeExternalCue(input: {
  id: string
  name: string
  kind: ExternalResourceCue['kind']
  source: string
  editable?: boolean
  agentUsable?: boolean
}): ExternalResourceCue {
  return {
    resourceId: input.id,
    title: input.name,
    kind: input.kind,
    source: input.source,
    editable: input.editable !== false,
    agentUsable: input.agentUsable !== false,
    videoInstruction: `Use ${input.name} as an editable ${input.kind} cue. Preserve its attribution and do not execute remote code. Animate with deterministic frame time; provide a local fallback if the source asset is unavailable.`,
  }
}

export function externalResourcePrompt(cue: ExternalResourceCue): string {
  return [
    `RESOURCE: ${cue.title}`,
    `TYPE: ${cue.kind}`,
    `SOURCE: ${cue.source}`,
    `EDITABLE: ${cue.editable}`,
    `AGENT_USE: ${cue.agentUsable}`,
    cue.videoInstruction,
  ].join('\n')
}
