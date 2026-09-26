'use client';

import React, { useRef, useEffect } from 'react';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';

export interface ProceduralBackgroundProps {
  type?: 'aurora' | 'cyber_grid' | 'fluid_mesh' | 'matrix_rain' | 'holographic_wave' | 'nebula';
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  speed?: number;
  intensity?: number;
  className?: string;
}

export function ProceduralBackground({
  type = 'aurora',
  primaryColor = '#4f46e5',
  secondaryColor = '#ec4899',
  accentColor = '#06b6d4',
  speed = 1.0,
  intensity = 0.8,
  className = '',
}: ProceduralBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const time = (frame * speed) / 30;

    ctx.clearRect(0, 0, width, height);

    if (type === 'cyber_grid') {
      // Dark perspective horizon cyber grid
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, width, height);

      // Horizon line
      const horizonY = height * 0.55;

      // Glow horizon
      const horizonGrad = ctx.createLinearGradient(0, horizonY - 40, 0, horizonY + 60);
      horizonGrad.addColorStop(0, 'rgba(0,0,0,0)');
      horizonGrad.addColorStop(0.5, primaryColor);
      horizonGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = horizonGrad;
      ctx.fillRect(0, horizonY - 40, width, 100);

      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 1;

      // Perspective vanishing lines
      const vanishingX = width / 2;
      const numLines = 28;
      for (let i = -numLines; i <= numLines; i++) {
        const xBottom = vanishingX + i * 50;
        ctx.beginPath();
        ctx.moveTo(vanishingX, horizonY);
        ctx.lineTo(xBottom, height);
        ctx.strokeStyle = `rgba(99, 102, 241, ${0.15 * intensity})`;
        ctx.stroke();
      }

      // Horizontal lines with exponential perspective spacing
      const numHorizontals = 16;
      const gridOffset = (time * 40) % 30;
      for (let i = 1; i <= numHorizontals; i++) {
        const p = Math.pow(i / numHorizontals, 2.5);
        const y = horizonY + p * (height - horizonY) + (gridOffset * p);
        if (y <= height) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.strokeStyle = `rgba(168, 85, 247, ${(0.2 + p * 0.6) * intensity})`;
          ctx.stroke();
        }
      }
    } else if (type === 'holographic_wave') {
      // Wave lines simulation
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, width, height);

      const waves = 5;
      for (let w = 0; w < waves; w++) {
        ctx.beginPath();
        const baseColor = w % 2 === 0 ? primaryColor : secondaryColor;
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2.5;

        for (let x = 0; x <= width; x += 10) {
          const y =
            height * 0.5 +
            Math.sin(x * 0.008 + time * 2 + w) * 60 * intensity +
            Math.cos(x * 0.015 - time * 1.5) * 35;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = 15;
        ctx.stroke();
      }
    } else if (type === 'fluid_mesh' || type === 'aurora') {
      // Multi-layer Aurora Mesh Blobs
      ctx.fillStyle = '#050713';
      ctx.fillRect(0, 0, width, height);

      // Orbs moving organically
      const orbs = [
        {
          x: width * 0.35 + Math.sin(time * 0.8) * (width * 0.2),
          y: height * 0.4 + Math.cos(time * 0.6) * (height * 0.2),
          r: width * 0.45,
          color: primaryColor,
        },
        {
          x: width * 0.7 + Math.cos(time * 0.7) * (width * 0.25),
          y: height * 0.6 + Math.sin(time * 0.9) * (height * 0.2),
          r: width * 0.4,
          color: secondaryColor,
        },
        {
          x: width * 0.5 + Math.sin(time * 1.2) * (width * 0.15),
          y: height * 0.3 + Math.cos(time * 1.1) * (height * 0.15),
          r: width * 0.35,
          color: accentColor,
        },
      ];

      orbs.forEach((orb) => {
        const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.r);
        grad.addColorStop(0, orb.color + 'aa');
        grad.addColorStop(0.5, orb.color + '44');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      });
    } else {
      // Default sleek dark vignette
      ctx.fillStyle = '#080c18';
      ctx.fillRect(0, 0, width, height);
      const grad = ctx.createRadialGradient(
        width / 2,
        height / 2,
        50,
        width / 2,
        height / 2,
        width * 0.7
      );
      grad.addColorStop(0, primaryColor + '55');
      grad.addColorStop(1, '#050710');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }
  }, [frame, type, primaryColor, secondaryColor, accentColor, speed, intensity]);

  return (
    <canvas
      ref={canvasRef}
      width={1280}
      height={720}
      className={`absolute inset-0 w-full h-full object-cover pointer-events-none ${className}`}
    />
  );
}
