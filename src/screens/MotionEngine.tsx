import React, { useState } from 'react'
import { Sparkles, Layers, Layout, Play } from 'lucide-react'
import InteractiveShowcase from '../engine-showcase/InteractiveShowcase'
import TemplatePlayground from '../components/TemplatePlayground'
import AssetGallery from '../components/AssetGallery'

export function MotionEngine() {
  const [tab, setTab] = useState<'showcase' | 'templates' | 'gallery'>('showcase')

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      {/* Top Engine Navigation */}
      <header className="flex shrink-0 items-center justify-between border-b border-line bg-panel/60 px-6 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/20 text-accent border border-accent/30 shadow-lg shadow-accent/10">
            <Sparkles size={20} />
          </div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 whitespace-nowrap text-base font-semibold tracking-tight text-text">
              React Motion Design Engine
              <span className="rounded-full bg-accent/10 border border-accent/30 px-2 py-0.5 text-[10px] font-mono text-accent">
                v2.0 Universal
              </span>
            </h1>
            <p className="truncate text-xs text-muted">
              Deterministic 2D/3D motion graphics, procedural shaders, canvas compositor & AI scene generator
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-line bg-panel-alt p-1">
          <button
            type="button"
            onClick={() => setTab('showcase')}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              tab === 'showcase'
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-muted hover:bg-panel hover:text-text'
            }`}
          >
            <Play size={14} />
            Live Motion Engine
          </button>
          <button
            type="button"
            onClick={() => setTab('templates')}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              tab === 'templates'
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-muted hover:bg-panel hover:text-text'
            }`}
          >
            <Layout size={14} />
            Templates & AI
          </button>
          <button
            type="button"
            onClick={() => setTab('gallery')}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              tab === 'gallery'
                ? 'bg-accent text-accent-ink shadow-sm'
                : 'text-muted hover:bg-panel hover:text-text'
            }`}
          >
            <Layers size={14} />
            Asset Catalog
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className={tab === 'showcase' ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-y-auto'}>
        {tab === 'showcase' && (
          // The showcase is a complete editor; it must fill exactly this
          // panel — never the window — so nothing is clipped off-screen.
          <div className="h-full min-h-0 p-3">
            <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-line">
              <InteractiveShowcase />
            </div>
          </div>
        )}

        {tab === 'templates' && (
          // These engine surfaces are authored for a dark stage (white type,
          // glass chips), exactly like the Apex editor; in light mode they sit
          // on that stage instead of washing out against a light page.
          <div className="p-3">
            <div className="min-h-full rounded-2xl border border-line bg-[#07080d] p-6 text-zinc-100 [color-scheme:dark]">
              <div className="mx-auto max-w-7xl space-y-6">
                <TemplatePlayground />
              </div>
            </div>
          </div>
        )}

        {tab === 'gallery' && (
          <div className="p-3">
            <div className="min-h-full rounded-2xl border border-line bg-[#07080d] text-zinc-100 [color-scheme:dark]">
              <AssetGallery />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
