// Cupric re-implementation of an ObsidianUI idea (MIT) — see src/lab/obsidian/LICENSE.
import { TextStream } from '../obsidian'
import { OBSIDIAN_CONFIGS } from '../obsidian/configs'
import { FramecnStage } from '../framecn/stage'

export default function Demo() {
  return <FramecnStage component={TextStream} config={OBSIDIAN_CONFIGS['ob-text-stream']} />
}
