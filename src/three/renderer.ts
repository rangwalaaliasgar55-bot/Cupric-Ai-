/* 3D layer: Three.js scenes built from serializable node props, rendered frame-deterministically into an
 * offscreen WebGL canvas and composited into the 2D video canvas. Includes Rapier physics (lazy WASM). */
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clamp, getEase, hash1, hashString } from "@/core/math";
import { sanitizeUrl } from "@/core/scene-graph";
import type { SceneNode } from "@/core/types";
import type { Theme } from "@/themes";
import { registerNodeRenderer, p, linearGrad, text, type RenderContext } from "@/render/core";
import { shapePoints } from "@/render/shapes";

export type MaterialPreset = { id: string; name: string; tags: string[]; params: THREE.MeshPhysicalMaterialParameters & { wireframe?: boolean; useColor?: boolean } };
export const MATERIALS: Record<string, MaterialPreset> = {};
const M = (id: string, name: string, tags: string[], params: MaterialPreset["params"]) => { MATERIALS[id] = { id, name, tags, params }; };
M("glass", "Glass", ["glass", "premium"], { transmission: 1, roughness: 0.04, thickness: 1.4, ior: 1.5, metalness: 0, color: "#ffffff", envMapIntensity: 1.2, clearcoat: 1 });
M("frostedGlass", "Frosted Glass", ["glass", "frosted", "soft"], { transmission: 1, roughness: 0.45, thickness: 1.2, ior: 1.45, color: "#f1f5ff" });
M("chrome", "Chrome", ["chrome", "metal", "premium"], { metalness: 1, roughness: 0.04, color: "#ffffff", envMapIntensity: 1.6 });
M("metal", "Brushed Metal", ["metal", "industrial"], { metalness: 1, roughness: 0.35, color: "#b9c0cc" });
M("gold", "Gold", ["gold", "luxury"], { metalness: 1, roughness: 0.18, color: "#f2c15b", envMapIntensity: 1.4 });
M("silver", "Silver", ["silver", "metal"], { metalness: 1, roughness: 0.14, color: "#e5e7eb" });
M("copper", "Copper", ["copper", "warm", "metal"], { metalness: 1, roughness: 0.25, color: "#d8845b" });
M("plastic", "Plastic", ["plastic", "product"], { metalness: 0, roughness: 0.35, clearcoat: 0.4, useColor: true });
M("matte", "Matte", ["matte", "minimal"], { metalness: 0, roughness: 1, useColor: true });
M("glossy", "Glossy", ["glossy", "candy"], { metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, useColor: true });
M("crystal", "Crystal", ["crystal", "gem", "luxury"], { transmission: 1, roughness: 0, thickness: 2.4, ior: 2.2, iridescence: 0.4, color: "#ffffff", dispersion: 3 } as MaterialPreset["params"]);
M("holographic", "Holographic", ["holographic", "futuristic"], { metalness: 0.7, roughness: 0.15, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [100, 800], color: "#ffffff" });
M("iridescent", "Iridescent", ["iridescent", "soap"], { metalness: 0.2, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.3, useColor: true });
M("liquid", "Liquid", ["liquid", "water"], { transmission: 0.95, roughness: 0, ior: 1.33, thickness: 2, useColor: true, clearcoat: 1 });
M("emissive", "Emissive", ["neon", "glow", "energy"], { emissiveIntensity: 2.2, roughness: 0.4, useColor: true });
M("wireframe", "Wireframe", ["wireframe", "tech", "blueprint"], { wireframe: true, useColor: true, roughness: 1 });
M("ceramic", "Ceramic", ["ceramic", "clean"], { roughness: 0.25, clearcoat: 0.8, color: "#f5f3ef" });
M("carbon", "Carbon", ["carbon", "sport", "dark"], { roughness: 0.3, metalness: 0.4, clearcoat: 1, color: "#1a1b1f" });
M("pearl", "Pearl", ["pearl", "luxury", "soft"], { roughness: 0.25, sheen: 1, sheenColor: new THREE.Color("#ffd9f0"), iridescence: 0.5, color: "#fbf6f0" });
M("obsidian", "Obsidian", ["dark", "luxury", "glossy"], { roughness: 0.05, clearcoat: 1, color: "#07070a", metalness: 0.2 });

