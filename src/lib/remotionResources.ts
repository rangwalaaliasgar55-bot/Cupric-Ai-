/**
 * Remotion capability bridge for NewBrand's autonomous planner.
 *
 * `resources/remotion/catalog.json` is intentionally a metadata index: it
 * makes upstream templates, fonts and skills searchable without copying an
 * entire upstream monorepo or silently changing its license. The actual
 * render path remains NewBrand's deterministic Studio renderer and Remotion
 * Player preview.
 */

export type RemotionTemplate = { id: string; name: string; package: string; source: string }
export type RemotionFont = { name: string }
export type RemotionSkill = { id: string; name: string; description: string }

export type RemotionPlan = {
  template: string
  font: string
  skills: string[]
  rationale: string
  render: { aspect: '16:9' | '9:16' | '1:1'; fps: 30 | 60; deterministic: true; noRemoteAssets: true }
}

const templateRules: Array<[RegExp, string]> = [
  [/saas|startup|product launch|feature|pricing|changelog|onboarding/i, 'saas-video'],
  [/audio|podcast|voice|music/i, 'audiogram'],
  [/code|developer|programming|software/i, 'code-hike'],
  [/tiktok|reel|short|vertical/i, 'tiktok'],
  [/three|3d|product render/i, 'three'],
  [/still|poster|thumbnail|cover/i, 'still'],
]

const fontRules: Array<[RegExp, string]> = [
  [/code|developer|terminal/i, 'JetBrainsMono'],
  [/luxury|fashion|editorial/i, 'PlayfairDisplay'],
  [/friendly|education|children/i, 'Nunito'],
  [/bold|energy|sport|gaming/i, 'BebasNeue'],
]

/** Choose a compatible upstream capability set without requiring a model call. */
export function planWithRemotionCapabilities(
  brief: string,
  aspect: RemotionPlan['render']['aspect'],
  fps: RemotionPlan['render']['fps'],
): RemotionPlan {
  const template = templateRules.find(([rule]) => rule.test(brief))?.[1] ?? (aspect === '9:16' ? 'tiktok' : 'blank')
  const font = fontRules.find(([rule]) => rule.test(brief))?.[1] ?? 'Inter'
  const skills = ['make-video', 'render-video', 'writing-tests']
  if (/audio|podcast|voice|music/i.test(brief)) skills.unshift('audio-visualizer')
  if (/caption|subtitle|transcript/i.test(brief)) skills.unshift('captions')
  return {
    template,
    font,
    skills,
    rationale: `Selected ${template} for the brief and ${font} with deterministic ${fps}fps rendering.`,
    render: { aspect, fps, deterministic: true, noRemoteAssets: true },
  }
}

/** Build the compact context an LLM needs; avoids sending 1,855 font names. */
export function remotionPlannerContext(plan: RemotionPlan): string {
  return [
    'REMOTION CAPABILITIES (metadata index, source: remotion-dev/remotion)',
    `template=${plan.template}`,
    `font=${plan.font} (use local Inter fallback if unavailable)`,
    `skills=${plan.skills.join(',')}`,
    `render=${plan.render.aspect},${plan.render.fps}fps, deterministic=${plan.render.deterministic}`,
    'Rules: no remote assets, no wall-clock animation, no random frame state; preview and export must match.',
  ].join('\n')
}
