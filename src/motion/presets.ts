/* Motion preset registry. Entrance presets are functions of progress p (0 hidden → 1 settled; may exceed
 * 1 for springs). Loop presets are functions of time in seconds. Exits reuse entrances reversed. */
import { EASINGS } from "@/core/math";

export type ClipShape = "rect-up" | "rect-down" | "rect-left" | "rect-right" | "circle" | "diamond" | "center-x" | "center-y";
export type MotionState = {
  x: number; y: number; scale: number; scaleX: number; scaleY: number; rotate: number; rotateX: number; rotateY: number;
  skewX: number; opacity: number; blur: number; brightness: number; rgbSplit: number; glitch: number;
  clip?: { shape: ClipShape; p: number };
};
export const identityState = (): MotionState => ({
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, opacity: 1, blur: 0, brightness: 1, rgbSplit: 0, glitch: 0,
});

export type PresetOpts = { d: number; i: number; seed: number };
type EntranceFn = (p: number, o: PresetOpts) => Partial<MotionState>;
type LoopFn = (t: number, o: PresetOpts) => Partial<MotionState>;

export type MotionPreset = {
  id: string;
  name: string;
  kind: "entrance" | "loop";
  ease: string;
  duration: number; // default frames
  spring?: string;
  tags: string[];
  description: string;
  fn: EntranceFn | LoopFn;
};

const presets = new Map<string, MotionPreset>();
export function registerMotionPreset(p: MotionPreset) { presets.set(p.id, p); return p; }
export function getMotionPreset(id: string) { return presets.get(id) ?? presets.get(ALIASES[id] ?? "") ; }
export function allMotionPresets() { return [...presets.values()]; }

const q = (p: number) => 1 - p; // remaining
const hs = (n: number) => { const s = Math.sin(n * 91.345) * 47453.5453; return s - Math.floor(s); };

function E(id: string, name: string, ease: string, duration: number, tags: string[], description: string, fn: EntranceFn, spring?: string) {
  registerMotionPreset({ id, name, kind: "entrance", ease, duration, tags, description, fn, spring });
}
function L(id: string, name: string, tags: string[], description: string, fn: LoopFn) {
  registerMotionPreset({ id, name, kind: "loop", ease: "linear", duration: 60, tags, description, fn });
}

