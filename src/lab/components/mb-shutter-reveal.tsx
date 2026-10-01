// NewBrand original, after a motion-board reference (see src/lab/obsidian/board.tsx).
import { ShutterReveal } from '../obsidian'
import { OBSIDIAN_CONFIGS } from '../obsidian/configs'
import { FramecnStage } from '../framecn/stage'

export default function Demo() {
  return <FramecnStage component={ShutterReveal} config={OBSIDIAN_CONFIGS['mb-shutter-reveal']} />
}
