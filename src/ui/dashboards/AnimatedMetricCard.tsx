'use client';

import React from 'react';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';
import { Easings } from '../../core/animation/interpolations';

export interface AnimatedMetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  changeRate?: string;
  isPositive?: boolean;
  startFrame?: number;
  durationInFrames?: number;
  accentColor?: 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan';
  className?: string;
}

export function AnimatedMetricCard({
  label,
  value,
  prefix = '',
  suffix = '',
  changeRate = '+32.4%',
  isPositive = true,
  startFrame = 0,
  durationInFrames = 45,
  accentColor = 'indigo',
  className = '',
}: AnimatedMetricCardProps) {
  const currentFrame = useCurrentFrame();
  const relFrame = Math.max(0, currentFrame - startFrame);
  const progress = Math.min(1, relFrame / durationInFrames);
  const ease = Easings.easeOutCubic(progress);

  // Animated numerical counter
  const currentValue = Math.floor(value * ease);

  return (
    <div
      className={`p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md relative overflow-hidden group hover:border-slate-700 transition-all ${className}`}
      style={{
        transform: `translateY(${(1 - ease) * 30}px) scale(${0.92 + ease * 0.08})`,
        opacity: progress,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            isPositive
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
          }`}
        >
          {changeRate}
        </span>
      </div>

      <div className="text-3xl font-black text-white tracking-tight flex items-baseline gap-1">
        <span>{prefix}</span>
        <span>{currentValue.toLocaleString()}</span>
        <span className="text-sm font-semibold text-slate-400">{suffix}</span>
      </div>

      {/* Dynamic progress sparkline indicator */}
      <div className="w-full bg-slate-800/80 h-1.5 rounded-full mt-4 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            accentColor === 'indigo'
              ? 'bg-gradient-to-r from-indigo-500 to-purple-500'
              : accentColor === 'emerald'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
              : accentColor === 'amber'
              ? 'bg-gradient-to-r from-amber-500 to-orange-500'
              : accentColor === 'rose'
              ? 'bg-gradient-to-r from-rose-500 to-pink-500'
              : 'bg-gradient-to-r from-cyan-500 to-blue-500'
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}

export interface AnimatedBarChartProps {
  title?: string;
  data: { label: string; value: number }[];
  startFrame?: number;
  durationInFrames?: number;
  barColor?: string;
  className?: string;
}

export function AnimatedBarChart({
  title = 'Platform Growth',
  data,
  startFrame = 0,
  durationInFrames = 40,
  barColor = 'from-indigo-500 to-cyan-400',
  className = '',
}: AnimatedBarChartProps) {
  const currentFrame = useCurrentFrame();
  const relFrame = Math.max(0, currentFrame - startFrame);
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div
      className={`p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl backdrop-blur-md ${className}`}
    >
      {title && (
        <div className="text-sm font-bold text-white mb-6 flex items-center justify-between">
          <span>{title}</span>
          <span className="text-xs text-slate-400 font-normal">Real-time Stream</span>
        </div>
      )}

      <div className="flex items-end gap-3 h-48 pt-4">
        {data.map((item, idx) => {
          const itemStart = idx * 3;
          const itemProgress = Math.min(
            1,
            Math.max(0, (relFrame - itemStart) / (durationInFrames - 10))
          );
          const ease = Easings.easeOutCubic(itemProgress);
          const heightPercent = (item.value / maxValue) * 100 * ease;

          return (
            <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
              <div
                className="text-[10px] font-bold text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity mb-1"
                style={{ opacity: itemProgress > 0.5 ? 1 : 0 }}
              >
                {Math.round(item.value * ease)}
              </div>
              <div
                className={`w-full rounded-t-lg bg-gradient-to-t ${barColor} shadow-lg transition-all`}
                style={{
                  height: `${heightPercent}%`,
                  minHeight: heightPercent > 0 ? '4px' : '0px',
                }}
              />
              <span className="text-[11px] font-medium text-slate-400 mt-2 truncate max-w-[48px]">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