/* ---------- Entrances: fades & slides ---------- */
E("fade", "Fade", "easeOutCubic", 18, ["minimal", "basic"], "Pure opacity fade.", (p) => ({ opacity: p }));
E("fadeUp", "Fade Up", "standard", 22, ["saas", "basic"], "Fade while rising from below.", (p, o) => ({ opacity: Math.min(1, p), y: q(p) * o.d }));
E("fadeDown", "Fade Down", "standard", 22, ["basic"], "Fade while dropping from above.", (p, o) => ({ opacity: Math.min(1, p), y: -q(p) * o.d }));
E("fadeLeft", "Fade Left", "standard", 22, ["basic"], "Fade in travelling leftwards.", (p, o) => ({ opacity: Math.min(1, p), x: q(p) * o.d }));
E("fadeRight", "Fade Right", "standard", 22, ["basic"], "Fade in travelling rightwards.", (p, o) => ({ opacity: Math.min(1, p), x: -q(p) * o.d }));
E("slideUp", "Slide Up", "emphasized", 24, ["bold"], "Travel a long distance upward without fading.", (p, o) => ({ y: q(p) * o.d * 4 }));
E("slideDown", "Slide Down", "emphasized", 24, ["bold"], "Travel from above.", (p, o) => ({ y: -q(p) * o.d * 4 }));
E("slideLeft", "Slide Left", "emphasized", 24, ["bold"], "Travel in from the right edge.", (p, o) => ({ x: q(p) * o.d * 6 }));
E("slideRight", "Slide Right", "emphasized", 24, ["bold"], "Travel in from the left edge.", (p, o) => ({ x: -q(p) * o.d * 6 }));
E("riseIn", "Rise", "easeOutQuart", 36, ["elegant", "slow"], "Slow long rise with late fade.", (p, o) => ({ opacity: Math.min(1, p * 1.4), y: q(p) * o.d * 1.6 }));
E("dropIn", "Drop", "easeOutBounce", 30, ["playful", "gravity"], "Falls under gravity and bounces to rest.", (p, o) => ({ opacity: Math.min(1, p * 3), y: -q(p) * o.d * 5 }));
/* ---------- Scale ---------- */
E("scaleIn", "Scale", "standard", 20, ["basic"], "Scale from 85% with fade.", (p) => ({ opacity: Math.min(1, p), scale: 0.85 + 0.15 * p }));
E("scaleUp", "Scale Up", "easeOutExpo", 24, ["bold"], "Grow from 40%.", (p) => ({ opacity: Math.min(1, p * 2), scale: 0.4 + 0.6 * p }));
E("scaleDown", "Scale Down", "easeOutExpo", 24, ["cinematic"], "Settle down from 140%.", (p) => ({ opacity: Math.min(1, p * 1.5), scale: 1.4 - 0.4 * p }));
E("pop", "Pop", "overshoot", 18, ["playful", "ui"], "Quick overshoot pop.", (p) => ({ opacity: Math.min(1, p * 2), scale: 0.5 + 0.5 * p }));
E("springIn", "Spring", "linear", 30, ["physical", "ui"], "Physically simulated spring scale.", (p) => ({ opacity: Math.min(1, p * 2), scale: 0.6 + 0.4 * p }), "bouncy");
E("springUp", "Spring Up", "linear", 30, ["physical", "saas"], "Spring rise with overshoot and settle.", (p, o) => ({ opacity: Math.min(1, p * 2), y: q(p) * o.d * 1.5 }), "snappy");
E("bounceIn", "Bounce", "easeOutBounce", 30, ["playful"], "Scale with bounce settle.", (p) => ({ opacity: Math.min(1, p * 3), scale: p }));
E("elasticIn", "Elastic", "easeOutElastic", 40, ["playful", "energetic"], "Elastic overshoot scale.", (p) => ({ opacity: Math.min(1, p * 3), scale: 0.2 + 0.8 * p }));
E("unfold", "Unfold", "emphasized", 24, ["ui"], "Unfold vertically from a line.", (p) => ({ opacity: Math.min(1, p * 3), scaleY: Math.max(0.001, p) }));
E("expandX", "Expand X", "emphasized", 24, ["ui", "line"], "Expand horizontally from centre.", (p) => ({ opacity: Math.min(1, p * 3), scaleX: Math.max(0.001, p) }));
E("stretchIn", "Stretch", "easeOutExpo", 26, ["futuristic"], "Horizontal stretch with blur.", (p) => ({ opacity: Math.min(1, p * 2), scaleX: 1 + q(p) * 1.5, scaleY: 0.6 + 0.4 * p, blur: q(p) * 12 }));
E("squashIn", "Squash & Stretch", "easeOutBack", 26, ["cartoon", "playful"], "Classic squash then stretch.", (p) => ({ opacity: Math.min(1, p * 2), scaleX: 1 + Math.sin(p * Math.PI) * 0.25, scaleY: 1 - Math.sin(p * Math.PI) * 0.2, y: q(p) * 40 }));
E("jackInTheBox", "Jack in the Box", "easeOutBack", 30, ["playful"], "Scale with swinging rotation.", (p) => ({ opacity: Math.min(1, p * 2), scale: 0.1 + 0.9 * p, rotate: Math.sin(p * Math.PI * 3) * 20 * q(p) }));
E("heartbeatIn", "Heartbeat", "linear", 30, ["emphasis"], "Double pulse into place.", (p) => ({ opacity: Math.min(1, p * 4), scale: 1 + Math.sin(p * Math.PI * 4) * 0.12 * q(p) }));
/* ---------- Blur ---------- */
E("blurIn", "Blur", "easeOutCubic", 26, ["cinematic", "soft"], "Defocus to focus.", (p, o) => ({ opacity: Math.min(1, p * 1.3), blur: q(p) * 18 * o.i }));
E("blurScale", "Blur Scale", "easeOutExpo", 30, ["cinematic", "premium"], "Blur with scale settle.", (p, o) => ({ opacity: Math.min(1, p * 1.3), blur: q(p) * 20 * o.i, scale: 1.15 - 0.15 * p }));
E("blurUp", "Blur Up", "emphasized", 28, ["saas", "modern"], "Rise from blur (modern SaaS signature).", (p, o) => ({ opacity: Math.min(1, p * 1.3), blur: q(p) * 12 * o.i, y: q(p) * o.d * 0.8 }));
E("zoomBlur", "Zoom Blur", "easeOutExpo", 28, ["energetic"], "Rush in from the camera.", (p) => ({ opacity: Math.min(1, p * 2), blur: q(p) * 24, scale: 2.2 - 1.2 * p }));
E("focusPull", "Focus Pull", "cinematic", 40, ["cinematic", "film"], "Slow rack-focus reveal.", (p) => ({ opacity: 0.3 + 0.7 * p, blur: q(p) * 30, brightness: 0.6 + 0.4 * p }));
/* ---------- Masks & wipes ---------- */
E("maskUp", "Mask Up", "emphasized", 26, ["editorial", "text"], "Revealed by a mask rising.", (p, o) => ({ clip: { shape: "rect-up", p }, y: q(p) * o.d * 0.6 }));
E("maskDown", "Mask Down", "emphasized", 26, ["editorial"], "Revealed from the top.", (p) => ({ clip: { shape: "rect-down", p } }));
E("maskLeft", "Mask Left", "emphasized", 26, ["editorial"], "Revealed right-to-left.", (p) => ({ clip: { shape: "rect-left", p } }));
E("maskRight", "Mask Right", "emphasized", 26, ["editorial"], "Revealed left-to-right.", (p) => ({ clip: { shape: "rect-right", p } }));
E("wipeRight", "Wipe Right", "easeInOutCubic", 24, ["clean"], "Hard wipe revealing to the right with slide.", (p, o) => ({ clip: { shape: "rect-right", p }, x: -q(p) * o.d * 0.3 }));
E("wipeLeft", "Wipe Left", "easeInOutCubic", 24, ["clean"], "Hard wipe revealing to the left with slide.", (p, o) => ({ clip: { shape: "rect-left", p }, x: q(p) * o.d * 0.3 }));
E("wipeUp", "Wipe Up", "easeInOutCubic", 24, ["clean"], "Vertical wipe upward.", (p) => ({ clip: { shape: "rect-up", p } }));
E("wipeDown", "Wipe Down", "easeInOutCubic", 24, ["clean"], "Vertical wipe downward.", (p) => ({ clip: { shape: "rect-down", p } }));
E("circleReveal", "Iris", "easeInOutCubic", 30, ["cinematic"], "Circular iris opening.", (p) => ({ clip: { shape: "circle", p } }));
E("diamondReveal", "Diamond", "easeInOutCubic", 30, ["geometric"], "Diamond aperture.", (p) => ({ clip: { shape: "diamond", p } }));
E("curtain", "Curtain", "easeInOutQuart", 30, ["theatrical"], "Opens from the centre outward.", (p) => ({ clip: { shape: "center-x", p } }));
E("blinds", "Blinds", "easeInOutQuart", 30, ["theatrical"], "Opens vertically from centre.", (p) => ({ clip: { shape: "center-y", p } }));
/* ---------- Rotation / 3D ---------- */
E("rotateIn", "Rotate", "easeOutBack", 26, ["playful"], "Rotate into place.", (p) => ({ opacity: Math.min(1, p * 2), rotate: -q(p) * 25 }));
E("rotateInLeft", "Rotate from Left", "easeOutCubic", 26, ["dynamic"], "Pivot in from the left.", (p, o) => ({ opacity: Math.min(1, p * 2), rotate: q(p) * 45, x: -q(p) * o.d }));
E("spinIn", "Spin", "easeOutExpo", 34, ["energetic"], "Full spin with scale.", (p) => ({ opacity: Math.min(1, p * 2), rotate: -q(p) * 360, scale: 0.3 + 0.7 * p }));
E("flipX", "Flip X", "easeOutCubic", 28, ["3d", "card"], "Flip around the vertical axis.", (p) => ({ opacity: Math.min(1, p * 2), rotateY: q(p) * 90 }));
E("flipY", "Flip Y", "easeOutCubic", 28, ["3d", "card"], "Flip around the horizontal axis.", (p) => ({ opacity: Math.min(1, p * 2), rotateX: q(p) * 90 }));
E("flipUp3D", "Flip Up 3D", "emphasized", 30, ["3d", "text"], "Tilt up from perspective.", (p, o) => ({ opacity: Math.min(1, p * 1.5), rotateX: q(p) * 70, y: q(p) * o.d * 0.5 }));
E("perspectiveIn", "Perspective", "cinematic", 34, ["3d", "premium"], "Swing in with perspective.", (p) => ({ opacity: Math.min(1, p * 1.5), rotateY: -q(p) * 35, scale: 0.9 + 0.1 * p }));
E("swingIn", "Swing", "easeOutElastic", 40, ["playful"], "Hinged swing settle.", (p) => ({ opacity: Math.min(1, p * 3), rotate: q(p) * 30 }));
E("tiltIn", "Tilt", "standard", 24, ["subtle"], "Small tilt settle.", (p, o) => ({ opacity: Math.min(1, p * 1.5), rotate: q(p) * 6, y: q(p) * o.d * 0.4 }));
E("rollIn", "Roll", "easeOutCubic", 30, ["playful"], "Roll in from the left.", (p, o) => ({ opacity: Math.min(1, p * 2), rotate: -q(p) * 120, x: -q(p) * o.d * 3 }));
E("orbitIn", "Orbit In", "easeOutCubic", 34, ["space"], "Travel an arc into place.", (p, o) => ({ opacity: Math.min(1, p * 2), x: Math.cos(p * Math.PI * 0.5 + Math.PI) * o.d * 2 * q(p), y: Math.sin(p * Math.PI) * -o.d * q(p) }));
E("spiralIn", "Spiral", "easeOutQuart", 40, ["space", "energetic"], "Spiral inwards.", (p, o) => ({ opacity: Math.min(1, p * 2), x: Math.cos(p * 8) * o.d * 2 * q(p), y: Math.sin(p * 8) * o.d * 2 * q(p), rotate: -q(p) * 180 }));
/* ---------- Skew / speed ---------- */
E("skewIn", "Skew", "emphasized", 24, ["dynamic"], "Skewed entry that straightens.", (p, o) => ({ opacity: Math.min(1, p * 2), skewX: q(p) * -20, x: q(p) * o.d }));
E("lightSpeedIn", "Light Speed", "easeOutExpo", 22, ["fast"], "Fast skewed streak.", (p, o) => ({ opacity: Math.min(1, p * 2), skewX: q(p) * -35, x: q(p) * o.d * 8, blur: q(p) * 10 }));
E("whipLeft", "Whip Left", "easeOutExpo", 16, ["fast", "transition"], "Motion-blurred whip from the right.", (p, o) => ({ x: q(p) * o.d * 10, blur: q(p) * 30 }));
E("whipRight", "Whip Right", "easeOutExpo", 16, ["fast", "transition"], "Motion-blurred whip from the left.", (p, o) => ({ x: -q(p) * o.d * 10, blur: q(p) * 30 }));
E("shutterIn", "Shutter", "steps8", 20, ["tech"], "Stepped shutter reveal.", (p) => ({ clip: { shape: "rect-down", p }, opacity: p }));
E("backIn", "Anticipate", "anticipate", 30, ["character"], "Pulls back before launching in.", (p, o) => ({ opacity: Math.min(1, Math.max(0, p) * 2), y: q(p) * o.d }));
/* ---------- Digital ---------- */
E("glitchIn", "Glitch", "linear", 22, ["tech", "cyber"], "Digital glitch with RGB split.", (p, o) => ({ opacity: p < 0.1 ? 0 : hs(Math.floor(p * 20) + o.seed) > 0.25 || p > 0.8 ? 1 : 0.2, x: p < 0.8 ? (hs(Math.floor(p * 30) + o.seed) - 0.5) * 30 : 0, rgbSplit: q(p) * 12, glitch: q(p) }));
E("distortIn", "Distort", "easeOutCubic", 26, ["experimental"], "Warped skew and stretch settle.", (p) => ({ opacity: Math.min(1, p * 1.5), skewX: Math.sin(p * 12) * 14 * q(p), scaleY: 1 + Math.sin(p * 9) * 0.3 * q(p), blur: q(p) * 6 }));
E("rgbSplitIn", "RGB Split", "easeOutCubic", 24, ["tech", "music"], "Chromatic separation converging.", (p) => ({ opacity: Math.min(1, p * 2), rgbSplit: q(p) * 24 }));
E("flicker", "Flicker", "linear", 24, ["neon", "retro"], "Neon tube flicker on.", (p, o) => ({ opacity: p > 0.85 ? 1 : hs(Math.floor(p * 24) + o.seed) > 0.5 ? 0.9 : 0.05 }));
E("pixelateIn", "Pixelate", "steps4", 24, ["retro", "tech"], "Stepped blur resolve.", (p) => ({ opacity: Math.min(1, p * 2), blur: q(p) * 16 }));
E("scanIn", "Scan", "linear", 26, ["tech", "hud"], "HUD scan line reveal.", (p) => ({ clip: { shape: "rect-down", p }, brightness: 1 + q(p) * 1.5 }));
E("dissolveIn", "Dissolve", "linear", 30, ["soft"], "Noisy dissolve.", (p, o) => ({ opacity: Math.min(1, p + (hs(Math.floor(p * 40) + o.seed) - 0.5) * 0.3 * q(p)) }));
/* ---------- Brand / style presets ---------- */
E("cinematic", "Cinematic", "cinematic", 48, ["cinematic", "premium", "film"], "Slow blur, rise and exposure settle.", (p, o) => ({ opacity: Math.min(1, p * 1.2), blur: q(p) * 14, y: q(p) * o.d * 0.5, scale: 1.06 - 0.06 * p, brightness: 1.4 - 0.4 * p }));
E("minimal", "Minimal", "easeOutQuart", 20, ["minimal", "clean"], "Barely-there 8px lift.", (p) => ({ opacity: p, y: q(p) * 8 }));
E("saas", "SaaS", "emphasized", 26, ["saas", "modern", "product"], "Lift + blur with emphasized easing.", (p, o) => ({ opacity: Math.min(1, p * 1.3), y: q(p) * o.d * 0.5, blur: q(p) * 8, scale: 0.98 + 0.02 * p }));
E("tech", "Tech", "steps8", 20, ["tech", "hud"], "Quantized HUD reveal.", (p) => ({ opacity: p, clip: { shape: "rect-right", p }, brightness: 1 + q(p) }));
E("luxury", "Luxury", "luxury", 56, ["luxury", "premium", "elegant"], "Slow exposure and gentle scale settle.", (p) => ({ opacity: p, scale: 1.04 - 0.04 * p, blur: q(p) * 4 }));
E("editorial", "Editorial", "easeOutQuart", 30, ["editorial", "magazine"], "Masked rise with slight skew.", (p, o) => ({ clip: { shape: "rect-up", p }, y: q(p) * o.d * 0.8, skewX: q(p) * -4 }));
E("futuristic", "Futuristic", "easeOutExpo", 30, ["futuristic", "tech", "ai"], "Stretched blur resolving with chroma.", (p) => ({ opacity: Math.min(1, p * 1.4), scaleX: 1 + q(p) * 0.6, blur: q(p) * 16, rgbSplit: q(p) * 8 }));
E("hero", "Hero", "emphasized", 40, ["hero", "landing"], "Large confident rise.", (p, o) => ({ opacity: Math.min(1, p * 1.2), y: q(p) * o.d * 1.5, scale: 0.94 + 0.06 * p }));
E("dramatic", "Dramatic", "easeInOutExpo", 44, ["cinematic", "dramatic"], "Dark to bright zoom from far.", (p) => ({ opacity: p, scale: 0.6 + 0.4 * p, brightness: 0.2 + 0.8 * p }));
E("playful", "Playful", "overshoot", 24, ["playful", "social"], "Pop with tilt.", (p) => ({ opacity: Math.min(1, p * 2), scale: 0.6 + 0.4 * p, rotate: q(p) * -12 }));
E("corporate", "Corporate", "easeOutCubic", 24, ["corporate", "clean"], "Measured fade-left.", (p, o) => ({ opacity: p, x: -q(p) * o.d * 0.5 }));
E("social", "Social", "snappy", 16, ["social", "shorts", "fast"], "Punchy snap for short-form.", (p) => ({ opacity: Math.min(1, p * 2), scale: 1.25 - 0.25 * p }));
E("magnetic", "Magnetic", "linear", 34, ["interactive"], "Attracted into place with damped oscillation.", (p, o) => ({ opacity: Math.min(1, p * 2), x: q(p) * o.d }), "wobbly");
E("parallax", "Parallax", "easeOutQuart", 40, ["depth"], "Depth-staggered travel.", (p, o) => ({ opacity: Math.min(1, p * 1.5), y: q(p) * o.d * 2 * o.i, scale: 1 + q(p) * 0.1 }));
E("float", "Float In", "easeOutSine", 40, ["soft"], "Weightless float into position.", (p, o) => ({ opacity: p, y: q(p) * o.d, rotate: q(p) * 3 }));
E("zoomIn", "Zoom In", "easeOutCubic", 24, ["basic"], "Zoom from small.", (p) => ({ opacity: Math.min(1, p * 2), scale: 0.2 + 0.8 * p }));
E("zoomOut", "Zoom Out", "easeOutCubic", 24, ["basic"], "Zoom from large.", (p) => ({ opacity: Math.min(1, p * 2), scale: 2 - p }));

