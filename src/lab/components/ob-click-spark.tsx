// NewBrand re-implementation of an ObsidianUI idea (MIT) — see src/lab/obsidian/LICENSE.
import { ClickSpark } from '../obsidian'
import { OBSIDIAN_CONFIGS } from '../obsidian/configs'
import { FramecnStage } from '../framecn/stage'

export default function Demo() {
  return <FramecnStage component={ClickSpark} config={OBSIDIAN_CONFIGS['ob-click-spark']} />
}
