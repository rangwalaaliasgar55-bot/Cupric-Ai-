'use client';

import React from 'react';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';
import { Easings } from '../../core/animation/interpolations';

export type TransitionType =
  | 'crossfade'
  | 'slide_left'
  | 'slide_right'
  | 'zoom_in'
  | 'wipe'
  | 'glitch_dissolve'
  | 'curtain';

export interface SceneTransitionProps {
  type?: TransitionType;
  transitionFrame: number;
  durationFrames?: number;
  children: [React.ReactNode, React.ReactNode]; // Scene 1 and Scene 2
  className?: string;
}

export function SceneTransition({
  type = 'crossfade',
  transitionFrame = 90,
  durationFrames = 15,
  children,
  className = '',
}: SceneTransitionProps) {
  const currentFrame = useCurrentFrame();
  const [SceneA, SceneB] = children;

  // Before transition begins
  if (currentFrame < transitionFrame) {
    return <div className={`relative w-full h-full ${className}`}>{SceneA}</div>;
  }

  // After transition finishes
  if (currentFrame >= transitionFrame + durationFrames) {
    return <div className={`relative w-full h-full ${className}`}>{SceneB}</div>;
  }

  // During transition
  const progress = (currentFrame - transitionFrame) / durationFrames;
  const ease = Easings.easeInOutCubic(progress);

  let styleA: React.CSSProperties = { position: 'absolute', inset: 0 };
  let styleB: React.CSSProperties = { position: 'absolute', inset: 0 };

  switch (type) {
    case 'slide_left':
      styleA.transform = `translateX(${-ease * 100}%)`;
      styleB.transform = `translateX(${(1 - ease) * 100}%)`;
      break;

    case 'slide_right':
      styleA.transform = `translateX(${ease * 100}%)`;
      styleB.transform = `translateX(${-(1 - ease) * 100}%)`;
      break;

    case 'zoom_in':
      styleA.transform = `scale(${1 + ease * 0.4})`;
      styleA.opacity = 1 - ease;
      styleB.transform = `scale(${0.8 + ease * 0.2})`;
      styleB.opacity = ease;
      break;

    case 'wipe':
      styleA.clipPath = `inset(0 ${ease * 100}% 0 0)`;
      styleB.opacity = 1;
      break;

    case 'glitch_dissolve': {
      const glitchOffset = Math.sin(progress * 40) * 15;
      styleA.transform = `translateX(${glitchOffset}px)`;
      styleA.opacity = 1 - ease;
      styleB.transform = `translateX(${-glitchOffset}px)`;
      styleB.opacity = ease;
      break;
    }

    case 'crossfade':
    default:
      styleA.opacity = 1 - ease;
      styleB.opacity = ease;
      break;
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <div style={styleA}>{SceneA}</div>
      <div style={styleB}>{SceneB}</div>
    </div>
  );
}

export function EffectStack({
  children,
  bloom = 0,
  vignette = false,
  filmGrain = false,
  chromaticAberration = 0,
  className = '',
}: {
  children: React.ReactNode;
  bloom?: number;
  vignette?: boolean;
  filmGrain?: boolean;
  chromaticAberration?: number;
  className?: string;
}) {
  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* Underlying content */}
      <div
        className="w-full h-full"
        style={{
          filter: bloom > 0 ? `drop-shadow(0 0 ${bloom}px rgba(99, 102, 241, 0.6))` : undefined,
        }}
      >
        {children}
      </div>

      {/* Chromatic aberration overlay if active */}
      {chromaticAberration > 0 && (
        <div
          className="absolute inset-0 pointer-events-none mix-blend-screen opacity-40"
          style={{
            transform: `translate(${chromaticAberration}px, 0)`,
            filter: 'hue-rotate(90deg)',
          }}
        />
      )}

      {/* Vignette Overlay */}
      {vignette && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.7) 100%)',
          }}
        />
      )}

      {/* Film Grain Texture Approximation */}
      {filmGrain && (
        <div
          className="absolute inset-0 pointer-events-none opacity-20 mix-blend-overlay"
          style={{
            backgroundImage: `radial-gradient(#ffffff 1px, transparent 1px)`,
            backgroundSize: '4px 4px',
          }}
        />
      )}
    </div>
  );
}
