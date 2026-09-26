import { useState } from 'react'
import { Boxes, Check, FileText, Palette, Search } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { Segmented } from '../components/Segmented'
import type { LibraryItem } from '../types/project'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { relTime } from '../lib/utils'

/* Mocked cross-project library: 8 sample entries across the three kinds. */
const ITEMS: LibraryItem[] = [
  {
    id: 'lib-r1',
    kind: 'rundown',
    name: 'Aurora — 12s Launch Bumper',
    updatedAt: new Date(Date.now() - 42 * 60_000).toISOString(),
    rundown: {
      title: 'Aurora — 12s Launch Bumper',
      durationSec: 12,
      fps: 30,
      size: [1920, 1080],
      style: 'Kinetic type, dark base, lime accent, tabular numerals',
      scenes: [
        { id: 'l1', from: 0, to: 3, type: 'logo', copy: 'AURORA', motion: 'spring scale-in with overshoot' },
        { id: 'l2', from: 3, to: 7.5, type: 'hook', copy: 'Edit video with a sentence.', motion: 'word-by-word reveal' },
        { id: 'l3', from: 7.5, to: 12, type: 'cta', copy: 'aurora.app — Oct 2', motion: 'counter + fade' },
      ],
      arenaPrompt:
        'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: one file, inline CSS/JS, no build step. Root #scene exactly 1920x1080 px. Duration 12s at 30fps. Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. Kinetic type, dark base, lime accent.',
    },
  },
  {
    id: 'lib-r2',
    kind: 'rundown',
    name: 'Quote Card — “Make it obvious”',
    updatedAt: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
    rundown: {
      title: 'Quote Card — Make it obvious',
      durationSec: 6,
      fps: 30,
      size: [1080, 1920],
      style: 'Kinetic typography, word-by-word reveal, one lime highlight word',
      scenes: [
        { id: 'q1', from: 0, to: 4, type: 'quote', copy: '“Make it obvious.”', motion: 'word-by-word reveal, 9 words/s' },
        { id: 'q2', from: 4, to: 6, type: 'attribution', copy: '— Cupric AI', motion: 'fade up' },
      ],
      arenaPrompt:
        'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: one file, inline CSS/JS, no build step. Root #scene exactly 1080x1920 px. Duration 6s at 30fps. Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. Kinetic typography.',
    },
  },
  {
    id: 'lib-r3',
    kind: 'rundown',
    name: 'Logo Sting — 3s Pulse',
    updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString(),
    rundown: {
      title: 'Logo Sting — 3s Pulse',
      durationSec: 3,
      fps: 30,
      size: [1080, 1080],
      style: 'Single mark, spring scale 0.96→1 with overshoot, ring wipe',
      scenes: [{ id: 's1', from: 0, to: 3, type: 'logo', copy: 'NORTHFRAME', motion: 'spring scale-in with overshoot' }],
      arenaPrompt:
        'Build a SINGLE FILE index.html motion-graphics piece. HARD CONSTRAINTS: one file, inline CSS/JS, no build step. Root #scene exactly 1080x1080 px. Duration 3s at 30fps. Implement window.__seek(t) — all motion must be a pure function of t, no CSS animations, no setTimeout, no Math.random in the frame loop. Single mark, spring overshoot.',
    },
  },
  {
    id: 'lib-a1',
    kind: 'arena',
    name: 'neon-grid-loops.html',
    updatedAt: new Date(Date.now() - 5 * 60 * 60_000).toISOString(),
    prompt: 'Neon grid perspective loop, cyan/lime duotone, camera dolly on the beat.',
    style: 'Neon grid, cyan + lime duotone',
  },
  {
    id: 'lib-a2',
    kind: 'arena',
    name: 'paper-cutout-scenes.html',
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    prompt: 'Paper-cutout collage scenes, warm paper tones, hard shadows, snap transitions.',
    style: 'Paper cutout, warm tones',
  },
  {
    id: 'lib-a3',
    kind: 'arena',
    name: 'chrome-type-sting.html',
    updatedAt: new Date(Date.now() - 4 * 24 * 60 * 60_000).toISOString(),
    prompt: 'Chrome liquid type sting, reflective gradient fills, slow orbit + snap settle.',
    style: 'Chrome type, reflective',
  },
  {
    id: 'lib-p1',
    kind: 'preset',
    name: 'NF Dark — Lime',
    updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    colors: ['#0B0B10', '#15151B', '#C8F542', '#F4F1EA', '#9A9AA5'],
    font: 'Inter Variable',
  },
  {
    id: 'lib-p2',
    kind: 'preset',
    name: 'Studio Light — Blue',
    updatedAt: new Date(Date.now() - 9 * 24 * 60 * 60_000).toISOString(),
    colors: ['#F3F2ED', '#FFFFFF', '#4FB6E8', '#191922', '#63636E'],
    font: 'Inter Variable',
  },
]

