'use client';

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';

export interface Scene3DProps {
  children?: React.ReactNode;
  cameraFov?: number;
  cameraPosition?: [number, number, number];
  backgroundColor?: string;
  ambientLightIntensity?: number;
  enableControls?: boolean;
  onAnimate?: (context: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    frame: number;
    time: number;
  }) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function Scene3D({
  children,
  cameraFov = 45,
  cameraPosition = [0, 0, 8],
  backgroundColor = '#05070f',
  ambientLightIntensity = 0.8,
  onAnimate,
  className = '',
  style = {},
}: Scene3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frame = useCurrentFrame();

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Initialize Three.js context
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(cameraFov, width / height, 0.1, 1000);
    camera.position.set(cameraPosition[0], cameraPosition[1], cameraPosition[2]);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    rendererRef.current = renderer;

    // Ambient & Point lighting rigs
    const ambientLight = new THREE.AmbientLight(0xffffff, ambientLightIntensity);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x60a5fa, 2.5); // Blue rim
    dirLight1.position.set(5, 8, 4);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xa855f7, 2.0); // Purple fill
    dirLight2.position.set(-6, -4, -2);
    scene.add(dirLight2);

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, [backgroundColor, cameraFov, cameraPosition, ambientLightIntensity]);

  // Deterministic frame update synchronized with the composition playhead!
  useEffect(() => {
    if (!sceneRef.current || !cameraRef.current || !rendererRef.current) return;

    const time = frame / 30; // 30 fps normalized time

    if (onAnimate) {
      onAnimate({
        scene: sceneRef.current,
        camera: cameraRef.current,
        renderer: rendererRef.current,
        frame,
        time,
      });
    }

    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, [frame, onAnimate]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden ${className}`}
      style={style}
    >
      <canvas ref={canvasRef} className="w-full h-full block" />
      {/* Declarative HTML overlays if any */}
      <div className="absolute inset-0 pointer-events-none">{children}</div>
    </div>
  );
}