export const LIGHTING = ["STUDIO", "PRODUCT", "CINEMATIC", "NEON", "RIM", "SOFTBOX", "DRAMATIC", "DARK_LUXURY", "FUTURISTIC", "HOLOGRAPHIC"] as const;
export const CAMERAS = ["PRODUCT", "SAAS", "CINEMATIC", "TECH", "LUXURY", "MACRO", "DRAMATIC", "OVERHEAD", "ORBIT", "HERO"] as const;
export const OBJECTS = ["sphere", "cube", "torus", "torusKnot", "cylinder", "cone", "capsule", "plane", "icosahedron", "octahedron", "dodecahedron", "ring", "tube", "star", "hexPrism", "heart", "blob", "gltf"] as const;
export const ANIMATIONS_3D = ["heroFloat", "turntable", "tumble", "orbit", "pulse", "reveal", "wave", "explode", "none"] as const;

function makeMaterial(id: string, color: string, theme: Theme): THREE.Material {
  const pr = MATERIALS[id] ?? MATERIALS.glossy;
  const { wireframe, useColor, ...params } = pr.params;
  if (wireframe) return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), wireframe: true, transparent: true, opacity: 0.85 });
  const m = new THREE.MeshPhysicalMaterial({ ...params });
  if (useColor) m.color = new THREE.Color(color);
  if (id === "emissive") m.emissive = new THREE.Color(color);
  void theme;
  return m;
}
function makeGeometry(kind: string, detail: number): THREE.BufferGeometry {
  const seg = Math.round(32 * detail) + 16;
  switch (kind) {
    case "cube": return new RoundedBoxGeometry(1.6, 1.6, 1.6, 6, 0.18);
    case "torus": return new THREE.TorusGeometry(1, 0.38, seg, seg * 2);
    case "torusKnot": return new THREE.TorusKnotGeometry(0.85, 0.28, seg * 4, seg);
    case "cylinder": return new THREE.CylinderGeometry(0.8, 0.8, 1.8, seg);
    case "cone": return new THREE.ConeGeometry(0.95, 1.9, seg);
    case "capsule": return new THREE.CapsuleGeometry(0.6, 1.1, 12, seg);
    case "plane": return new THREE.PlaneGeometry(2.6, 1.6, 1, 1);
    case "icosahedron": return new THREE.IcosahedronGeometry(1.2, 0);
    case "octahedron": return new THREE.OctahedronGeometry(1.25, 0);
    case "dodecahedron": return new THREE.DodecahedronGeometry(1.2, 0);
    case "ring": return new THREE.RingGeometry(0.7, 1.3, seg * 2);
    case "blob": { const g = new THREE.IcosahedronGeometry(1.2, Math.round(4 * detail) + 2); const pos = g.attributes.position; const v = new THREE.Vector3(); for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const n = Math.sin(v.x * 3) * Math.sin(v.y * 2.5) * Math.sin(v.z * 3.2) * 0.18; v.multiplyScalar(1 + n); pos.setXYZ(i, v.x, v.y, v.z); } g.computeVertexNormals(); return g; }
    case "tube": { const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * 1.1, Math.sin(a * 2) * 0.5, Math.sin(a) * 1.1); }), true); return new THREE.TubeGeometry(curve, seg * 4, 0.16, 16, true); }
    case "star": case "hexPrism": case "heart": {
      const pts = shapePoints(kind === "hexPrism" ? "hexagon" : kind, 2.2, 2.2, { points: 5, inner: 0.45 });
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, -y)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 6, curveSegments: 24 });
      g.center(); return g;
    }
    default: return new THREE.SphereGeometry(1.15, seg * 2, seg);
  }
}
function addLights(scene: THREE.Scene, preset: string, theme: Theme) {
  const L = (c: string, i: number, pos: [number, number, number], kind: "dir" | "point" | "spot" = "dir") => { const l = kind === "point" ? new THREE.PointLight(c, i * 20, 30) : kind === "spot" ? new THREE.SpotLight(c, i * 40, 40, 0.5, 0.6) : new THREE.DirectionalLight(c, i); l.position.set(...pos); l.userData.base = pos; scene.add(l); return l; };
  scene.add(new THREE.AmbientLight("#ffffff", preset === "DRAMATIC" || preset === "DARK_LUXURY" ? 0.05 : 0.25));
  switch (preset) {
    case "PRODUCT": L("#ffffff", 2.2, [0, 6, 4]); L("#dbe4ff", 1.2, [-5, 2, -3]); L("#ffffff", 1.2, [5, 2, -3]); break;
    case "CINEMATIC": L("#ffc58a", 2.6, [4, 3, 4]); L("#5aa7ff", 2, [-5, 1, -4]); break;
    case "NEON": L(theme.colors.primary, 3, [-3, 1, 3], "point"); L(theme.colors.accent, 3, [3, -1, 3], "point"); L("#ffffff", 0.3, [0, 5, 5]); break;
    case "RIM": L("#ffffff", 3, [-4, 2, -4]); L("#ffffff", 3, [4, 2, -4]); L("#ffffff", 0.4, [0, 0, 5]); break;
    case "SOFTBOX": { const h = new THREE.HemisphereLight("#ffffff", "#444444", 1.4); scene.add(h); L("#ffffff", 1.4, [0, 5, 5]); break; }
    case "DRAMATIC": L("#ffffff", 5, [3, 6, 2], "spot"); break;
    case "DARK_LUXURY": L("#ffd9a0", 4, [2, 5, 3], "spot"); L("#6b4f2a", 0.8, [-4, 0, -3]); break;
    case "FUTURISTIC": L("#22d3ee", 2.2, [-4, 2, 3]); L("#a855f7", 2.2, [4, -1, 3]); L("#ffffff", 0.6, [0, 5, -4]); break;
    case "HOLOGRAPHIC": L("#ff2bd6", 2.5, [-3, 2, 3], "point"); L("#00f0ff", 2.5, [3, 2, 3], "point"); L("#faff00", 1.5, [0, -3, 3], "point"); break;
    default: L("#ffffff", 2.4, [3, 4, 5]); L("#ffffff", 0.9, [-4, 1, 2]); L("#ffffff", 1.6, [0, 3, -5]);
  }
}
function cameraPose(preset: string, t: number, ortho: boolean) {
  const e = getEase("easeInOutSine");
  switch (preset) {
    case "SAAS": return { pos: [0, 1.2, 6.5], fov: 35, look: [0, 0, 0] };
    case "CINEMATIC": return { pos: [Math.sin(t * 0.2) * 0.8 + Math.sin(t * 1.3) * 0.02, -0.4 + Math.sin(t * 1.7) * 0.02, 7 - e(clamp(t / 8)) * 1.8], fov: 24, look: [0, 0.1, 0] };
    case "TECH": return { pos: [Math.sin(t * 0.3) * 6, 2, Math.cos(t * 0.3) * 6], fov: 45, look: [0, 0, 0] };
    case "LUXURY": return { pos: [Math.sin(t * 0.12) * 7, 0.6, Math.cos(t * 0.12) * 7], fov: 22, look: [0, 0, 0] };
    case "MACRO": return { pos: [0.6, 0.3, 3.4 - e(clamp(t / 6)) * 0.5], fov: 18, look: [0.1, 0.1, 0] };
    case "DRAMATIC": return { pos: [0, -1.8, 6 - e(clamp(t / 5)) * 1.2], fov: 28, look: [0, 0.4, 0] };
    case "OVERHEAD": return { pos: [0, 8, 0.01], fov: 35, look: [0, 0, 0] };
    case "ORBIT": return { pos: [Math.sin(t * 0.5) * 6, 1.5 + Math.sin(t * 0.25), Math.cos(t * 0.5) * 6], fov: 38, look: [0, 0, 0] };
    case "HERO": return { pos: [0, 0.3, 7.5 - e(clamp(t / 4)) * 1.5], fov: 32, look: [0, 0, 0] };
    default: return { pos: [0, 0.4, ortho ? 10 : 6.2], fov: 30, look: [0, 0, 0] };
  }
}

