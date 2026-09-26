'use client';

import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Layers,
  Sparkles,
  Sliders,
  Maximize2,
} from 'lucide-react';
import { useVideoComposition } from '../../core/composition/VideoCompositionContext';

export interface TimelineTrackItem {
  id: string;
  name: string;
  type: 'video' | 'text' | '3d' | 'particles' | 'ui' | 'audio' | 'effects';
  startFrame: number;
  durationInFrames: number;
  color: string;
}

export interface TimelineProps {
  tracks?: TimelineTrackItem[];
  selectedItemId?: string;
  onSelectItem?: (id: string) => void;
  className?: string;
}

export function Timeline({
  tracks = [
    { id: 't1', name: 'Procedural Aurora BG', type: 'effects', startFrame: 0, durationInFrames: 240, color: 'bg-indigo-600' },
    { id: 't2', name: 'Floating 3D Knot', type: '3d', startFrame: 0, durationInFrames: 75, color: 'bg-cyan-600' },
    { id: 't3', name: 'Brand Headline Kinetic Text', type: 'text', startFrame: 10, durationInFrames: 65, color: 'bg-purple-600' },
    { id: 't4', name: 'Particle Galaxy Simulation', type: 'particles', startFrame: 75, durationInFrames: 75, color: 'bg-pink-600' },
    { id: 't5', name: 'Metric Performance Cards', type: 'ui', startFrame: 85, durationInFrames: 65, color: 'bg-emerald-600' },
    { id: 't6', name: 'SaaS Browser UI Viewport', type: 'ui', startFrame: 150, durationInFrames: 60, color: 'bg-amber-600' },
    { id: 't7', name: 'CTA Final Sequence', type: 'text', startFrame: 210, durationInFrames: 30, color: 'bg-rose-600' },
  ],
  selectedItemId,
  onSelectItem,
  className = '',
}: TimelineProps) {
  const {
    currentFrame,
    durationInFrames,
    fps,
    isPlaying,
    play,
    pause,
    seek,
  } = useVideoComposition();

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const progress = Math.max(0, Math.min(1, clickX / rect.width));
    const targetFrame = Math.floor(progress * durationInFrames);
    seek(targetFrame);
  };

  const formatTime = (frame: number) => {
    const totalSecs = frame / fps;
    const mins = Math.floor(totalSecs / 60);
    const secs = Math.floor(totalSecs % 60);
    const frames = Math.floor(frame % fps);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col bg-slate-950 border-t border-slate-800 select-none text-slate-200 ${className}`}>
      {/* Top Toolbar / Transport Controls */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800/80 bg-slate-900/60">
        {/* Playhead Transport */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => seek(0)}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Rewind to Start"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={() => seek(Math.max(0, currentFrame - fps))}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Step Back 1 Sec"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => (isPlaying ? pause() : play())}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium flex items-center gap-1.5 text-xs shadow-md shadow-indigo-600/30 transition-all"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>
          <button
            onClick={() => seek(Math.min(durationInFrames - 1, currentFrame + fps))}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Step Forward 1 Sec"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Timecode & Frame Counter */}
        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-indigo-400 font-bold">
            {formatTime(currentFrame)}
          </div>
          <div className="text-slate-500">
            FRAME <span className="text-slate-300 font-semibold">{currentFrame}</span> / {durationInFrames} ({fps} FPS)
          </div>
        </div>

        {/* Auxiliary info / tools */}
        <div className="flex items-center space-x-3 text-xs text-slate-400">
          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/80 text-[11px] font-medium text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Deterministic RAF
          </span>
          <span className="hidden sm:inline">Snap: 1 Frame</span>
        </div>
      </div>

      {/* Timeline Tracks Workspace */}
      <div className="flex h-44 overflow-hidden relative">
        {/* Track Headers (Left sidebar) */}
        <div className="w-48 flex-shrink-0 border-r border-slate-800/80 bg-slate-900/40 overflow-y-auto">
          {tracks.map((track) => (
            <div
              key={track.id}
              onClick={() => onSelectItem?.(track.id)}
              className={`h-7 px-3 flex items-center justify-between text-xs font-medium border-b border-slate-800/40 cursor-pointer transition-colors ${
                selectedItemId === track.id ? 'bg-indigo-600/20 text-indigo-300' : 'text-slate-400 hover:bg-slate-800/40'
              }`}
            >
              <span className="truncate pr-1">{track.name}</span>
              <span className="text-[10px] uppercase font-mono text-slate-500">{track.type}</span>
            </div>
          ))}
        </div>

        {/* Multi-Track Ruler & Sequencer Bars (Right scrolling canvas) */}
        <div className="flex-1 relative overflow-x-auto overflow-y-hidden cursor-crosshair" onClick={handleTimelineClick}>
          {/* Time Ruler (Seconds markers) */}
          <div className="h-6 border-b border-slate-800/60 bg-slate-950 flex items-center relative text-[10px] text-slate-500 font-mono">
            {Array.from({ length: Math.ceil(durationInFrames / fps) + 1 }).map((_, i) => {
              const leftPercent = ((i * fps) / durationInFrames) * 100;
              return (
                <div key={i} className="absolute h-full flex items-center pl-1 border-l border-slate-800" style={{ left: `${leftPercent}%` }}>
                  {i}s
                </div>
              );
            })}
          </div>

          {/* Track Blocks */}
          <div className="relative">
            {tracks.map((track) => {
              const left = (track.startFrame / durationInFrames) * 100;
              const width = (track.durationInFrames / durationInFrames) * 100;
              const isSelected = selectedItemId === track.id;

              return (
                <div key={track.id} className="h-7 border-b border-slate-800/30 relative px-1 py-1">
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectItem?.(track.id);
                    }}
                    className={`absolute top-1 bottom-1 rounded-md px-2 flex items-center text-[11px] font-semibold text-white/90 truncate cursor-pointer shadow-sm transition-all ${
                      track.color
                    } ${isSelected ? 'ring-2 ring-white shadow-lg' : 'opacity-85 hover:opacity-100'}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  >
                    {track.name}
                  </div>
                </div>
              );
            })}

            {/* Playhead Vertical Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 pointer-events-none z-30 shadow-[0_0_8px_rgba(244,63,94,0.9)]"
              style={{
                left: `${(currentFrame / durationInFrames) * 100}%`,
                height: '180px',
              }}
            >
              <div className="w-2.5 h-2.5 bg-rose-500 rotate-45 -translate-x-1 -translate-y-1 shadow-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
