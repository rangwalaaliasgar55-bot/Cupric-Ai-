/**
 * JOB 6 — prop configs for Cupric's own lab components.
 *
 * framecn and ObsidianUI components ship customizer configs, so the inspector
 * and the agent can edit their text. Cupric's own components in
 * `src/lab/components/` had none, which is why the "Hold to delete" pill was a
 * hard-coded string nobody could change. Anything in here becomes an editable
 * field in the Studio inspector and a prop the agent may set.
 */
import type { ComponentConfig } from './framecn/customizer-config'
import { FPS, H, W } from './framecn/customizer-config'

const base = (componentName: string, seconds: number, controls: ComponentConfig['controls']): ComponentConfig => ({
  componentName, controls, compositionWidth: W, compositionHeight: H,
  durationInFrames: Math.round(seconds * FPS), fps: FPS, importPath: `@/lab/components#${componentName}`,
})

export const CUPRIC_CONFIGS: Record<string, ComponentConfig> = {
  'hold-to-delete': base('HoldToDelete', 4, {
    label: { type: 'text', default: 'Hold to delete', label: 'Button text' },
    doneLabel: { type: 'text', default: 'Deleted', label: 'Text after it completes' },
  }),
}