/* ---------- Shared renderer ---------- */
let renderer: THREE.WebGLRenderer | null | undefined;
let envTex: THREE.Texture | null = null;
export function threeAvailable() {
  if (renderer !== undefined) return !!renderer;
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch { renderer = null; }
  return !!renderer;
}

type Built = { scene: THREE.Scene; camera: THREE.PerspectiveCamera | THREE.OrthographicCamera; root: THREE.Group; mesh?: THREE.Mesh | THREE.InstancedMesh; count: number; lastUsed: number };
const cache = new Map<string, Built>();
const gltfCache = new Map<string, THREE.Group | "loading" | "error">();
let tick = 0;

function buildScene(node: SceneNode, theme: Theme, quality: number, onReady: () => void): Built {
  const scene = new THREE.Scene();
  scene.environment = envTex;
  scene.environmentIntensity = p<number>(node, "envIntensity", 1);
  const root = new THREE.Group();
  scene.add(root);
  addLights(scene, p<string>(node, "lighting", "STUDIO"), theme);
  const ortho = p<boolean>(node, "ortho", false);
  const camera = ortho ? new THREE.OrthographicCamera(-3, 3, 2, -2, 0.1, 100) : new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 100);
  const color = p<string>(node, "color", theme.colors.primary);
  const material = makeMaterial(p<string>(node, "material", "glass"), color, theme);
  const obj = p<string>(node, "object", "torusKnot");
  const count = Math.max(1, Math.round(p<number>(node, "count", 1) * (quality < 0.5 ? 0.5 : 1)));
  let mesh: Built["mesh"];
  if (obj === "gltf") {
    const url = sanitizeUrl(node.props.model);
    const hit = url ? gltfCache.get(url) : "error";
    if (hit && hit !== "loading" && hit !== "error") root.add(hit.clone(true));
    else {
      mesh = new THREE.Mesh(makeGeometry("sphere", quality), material); root.add(mesh);
      if (url && !hit) { gltfCache.set(url, "loading"); new GLTFLoader().load(url, (g) => { const box = new THREE.Box3().setFromObject(g.scene); const s = 2.4 / Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.001); g.scene.scale.setScalar(s); g.scene.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s)); gltfCache.set(url, g.scene); cache.forEach((_, k) => { if (k.startsWith(node.id)) cache.delete(k); }); onReady(); }, undefined, () => gltfCache.set(url, "error")); }
    }
  } else if (count > 1) {
    const geo = makeGeometry(obj, quality * 0.5);
    const inst = new THREE.InstancedMesh(geo, material, count);
    mesh = inst; root.add(inst);
  } else {
    mesh = new THREE.Mesh(makeGeometry(obj, quality), material);
    root.add(mesh);
  }
  if (p<boolean>(node, "floor", false)) { const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 64), new THREE.MeshPhysicalMaterial({ color: theme.colors.surface, roughness: 0.3, metalness: 0.2 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -1.6; scene.add(floor); }
  return { scene, camera, root, mesh, count, lastUsed: tick };
}

