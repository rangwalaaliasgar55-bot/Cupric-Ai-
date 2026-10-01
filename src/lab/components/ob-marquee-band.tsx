// NewBrand re-implementation of an ObsidianUI idea (MIT) — see src/lab/obsidian/LICENSE.
import { MarqueeBand } from '../obsidian'
import { OBSIDIAN_CONFIGS } from '../obsidian/configs'
import { FramecnStage } from '../framecn/stage'

export default function Demo() {
  return <FramecnStage component={MarqueeBand} config={OBSIDIAN_CONFIGS['ob-marquee-band']} />
}
