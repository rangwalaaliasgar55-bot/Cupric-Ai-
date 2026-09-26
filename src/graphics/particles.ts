/* Particle engine — closed-form deterministic particles (seekable, no per-frame state, no React nodes).
 * Behaviors: drift, fall, rise, emitter, explode, orbit, vortex, warp, flow, network, helix, swarm. */
import { hash1, noise3, withAlpha, clamp } from "@/core/math";
import type { Theme } from "@/themes";
import { glowSprite, type Ctx2D } from "@/render/core";

export type Behavior = "drift" | "fall" | "rise" | "emitter" | "explode" | "orbit" | "vortex" | "warp" | "flow" | "network" | "helix" | "swarm";
export type ParticleConfig = {
  behavior: Behavior; count: number; colors?: string[]; size: [number, number]; speed: number; gravity: number; turbulence: number;
  life: number; glow: boolean; trails: number; blend: "lighter" | "source-over"; shape: "dot" | "glow" | "square" | "line" | "confetti" | "ring";
  spread?: number; arms?: number; originX?: number; originY?: number; opacity?: number; twinkle?: boolean; linkDistance?: number;
};
export type ParticlePreset = { id: string; name: string; tags: string[]; description: string; config: ParticleConfig };
export const PARTICLE_PRESETS: Record<string, ParticlePreset> = {};
const base: ParticleConfig = { behavior: "drift", count: 200, size: [1, 3], speed: 1, gravity: 0, turbulence: 0, life: 4, glow: false, trails: 0, blend: "lighter", shape: "dot", opacity: 1 };
const P = (id: string, name: string, tags: string[], description: string, c: Partial<ParticleConfig>) => { PARTICLE_PRESETS[id] = { id, name, tags, description, config: { ...base, ...c } }; };

