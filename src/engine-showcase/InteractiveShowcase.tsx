'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  Play,
  Layers,
  Sliders,
  Download,
  Film,
  Cpu,
  Palette,
  Search,
  CheckCircle2,
  Box,
  Code2,
  ChevronRight,
  Tv,
} from 'lucide-react';
import { VideoCompositionProvider, Sequence, AbsoluteFill } from '@/core/composition/VideoCompositionContext';
import { ProceduralBackground } from '@/graphics/backgrounds/ProceduralBackground';
import { KineticText } from '@/motion/text/KineticText';
import { Floating3DObject } from '@/three/objects/Floating3DObject';
import { ParticleGalaxy } from '@/three/particles/ParticleGalaxy';
import { SaaSBrowser, MobileDeviceMockup } from '@/ui/devices/SaaSBrowser';
import { AnimatedMetricCard, AnimatedBarChart } from '@/ui/dashboards/AnimatedMetricCard';
import { EffectStack } from '@/effects/transitions/SceneTransition';
import { Timeline } from '@/editor/timeline/Timeline';
import { Inspector } from '@/editor/inspector/Inspector';
import { COMPLETE_ASSET_CATALOG, CatalogItem } from '@/core/registry/asset-catalog';
import { motionRegistry } from '@/core/registry/motion-registry';

