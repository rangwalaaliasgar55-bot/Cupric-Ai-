'use client';

import React from 'react';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';
import { Easings, evaluateSpring } from '../../core/animation/interpolations';

export interface KineticTextProps {
  text: string;
  preset?:
    | 'character_stagger'
    | 'word_reveal'
    | 'scramble'
    | 'liquid_chrome'
    | 'cinematic_blur'
    | 'glitch'
    | 'typewriter'
    | '3d_rotate'
    | 'neon_glow';
  startFrame?: number;
  durationPerItem?: number;
  stagger?: number;
  className?: string;
  gradient?: string;
  tag?: 'h1' | 'h2' | 'h3' | 'p' | 'span';
}

export function KineticText({
  text,
  preset = 'character_stagger',
  startFrame = 0,
  durationPerItem = 18,
  stagger = 2,
  className = '',
  gradient,
  tag = 'h1',
}: KineticTextProps) {
  const currentFrame = useCurrentFrame();
  const relativeFrame = Math.max(0, currentFrame - startFrame);

  // Typewriter preset
  if (preset === 'typewriter') {
    const charsToShow = Math.min(
      text.length,
      Math.floor(relativeFrame / (stagger || 2))
    );
    const visibleSub = text.slice(0, charsToShow);
    const TagName = tag;

    return (
      <TagName className={`font-bold tracking-tight inline-block ${className}`}>
        <span>{visibleSub}</span>
        {charsToShow < text.length && (
          <span className="inline-block w-2 h-[1em] bg-indigo-500 ml-1 animate-pulse align-middle" />
        )}
      </TagName>
    );
  }

  // Word or Character splitting
  const isWordMode = preset === 'word_reveal';
  const units = isWordMode ? text.split(' ') : text.split('');

  const TagName = tag;

  return (
    <TagName
      className={`font-extrabold tracking-tight select-none ${className}`}
      aria-label={text}
    >
      {units.map((unit, index) => {
        const itemStart = index * stagger;
        const itemFrame = Math.max(0, relativeFrame - itemStart);
        const progress = Math.min(1, Math.max(0, itemFrame / durationPerItem));

        let style: React.CSSProperties = {
          display: 'inline-block',
          whiteSpace: 'pre',
          willChange: 'transform, opacity',
        };

        switch (preset) {
          case 'character_stagger': {
            const ease = Easings.easeOutBack(progress);
            style.opacity = Math.min(1, progress * 1.8);
            style.transform = `translateY(${(1 - ease) * 35}px) scale(${0.8 + ease * 0.2})`;
            break;
          }

          case 'word_reveal': {
            const ease = Easings.easeOutCubic(progress);
            style.opacity = progress;
            style.transform = `translateY(${(1 - ease) * 24}px) rotateX(${(1 - ease) * 45}deg)`;
            style.transformOrigin = 'bottom';
            break;
          }

          case 'cinematic_blur': {
            const ease = Easings.easeOutExpo(progress);
            const blurAmount = (1 - ease) * 14;
            style.opacity = progress;
            style.filter = blurAmount > 0.1 ? `blur(${blurAmount}px)` : undefined;
            style.transform = `scale(${1.2 - ease * 0.2}) translateY(${(1 - ease) * 10}px)`;
            break;
          }

          case '3d_rotate': {
            const spring = evaluateSpring(itemFrame / 30, { stiffness: 200, damping: 14 });
            style.opacity = Math.min(1, itemFrame / 8);
            style.transform = `perspective(600px) rotateY(${(1 - spring) * 90}deg) scale(${spring})`;
            break;
          }

          case 'liquid_chrome': {
            const ease = Easings.easeInOutQuad(progress);
            const shimmer = Math.sin(relativeFrame * 0.15 + index * 0.4) * 50 + 50;
            style.opacity = progress;
            style.background = `linear-gradient(${shimmer}deg, #ffffff 0%, #cbd5e1 30%, #38bdf8 60%, #ffffff 100%)`;
            style.WebkitBackgroundClip = 'text';
            style.WebkitTextFillColor = 'transparent';
            style.transform = `translateY(${(1 - ease) * 20}px)`;
            break;
          }

          case 'neon_glow': {
            const ease = Easings.easeOutCubic(progress);
            const glowIntensity = Math.sin(relativeFrame * 0.2 + index) * 5 + 15;
            style.opacity = progress;
            style.textShadow = `0 0 ${glowIntensity}px rgba(129, 140, 248, 0.9), 0 0 ${glowIntensity * 2}px rgba(99, 102, 241, 0.5)`;
            style.transform = `scale(${0.9 + ease * 0.1})`;
            break;
          }

          case 'scramble': {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%#@*&';
            const isSettled = progress >= 1;
            const displayChar = isSettled
              ? unit
              : chars[Math.floor(Math.sin(relativeFrame + index) * 100) % chars.length];
            style.opacity = Math.min(1, progress * 1.5);
            return (
              <span key={index} style={style} className={gradient}>
                {displayChar}
                {isWordMode && ' '}
              </span>
            );
          }

          default:
            style.opacity = progress;
            break;
        }

        return (
          <span key={index} style={style} className={gradient}>
            {unit}
            {isWordMode && ' '}
          </span>
        );
      })}
    </TagName>
  );
}