P("stars", "Stars", ["space", "calm"], "Twinkling parallax stars.", { behavior: "drift", count: 350, size: [0.6, 2.2], speed: 0.15, twinkle: true, colors: ["#ffffff", "#c7d2fe", "#fde68a"] });
P("dust", "Dust Motes", ["cinematic", "ambient"], "Floating dust in a light beam.", { behavior: "drift", count: 260, size: [0.8, 2.4], speed: 0.2, turbulence: 0.6, opacity: 0.6, colors: ["#fff7e6", "#ffe4b5"] });
P("sparks", "Sparks", ["energy", "fire", "dramatic"], "Hot sparks shooting upward.", { behavior: "emitter", count: 180, size: [1, 2.5], speed: 1.6, gravity: 0.5, life: 1.6, trails: 0.06, originY: 1.05, spread: 0.6, glow: true, colors: ["#fff1a8", "#ffb347", "#ff6a00"] });
P("rain", "Rain", ["weather", "moody"], "Slanted rain streaks.", { behavior: "fall", count: 400, size: [1, 1.6], speed: 2.4, shape: "line", opacity: 0.45, blend: "source-over", colors: ["#b8c7ff", "#e2e8f0"], spread: 0.25 });
P("snow", "Snow", ["weather", "winter", "calm"], "Soft falling snow with sway.", { behavior: "fall", count: 260, size: [1.5, 4.5], speed: 0.35, turbulence: 1, opacity: 0.85, blend: "source-over", colors: ["#ffffff"] });
P("galaxy", "Galaxy", ["space", "cosmic", "hero"], "Spiral galaxy with rotating arms.", { behavior: "orbit", count: 1400, size: [0.6, 2], speed: 0.35, arms: 3, spread: 0.35, colors: ["#c4b5fd", "#93c5fd", "#fbcfe8", "#ffffff"] });
P("neural", "Neural Network", ["ai", "network", "data"], "Linked nodes like neurons firing.", { behavior: "network", count: 90, size: [1.8, 3.5], speed: 0.25, linkDistance: 0.14, colors: ["#7c8cff", "#38bdf8", "#c084fc"] });
P("data", "Data Stream", ["data", "tech"], "Horizontal packets of data.", { behavior: "drift", count: 160, size: [2, 5], speed: 1.2, shape: "square", spread: 0, trails: 0.12, colors: ["#38bdf8", "#34d399", "#a78bfa"] });
P("energy", "Energy Vortex", ["energy", "portal"], "Energy spiralling into a core.", { behavior: "vortex", count: 600, size: [0.8, 2.4], speed: 1, life: 3, trails: 0.05, glow: true, colors: ["#22d3ee", "#818cf8", "#f0abfc"] });
P("magic", "Magic Sparkles", ["magic", "fantasy"], "Twinkling sparkles rising gently.", { behavior: "rise", count: 180, size: [1, 3.5], speed: 0.4, life: 3.5, twinkle: true, glow: true, turbulence: 0.5, colors: ["#e9d5ff", "#f0abfc", "#fde68a"] });
P("smoke", "Smoke", ["smoke", "moody"], "Soft rolling smoke puffs.", { behavior: "rise", count: 50, size: [40, 110], speed: 0.18, life: 7, turbulence: 1.2, shape: "glow", opacity: 0.12, blend: "source-over", colors: ["#9ca3af", "#6b7280"] });
P("fire", "Fire", ["fire", "warm"], "Flame particles with shrink and cool-down.", { behavior: "rise", count: 260, size: [6, 22], speed: 0.8, life: 1.4, turbulence: 0.6, shape: "glow", originY: 1.02, spread: 0.18, colors: ["#fff3b0", "#ffb000", "#ff4d00", "#7a1c00"] });
P("fireflies", "Fireflies", ["nature", "night", "calm"], "Blinking fireflies wandering.", { behavior: "drift", count: 60, size: [2, 4], speed: 0.1, turbulence: 2, twinkle: true, glow: true, colors: ["#d9f99d", "#fde047"] });
P("bubbles", "Bubbles", ["water", "playful"], "Rising outlined bubbles.", { behavior: "rise", count: 70, size: [4, 16], speed: 0.35, life: 6, turbulence: 0.6, shape: "ring", blend: "source-over", opacity: 0.6, colors: ["#bae6fd", "#e0f2fe"] });
P("confetti", "Confetti", ["celebration", "social"], "Celebratory confetti burst.", { behavior: "explode", count: 220, size: [5, 10], speed: 1.6, gravity: 0.9, life: 4, shape: "confetti", blend: "source-over", colors: ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#a855f7"] });
P("embers", "Embers", ["fire", "cinematic"], "Slow drifting embers.", { behavior: "rise", count: 90, size: [1, 3], speed: 0.25, life: 6, turbulence: 1.2, glow: true, twinkle: true, colors: ["#ff7a1a", "#ffb35c", "#ff3d00"] });
P("warp", "Warp Drive", ["space", "energetic"], "Hyperspace streaks.", { behavior: "warp", count: 400, size: [0.5, 2.5], speed: 0.8, trails: 1, colors: ["#ffffff", "#a5b4fc", "#67e8f9"] });
P("vortex", "Vortex", ["hypnotic"], "Swirling vortex funnel.", { behavior: "vortex", count: 900, size: [0.6, 1.8], speed: 0.6, life: 5, colors: ["#f472b6", "#818cf8"] });
P("explosion", "Explosion", ["dramatic", "impact"], "Radial burst with drag and trails.", { behavior: "explode", count: 320, size: [1, 3], speed: 2.4, gravity: 0.2, life: 2.2, trails: 0.08, glow: true, colors: ["#ffffff", "#fde68a", "#fb923c"] });
P("fountain", "Fountain", ["playful"], "Arcing fountain under gravity.", { behavior: "emitter", count: 300, size: [1.5, 3], speed: 1.4, gravity: 1.3, life: 2, originY: 0.95, spread: 0.25, colors: ["#67e8f9", "#a5f3fc", "#ffffff"] });
P("constellation", "Constellation", ["space", "network", "minimal"], "Sparse linked stars.", { behavior: "network", count: 45, size: [1.5, 3], speed: 0.08, linkDistance: 0.2, twinkle: true, colors: ["#ffffff", "#c7d2fe"] });
P("flowField", "Flow Field", ["fluid", "generative", "premium"], "Particles traced along a noise field.", { behavior: "flow", count: 500, size: [0.8, 1.6], speed: 0.6, life: 4, trails: 0.3, colors: ["#7c8cff", "#38bdf8", "#c084fc"] });
P("plankton", "Bioluminescence", ["water", "nature"], "Glowing plankton drifting in currents.", { behavior: "flow", count: 300, size: [1, 2.5], speed: 0.25, life: 6, glow: true, twinkle: true, colors: ["#22d3ee", "#5eead4"] });
P("meteorShower", "Meteor Shower", ["space", "dramatic"], "Streaking meteors with long trails.", { behavior: "fall", count: 24, size: [1.5, 2.5], speed: 1.8, trails: 0.25, spread: 1, glow: true, colors: ["#ffffff", "#fcd34d"] });
P("bokeh", "Bokeh", ["cinematic", "soft"], "Large out-of-focus bokeh discs.", { behavior: "drift", count: 30, size: [20, 70], speed: 0.08, shape: "glow", opacity: 0.35, colors: ["#fbbf24", "#f472b6", "#60a5fa"] });
P("pollen", "Pollen", ["nature", "warm"], "Pollen drifting on a breeze.", { behavior: "drift", count: 120, size: [1, 3], speed: 0.3, turbulence: 1.5, opacity: 0.7, colors: ["#fde68a", "#fef3c7"] });
P("ash", "Ash", ["moody", "apocalyptic"], "Falling ash flakes.", { behavior: "fall", count: 180, size: [1, 3], speed: 0.25, turbulence: 1.2, blend: "source-over", opacity: 0.6, colors: ["#9ca3af", "#d1d5db"] });
P("portal", "Portal Ring", ["portal", "sci-fi"], "Orbiting ring of particles.", { behavior: "orbit", count: 900, size: [0.6, 2], speed: 0.9, arms: 1, spread: 0.04, colors: ["#a78bfa", "#22d3ee"] });
P("dnaHelix", "DNA Helix", ["science", "biotech"], "Double helix of particles.", { behavior: "helix", count: 160, size: [2, 4], speed: 0.6, glow: true, colors: ["#34d399", "#60a5fa"] });
P("swarm", "Swarm", ["organic", "ai"], "A flocking swarm chasing a moving target.", { behavior: "swarm", count: 220, size: [1, 2.5], speed: 0.6, trails: 0.05, colors: ["#e2e8f0", "#94a3b8"] });
P("heartBurst", "Heart Burst", ["love", "social"], "Pink burst of hearts-like glow.", { behavior: "explode", count: 140, size: [2, 5], speed: 1.2, gravity: -0.1, life: 3, glow: true, colors: ["#fb7185", "#f472b6", "#fecdd3"] });
P("sparkleBurst", "Sparkle Burst", ["celebration", "luxury"], "Golden twinkling burst.", { behavior: "explode", count: 160, size: [1, 3], speed: 1, gravity: 0.1, life: 3, twinkle: true, glow: true, colors: ["#fde68a", "#fbbf24", "#ffffff"] });
P("orbitRings", "Orbit Rings", ["space", "atom"], "Particles on discrete orbital shells.", { behavior: "orbit", count: 500, size: [0.8, 2], speed: 0.6, arms: 4, spread: 0.02, colors: ["#93c5fd", "#c4b5fd"] });
P("lanterns", "Sky Lanterns", ["warm", "celebration"], "Lanterns rising slowly into the sky.", { behavior: "rise", count: 40, size: [4, 9], speed: 0.12, life: 14, turbulence: 0.5, glow: true, colors: ["#fdba74", "#fcd34d"] });

type PState = { x: number; y: number; a: number; s: number; ci: number; rot?: number } | null;

/** Evaluate particle i at time t in normalized space ([0,1] x [0,1], aspect-corrected by caller). Pure. */
export function particleAt(cfg: ParticleConfig, i: number, t: number, seed: number, ar: number): PState {
  const r1 = hash1(i * 1.618 + seed), r2 = hash1(i * 2.414 + seed * 1.3), r3 = hash1(i * 3.732 + seed * 0.7), r4 = hash1(i * 5.123 + seed * 1.9);
  const sp = cfg.speed;
  const s = cfg.size[0] + (cfg.size[1] - cfg.size[0]) * r3;
  const ci = Math.floor(r4 * 97);
  const turb = (k: number) => cfg.turbulence ? noise3(r1 * 10, r2 * 10 + k, t * 0.3, seed) * 0.05 * cfg.turbulence : 0;
  const wrap = (v: number) => ((v % 1) + 1) % 1;
  const tw = cfg.twinkle ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (2 + r2 * 4) + r1 * 40)) : 1;
  switch (cfg.behavior) {
    case "drift": {
      const vx = (cfg.spread === 0 ? 1 : r2 - 0.5) * 0.05 * sp * (0.4 + r3), vy = (cfg.spread === 0 ? 0 : r1 - 0.5) * 0.05 * sp;
      return { x: wrap(r1 + vx * t + turb(0)), y: wrap(r2 + vy * t + turb(9)), a: tw, s, ci };
    }
    case "fall": {
      const slant = cfg.spread ?? 0;
      const v = 0.12 * sp * (0.6 + r3 * 0.8);
      return { x: wrap(r1 - slant * v * t * 0.5 + (cfg.turbulence ? Math.sin(t * (0.8 + r2) + r1 * 20) * 0.02 * cfg.turbulence : 0)), y: wrap(r2 + v * t), a: tw, s, ci };
    }
    case "rise": {
      const L = cfg.life * (0.6 + r3 * 0.8);
      const age = (t + r4 * L * 3) % L;
      const k = age / L;
      const ox = cfg.originY !== undefined ? 0.5 + (r1 - 0.5) * (cfg.spread ?? 1) : r1;
      const oy = cfg.originY ?? 1.05;
      const y = oy - age * 0.15 * sp * (0.6 + r2);
      const x = ox + Math.sin(age * (1 + r2) + r1 * 30) * 0.02 * (cfg.turbulence + 0.2) + turb(3);
      const a = Math.sin(k * Math.PI) * tw;
      const sz = s * (cfg.originY !== undefined ? 1 - k * 0.7 : 1);
      return { x, y, a, s: sz, ci: cfg.originY !== undefined ? Math.floor(k * 3.99) : ci };
    }
    case "emitter": {
      const L = cfg.life * (0.7 + r3 * 0.6);
      const age = (t + r4 * L * 5) % L;
      const ang = -Math.PI / 2 + (r1 - 0.5) * Math.PI * (cfg.spread ?? 0.5);
      const v = 0.35 * sp * (0.5 + r2);
      const x = (cfg.originX ?? 0.5) + Math.cos(ang) * v * age / ar;
      const y = (cfg.originY ?? 0.5) + Math.sin(ang) * v * age + 0.5 * cfg.gravity * 0.3 * age * age;
      return { x, y, a: 1 - age / L, s: s * (1 - (age / L) * 0.5), ci };
    }
    case "explode": {
      const L = cfg.life;
      const cyc = L + 0.6;
      const age = t % cyc;
      if (age > L) return null;
      const ang = r1 * Math.PI * 2;
      const v = 0.45 * sp * (0.2 + r2 * r2 * 0.8 + 0.2);
      const drag = 2.2;
      const d = (v * (1 - Math.exp(-drag * age))) / drag;
      const x = (cfg.originX ?? 0.5) + (Math.cos(ang) * d) / ar;
      const y = (cfg.originY ?? 0.5) + Math.sin(ang) * d + 0.5 * cfg.gravity * 0.12 * age * age;
      return { x, y, a: clamp(1 - age / L) * tw, s, ci, rot: age * (r3 * 10 - 5) };
    }
    case "orbit": {
      const arms = cfg.arms ?? 3;
      const arm = Math.floor(r4 * arms);
      const rr = cfg.arms === 1 ? 0.28 + (r2 - 0.5) * (cfg.spread ?? 0.04) : cfg.behavior && (cfg.spread ?? 0.3) < 0.05 ? (arm + 1) / (arms + 1) * 0.42 + (r2 - 0.5) * (cfg.spread ?? 0.02) : Math.pow(r2, 0.6) * 0.45;
      const twist = (cfg.spread ?? 0.3) >= 0.05 ? rr * 9 : 0;
      const a0 = (arm / arms) * Math.PI * 2 + twist + (r1 - 0.5) * (cfg.spread ?? 0.3) * 2;
      const a = a0 + t * sp * (0.15 / Math.max(0.05, rr));
      return { x: 0.5 + (Math.cos(a) * rr) / ar * 1.0, y: 0.5 + Math.sin(a) * rr * 0.55, a: tw * (0.4 + 0.6 * (1 - rr * 1.5)), s: s * (1.2 - rr), ci };
    }
    case "vortex": {
      const L = cfg.life * (0.6 + r3 * 0.8);
      const age = (t * sp + r4 * L * 4) % L;
      const k = age / L;
      const rr = 0.5 * (1 - k) + 0.01;
      const a = r1 * Math.PI * 2 + age * (0.6 / rr);
      return { x: 0.5 + (Math.cos(a) * rr) / ar, y: 0.5 + Math.sin(a) * rr * 0.9, a: Math.sin(k * Math.PI), s: s * (0.5 + (1 - k)), ci };
    }
    case "warp": {
      const z = (r3 + t * sp * 0.35) % 1;
      const ang = r1 * Math.PI * 2;
      const d = z * z * 0.8;
      return { x: 0.5 + (Math.cos(ang) * d) / ar, y: 0.5 + Math.sin(ang) * d, a: z, s: s * (0.3 + z * 1.5), ci };
    }
    case "flow": {
      const L = cfg.life * (0.6 + r3 * 0.8);
      const age = (t + r4 * L * 4) % L;
      let x = r1, y = r2;
      const steps = Math.floor(age * 8);
      for (let k = 0; k < steps; k++) { const a = noise3(x * 2.2, y * 2.2, seed * 0.1, seed) * Math.PI * 2; x += (Math.cos(a) * 0.012 * sp) / ar; y += Math.sin(a) * 0.012 * sp; }
      return { x: wrap(x), y: wrap(y), a: Math.sin((age / L) * Math.PI) * tw, s, ci };
    }
    case "network": {
      return { x: wrap(r1 + Math.sin(t * sp * 0.5 + r3 * 20) * 0.03 + (r2 - 0.5) * 0.02 * t * sp), y: wrap(r2 + Math.cos(t * sp * 0.4 + r4 * 20) * 0.03), a: tw, s, ci };
    }
    case "helix": {
      const k = i / cfg.count;
      const strand = i % 2;
      const ph = k * Math.PI * 8 + t * sp * 2 + strand * Math.PI;
      const depth = (Math.cos(ph) + 1) / 2;
      return { x: 0.15 + k * 0.7, y: 0.5 + Math.sin(ph) * 0.14, a: 0.3 + depth * 0.7, s: s * (0.5 + depth), ci: strand };
    }
    case "swarm": {
      const tx = 0.5 + Math.sin(t * sp * 0.7) * 0.25, ty = 0.5 + Math.sin(t * sp * 1.1) * 0.2;
      const lag = r3 * 0.6;
      const lx = 0.5 + Math.sin((t - lag) * sp * 0.7) * 0.25, ly = 0.5 + Math.sin((t - lag) * sp * 1.1) * 0.2;
      const a = r1 * Math.PI * 2 + t * (1 + r2);
      const rad = 0.02 + r2 * 0.06;
      return { x: (tx + lx) / 2 + (Math.cos(a) * rad) / ar, y: (ty + ly) / 2 + Math.sin(a) * rad, a: 0.8, s, ci };
    }
  }
}