export default function MotionEngineStudio() {
  const [activeTab, setActiveTab] = useState<'editor' | 'catalog' | 'motion' | 'ai'>('editor');
  const [selectedTrackId, setSelectedTrackId] = useState<string>('t3');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Editable composition props synchronized across the canvas, timeline, and inspector
  const [compositionState, setCompositionState] = useState<{
    brandName: string;
    tagline: string;
    primaryColor: string;
    secondaryColor: string;
    ctaText: string;
    textPreset: 'liquid_chrome' | 'character_stagger' | 'word_reveal' | 'cinematic_blur' | 'neon_glow' | 'scramble' | 'typewriter';
    bgType: 'aurora' | 'cyber_grid' | 'fluid_mesh' | 'matrix_rain' | 'holographic_wave' | 'nebula';
    threeType: 'knot' | 'torus' | 'icosahedron' | 'cube' | 'ring' | 'sphere';
    speed: number;
    fps: number;
    durationInFrames: number;
  }>({
    brandName: 'Apex Engine',
    tagline: 'The Ultimate React Motion Graphics & 3D Operating System',
    primaryColor: '#6366f1',
    secondaryColor: '#ec4899',
    ctaText: 'Deploy with Apex',
    textPreset: 'liquid_chrome',
    bgType: 'aurora',
    threeType: 'knot',
    speed: 1.0,
    fps: 30,
    durationInFrames: 240, // 8s
  });

  const [aiPrompt, setAiPrompt] = useState('Create a futuristic high-growth SaaS product video with 3D glass physics');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);

  // Inspector element representation
  const selectedInspectorItem = {
    id: selectedTrackId,
    name:
      selectedTrackId === 't1'
        ? 'Procedural Aurora BG'
        : selectedTrackId === 't2'
        ? 'Floating 3D Knot'
        : selectedTrackId === 't3'
        ? 'Kinetic Headline Text'
        : selectedTrackId === 't4'
        ? 'Particle Galaxy Simulation'
        : selectedTrackId === 't5'
        ? 'Performance Metric Cards'
        : selectedTrackId === 't6'
        ? 'SaaS Browser Viewport'
        : 'CTA Final Sequence',
    type:
      selectedTrackId === 't1'
        ? 'background'
        : selectedTrackId === 't2'
        ? '3d'
        : selectedTrackId === 't3'
        ? 'text'
        : selectedTrackId === 't4'
        ? 'particles'
        : selectedTrackId === 't5' || selectedTrackId === 't6'
        ? 'ui'
        : 'text',
    startFrame:
      selectedTrackId === 't1' ? 0 : selectedTrackId === 't2' ? 0 : selectedTrackId === 't3' ? 10 : selectedTrackId === 't4' ? 75 : selectedTrackId === 't5' ? 85 : selectedTrackId === 't6' ? 150 : 210,
    durationInFrames:
      selectedTrackId === 't1' ? 240 : selectedTrackId === 't2' ? 75 : selectedTrackId === 't3' ? 65 : selectedTrackId === 't4' ? 75 : selectedTrackId === 't5' ? 65 : selectedTrackId === 't6' ? 60 : 30,
    props: {
      primaryColor: compositionState.primaryColor,
      text: selectedTrackId === 't3' ? compositionState.brandName : undefined,
      preset: selectedTrackId === 't3' ? compositionState.textPreset : undefined,
      speed: compositionState.speed,
    },
  };

  const handleUpdateInspectorProp = (key: string, value: any) => {
    if (key === 'primaryColor') {
      setCompositionState((prev) => ({ ...prev, primaryColor: value }));
    } else if (key === 'text') {
      setCompositionState((prev) => ({ ...prev, brandName: value }));
    } else if (key === 'preset') {
      setCompositionState((prev) => ({ ...prev, textPreset: value }));
    } else if (key === 'speed') {
      setCompositionState((prev) => ({ ...prev, speed: value }));
    }
  };

  const handleAiGenerate = async () => {
    setIsGeneratingAi(true);
    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, duration: 8 }),
      });
      const data = await res.json();
      if (data.success && data.composition) {
        setCompositionState((prev) => ({
          ...prev,
          primaryColor: data.composition.theme.primaryColor,
          secondaryColor: data.composition.theme.secondaryColor,
          brandName: data.composition.scenes[0].headline,
          tagline: data.composition.scenes[0].subheadline,
        }));
        setActiveTab('editor');
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleExportRender = async () => {
    setRenderStatus('Exporting deterministic video frames...');
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          compositionId: 'Apex_AI_Launch',
          format: 'mp4',
          fps: 30,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRenderStatus(`Render job ${data.jobId} completed! WebM / MP4 stream verified.`);
        setTimeout(() => setRenderStatus(null), 4000);
      }
    } catch (e) {
      setRenderStatus('Render export error.');
    }
  };

  const filteredAssets = COMPLETE_ASSET_CATALOG.filter((item) => {
    const matchesCat = filterCategory === 'all' || item.category === filterCategory;
    const matchesSearch =
      searchQuery === '' ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-slate-950 font-sans text-slate-100">
      {/* Top Header */}
      <header className="z-20 flex h-14 flex-shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-4">
        <div className="flex min-w-0 shrink-0 items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-300 bg-clip-text text-transparent">
              APEX MOTION ENGINE
            </span>
            <span className="ml-2 text-[10px] font-mono uppercase bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded">
              v1.0 OS
            </span>
          </div>
        </div>

        {/* Center Navigation Tabs */}
        <div className="flex min-w-0 items-center overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs [scrollbar-width:none]">
          <button
            onClick={() => setActiveTab('editor')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-all ${
              activeTab === 'editor' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Studio Editor</span>
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-all ${
              activeTab === 'catalog' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Asset Catalog</span>
          </button>
          <button
            onClick={() => setActiveTab('motion')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-all ${
              activeTab === 'motion' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Motion Registry</span>
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 font-medium transition-all ${
              activeTab === 'ai' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>AI Scene Generator</span>
          </button>
        </div>

        {/* Right CTA Actions */}
        <div className="flex items-center space-x-2">
          {renderStatus && (
            <span className="text-xs text-emerald-400 font-mono animate-pulse mr-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {renderStatus}
            </span>
          )}
          <button
            onClick={handleExportRender}
            title="Export composition"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-slate-200 shadow-sm transition-all hover:bg-slate-700"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Body */}
      {activeTab === 'editor' && (
        <VideoCompositionProvider
          fps={compositionState.fps}
          durationInFrames={compositionState.durationInFrames}
          autoPlay={true}
          loop={true}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Center Canvas Preview Area */}
              <div
                className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden bg-slate-950 p-4"
                style={{ containerType: 'size' }}
              >
                {/* Visual Canvas Monitor Frame — sized from BOTH the width and
                    the height of the free area so the 16:9 stage always fits. */}
                <div
                  className="relative flex items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-black shadow-2xl"
                  style={{ width: 'min(100cqw, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' }}
                >
                  <EffectStack bloom={12} vignette={true} filmGrain={true} className="w-full h-full">
                    {/* Continuous Procedural Background */}
                    <AbsoluteFill>
                      <ProceduralBackground
                        type={compositionState.bgType}
                        primaryColor={compositionState.primaryColor}
                        secondaryColor={compositionState.secondaryColor}
                        speed={compositionState.speed}
                      />
                    </AbsoluteFill>

                    {/* Scene 1: Kinetic Brand Hook (Frames 0 - 75) */}
                    <Sequence from={0} durationInFrames={75}>
                      <div className="flex flex-col items-center justify-center h-full px-8 text-center relative z-10">
                        <div className="w-24 h-24 mb-4">
                          <Floating3DObject
                            geometryType={compositionState.threeType}
                            materialType="glass"
                            color={compositionState.primaryColor}
                            size={2.2}
                            speed={compositionState.speed}
                          />
                        </div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-3">
                          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                          React Motion Engine v1.0
                        </div>
                        <KineticText
                          text={compositionState.brandName}
                          preset={compositionState.textPreset}
                          startFrame={10}
                          className="text-5xl md:text-6xl font-black tracking-tight"
                        />
                        <KineticText
                          text={compositionState.tagline}
                          preset="word_reveal"
                          startFrame={25}
                          className="text-base md:text-xl text-slate-300 font-medium max-w-xl mt-3"
                          tag="p"
                        />
                      </div>
                    </Sequence>

                    {/* Scene 2: 3D Galaxy Particles & Tech Metric Cards (Frames 75 - 150) */}
                    <Sequence from={75} durationInFrames={75}>
                      <AbsoluteFill>
                        <ParticleGalaxy
                          count={3500}
                          color={compositionState.primaryColor}
                          secondaryColor={compositionState.secondaryColor}
                          speed={compositionState.speed}
                        />
                      </AbsoluteFill>
                      <div className="absolute inset-0 flex flex-col justify-between p-10 z-10">
                        <div>
                          <span className="text-xs font-mono uppercase tracking-widest text-indigo-400">
                            02 // ARCHITECTURE & METRICS
                          </span>
                          <KineticText
                            text="GPU Instanced Particle Math"
                            preset="character_stagger"
                            startFrame={78}
                            className="text-3xl text-white font-extrabold mt-1"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-4 max-w-3xl">
                          <AnimatedMetricCard
                            label="Render Throughput"
                            value={120}
                            suffix=" fps"
                            changeRate="+400%"
                            startFrame={85}
                          />
                          <AnimatedMetricCard
                            label="Deterministic Frame"
                            value={100}
                            suffix="%"
                            changeRate="Lossless"
                            startFrame={95}
                            accentColor="emerald"
                          />
                          <AnimatedMetricCard
                            label="Memory Pressure"
                            value={12}
                            suffix=" MB"
                            changeRate="-65%"
                            startFrame={105}
                            accentColor="cyan"
                          />
                        </div>
                      </div>
                    </Sequence>

                    {/* Scene 3: SaaS Browser & Bar Chart Viewport (Frames 150 - 210) */}
                    <Sequence from={150} durationInFrames={60}>
                      <div className="flex flex-col items-center justify-center h-full p-8 z-10">
                        <div className="w-full max-w-3xl">
                          <SaaSBrowser
                            url="https://engine.motion.design/live"
                            title={`${compositionState.brandName} Live Matrix`}
                            startFrame={152}
                            durationInFrames={30}
                          >
                            <div className="grid grid-cols-2 gap-4">
                              <AnimatedBarChart
                                title="Deterministic Render Frames"
                                data={[
                                  { label: 'Q1', value: 45 },
                                  { label: 'Q2', value: 78 },
                                  { label: 'Q3', value: 110 },
                                  { label: 'Q4', value: 165 },
                                ]}
                                startFrame={155}
                              />
                              <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-800 flex flex-col justify-between">
                                <div>
                                  <div className="text-xs font-bold text-slate-300">Live Spring Engine</div>
                                  <p className="text-xs text-slate-400 mt-1">
                                    Zero wall-clock drift. Continuous analytic closed-form damping ODE solutions.
                                  </p>
                                </div>
                                <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/50 text-[11px] text-indigo-300 font-mono">
                                  stiffness: 220, damping: 14
                                </div>
                              </div>
                            </div>
                          </SaaSBrowser>
                        </div>
                      </div>
                    </Sequence>

                    {/* Scene 4: CTA Payoff (Frames 210 - 240) */}
                    <Sequence from={210} durationInFrames={30}>
                      <div className="flex flex-col items-center justify-center h-full px-6 text-center z-10">
                        <KineticText
                          text="Ready to Build the Future?"
                          preset="liquid_chrome"
                          startFrame={212}
                          className="text-4xl md:text-5xl font-black"
                        />
                        <p className="text-slate-300 text-sm max-w-md mt-2">
                          Production-grade React visual engine for motion graphics, video, and 3D scenes.
                        </p>
                        <div className="mt-5">
                          <button className="px-7 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-xs shadow-lg shadow-indigo-500/20 hover:scale-105 transition-all">
                            {compositionState.ctaText} →
                          </button>
                        </div>
                      </div>
                    </Sequence>
                  </EffectStack>
                </div>
              </div>

              {/* Right Side Inspector Panel */}
              <div className="w-72 flex-shrink-0 overflow-y-auto xl:w-80">
                <Inspector
                  selectedItem={selectedInspectorItem}
                  onUpdateProp={handleUpdateInspectorProp}
                />
              </div>
            </div>

            {/* Bottom Multi-Track Professional Timeline */}
            <Timeline
              className="max-h-[42%] shrink-0 overflow-y-auto"
              selectedItemId={selectedTrackId}
              onSelectItem={(id) => setSelectedTrackId(id)}
            />
          </div>
        </VideoCompositionProvider>
      )}

      {/* Asset Catalog Tab */}
      {activeTab === 'catalog' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 p-6">
          <div className="max-w-7xl mx-auto w-full flex-1 flex flex-col overflow-hidden">
            {/* Filter toolbar */}
            <div className="flex items-center justify-between gap-4 mb-6 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto">
                {['all', 'motion', 'typography', 'backgrounds', '3d', 'particles', 'ui', 'templates'].map(
                  (cat) => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                        filterCategory === cat
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {cat}
                    </button>
                  )
                )}
              </div>
              <div className="relative w-64">
                <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search 100+ assets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>

            {/* Grid of Catalog Items */}
            <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8 pr-1">
              {filteredAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                        {asset.category}
                      </span>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                        {asset.capabilities.gpu && <span className="text-cyan-400">GPU</span>}
                        {asset.capabilities.video && <span className="text-emerald-400">VIDEO</span>}
                      </div>
                    </div>
                    <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                      {asset.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                      {asset.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {asset.tags.map((tag) => (
                        <span key={tag} className="text-[10px] text-slate-500 bg-slate-950 px-2 py-0.5 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        if (asset.category === 'typography') {
                          setCompositionState((p) => ({ ...p, textPreset: 'character_stagger' }));
                        }
                        setActiveTab('editor');
                      }}
                      className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                    >
                      Use in Studio <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Motion Registry Inspection Tab */}
      {activeTab === 'motion' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 p-8">
          <div className="max-w-6xl mx-auto w-full flex-1 flex flex-col overflow-hidden">
            <div className="mb-6">
              <h2 className="text-2xl font-black text-white">Universal Motion Registry</h2>
              <p className="text-xs text-slate-400 mt-1">
                Deterministic mathematical easing curves, ODE spring models, and transform matrices registered in core.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8 pr-1">
              {motionRegistry.getAll().map((preset) => (
                <div
                  key={preset.id}
                  className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] uppercase font-mono font-bold text-purple-400">
                        {preset.category}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {preset.durationFrames} frames
                      </span>
                    </div>
                    <h3 className="font-bold text-white text-base">{preset.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">{preset.description}</p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span className="font-mono text-indigo-400 text-[11px]">id: &quot;{preset.id}&quot;</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`motionRegistry.get('${preset.id}')`);
                      }}
                      className="text-slate-400 hover:text-white text-[11px]"
                    >
                      Copy Reference
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AI Scene Generator Tab */}
      {activeTab === 'ai' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-950 overflow-y-auto">
          <div className="max-w-2xl w-full bg-slate-900/80 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">AI Scene Graph Generator</h2>
                <p className="text-xs text-slate-400">
                  Transform natural language prompts into complete, multi-scene editable video compositions.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                  Describe Your Motion Graphics or SaaS Video
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none leading-relaxed"
                  placeholder="e.g. Create a 30-second dark luxury product video with floating glass crystals and gold kinetic typography..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-slate-400 block mb-1">Target Aspect Ratio</label>
                  <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white">
                    <option value="16:9">16:9 (Landscape YouTube/Web)</option>
                    <option value="9:16">9:16 (Shorts / Reels / TikTok)</option>
                    <option value="1:1">1:1 (Square Feed)</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Target Duration</label>
                  <select className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-white">
                    <option value="8">8 Seconds (Hook + Feature)</option>
                    <option value="15">15 Seconds (Story Reel)</option>
                    <option value="30">30 Seconds (Complete Commercial)</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handleAiGenerate}
                disabled={isGeneratingAi}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 via-purple-600 to-pink-500 hover:from-indigo-600 hover:to-pink-600 text-white font-bold text-sm shadow-xl shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 mt-4"
              >
                {isGeneratingAi ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Synthesizing Scene AST Graph...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Generate & Open in Studio</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
