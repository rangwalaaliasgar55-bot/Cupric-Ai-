import { useMemo, useState } from 'react'
import { Boxes, Check, Copy, FileText, Palette, Search, Sparkles, Layers } from 'lucide-react'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { StockBrowser } from '../components/StockBrowser'
import { EmptyState } from '../components/EmptyState'
import { Segmented } from '../components/Segmented'
import type { LibraryItem } from '../types/project'
import { useActiveProject, useProjectStore } from '../state/useProjectStore'
import { EFFECTS } from '../lib/effects'
import { GRADIENT_PRESETS } from '../lib/gradients'
import { PackBrowser } from './library/PackBrowser'
import { LibrariesDev } from './library/LibrariesDev'
import { copyText, relTime } from '../lib/utils'

/* Built-in starter library: rundowns, arena, presets, effects, backgrounds. */
const STATIC_ITEMS: LibraryItem[] = [
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
        { id: 'q2', from: 4, to: 6, type: 'attribution', copy: '— NewBrand', motion: 'fade up' },
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
      scenes: [{ id: 's1', from: 0, to: 3, type: 'logo', copy: 'NEWBRAND', motion: 'spring scale-in with overshoot' }],
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
    name: 'NewBrand Dark — Lime',
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

function buildResourceItems(): LibraryItem[] {
  const now = new Date().toISOString()
  const effects: LibraryItem[] = EFFECTS.map((e) => ({
    id: `fx-${e.id}`,
    kind: 'effect' as const,
    name: e.name,
    updatedAt: now,
    effectId: e.id,
    effectKind: e.kind,
    description: e.description,
    promptCue: e.promptCue,
  }))
  const backgrounds: LibraryItem[] = GRADIENT_PRESETS.map((g) => ({
    id: `bg-${g.id}`,
    kind: 'background' as const,
    name: g.name,
    updatedAt: now,
    gradientId: g.id,
    css: g.css,
  }))
  return [...effects, ...backgrounds]
}

type Filter = 'all' | 'rundown' | 'arena' | 'preset' | 'effect' | 'background'

const KIND_LABEL: Record<LibraryItem['kind'], string> = {
  rundown: 'Rundown',
  arena: 'Arena asset',
  preset: 'Preset',
  effect: 'Effect',
  background: 'Background',
}

export function Library() {
  const project = useActiveProject()
  const patchRundown = useProjectStore((s) => s.patchRundown)
  const addArenaAsset = useProjectStore((s) => s.addArenaAsset)
  const patchStudio = useProjectStore((s) => s.patchStudio)
  const pushToast = useProjectStore((s) => s.pushToast)

  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [applied, setApplied] = useState<Set<string>>(new Set())

  const ITEMS = useMemo(() => [...STATIC_ITEMS, ...buildResourceItems()], [])

  const items = ITEMS.filter((i) => (filter === 'all' ? true : i.kind === filter)).filter((i) => {
    if (!query.trim()) return true
    const q = query.toLowerCase()
    if (i.name.toLowerCase().includes(q)) return true
    if (i.kind === 'arena' && i.style.toLowerCase().includes(q)) return true
    if (i.kind === 'preset' && i.font.toLowerCase().includes(q)) return true
    if (i.kind === 'effect' && (i.description.toLowerCase().includes(q) || i.effectKind.includes(q))) return true
    if (i.kind === 'background' && i.gradientId.includes(q)) return true
    return false
  })

  async function use(item: LibraryItem) {
    if (item.kind === 'effect') {
      const ok = await copyText(item.promptCue)
      pushToast(ok ? 'success' : 'info', ok ? `Effect cue “${item.name}” copied` : 'Could not copy — select and copy manually')
      setApplied((s) => new Set(s).add(item.id))
      return
    }
    if (item.kind === 'background') {
      if (project) {
        // Backgrounds are real Studio presets, so apply instead of just copying.
        patchStudio(project.id, { backgroundId: item.gradientId })
        pushToast('success', `“${item.name}” set as the Studio background for “${project.name}”`)
      } else {
        const ok = await copyText(item.css)
        pushToast(ok ? 'success' : 'info', ok ? `Background CSS “${item.name}” copied` : 'Could not copy CSS')
      }
      setApplied((s) => new Set(s).add(item.id))
      return
    }

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
    } else if (item.kind === 'preset') {
      useProjectStore.setState((s) => ({
        projects: s.projects.map((p) =>
          p.id === project.id
            ? {
                ...p,
                brandKit: { ...p.brandKit, colors: item.colors, font: item.font },
                updatedAt: new Date().toISOString(),
              }
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
          <p className="cu-eyebrow">Resources</p>
          <h1 className="cu-page-title mt-1">Library</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Glass materials, transitions, animations, gradients, effects and voice commands — fetched from the NewBrand
            repository and addable straight to the Studio. Rundowns and brand presets live below.
          </p>
        </div>

        <PackBrowser />
        <LibrariesDev />

        <div className="border-t border-line pt-5">
          <h2 className="text-sm font-semibold">Project starters</h2>
          <p className="text-xs text-muted">Rundowns, Arena prompts and brand presets that seed a project.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the library…"
              aria-label="Search library"
              className="h-9 w-full cu-panel pl-9 pr-3 text-sm placeholder:text-muted/70"
            />
          </div>
          <Segmented
            label="Filter library"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'rundown', label: 'Rundowns' },
              { value: 'arena', label: 'Arena' },
              { value: 'preset', label: 'Presets' },
              { value: 'effect', label: 'Effects' },
              { value: 'background', label: 'Backgrounds' },
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
        <StockBrowser />
      </div>
    </div>
  )
}

function LibraryCard({ item, used, onUse }: { item: LibraryItem; used: boolean; onUse: () => void }) {
  const Icon =
    item.kind === 'rundown'
      ? FileText
      : item.kind === 'arena'
        ? Boxes
        : item.kind === 'preset'
          ? Palette
          : item.kind === 'effect'
            ? Sparkles
            : Layers

  return (
    <Card className="flex flex-col gap-3 p-4 transition-colors duration-150 hover:border-text/20">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel-alt text-muted">
          <Icon size={16} />
        </div>
        <Badge tone={item.kind === 'preset' || item.kind === 'background' ? 'info' : item.kind === 'effect' ? 'accent' : 'neutral'}>
          {KIND_LABEL[item.kind]}
        </Badge>
      </div>

      {item.kind === 'background' && (
        <div
          className="h-16 w-full rounded-lg border border-line"
          aria-hidden
          ref={(node) => {
            // The preset ships raw CSS (the same string the Studio paints and
            // the copy button hands over), so it is applied directly.
            if (node) node.setAttribute('style', item.css)
          }}
        />
      )}

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
        {item.kind === 'effect' && (
          <div className="mt-0.5 space-y-1">
            <div className="text-xs capitalize text-muted">{item.effectKind}</div>
            <p className="line-clamp-2 text-xs text-muted">{item.description}</p>
          </div>
        )}
        {item.kind === 'background' && (
          <div className="mt-0.5 text-xs text-muted">Stage / thumbnail only — chrome stays flat</div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="text-xs text-muted">
          {item.kind === 'effect' || item.kind === 'background' ? 'Resource' : `Updated ${relTime(item.updatedAt)}`}
        </span>
        {used ? (
          <Badge tone="accent">
            <Check size={11} />
            {item.kind === 'effect' || item.kind === 'background' ? 'Copied' : 'Added'}
          </Badge>
        ) : (
          <Button size="sm" variant="outline" onClick={onUse}>
            {item.kind === 'effect' || item.kind === 'background' ? (
              <>
                <Copy size={12} /> Copy
              </>
            ) : (
              'Use in current project'
            )}
          </Button>
        )}
      </div>
    </Card>
  )
}