const dummy = new THREE.Object3D();
function animate(b: Built, node: SceneNode, t: number) {
  const anim = p<string>(node, "animation", "heroFloat");
  const sp = p<number>(node, "speed", 1);
  const T = t * sp;
  const r = b.root;
  r.rotation.set(0, 0, 0); r.position.set(0, 0, 0); r.scale.setScalar(p<number>(node, "objectScale", 1));
  switch (anim) {
    case "heroFloat": r.position.y = Math.sin(T * 1.2) * 0.15; r.rotation.y = T * 0.35; r.rotation.x = Math.sin(T * 0.6) * 0.15; break;
    case "turntable": r.rotation.y = T * 0.8; break;
    case "tumble": r.rotation.x = T * 0.5; r.rotation.y = T * 0.7; break;
    case "pulse": r.scale.multiplyScalar(1 + Math.sin(T * 3) * 0.06); r.rotation.y = T * 0.3; break;
    case "reveal": { const k = getEase("easeOutBack")(clamp(T / 1.6)); r.scale.multiplyScalar(Math.max(0.001, k)); r.rotation.y = (1 - k) * -2 + T * 0.2; break; }
    case "orbit": r.rotation.y = T * 0.2; break;
    default: break;
  }
  if (b.mesh instanceof THREE.InstancedMesh) {
    const n = b.count, layout = p<string>(node, "layout", "ring");
    for (let i = 0; i < n; i++) {
      const h1 = hash1(i * 1.7), h2 = hash1(i * 3.1), h3 = hash1(i * 5.3);
      if (layout === "grid") { const side = Math.ceil(Math.sqrt(n)); const gx = (i % side) - side / 2 + 0.5, gz = Math.floor(i / side) - side / 2 + 0.5; dummy.position.set(gx * 0.9, anim === "wave" ? Math.sin(T * 2 + gx * 0.6 + gz * 0.6) * 0.4 : 0, gz * 0.9); }
      else if (layout === "scatter") dummy.position.set((h1 - 0.5) * 7, (h2 - 0.5) * 4 + Math.sin(T + i) * 0.2, (h3 - 0.5) * 4);
      else { const a = (i / n) * Math.PI * 2 + T * 0.3; dummy.position.set(Math.cos(a) * 2.4, Math.sin(T * 1.5 + i) * 0.25, Math.sin(a) * 2.4); }
      if (anim === "explode") dummy.position.multiplyScalar(1 + getEase("easeOutExpo")(clamp((T % 4) / 1.5)) * 1.2);
      dummy.rotation.set(T * (h1 - 0.5) * 2, T * (h2 - 0.5) * 2, 0);
      dummy.scale.setScalar(0.35 + h3 * 0.25);
      dummy.updateMatrix();
      b.mesh.setMatrixAt(i, dummy.matrix);
    }
    b.mesh.instanceMatrix.needsUpdate = true;
  }
  const ortho = b.camera instanceof THREE.OrthographicCamera;
  const pose = cameraPose(p<string>(node, "camera", "PRODUCT"), t, ortho);
  b.camera.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
  if (b.camera instanceof THREE.PerspectiveCamera) b.camera.fov = pose.fov;
  b.camera.lookAt(pose.look[0], pose.look[1], pose.look[2]);
  if (p<string>(node, "lighting", "STUDIO") === "HOLOGRAPHIC") b.scene.children.forEach((c, i) => { if (c instanceof THREE.PointLight) { const a = T + i * 2; c.position.set(Math.cos(a) * 4, Math.sin(a * 0.7) * 2, Math.sin(a) * 4); } });
}

