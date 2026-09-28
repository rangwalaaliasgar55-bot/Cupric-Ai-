// Pure ranking for the command palette (tested in check-upgrades-batch1).
/** Rank: prefix match > word-start match > contains > subsequence. Deterministic. */
export function rankCommands<T extends { label: string; keywords?: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const score = (it: T) => {
    const hay = `${it.label} ${it.keywords ?? ''}`.toLowerCase()
    if (it.label.toLowerCase().startsWith(q)) return 4
    if (hay.split(/[\s·/-]+/).some((w) => w.startsWith(q))) return 3
    if (hay.includes(q)) return 2
    let i = 0
    for (const ch of hay) if (ch === q[i]) i++
    return i === q.length ? 1 : 0
  }
  return items.map((it, i) => ({ it, s: score(it), i })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.it)
}
