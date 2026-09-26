import { MotionPresetDefinition, TransformProperties } from '../schemas/scene-graph';
import { Easings, evaluateSpring, interpolate } from '../animation/interpolations';

class MotionRegistry {
  private presets: Map<string, MotionPresetDefinition> = new Map();

  constructor() {
    this.registerDefaults();
  }

  public register(preset: MotionPresetDefinition) {
    this.presets.set(preset.id, preset);
  }

  public get(id: string): MotionPresetDefinition | undefined {
    return this.presets.get(id);
  }

  public getAll(): MotionPresetDefinition[] {
    return Array.from(this.presets.values());
  }

  public getByCategory(category: MotionPresetDefinition['category']): MotionPresetDefinition[] {
    return this.getAll().filter((p) => p.category === category);
  }

  private registerDefaults() {
    // 1. FADE
    this.register({
      id: 'fade',
      name: 'Fade In',
      category: 'entrance',
      description: 'Clean linear fade-in opacity transition',
      tags: ['minimal', 'clean', 'opacity'],
      durationFrames: 20,
      evaluate: (frame, dur) => ({
        opacity: interpolate(frame, [0, dur], [0, 1]),
      }),
    });

    // 2. FADE_UP
    this.register({
      id: 'fade_up',
      name: 'Fade Up',
      category: 'entrance',
      description: 'Smooth vertical rise with opacity fade',
      tags: ['saas', 'modern', 'slide'],
      durationFrames: 25,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutCubic(p);
        return {
          opacity: p,
          y: (1 - ease) * 40,
        };
      },
    });

    // 3. FADE_DOWN
    this.register({
      id: 'fade_down',
      name: 'Fade Down',
      category: 'entrance',
      description: 'Elegant downward cascade with opacity',
      tags: ['dropdown', 'reveal'],
      durationFrames: 25,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutCubic(p);
        return {
          opacity: p,
          y: (ease - 1) * 40,
        };
      },
    });

    // 4. FADE_LEFT / FADE_RIGHT
    this.register({
      id: 'fade_left',
      name: 'Fade Left',
      category: 'entrance',
      description: 'Slide in from right to left with fade',
      tags: ['horizontal', 'slide'],
      durationFrames: 25,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutCubic(p);
        return {
          opacity: p,
          x: (1 - ease) * 50,
        };
      },
    });

    this.register({
      id: 'fade_right',
      name: 'Fade Right',
      category: 'entrance',
      description: 'Slide in from left to right with fade',
      tags: ['horizontal', 'slide'],
      durationFrames: 25,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutCubic(p);
        return {
          opacity: p,
          x: (ease - 1) * 50,
        };
      },
    });

    // 5. SCALE_POP
    this.register({
      id: 'scale_pop',
      name: 'Scale Pop',
      category: 'entrance',
      description: 'Energetic scale pop with elastic spring physics',
      tags: ['pop', 'spring', 'bouncy'],
      durationFrames: 30,
      evaluate: (frame, dur) => {
        const t = (frame / dur) * 0.8; // spring seconds
        const spring = evaluateSpring(t, { stiffness: 220, damping: 14 });
        return {
          opacity: Math.min(1, frame / 6),
          scale: spring,
        };
      },
    });

    // 6. SPRING_BOUNCE
    this.register({
      id: 'spring_bounce',
      name: 'Spring Bounce',
      category: 'entrance',
      description: 'Playful overshoot bounce settle',
      tags: ['bouncy', 'playful'],
      durationFrames: 35,
      evaluate: (frame, dur) => {
        const t = (frame / dur) * 1.0;
        const spring = evaluateSpring(t, { stiffness: 180, damping: 10 });
        return {
          opacity: Math.min(1, frame / 8),
          y: (1 - spring) * 60,
          scale: 0.9 + spring * 0.1,
        };
      },
    });

    // 7. BLUR_SCALE
    this.register({
      id: 'blur_scale',
      name: 'Cinematic Blur Reveal',
      category: 'cinematic',
      description: 'Depth-of-field lens focus with subtle scale down',
      tags: ['cinematic', 'lens', 'blur'],
      durationFrames: 30,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutExpo(p);
        return {
          opacity: p,
          scale: 1.15 - ease * 0.15,
          blur: (1 - ease) * 16,
        };
      },
    });

    // 8. GLITCH
    this.register({
      id: 'glitch',
      name: 'Cyber Glitch',
      category: 'tech',
      description: 'High frequency digital chromatic twitch',
      tags: ['glitch', 'cyber', 'tech'],
      durationFrames: 24,
      evaluate: (frame) => {
        const seed = Math.sin(frame * 999);
        const isGlitch = frame % 3 === 0;
        return {
          opacity: 0.85 + Math.random() * 0.15,
          x: isGlitch ? seed * 8 : 0,
          skewX: isGlitch ? seed * 6 : 0,
          scale: isGlitch ? 1.02 : 1,
        };
      },
    });

    // 9. FLOAT_LOOP
    this.register({
      id: 'float_loop',
      name: 'Zero-G Float',
      category: 'loop',
      description: 'Continuous organic gravitational levitation',
      tags: ['floating', 'ambient', 'loop'],
      durationFrames: 90,
      evaluate: (frame, dur) => {
        const theta = (frame / dur) * Math.PI * 2;
        return {
          y: Math.sin(theta) * 12,
          rotate: Math.cos(theta) * 2,
        };
      },
    });

    // 10. SAAS_HERO
    this.register({
      id: 'saas_hero',
      name: 'SaaS Hero Entrance',
      category: 'saas',
      description: 'Crisp high-converting 3D perspective tilt reveal',
      tags: ['saas', 'hero', '3d'],
      durationFrames: 40,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutCubic(p);
        return {
          opacity: p,
          y: (1 - ease) * 80,
          rotateX: (1 - ease) * 20,
          scale: 0.92 + ease * 0.08,
        };
      },
    });

    // 11. LUXURY_GOLD
    this.register({
      id: 'luxury_gold',
      name: 'Luxury Ethereal Reveal',
      category: 'luxury',
      description: 'Ultra-slow cinematic high-end luxury pacing',
      tags: ['luxury', 'slow', 'editorial'],
      durationFrames: 50,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeInOutCubic(p);
        return {
          opacity: ease,
          scale: 0.97 + ease * 0.03,
          blur: (1 - ease) * 8,
          y: (1 - ease) * 15,
        };
      },
    });

    // 12. 3D_FLIP
    this.register({
      id: '3d_flip',
      name: '3D Card Flip',
      category: 'tech',
      description: 'Perspective 3D Y-axis reveal with spatial depth',
      tags: ['3d', 'flip', 'card'],
      durationFrames: 35,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        const ease = Easings.easeOutCubic(p);
        return {
          opacity: p,
          rotateY: (1 - ease) * 90,
          scale: 0.85 + ease * 0.15,
        };
      },
    });

    // 13. WIPE_REVEAL
    this.register({
      id: 'wipe_reveal',
      name: 'Mask Wipe Reveal',
      category: 'entrance',
      description: 'Crisp editorial directional wipe',
      tags: ['editorial', 'wipe', 'mask'],
      durationFrames: 25,
      evaluate: (frame, dur) => {
        const p = Math.min(1, Math.max(0, frame / dur));
        return {
          opacity: Math.min(1, p * 2),
          x: (1 - Easings.easeOutQuart(p)) * 120,
        };
      },
    });

    // 14. PULSE_BREATHE
    this.register({
      id: 'pulse_breathe',
      name: 'Organic Pulse Breathe',
      category: 'loop',
      description: 'Subtle rhythmic breathing pulse for cards & CTA',
      tags: ['loop', 'breathe', 'cta'],
      durationFrames: 60,
      evaluate: (frame, dur) => {
        const cycle = Math.sin((frame / dur) * Math.PI * 2);
        return {
          scale: 1 + cycle * 0.03,
          opacity: 0.9 + cycle * 0.1,
        };
      },
    });

    // 15. KINETIC_SHAKE
    this.register({
      id: 'kinetic_shake',
      name: 'Impact Shockwave Shake',
      category: 'cinematic',
      description: 'Visceral high-decay camera impact trauma',
      tags: ['impact', 'trauma', 'cinematic'],
      durationFrames: 20,
      evaluate: (frame, dur) => {
        const decay = Math.max(0, 1 - frame / dur);
        const freq = frame * 1.8;
        return {
          x: Math.sin(freq) * 14 * decay,
          y: Math.cos(freq * 1.4) * 10 * decay,
          rotate: Math.sin(freq * 0.8) * 3 * decay,
        };
      },
    });
  }
}

