'use client';

import React from 'react';
import {
  Sliders,
  Sparkles,
  Layers,
  Palette,
  Clock,
  Box,
  Type,
  Eye,
  Trash2,
} from 'lucide-react';

export interface InspectorProps {
  selectedItem: {
    id: string;
    name: string;
    type: string;
    startFrame: number;
    durationInFrames: number;
    props: Record<string, any>;
  } | null;
  onUpdateProp?: (key: string, value: any) => void;
  className?: string;
}

export function Inspector({ selectedItem, onUpdateProp, className = '' }: InspectorProps) {
  if (!selectedItem) {
    return (
      <div className={`p-6 flex flex-col items-center justify-center text-center text-slate-500 bg-slate-950 border-l border-slate-800 h-full ${className}`}>
        <Layers className="w-10 h-10 mb-3 text-slate-600" />
        <h4 className="font-semibold text-slate-300 text-sm">No Layer Selected</h4>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Click any element on the timeline or canvas to inspect and edit its live parameters in real-time.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex flex-col bg-slate-950 border-l border-slate-800 text-slate-200 overflow-y-auto h-full ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/40">
        <div>
          <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-indigo-400">
            {selectedItem.type}
          </span>
          <h3 className="font-bold text-sm text-white truncate max-w-[180px]">
            {selectedItem.name}
          </h3>
        </div>
        <div className="flex items-center space-x-1">
          <button className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors" title="Toggle Visibility">
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Accordion / Sections */}
      <div className="p-4 space-y-5 text-xs">
        {/* Timing Section */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-slate-300">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Timeline Timing</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Start Frame</label>
              <input
                type="number"
                value={selectedItem.startFrame}
                onChange={(e) => onUpdateProp?.('startFrame', parseInt(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Duration (Frames)</label>
              <input
                type="number"
                value={selectedItem.durationInFrames}
                onChange={(e) => onUpdateProp?.('durationInFrames', parseInt(e.target.value) || 1)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* Live Parameters Section */}
        <div className="space-y-3 pt-3 border-t border-slate-800">
          <div className="flex items-center gap-1.5 font-semibold text-slate-300">
            <Sliders className="w-3.5 h-3.5 text-pink-400" />
            <span>Visual Parameters</span>
          </div>

          {/* Color pickers */}
          {selectedItem.props.primaryColor !== undefined && (
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedItem.props.primaryColor}
                  onChange={(e) => onUpdateProp?.('primaryColor', e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                />
                <span className="font-mono text-slate-300">{selectedItem.props.primaryColor}</span>
              </div>
            </div>
          )}

          {/* Speed / Intensity sliders */}
          {selectedItem.props.speed !== undefined && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] text-slate-400">Motion Speed</label>
                <span className="font-mono text-indigo-400">{selectedItem.props.speed}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={selectedItem.props.speed}
                onChange={(e) => onUpdateProp?.('speed', parseFloat(e.target.value))}
                className="w-full accent-indigo-500 cursor-pointer"
              />
            </div>
          )}

          {/* Headline / text input */}
          {selectedItem.props.text !== undefined && (
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Text Content</label>
              <textarea
                value={selectedItem.props.text}
                onChange={(e) => onUpdateProp?.('text', e.target.value)}
                rows={3}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-white font-sans text-xs focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </div>
          )}

          {/* Preset Selector */}
          {selectedItem.props.preset !== undefined && (
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Animation Preset</label>
              <select
                value={selectedItem.props.preset}
                onChange={(e) => onUpdateProp?.('preset', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white"
              >
                <option value="liquid_chrome">Liquid Chrome Shimmer</option>
                <option value="character_stagger">Character Stagger Pop</option>
                <option value="word_reveal">Word Perspective Reveal</option>
                <option value="cinematic_blur">Cinematic Blur Scale</option>
                <option value="neon_glow">Neon Electric Pulse</option>
                <option value="scramble">Matrix Scramble Decrypt</option>
                <option value="typewriter">Terminal Typewriter</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