export function drawParticles(ctx: Ctx2D, w: number, h: number, t: number, cfg: ParticleConfig, theme: Theme, seed: number, quality = 1, intensity = 1) {
  const colors = cfg.colors?.length ? cfg.colors : theme.gradient;
  const n = Math.max(1, Math.round(cfg.count * quality));
  const ar = w / h;
  const pts: { x: number; y: number; a: number }[] = [];
  ctx.save();
  ctx.globalCompositeOperation = cfg.blend;
  const trail = cfg.trails;
  for (let i = 0; i < n; i++) {
    const st = particleAt(cfg, i, t, seed, ar);
    if (!st || st.a <= 0.01) continue;
    const x = st.x * w, y = st.y * h;
    const col = colors[st.ci % colors.length];
    const alpha = clamp(st.a * (cfg.opacity ?? 1) * intensity);
    if (cfg.behavior === "network") pts.push({ x, y, a: alpha });
    if (trail > 0) {
      const prev = particleAt(cfg, i, t - trail, seed, ar);
      if (prev) {
        const px = prev.x * w, py = prev.y * h;
        if (Math.abs(px - x) < w * 0.3 && Math.abs(py - y) < h * 0.3) {
          const g = ctx.createLinearGradient(px, py, x, y);
          g.addColorStop(0, withAlpha(col, 0)); g.addColorStop(1, withAlpha(col, alpha));
          ctx.strokeStyle = g; ctx.lineWidth = st.s; ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = alpha;
    switch (cfg.shape) {
      case "glow": { const r = st.s; ctx.drawImage(glowSprite(col, 64), x - r, y - r, r * 2, r * 2); break; }
      case "square": ctx.fillStyle = col; ctx.fillRect(x - st.s / 2, y - st.s / 2, st.s, st.s); break;
      case "line": ctx.strokeStyle = col; ctx.lineWidth = st.s; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - (cfg.spread ?? 0) * 8, y - 18 * cfg.speed); ctx.stroke(); break;
      case "ring": ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, st.s, 0, Math.PI * 2); ctx.stroke(); break;
      case "confetti": ctx.save(); ctx.translate(x, y); ctx.rotate(st.rot ?? 0); ctx.scale(1, Math.cos((st.rot ?? 0) * 2)); ctx.fillStyle = col; ctx.fillRect(-st.s / 2, -st.s / 4, st.s, st.s / 2); ctx.restore(); break;
      default:
        if (cfg.glow) { const r = st.s * 5; ctx.drawImage(glowSprite(col, 64), x - r, y - r, r * 2, r * 2); }
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, st.s, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (pts.length) {
    const md = (cfg.linkDistance ?? 0.15) * w;
    ctx.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d < md) { ctx.globalAlpha = (1 - d / md) * 0.5 * Math.min(pts[i].a, pts[j].a); ctx.strokeStyle = colors[(i + j) % colors.length]; ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke(); }
    }
  }
  ctx.restore();
}