export const motionRegistry = new MotionRegistry();

/**
 * Universal styling evaluator to convert TransformProperties into hardware-accelerated CSS
 */
export function transformToStyle(transform: TransformProperties): React.CSSProperties {
  const parts: string[] = [];

  if (transform.x !== undefined || transform.y !== undefined || transform.z !== undefined) {
    const x = transform.x ?? 0;
    const y = transform.y ?? 0;
    const z = transform.z ?? 0;
    parts.push(`translate3d(${x}px, ${y}px, ${z}px)`);
  }
  if (transform.scale !== undefined) {
    parts.push(`scale(${transform.scale})`);
  } else if (transform.scaleX !== undefined || transform.scaleY !== undefined) {
    parts.push(`scale(${transform.scaleX ?? 1}, ${transform.scaleY ?? 1})`);
  }
  if (transform.rotate !== undefined) {
    parts.push(`rotate(${transform.rotate}deg)`);
  }
  if (transform.rotateX !== undefined) {
    parts.push(`rotateX(${transform.rotateX}deg)`);
  }
  if (transform.rotateY !== undefined) {
    parts.push(`rotateY(${transform.rotateY}deg)`);
  }
  if (transform.rotateZ !== undefined) {
    parts.push(`rotateZ(${transform.rotateZ}deg)`);
  }
  if (transform.skewX !== undefined) {
    parts.push(`skewX(${transform.skewX}deg)`);
  }

  const style: React.CSSProperties = {
    transform: parts.length > 0 ? parts.join(' ') : undefined,
    opacity: transform.opacity,
    filter: transform.blur !== undefined && transform.blur > 0 ? `blur(${transform.blur}px)` : undefined,
    willChange: 'transform, opacity, filter',
    transformStyle: 'preserve-3d',
  };

  return style;
}
