import type { Project } from '../types/project'
import { nowIso } from './utils'

/** No fake projects: first launch starts clean, and every project/media item is user-created. */
export function makeSeedProjects(): Project[] {
  return []
}

export const seedTimestamp = nowIso
