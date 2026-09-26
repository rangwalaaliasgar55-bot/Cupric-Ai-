'use client';

import React from 'react';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';
import { Easings } from '../../core/animation/interpolations';

export interface SaaSBrowserProps {
  url?: string;
  title?: string;
  startFrame?: number;
  durationInFrames?: number;
  tiltAngle?: number;
  children?: React.ReactNode;
  className?: string;
}

export function SaaSBrowser({
  url = 'https://app.apex-motion.ai',
  title = 'Apex Dashboard',
  startFrame = 0,
  durationInFrames = 40,
  tiltAngle = 10,
  children,
  className = '',
}: SaaSBrowserProps) {
  const currentFrame = useCurrentFrame();
  const relFrame = Math.max(0, currentFrame - startFrame);
  const progress = Math.min(1, relFrame / durationInFrames);
  const ease = Easings.easeOutCubic(progress);

  const rotateX = (1 - ease) * tiltAngle;
  const translateY = (1 - ease) * 60;
  const opacity = progress;

  return (
    <div
      className={`relative rounded-2xl overflow-hidden border border-slate-700/60 bg-slate-900/90 shadow-2xl backdrop-blur-xl transition-all duration-300 ${className}`}
      style={{
        transform: `perspective(1200px) rotateX(${rotateX}deg) translateY(${translateY}px) scale(${0.96 + ease * 0.04})`,
        opacity,
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), 0 0 35px rgba(99, 102, 241, 0.2)',
      }}
    >
      {/* Chrome Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950/70 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-rose-500/80" />
          <div className="w-3 h-3 rounded-full bg-amber-500/80" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
        </div>
        <div className="flex-1 max-w-sm mx-4 bg-slate-900/90 text-slate-400 text-xs px-3 py-1 rounded-md border border-slate-800 text-center truncate flex items-center justify-center gap-1.5">
          <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
              clipRule="evenodd"
            />
          </svg>
          {url}
        </div>
        <div className="text-xs text-slate-400 font-medium">{title}</div>
      </div>

      {/* Internal Viewport Content */}
      <div className="p-4 bg-slate-950/40 relative min-h-[300px]">
        {children || (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="text-xs text-slate-400 font-medium">Monthly Active Users</div>
              <div className="text-2xl font-black text-white mt-1">1,482,900</div>
              <div className="text-xs text-emerald-400 mt-2">↑ 28.4% from last month</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="text-xs text-slate-400 font-medium">GPU Compute Latency</div>
              <div className="text-2xl font-black text-white mt-1">8.4 ms</div>
              <div className="text-xs text-indigo-400 mt-2">⚡ Ultra-low latency</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-700/40">
              <div className="text-xs text-slate-400 font-medium">Rendered Compositions</div>
              <div className="text-2xl font-black text-white mt-1">94,320</div>
              <div className="text-xs text-purple-400 mt-2">100% deterministic</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface MobileDeviceMockupProps {
  deviceType?: 'iphone' | 'android';
  startFrame?: number;
  children?: React.ReactNode;
  className?: string;
}

export function MobileDeviceMockup({
  deviceType = 'iphone',
  startFrame = 0,
  children,
  className = '',
}: MobileDeviceMockupProps) {
  const currentFrame = useCurrentFrame();
  const relFrame = Math.max(0, currentFrame - startFrame);
  const progress = Math.min(1, relFrame / 30);
  const ease = Easings.easeOutBack(progress);

  return (
    <div
      className={`relative mx-auto w-[280px] h-[560px] bg-slate-950 rounded-[48px] p-3 border-4 border-slate-700/80 shadow-2xl flex flex-col justify-between ${className}`}
      style={{
        transform: `scale(${0.9 + ease * 0.1}) translateY(${(1 - ease) * 40}px)`,
        opacity: progress,
        boxShadow: '0 30px 80px -15px rgba(0,0,0,0.8), 0 0 25px rgba(129, 140, 248, 0.25)',
      }}
    >
      {/* Notch / Dynamic Island */}
      <div className="w-24 h-5 bg-black rounded-full mx-auto mb-2 flex items-center justify-center">
        <div className="w-2.5 h-2.5 rounded-full bg-slate-800 mr-2" />
        <div className="w-1.5 h-1.5 rounded-full bg-indigo-900/50" />
      </div>

      {/* Screen area */}
      <div className="flex-1 w-full bg-slate-900 rounded-[36px] overflow-hidden p-4 relative flex flex-col justify-between">
        {children || (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30">
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <h3 className="font-bold text-white text-lg">Apex Mobile</h3>
            <p className="text-xs text-slate-400">Motion generation on the go</p>
            <button className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md">
              Tap to Launch
            </button>
          </div>
        )}
      </div>

      {/* Home indicator bar */}
      <div className="w-28 h-1 bg-slate-600 rounded-full mx-auto mt-2" />
    </div>
  );
}
