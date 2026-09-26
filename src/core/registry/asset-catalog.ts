export interface CatalogItem {
  id: string;
  title: string;
  category: 'motion' | 'typography' | 'backgrounds' | '3d' | 'particles' | 'ui' | 'effects' | 'templates';
  description: string;
  tags: string[];
  capabilities: {
    browser: boolean;
    video: boolean;
    gpu: boolean;
  };
}

export const COMPLETE_ASSET_CATALOG: CatalogItem[] = [
  // MOTION PRESETS
  { id: 'mot_fade', title: 'Fade In / Out', category: 'motion', description: 'Deterministic alpha interpolation', tags: ['entrance', 'fade'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_fade_up', title: 'Fade Up SaaS', category: 'motion', description: 'Vertical slide with cubic deceleration', tags: ['saas', 'entrance'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_fade_down', title: 'Fade Down Cascade', category: 'motion', description: 'Downward ease reveal', tags: ['dropdown', 'reveal'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_fade_left', title: 'Fade Slide Left', category: 'motion', description: 'Horizontal wipe entrance from right', tags: ['slide', 'horizontal'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_fade_right', title: 'Fade Slide Right', category: 'motion', description: 'Horizontal wipe entrance from left', tags: ['slide', 'horizontal'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_scale_pop', title: 'Scale Pop Elastic', category: 'motion', description: 'High-tension spring scale pop with overshoot', tags: ['pop', 'spring'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_spring_bounce', title: 'Physics Spring Bounce', category: 'motion', description: 'Analytic damped spring vibration settling', tags: ['physics', 'bounce'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_blur_scale', title: 'Cinematic Lens Focus', category: 'motion', description: 'Depth of field blur scale reveal', tags: ['cinematic', 'blur'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_glitch', title: 'Cyber Glitch Twitch', category: 'motion', description: 'Procedural chromatic jitter', tags: ['tech', 'glitch'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_float', title: 'Zero-G Float Levitation', category: 'motion', description: 'Harmonic continuous sine wave loop', tags: ['loop', 'float'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_saas_hero', title: 'SaaS 3D Perspective Tilt', category: 'motion', description: '3D perspective card reveal for landing heroes', tags: ['saas', '3d'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'mot_luxury', title: 'Luxury Ethereal Reveal', category: 'motion', description: 'Slow-motion high-end fashion/luxury pacing', tags: ['luxury', 'editorial'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_3d_flip', title: '3D Y-Axis Flip', category: 'motion', description: 'Spatial card flip transition', tags: ['3d', 'flip'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'mot_wipe', title: 'Mask Wipe Reveal', category: 'motion', description: 'Directional clipping path wipe', tags: ['mask', 'wipe'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_pulse', title: 'Organic Pulse Breathe', category: 'motion', description: 'Continuous cardiac breathing rhythm for buttons & badges', tags: ['loop', 'pulse'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'mot_shake', title: 'Trauma Impact Shake', category: 'motion', description: 'Decaying camera vibration trauma', tags: ['cinematic', 'impact'], capabilities: { browser: true, video: true, gpu: false } },

  // TYPOGRAPHY ANIMATIONS
  { id: 'typ_stagger', title: 'Character Stagger Pop', category: 'typography', description: 'Individual glyph cascading with spring physics', tags: ['kinetic', 'stagger'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'typ_word', title: 'Word Perspective Reveal', category: 'typography', description: '3D bottom-hinged word rotation', tags: ['words', '3d'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'typ_chrome', title: 'Liquid Chrome Shimmer', category: 'typography', description: 'Real-time reflective metallic gradient specular sweep', tags: ['chrome', 'luxury'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'typ_scramble', title: 'Matrix Decrypt Scramble', category: 'typography', description: 'Procedural character shuffling settling into final text', tags: ['cyber', 'scramble'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'typ_typewriter', title: 'Terminal Typewriter', category: 'typography', description: 'Code-style monospace character by character cursor typing', tags: ['terminal', 'code'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'typ_neon', title: 'Neon Electric Glow', category: 'typography', description: 'Oscillating luminescence text shadow glow', tags: ['neon', 'cyberpunk'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'typ_cinematic_blur', title: 'Cinematic Lens Blur Reveal', category: 'typography', description: 'High-end movie title blur fade', tags: ['cinematic', 'blur'], capabilities: { browser: true, video: true, gpu: false } },

  // PROCEDURAL BACKGROUNDS
  { id: 'bg_aurora', title: 'Aurora Borealis Liquid Mesh', category: 'backgrounds', description: 'Organic harmonic moving radial energy orbs', tags: ['aurora', 'mesh', 'ambient'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'bg_cybergrid', title: 'Infinite Cyber Grid Horizon', category: 'backgrounds', description: 'Retro-futuristic perspective vanishing grid', tags: ['grid', 'perspective'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'bg_wave', title: 'Holographic Sine Wavefield', category: 'backgrounds', description: 'Multi-frequency glowing audio wave simulation', tags: ['waves', 'audio'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'bg_nebula', title: 'Deep Space Cosmic Nebula', category: 'backgrounds', description: 'Multi-layer volumetric stellar clouds', tags: ['cosmic', 'space'], capabilities: { browser: true, video: true, gpu: true } },

  // 3D OBJECTS & PARTICLES
  { id: '3d_knot', title: 'Torus Knot Glass Prism', category: '3d', description: 'Refractive Three.js physical transmission knot', tags: ['three', 'glass', 'knot'], capabilities: { browser: true, video: true, gpu: true } },
  { id: '3d_icosahedron', title: 'Chrome Icosahedron', category: '3d', description: 'High-specular metal geometry with rim illumination', tags: ['three', 'chrome'], capabilities: { browser: true, video: true, gpu: true } },
  { id: '3d_galaxy', title: 'Spiral Particle Galaxy', category: 'particles', description: '4,000 GPU instanced orbiting points with dual color bands', tags: ['particles', 'galaxy'], capabilities: { browser: true, video: true, gpu: true } },
  { id: '3d_neon_ring', title: 'Neon Emissive Torus', category: '3d', description: 'Glowing emissive bloom ring with continuous orbit', tags: ['neon', 'three'], capabilities: { browser: true, video: true, gpu: true } },

  // SAAS UI & DATA VIZ
  { id: 'ui_browser', title: 'SaaS Perspective Browser', category: 'ui', description: 'Window mockup with customizable URL, controls, and 3D tilt', tags: ['browser', 'mockup'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'ui_mobile', title: 'Dynamic Island Mobile Mockup', category: 'ui', description: 'Realistic hardware bezel with notch and nested viewport', tags: ['mobile', 'iphone'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'ui_metric', title: 'Animated Metric Counter Card', category: 'ui', description: 'Numerical easing counter with sparkline progress', tags: ['counter', 'kpi'], capabilities: { browser: true, video: true, gpu: false } },
  { id: 'ui_chart', title: 'Animated Growth Bar Chart', category: 'ui', description: 'Frame-synchronized bar height spring rise', tags: ['chart', 'growth'], capabilities: { browser: true, video: true, gpu: false } },

  // TEMPLATES
  { id: 'tpl_ai_launch', title: 'AI SaaS Product Commercial (8s)', category: 'templates', description: 'Complete 4-scene video composition: Hook, 3D Architecture, UI Dashboard, CTA', tags: ['ai', 'saas', 'video'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'tpl_startup', title: 'High-Growth Startup Pitch', category: 'templates', description: 'Problem-insight-solution dynamic typography reel', tags: ['pitch', 'startup'], capabilities: { browser: true, video: true, gpu: true } },
  { id: 'tpl_mobile_app', title: 'Mobile App Showcase Reel', category: 'templates', description: 'Vertical 9:16 mobile mockups with feature callouts', tags: ['mobile', 'social'], capabilities: { browser: true, video: true, gpu: true } },
];
