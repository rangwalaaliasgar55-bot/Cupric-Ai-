'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

export interface VideoCompositionContextType {
  currentFrame: number;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  isPlaying: boolean;
  playbackRate: number;
  isLooping: boolean;
  seek: (frame: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setFps: (fps: number) => void;
  setDurationInFrames: (frames: number) => void;
}

const VideoCompositionContext = createContext<VideoCompositionContextType | null>(null);

export function useVideoComposition(): VideoCompositionContextType {
  const ctx = useContext(VideoCompositionContext);
  if (!ctx) {
    // Return a graceful deterministic fallback for components previewed outside a full composition
    return {
      currentFrame: 0,
      fps: 30,
      durationInFrames: 180,
      width: 1920,
      height: 1080,
      isPlaying: false,
      playbackRate: 1,
      isLooping: true,
      seek: () => {},
      play: () => {},
      pause: () => {},
      togglePlay: () => {},
      setFps: () => {},
      setDurationInFrames: () => {},
    };
  }
  return ctx;
}

export function useCurrentFrame(): number {
  return useVideoComposition().currentFrame;
}

export function useVideoConfig() {
  const { fps, durationInFrames, width, height } = useVideoComposition();
  return { fps, durationInFrames, width, height };
}

interface VideoCompositionProviderProps {
  children: React.ReactNode;
  fps?: number;
  durationInFrames?: number;
  width?: number;
  height?: number;
  autoPlay?: boolean;
  loop?: boolean;
  initialFrame?: number;
  onFrameUpdate?: (frame: number) => void;
}

export function VideoCompositionProvider({
  children,
  fps = 30,
  durationInFrames = 300,
  width = 1920,
  height = 1080,
  autoPlay = true,
  loop = true,
  initialFrame = 0,
  onFrameUpdate,
}: VideoCompositionProviderProps) {
  const [currentFrame, setCurrentFrame] = useState(initialFrame);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentFps, setFps] = useState(fps);
  const [currentDuration, setDurationInFrames] = useState(durationInFrames);

  const lastTimeRef = useRef<number | null>(null);
  const accumulatorRef = useRef<number>(0);
  const animFrameIdRef = useRef<number | null>(null);

  const seek = useCallback((frame: number) => {
    const clamped = Math.max(0, Math.min(frame, currentDuration - 1));
    setCurrentFrame(clamped);
    onFrameUpdate?.(clamped);
  }, [currentDuration, onFrameUpdate]);

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      lastTimeRef.current = null;
      return;
    }

    const frameDurationMs = 1000 / (currentFps * playbackRate);

    const step = (now: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = now;
      }
      const delta = now - lastTimeRef.current;
      lastTimeRef.current = now;
      accumulatorRef.current += delta;

      while (accumulatorRef.current >= frameDurationMs) {
        accumulatorRef.current -= frameDurationMs;
        setCurrentFrame((prev) => {
          const next = prev + 1;
          if (next >= currentDuration) {
            if (loop) {
              onFrameUpdate?.(0);
              return 0;
            } else {
              setIsPlaying(false);
              return prev;
            }
          }
          onFrameUpdate?.(next);
          return next;
        });
      }

      animFrameIdRef.current = requestAnimationFrame(step);
    };

    animFrameIdRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [isPlaying, currentFps, playbackRate, currentDuration, loop, onFrameUpdate]);

  return (
    <VideoCompositionContext.Provider
      value={{
        currentFrame,
        fps: currentFps,
        durationInFrames: currentDuration,
        width,
        height,
        isPlaying,
        playbackRate,
        isLooping: loop,
        seek,
        play,
        pause,
        togglePlay,
        setFps,
        setDurationInFrames,
      }}
    >
      {children}
    </VideoCompositionContext.Provider>
  );
}

/**
 * Remotion-like Sequence primitive for layered timing
 */
export function Sequence({
  from,
  durationInFrames,
  children,
  className = '',
  style = {},
}: {
  from: number;
  durationInFrames: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const currentFrame = useCurrentFrame();
  const isVisible = currentFrame >= from && currentFrame < from + durationInFrames;

  if (!isVisible) return null;

  return (
    <div
      className={`absolute inset-0 pointer-events-auto ${className}`}
      style={{
        ...style,
      }}
      data-sequence-from={from}
      data-sequence-duration={durationInFrames}
    >
      {children}
    </div>
  );
}

/**
 * Remotion-like AbsoluteFill primitive
 */
export function AbsoluteFill({
  children,
  className = '',
  style = {},
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`absolute inset-0 flex flex-col overflow-hidden pointer-events-none select-none ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
