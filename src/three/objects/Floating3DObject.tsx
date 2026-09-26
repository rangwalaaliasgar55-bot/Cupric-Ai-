'use client';

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useCurrentFrame } from '../../core/composition/VideoCompositionContext';

export interface Floating3DObjectProps {
  geometryType?: 'torus' | 'icosahedron' | 'cube' | 'ring' | 'sphere' | 'knot';
  materialType?: 'glass' | 'chrome' | 'gold' | 'neon' | 'wireframe' | 'iridescent';
  size?: number;
  color?: string;
  speed?: number;
  wireframe?: boolean;
  className?: string;
}

export function Floating3DObject({
  geometryType = 'torus',
  materialType = 'glass',
  size = 2.4,
  color = '#6366f1',
  speed = 1.0,
  wireframe = false,
  className = '',
}: Floating3DObjectProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const frame = useCurrentFrame();

  const meshRef = useRef<THREE.Mesh | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const width = mountRef.current.clientWidth || 300;
    const height = mountRef.current.clientHeight || 300;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 5;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);

    const light1 = new THREE.DirectionalLight(0x38bdf8, 3.5);
    light1.position.set(4, 5, 4);
    scene.add(light1);

    const light2 = new THREE.DirectionalLight(0xf43f5e, 3.0);
    light2.position.set(-4, -3, -2);
    scene.add(light2);

    // Geometry selection
    let geometry: THREE.BufferGeometry;
    switch (geometryType) {
      case 'torus':
        geometry = new THREE.TorusGeometry(size * 0.6, size * 0.22, 32, 100);
        break;
      case 'icosahedron':
        geometry = new THREE.IcosahedronGeometry(size * 0.7, 2);
        break;
      case 'cube':
        geometry = new THREE.BoxGeometry(size * 0.9, size * 0.9, size * 0.9);
        break;
      case 'ring':
        geometry = new THREE.TorusGeometry(size * 0.7, size * 0.08, 16, 100);
        break;
      case 'knot':
        geometry = new THREE.TorusKnotGeometry(size * 0.5, size * 0.15, 128, 32);
        break;
      case 'sphere':
      default:
        geometry = new THREE.SphereGeometry(size * 0.75, 48, 48);
        break;
    }

    // Material selection
    let material: THREE.Material;
    if (materialType === 'chrome') {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.95,
        roughness: 0.05,
        wireframe,
      });
    } else if (materialType === 'gold') {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#fbbf24'),
        metalness: 0.88,
        roughness: 0.15,
        wireframe,
      });
    } else if (materialType === 'glass') {
      material = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(color),
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.8,
        ior: 1.5,
        transparent: true,
        opacity: 0.85,
        wireframe,
      });
    } else if (materialType === 'neon') {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        emissive: new THREE.Color(color),
        emissiveIntensity: 1.4,
        roughness: 0.2,
        wireframe,
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        metalness: 0.4,
        roughness: 0.3,
        wireframe,
      });
    }

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    return () => {
      renderer.dispose();
      if (mountRef.current) {
        mountRef.current.innerHTML = '';
      }
    };
  }, [geometryType, materialType, size, color, wireframe]);

  // Sync animation with frame
  useEffect(() => {
    if (!meshRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
    const t = (frame * speed) / 30;
    meshRef.current.rotation.x = t * 0.7;
    meshRef.current.rotation.y = t * 1.0;
    meshRef.current.position.y = Math.sin(t * 1.5) * 0.15;
    rendererRef.current.render(sceneRef.current, cameraRef.current);
  }, [frame, speed]);

  return <div ref={mountRef} className={`w-full h-full flex items-center justify-center ${className}`} />;
}
