'use client';

import React from 'react';
import { VideoCompositionProvider, Sequence, AbsoluteFill } from '../../core/composition/VideoCompositionContext';
import { ProceduralBackground } from '../../graphics/backgrounds/ProceduralBackground';
import { KineticText } from '../../motion/text/KineticText';
import { Floating3DObject } from '../../three/objects/Floating3DObject';
import { ParticleGalaxy } from '../../three/particles/ParticleGalaxy';
import { SaaSBrowser } from '../../ui/devices/SaaSBrowser';
import { AnimatedMetricCard, AnimatedBarChart } from '../../ui/dashboards/AnimatedMetricCard';
import { EffectStack } from '../../effects/transitions/SceneTransition';

export interface AIProductLaunchProps {
  brandName?: string;
  tagline?: string;
  primaryColor?: string;
  secondaryColor?: string;
  ctaText?: string;
  durationInFrames?: number;
}

export function AIProductLaunchTemplate({
  brandName = 'Apex Engine',
  tagline = 'The Future of Generative Motion Graphics',
  primaryColor = '#6366f1',
  secondaryColor = '#ec4899',
  ctaText = 'Deploy with Apex',
  durationInFrames = 240, // 8 seconds @ 30fps
}: AIProductLaunchProps) {
  return (
    <VideoCompositionProvider fps={30} durationInFrames={durationInFrames} autoPlay={true} loop={true}>
      <EffectStack bloom={15} vignette={true} filmGrain={true} className="w-full h-full bg-slate-950 font-sans">
        {/* Dynamic Procedural Mesh Background (Continuous) */}
        <AbsoluteFill>
          <ProceduralBackground
            type="aurora"
            primaryColor={primaryColor}
            secondaryColor={secondaryColor}
            speed={0.8}
          />
        </AbsoluteFill>

        {/* SCENE 1: The Hook & Kinetic Reveal (Frames 0 - 75) */}
        <Sequence from={0} durationInFrames={75}>
          <div className="flex flex-col items-center justify-center h-full px-8 text-center relative z-10">
            <div className="w-20 h-20 mb-6">
              <Floating3DObject geometryType="knot" materialType="glass" color={primaryColor} size={2.2} />
            </div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-4 shadow-sm backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
              Next-Gen Motion Framework
            </div>
            <KineticText
              text={brandName}
              preset="liquid_chrome"
              startFrame={10}
              className="text-5xl md:text-7xl font-black tracking-tight"
            />
            <KineticText
              text={tagline}
              preset="word_reveal"
              startFrame={25}
              className="text-lg md:text-2xl text-slate-300 font-medium max-w-2xl mt-4"
              tag="p"
            />
          </div>
        </Sequence>

        {/* SCENE 2: 3D Galaxy Deep Dive & Core AI Architecture (Frames 75 - 150) */}
        <Sequence from={75} durationInFrames={75}>
          <AbsoluteFill>
            <ParticleGalaxy
              count={3500}
              color={primaryColor}
              secondaryColor={secondaryColor}
              speed={1.2}
            />
          </AbsoluteFill>
          <div className="absolute inset-0 flex flex-col justify-between p-12 z-10">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-indigo-400">
                02 // ARCHITECTURE
              </span>
              <KineticText
                text="GPU-Accelerated Timeline Core"
                preset="character_stagger"
                startFrame={78}
                className="text-3xl md:text-4xl text-white font-extrabold mt-1"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl">
              <AnimatedMetricCard
                label="Render Throughput"
                value={120}
                suffix=" fps"
                changeRate="+400%"
                startFrame={85}
              />
              <AnimatedMetricCard
                label="Latency Budget"
                value={4}
                suffix=" ms"
                changeRate="Realtime"
                startFrame={95}
                accentColor="emerald"
              />
              <AnimatedMetricCard
                label="Deterministic Precision"
                value={100}
                suffix="%"
                changeRate="Lossless"
                startFrame={105}
                accentColor="cyan"
              />
            </div>
          </div>
        </Sequence>

        {/* SCENE 3: Product UI Showcase & Live Dashboard (Frames 150 - 210) */}
        <Sequence from={150} durationInFrames={60}>
          <div className="flex flex-col items-center justify-center h-full p-8 z-10">
            <div className="w-full max-w-4xl">
              <SaaSBrowser
                url="https://engine.motion.design/editor"
                title={`${brandName} Studio Pro`}
                startFrame={152}
                durationInFrames={30}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <AnimatedBarChart
                    title="Render Pipeline Concurrency"
                    data={[
                      { label: 'Jan', value: 35 },
                      { label: 'Feb', value: 58 },
                      { label: 'Mar', value: 72 },
                      { label: 'Apr', value: 89 },
                      { label: 'May', value: 120 },
                    ]}
                    startFrame={155}
                  />
                  <div className="flex flex-col justify-between p-4 bg-slate-900/60 rounded-xl border border-slate-800">
                    <div>
                      <div className="text-xs font-semibold text-slate-400">Active Node Graph</div>
                      <div className="text-xl font-bold text-white mt-1">2,480 Active Springs</div>
                      <p className="text-xs text-slate-400 mt-2">
                        Hardware accelerated GLSL shaders bound to discrete video frames.
                      </p>
                    </div>
                    <div className="flex items-center gap-3 pt-3 border-t border-slate-800">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500 flex items-center justify-center text-indigo-400 font-bold text-xs">
                        4K
                      </div>
                      <span className="text-xs text-slate-300">Ready for WebM & ProRes Export</span>
                    </div>
                  </div>
                </div>
              </SaaSBrowser>
            </div>
          </div>
        </Sequence>

        {/* SCENE 4: High-Impact Call to Action (Frames 210 - 240) */}
        <Sequence from={210} durationInFrames={30}>
          <div className="flex flex-col items-center justify-center h-full px-6 text-center z-10">
            <KineticText
              text="Ship Motion at the Speed of Thought"
              preset="liquid_chrome"
              startFrame={212}
              className="text-4xl md:text-6xl font-black max-w-3xl"
            />
            <p className="text-slate-300 text-sm md:text-base max-w-lg mt-3">
              Export professional video or embed interactive React motion graphics directly into your production apps.
            </p>
            <div className="mt-6">
              <button className="px-8 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm tracking-wide shadow-xl shadow-indigo-500/25 border border-indigo-400/30 hover:scale-105 active:scale-95 transition-all">
                {ctaText} →
              </button>
            </div>
          </div>
        </Sequence>
      </EffectStack>
    </VideoCompositionProvider>
  );
}
