/**
 * Library favourites + recently-used, and the pure maths behind the windowed
 * pack grid. DOM-guarded: Node checks bundle this file with no localStorage.
 */

const FAV_KEY = 'cupric.packs.favourites'
const RECENT_KEY = 'cupric.packs.recent'
/** How many recently-applied items are remembered. */
export const RECENT_LIMIT = 40

function read(key: string): string[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, ids: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    /* storage full / unavailable — preference just isn't saved */
  }
}

export const loadFavourites = (): string[] => read(FAV_KEY)
export const loadRecent = (): string[] => read(RECENT_KEY)

/** Toggle an item in favourites; returns the new list. */
export function toggleFavourite(id: string, current = loadFavourites()): string[] {
  const next = current.includes(id) ? current.filter((v) => v !== id) : [id, ...current]
  write(FAV_KEY, next)
  return next
}

/** Put an item at the front of recently-used (deduped, capped); returns the new list. */
export function pushRecent(id: string, current = loadRecent()): string[] {
  const next = [id, ...current.filter((v) => v !== id)].slice(0, RECENT_LIMIT)
  write(RECENT_KEY, next)
  return next
}

export type PackFilter = 'all' | 'favourites' | 'recent'

/** Apply the favourites/recent filter; recent keeps most-recent-first order. */
export function filterPackItems<T extends { id: string }>(items: T[], filter: PackFilter, favourites: string[], recent: string[]): T[] {
  if (filter === 'all') return items
  if (filter === 'favourites') {
    const fav = new Set(favourites)
    return items.filter((item) => fav.has(item.id))
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  return recent.map((id) => byId.get(id)).filter((item): item is T => Boolean(item))
}

/**
 * Which rows of a fixed-row-height grid intersect the viewport (plus overscan).
 * `gridTop` is the grid's top edge relative to the viewport top (may be negative).
 */
export function windowRange(total: number, cols: number, rowHeight: number, gridTop: number, viewportHeight: number, overscanRows = 3): { start: number; end: number; padTop: number; padBottom: number } {
  const c = Math.max(1, Math.floor(cols))
  const rows = Math.ceil(total / c)
  if (!rows || rowHeight <= 0) return { start: 0, end: total, padTop: 0, padBottom: 0 }
  const firstRow = Math.max(0, Math.floor(-gridTop / rowHeight) - overscanRows)
  const lastRow = Math.min(rows, Math.ceil((viewportHeight - gridTop) / rowHeight) + overscanRows)
  const fr = Math.min(firstRow, rows)
  const lr = Math.max(fr, lastRow)
  return { start: fr * c, end: Math.min(total, lr * c), padTop: fr * rowHeight, padBottom: (rows - lr) * rowHeight }
}