function fallback(rc: RenderContext, w: number, h: number, label: string) {
  const { ctx, theme } = rc;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(w, h) / 2);
  g.addColorStop(0, theme.colors.primary); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, Math.min(w, h) * 0.35, 0, Math.PI * 2); ctx.fill();
  text(ctx, label, 0, h / 2 - 20, { size: 14, color: theme.colors.muted, align: "center" });
  void linearGrad;
}

export function renderThreeNode(rc: RenderContext, node: SceneNode) {
  const w = p<number>(node, "w", 900), h = p<number>(node, "h", 700);
  if (!threeAvailable() || !renderer) { fallback(rc, w, h, "3D fallback (WebGL unavailable)"); return; }
  tick++;
  const q = { low: 0.5, medium: 0.75, high: 1, ultra: 1.5 }[rc.quality];
  const key = `${node.id}|${hashString(JSON.stringify(node.props))}|${rc.theme.id}|${rc.quality}`;
  let b = cache.get(key);
  if (!b) { b = buildScene(node, rc.theme, q, rc.requestRedraw); cache.set(key, b); for (const [k, v] of cache) if (tick - v.lastUsed > 600) { cache.delete(k); v.scene.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); } }
  b.lastUsed = tick;
  const t = (rc.frame - node.timing.start) / rc.fps;
  animate(b, node, t);
  const rs = q >= 1.5 ? 1.5 : q < 0.6 ? 0.6 : 1;
  const W = Math.round(w * rs), H = Math.round(h * rs);
  renderer.setSize(W, H, false);
  if (b.camera instanceof THREE.PerspectiveCamera) { b.camera.aspect = w / h; b.camera.updateProjectionMatrix(); }
  else { const a = w / h; b.camera.left = -2.4 * a; b.camera.right = 2.4 * a; b.camera.top = 2.4; b.camera.bottom = -2.4; b.camera.updateProjectionMatrix(); }
  renderer.render(b.scene, b.camera);
  rc.ctx.drawImage(renderer.domElement, -w / 2, -h / 2, w, h);
}
registerNodeRenderer("three", renderThreeNode, (node) => ({ w: (node.props.w as number) ?? 900, h: (node.props.h as number) ?? 700 }));