/* ---------- Loops ---------- */
L("floatLoop", "Float", ["ambient", "3d"], "Gentle vertical float.", (t, o) => ({ y: Math.sin(t * 1.4) * o.d * 0.2 * o.i }));
L("bob", "Bob", ["ambient"], "Quick bob.", (t, o) => ({ y: Math.abs(Math.sin(t * 3)) * -o.d * 0.2 * o.i }));
L("orbit", "Orbit", ["space"], "Circular orbit path.", (t, o) => ({ x: Math.cos(t) * o.d * 0.5 * o.i, y: Math.sin(t) * o.d * 0.3 * o.i }));
L("pulse", "Pulse", ["emphasis"], "Scale pulse.", (t, o) => ({ scale: 1 + Math.sin(t * 4) * 0.04 * o.i }));
L("breathe", "Breathe", ["ambient", "calm"], "Slow breathing scale and opacity.", (t, o) => ({ scale: 1 + Math.sin(t * 1.2) * 0.03 * o.i, opacity: 0.85 + Math.sin(t * 1.2) * 0.15 }));
L("wiggle", "Wiggle", ["playful"], "Noise wiggle.", (t, o) => ({ rotate: Math.sin(t * 13) * 3 * o.i + Math.sin(t * 7) * 2 * o.i }));
L("shake", "Shake", ["emphasis", "error"], "Horizontal shake.", (t, o) => ({ x: Math.sin(t * 40) * 6 * o.i * (0.5 + 0.5 * Math.sin(t * 2)) }));
L("jitter", "Jitter", ["tech", "glitch"], "Random positional jitter.", (t, o) => { const f = Math.floor(t * 24); return { x: (hs(f + o.seed) - 0.5) * 6 * o.i, y: (hs(f * 3.1 + o.seed) - 0.5) * 6 * o.i }; });
L("swing", "Swing", ["playful"], "Pendulum swing.", (t, o) => ({ rotate: Math.sin(t * 2.5) * 10 * o.i }));
L("spin", "Spin", ["loader"], "Continuous rotation.", (t, o) => ({ rotate: t * 180 * o.i }));
L("spinSlow", "Slow Spin", ["ambient"], "Slow continuous rotation.", (t, o) => ({ rotate: t * 20 * o.i }));
L("heartbeat", "Heartbeat", ["emphasis"], "Double-beat scale.", (t, o) => { const c = (t * 1.2) % 1; return { scale: 1 + (c < 0.15 ? Math.sin((c / 0.15) * Math.PI) : c < 0.3 ? Math.sin(((c - 0.15) / 0.15) * Math.PI) * 0.6 : 0) * 0.08 * o.i }; });
L("flickerLoop", "Flicker", ["neon"], "Occasional neon flicker.", (t, o) => ({ opacity: hs(Math.floor(t * 20) + o.seed) > 0.93 ? 0.3 : 1 }));
L("glitchLoop", "Glitch", ["cyber"], "Periodic glitch bursts.", (t, o) => { const f = Math.floor(t * 24); const on = hs(Math.floor(t * 2) + o.seed) > 0.7 && f % 6 < 2; return on ? { x: (hs(f) - 0.5) * 20 * o.i, rgbSplit: 8 * o.i, glitch: 0.6 } : {}; });
L("parallaxDrift", "Parallax Drift", ["depth", "ambient"], "Slow lissajous drift.", (t, o) => ({ x: Math.sin(t * 0.5) * o.d * 0.3 * o.i, y: Math.cos(t * 0.37) * o.d * 0.2 * o.i }));
L("magneticDrift", "Magnetic Drift", ["interactive"], "Organic noise drift.", (t, o) => ({ x: (Math.sin(t * 0.9) + Math.sin(t * 2.1) * 0.5) * o.d * 0.15 * o.i, y: (Math.cos(t * 1.3) + Math.sin(t * 1.7) * 0.5) * o.d * 0.15 * o.i }));
L("hover", "Hover", ["ui", "3d"], "Float + subtle tilt.", (t, o) => ({ y: Math.sin(t * 1.6) * 8 * o.i, rotate: Math.sin(t * 0.8) * 1.5 * o.i }));
L("tada", "Tada", ["emphasis"], "Attention seeker.", (t, o) => { const c = (t * 0.6) % 1; const a = c < 0.4 ? Math.sin(c * 40) : 0; return { scale: 1 + (c < 0.4 ? 0.06 : 0) * o.i, rotate: a * 4 * o.i }; });
L("rubberBand", "Rubber Band", ["playful"], "Elastic stretch.", (t, o) => ({ scaleX: 1 + Math.sin(t * 6) * 0.08 * o.i, scaleY: 1 - Math.sin(t * 6) * 0.06 * o.i }));
L("jello", "Jello", ["playful"], "Jello skew wobble.", (t, o) => ({ skewX: Math.sin(t * 7) * 6 * o.i }));
L("wobble", "Wobble", ["playful"], "Side wobble.", (t, o) => ({ x: Math.sin(t * 5) * 10 * o.i, rotate: Math.sin(t * 5) * 3 * o.i }));
L("headShake", "Head Shake", ["emphasis"], "No-no shake.", (t, o) => ({ x: Math.sin(t * 12) * 5 * o.i, rotateY: Math.sin(t * 12) * 9 * o.i }));
L("blink", "Blink", ["ui"], "Cursor blink.", (t) => ({ opacity: Math.floor(t * 2) % 2 === 0 ? 1 : 0 }));
L("glowPulse", "Glow Pulse", ["neon", "energy"], "Brightness pulse.", (t, o) => ({ brightness: 1 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.4 * o.i }));
L("sway", "Sway", ["ambient"], "Wind sway.", (t, o) => ({ rotate: Math.sin(t * 1.1) * 4 * o.i, x: Math.sin(t * 1.1) * 6 * o.i }));
L("levitate", "Levitate", ["3d", "product"], "Float with breathing scale.", (t, o) => ({ y: Math.sin(t * 1.2) * 14 * o.i, scale: 1 + Math.sin(t * 1.2 + 1) * 0.015 * o.i }));
L("tilt3D", "Tilt 3D", ["3d", "card"], "Card tilt in 3D.", (t, o) => ({ rotateY: Math.sin(t * 0.9) * 12 * o.i, rotateX: Math.cos(t * 0.7) * 8 * o.i }));
L("rock", "Rock", ["ambient"], "Rocking boat.", (t, o) => ({ rotate: Math.sin(t * 1.8) * 6 * o.i, y: Math.cos(t * 3.6) * 3 * o.i }));
L("driftX", "Drift X", ["ambient"], "Endless horizontal drift.", (t, o) => ({ x: Math.sin(t * 0.4) * o.d * o.i }));
L("driftY", "Drift Y", ["ambient"], "Endless vertical drift.", (t, o) => ({ y: Math.sin(t * 0.4) * o.d * o.i }));
L("handheld", "Handheld", ["cinematic", "camera"], "Handheld camera micro-shake.", (t, o) => ({ x: (Math.sin(t * 1.3) + Math.sin(t * 3.7) * 0.3) * 4 * o.i, y: (Math.cos(t * 1.1) + Math.sin(t * 4.3) * 0.3) * 3 * o.i, rotate: Math.sin(t * 0.9) * 0.4 * o.i }));
L("kenBurns", "Ken Burns", ["cinematic", "photo"], "Slow push in and pan.", (t, o) => ({ scale: 1 + t * 0.02 * o.i, x: t * 3 * o.i }));

