'use client';

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';

export interface ParticleGalaxyProps {
  count?: number;
  color?: string;
  secondaryColor?: string;
  speed?: number;
  size?: number;
  radius?: number;
  arms?: number;
  className?: string;
}

export function ParticleGalaxy({
  count = 4000,
  color = '#818cf8',
  secondaryColor = '#ec4899',
  speed = 0.8,
  size = 0.035,
  radius = 5,
  arms = 4,
  className = '',
}: ParticleGalaxyProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const frame = useCurrentFrame();

  const pointsRef = useRef<THREE.Points | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const width = mountRef.current.clientWidth || 800;
    const height = mountRef.current.clientHeight || 500;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 100);
    camera.position.set(0, 3.5, 4.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Build Galaxy Geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    const c1 = new THREE.Color(color);
    const c2 = new THREE.Color(secondaryColor);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Spiral math
      const r = Math.pow(Math.random(), 1.5) * radius;
      const spinAngle = r * 1.5;
      const branchAngle = ((i % arms) / arms) * Math.PI * 2;

      const randomX = (Math.random() - 0.5) * (0.3 + r * 0.15);
      const randomY = (Math.random() - 0.5) * (0.2 + r * 0.1);
      const randomZ = (Math.random() - 0.5) * (0.3 + r * 0.15);

      positions[i3] = Math.cos(branchAngle + spinAngle) * r + randomX;
      positions[i3 + 1] = randomY;
      positions[i3 + 2] = Math.sin(branchAngle + spinAngle) * r + randomZ;

      // Color gradient from center to edge
      const mixedColor = c1.clone().lerp(c2, r / radius);
      colors[i3] = mixedColor.r;
      colors[i3 + 1] = mixedColor.g;
      colors[i3 + 2] = mixedColor.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);
    pointsRef.current = points;

    return () => {
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (mountRef.current) mountRef.current.innerHTML = '';
    };
  }, [count, color, secondaryColor, radius, arms, size]);

  useEffect(() => {
    if (!pointsRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    const t = (frame * speed) / 30;
    pointsRef.current.rotation.y = t * 0.35;
    cameraRef.current.position.y = 3.5 + Math.sin(t * 0.5) * 0.4;
    cameraRef.current.lookAt(0, 0, 0);
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, [frame, speed]);

  return <div ref={mountRef} className={`w-full h-full relative ${className}`} />;
}