/* ---------- Physics (Rapier, deterministic fixed step, cached per frame) ---------- */
type RapierModule = typeof import("@dimforge/rapier3d-compat");
let RAPIER: RapierModule | null = null;
let rapierLoading: Promise<void> | null = null;
export function loadPhysics(): Promise<void> {
  if (RAPIER) return Promise.resolve();
  if (!rapierLoading) rapierLoading = import("@dimforge/rapier3d-compat").then(async (m) => { const mod = (m as unknown as { default?: RapierModule }).default ?? (m as unknown as RapierModule); await mod.init(); RAPIER = mod; });
  return rapierLoading;
}
export const PHYSICS_PRESETS = ["stack", "drop", "explosion", "dominoes", "attractor", "pyramid"] as const;
type Sim = { frames: Float32Array[]; world: InstanceType<RapierModule["World"]>; bodies: InstanceType<RapierModule["RigidBody"]>[]; kinds: string[]; stepFn: (f: number) => void };
const sims = new Map<string, Sim>();

function createSim(node: SceneNode, fps: number): Sim {
  const R = RAPIER!;
  const preset = p<string>(node, "preset", "stack");
  const world = new R.World({ x: 0, y: preset === "attractor" ? 0 : -9.81, z: 0 });
  world.timestep = 1 / fps;
  world.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -2.5, 0).setRestitution(0.3));
  const bodies: Sim["bodies"] = [], kinds: string[] = [];
  const add = (x: number, y: number, z: number, kind: "box" | "ball", s = 0.25) => {
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCcdEnabled(true));
    world.createCollider((kind === "box" ? R.ColliderDesc.cuboid(s, s, s) : R.ColliderDesc.ball(s)).setRestitution(0.35).setFriction(0.7).setDensity(1), b);
    bodies.push(b); kinds.push(kind); return b;
  };
  const n = Math.min(160, Math.max(4, p<number>(node, "count", 40)));
  if (preset === "stack") { for (let i = 0; i < Math.min(n, 12); i++) add(((i % 2) - 0.5) * 0.02, -1.95 + i * 0.51, 0, "box"); const ball = add(-6, -1.2, 0, "ball", 0.45); ball.setLinvel({ x: 14, y: 1, z: 0 }, true); }
  else if (preset === "pyramid") { let k = 0; for (let row = 0; row < 6 && k < n; row++) for (let i = 0; i < 6 - row && k < n; i++, k++) add((i - (5 - row) / 2) * 0.52, -1.95 + row * 0.51, 0, "box"); const ball = add(0, 8, 0.1, "ball", 0.5); void ball; }
  else if (preset === "drop") { for (let i = 0; i < n; i++) add((hash1(i) - 0.5) * 3, 1 + i * 0.35, (hash1(i * 3) - 0.5) * 2, i % 3 ? "box" : "ball", 0.2 + hash1(i * 7) * 0.12); }
  else if (preset === "explosion") { const side = 4; for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) for (let z = 0; z < side; z++) if (bodies.length < n) add((x - 1.5) * 0.52, -1.95 + y * 0.51, (z - 1.5) * 0.52, "box"); }
  else if (preset === "dominoes") { for (let i = 0; i < Math.min(n, 18); i++) { const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(-4 + i * 0.48, -1.5, 0)); world.createCollider(R.ColliderDesc.cuboid(0.06, 0.5, 0.3).setFriction(0.6), b); bodies.push(b); kinds.push("domino"); } bodies[0].applyImpulse({ x: 0.4, y: 0, z: 0 }, true); }
  else { for (let i = 0; i < n; i++) { const a = hash1(i) * Math.PI * 2, r = 2 + hash1(i * 2) * 2; const b = add(Math.cos(a) * r, (hash1(i * 5) - 0.5) * 2, Math.sin(a) * r, "ball", 0.15 + hash1(i * 9) * 0.15); b.setLinvel({ x: -Math.sin(a) * 2, y: 0, z: Math.cos(a) * 2 }, true); } }
  const stepFn = (f: number) => {
    if (preset === "explosion" && f === Math.round(fps * 0.8)) bodies.forEach((b) => { const t = b.translation(); const d = Math.hypot(t.x, t.y + 2, t.z) + 0.3; b.applyImpulse({ x: (t.x / d) * 1.2, y: 1.6 / d + 0.6, z: (t.z / d) * 1.2 }, true); });
    if (preset === "attractor") bodies.forEach((b) => { const t = b.translation(); b.applyImpulse({ x: -t.x * 0.004, y: -t.y * 0.004, z: -t.z * 0.004 }, true); });
    world.step();
  };
  return { frames: [], world, bodies, kinds, stepFn };
}
function simFrame(sim: Sim, frame: number) {
  while (sim.frames.length <= frame) {
    const f = sim.frames.length;
    const arr = new Float32Array(sim.bodies.length * 7);
    sim.bodies.forEach((b, i) => { const t = b.translation(), r = b.rotation(); arr.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7); });
    sim.frames.push(arr);
    sim.stepFn(f);
  }
  return sim.frames[frame];
}
const physScenes = new Map<string, { scene: THREE.Scene; camera: THREE.PerspectiveCamera; meshes: THREE.Mesh[] }>();
registerNodeRenderer("physics", (rc, node) => {
  const w = p<number>(node, "w", 1000), h = p<number>(node, "h", 700);
  if (!threeAvailable() || !renderer) { fallback(rc, w, h, "Physics fallback (WebGL unavailable)"); return; }
  if (!RAPIER) { loadPhysics().then(rc.requestRedraw).catch(() => {}); fallback(rc, w, h, "Loading physics engine…"); return; }
  const key = `${node.id}|${hashString(JSON.stringify(node.props))}|${rc.fps}`;
  let sim = sims.get(key);
  if (!sim) { sim = createSim(node, rc.fps); sims.set(key, sim); }
  const local = Math.max(0, Math.floor(rc.frame - node.timing.start));
  const data = simFrame(sim, Math.min(local, 60 * 60));
  let ps = physScenes.get(key + rc.theme.id);
  if (!ps) {
    const scene = new THREE.Scene(); scene.environment = envTex; addLights(scene, p<string>(node, "lighting", "STUDIO"), rc.theme);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40), new THREE.MeshPhysicalMaterial({ color: rc.theme.colors.surface, roughness: 0.6 })); floor.position.y = -2.5; scene.add(floor);
    const mats = [p<string>(node, "material", "glossy"), "chrome", "glass"].map((m, i) => makeMaterial(m, [rc.theme.colors.primary, rc.theme.colors.secondary, rc.theme.colors.accent][i], rc.theme));
    const meshes = sim.kinds.map((k, i) => { const geo = k === "ball" ? new THREE.SphereGeometry(1, 32, 16) : k === "domino" ? new THREE.BoxGeometry(0.12, 1, 0.6) : new RoundedBoxGeometry(0.5, 0.5, 0.5, 3, 0.05); const m = new THREE.Mesh(geo, mats[i % 3 === 0 ? 0 : i % 3]); scene.add(m); return m; });
    sim.bodies.forEach((b, i) => { if (sim!.kinds[i] === "ball") { const c = b.collider(0); const r = c ? c.radius() : 0.25; meshes[i].scale.setScalar(r); } });
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100); camera.position.set(0, 1.5, 11); camera.lookAt(0, -0.8, 0);
    ps = { scene, camera, meshes }; physScenes.set(key + rc.theme.id, ps);
  }
  ps.meshes.forEach((m, i) => { m.position.set(data[i * 7], data[i * 7 + 1], data[i * 7 + 2]); m.quaternion.set(data[i * 7 + 3], data[i * 7 + 4], data[i * 7 + 5], data[i * 7 + 6]); });
  ps.camera.aspect = w / h; ps.camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.render(ps.scene, ps.camera);
  rc.ctx.drawImage(renderer.domElement, -w / 2, -h / 2, w, h);
}, (node) => ({ w: (node.props.w as number) ?? 1000, h: (node.props.h as number) ?? 700 }));