export const ALIASES: Record<string, string> = {
  FADE: "fade", FADE_UP: "fadeUp", FADE_DOWN: "fadeDown", FADE_LEFT: "fadeLeft", FADE_RIGHT: "fadeRight", SCALE: "scaleIn", POP: "pop",
  SPRING: "springIn", BOUNCE: "bounceIn", ELASTIC: "elasticIn", BLUR: "blurIn", BLUR_SCALE: "blurScale", MASK: "maskUp", WIPE: "wipeRight",
  SLIDE: "slideUp", ZOOM: "zoomIn", ROTATE: "rotateIn", GLITCH: "glitchIn", DISTORT: "distortIn", FLIP: "flipX", PARALLAX: "parallax",
  MAGNETIC: "magnetic", FLOAT: "floatLoop", ORBIT: "orbit", CINEMATIC: "cinematic", MINIMAL: "minimal", SAAS: "saas", TECH: "tech",
  LUXURY: "luxury", EDITORIAL: "editorial", FUTURISTIC: "futuristic",
};

export const ENTRANCE_IDS = () => allMotionPresets().filter((p) => p.kind === "entrance").map((p) => p.id);
export const LOOP_IDS = () => allMotionPresets().filter((p) => p.kind === "loop").map((p) => p.id);
export { EASINGS };