type Filter = 'all' | 'rundown' | 'arena' | 'preset'

const KIND_LABEL: Record<LibraryItem['kind'], string> = {
  rundown: 'Rundown',
  arena: 'Arena asset',
  preset: 'Preset',
}

export function Library() {
  const project = useActiveProject()
  const patchRundown = useProjectStore((s) => s.patchRundown)
  const addArenaAsset = useProjectStore((s) => s.addArenaAsset)
  const pushToast = useProjectStore((s) => s.pushToast)

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState<Set<string>>(new Set())

  const items = ITEMS.filter((i) => (filter === 'all' ? true : i.kind === filter)).filter((i) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    return (
      i.name.toLowerCase().includes(q) ||
      (i.kind === 'arena' && i.style.toLowerCase().includes(q)) ||
      (i.kind === 'preset' && i.font.toLowerCase().includes(q))
    )
  })

  function use(item: LibraryItem) {
    if (!project) {
      pushToast('info', 'Create or open a project first')
      useProjectStore.getState().setView('home')
      return
    }
    if (item.kind === 'rundown') {
      patchRundown(project.id, item.rundown)
      pushToast('success', `Rundown copied into “${project.name}” — review it in the Brief`)
    } else if (item.kind === 'arena') {
      addArenaAsset(project.id, {
        name: item.name,
        status: 'prompt-ready',
        prompt: item.prompt,
        htmlFileName: null,
        thumbnailDataUrl: null,
      })
      pushToast('success', `${item.name} added to “${project.name}” (prompt-ready)`)
    } else {
      // Brand kit preset — applied through the store's project update path.
      useProjectStore.setState((s) => ({
        projects: s.projects.map((p) =>
          p.id === project.id
            ? { ...p, brandKit: { ...p.brandKit, colors: item.colors, font: item.font }, updatedAt: new Date().toISOString() }
            : p,
        ),
      }))
      pushToast('success', `Brand kit “${item.name}” applied to “${project.name}”`)
    }
    setApplied((s) => new Set(s).add(item.id))
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-6 py-6">
        <div>
          <h1 className="text-lg font-bold">Library</h1>
          <p className="text-sm text-muted">
            Rundowns, Arena assets and brand presets across all projects — drop one into the active project.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the library…"
              aria-label="Search library"
              className="h-9 w-full rounded-lg border border-line bg-panel pl-9 pr-3 text-sm placeholder:text-muted/70"
            />
          </div>
          <Segmented
            label="Filter library"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'rundown', label: 'Rundowns' },
              { value: 'arena', label: 'Arena assets' },
              { value: 'preset', label: 'Presets' },
            ]}
          />
        </div>

        {items.length === 0 ? (
          <EmptyState icon={Search} title="Nothing matches" hint="Try a different search or filter." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <LibraryCard key={item.id} item={item} used={applied.has(item.id)} onUse={() => use(item)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LibraryCard({ item, used, onUse }: { item: LibraryItem; used: boolean; onUse: () => void }) {
  const Icon = item.kind === 'rundown' ? FileText : item.kind === 'arena' ? Boxes : Palette
  return (
    <Card className="flex flex-col gap-3 p-4 transition-colors duration-150 hover:border-text/20">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel-alt text-muted">
          <Icon size={16} />
        </div>
        <Badge tone={item.kind === 'preset' ? 'info' : 'neutral'}>{KIND_LABEL[item.kind]}</Badge>
      </div>
      <div>
        <div className="truncate text-sm font-semibold">{item.name}</div>
        {item.kind === 'rundown' && (
          <div className="mt-0.5 text-xs tabular-nums text-muted">
            {item.rundown.durationSec}s · {item.rundown.scenes.length} scenes · {item.rundown.size[0]}×{item.rundown.size[1]}
          </div>
        )}
        {item.kind === 'arena' && <div className="mt-0.5 text-xs text-muted">{item.style}</div>}
        {item.kind === 'preset' && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="flex gap-1">
              {item.colors.map((c) => (
                <span key={c} className="h-4 w-4 rounded-full border border-line" style={{ backgroundColor: c }} />
              ))}
            </span>
            <span className="text-xs text-muted">{item.font}</span>
          </div>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-muted">Updated {relTime(item.updatedAt)}</span>
        {used ? (
          <Badge tone="accent">
            <Check size={11} />
            Added
          </Badge>
        ) : (
          <Button size="sm" variant="outline" onClick={onUse}>
            Use in current project
          </Button>
        )}
      </div>
    </Card>
  )
}
