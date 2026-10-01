// NewBrand original, after a motion-board reference (see src/lab/obsidian/board.tsx).
import { SearchResults } from '../obsidian'
import { OBSIDIAN_CONFIGS } from '../obsidian/configs'
import { FramecnStage } from '../framecn/stage'

export default function Demo() {
  return <FramecnStage component={SearchResults} config={OBSIDIAN_CONFIGS['mb-search-results']} />
}
