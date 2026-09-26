/* Normalized, serializable scene graph types. Everything is JSON. Timing is frame-based. */
import type { SpringConfig } from "./math";

export type Aspect = "16:9" | "9:16" | "1:1" | "4:5" | "4:3" | "custom";
export const ASPECT_SIZES: Record<Exclude<Aspect, "custom">, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "4:3": [1440, 1080],
};

export type Quality = "auto" | "low" | "medium" | "high" | "ultra";

export type Transform = {
  x?: number; // center x in composition px
  y?: number; // center y in composition px
  z?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number; // degrees
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  opacity?: number;
  blur?: number;
};

export type Timing = { start: number; duration: number; delay?: number; repeat?: number; repeatType?: any; fill?: string }; // frames, relative to scene

export type AnimationConfig = {
  preset: string;
  duration?: number; // frames
  delay?: number; // frames
  ease?: string;
  spring?: string | SpringConfig;
  intensity?: number;
  distance?: number;
  speed?: number; // loop speed multiplier
  stagger?: number; // frames between units (text/items)
};

export type Keyframe = { frame: number; value: number | string; ease?: string };
export type KeyframeTrack = { property: "x" | "y" | "scale" | "rotate" | "opacity" | "blur" | "rotateX" | "rotateY"; keyframes: Keyframe[] };

export type EffectConfig = { id?: string; type: string; params?: Record<string, unknown>; enabled?: boolean };
export type TransitionConfig = { type: string; duration: number; params?: Record<string, unknown> };

export type TrackKind =
  | "video" | "text" | "image" | "ui" | "3d" | "effect" | "audio" | "caption" | "shape" | "background"
  | "BACKGROUND" | "TEXT" | "SHAPE" | "UI" | "CHART" | "EFFECT" | "THREE" | "AUDIO" | "CAPTION";

export type SceneNode = {
  id: string;
  type: string; // registered node type
  name?: string;
  props: Record<string, unknown>;
  transform: Transform;
  timing: Timing;
  enter?: AnimationConfig;
  exit?: AnimationConfig;
  loop?: AnimationConfig;
  keyframes?: KeyframeTrack[];
  effects?: EffectConfig[];
  hidden?: boolean;
  locked?: boolean;
  children?: SceneNode[];
};

export type StoryType =
  | "hook" | "title" | "problem" | "statement" | "product" | "feature" | "demo" | "comparison"
  | "statistic" | "testimonial" | "process" | "result" | "cta" | "outro" | "logo" | "custom";

export type Scene = {
  id: string;
  name: string;
  type?: StoryType;
  startFrame?: number;
  durationInFrames: number;
  transition?: TransitionConfig; // transition INTO this scene
  nodes: SceneNode[];
  effects?: EffectConfig[];
  hidden?: boolean;
};

export type AudioTrack = {
  id: string;
  name: string;
  kind: "music" | "voiceover" | "sfx";
  src?: string; // sanitized URL / blob
  generator?: { type: "beat"; bpm: number; key?: number }; // procedural, deterministic
  start: number; // frame
  trimStart?: number; // seconds
  duration?: number; // frames
  volume: number;
  fadeIn?: number; // frames
  fadeOut?: number;
  loop?: boolean;
  muted?: boolean;
};

export type CaptionCue = { start: number; end: number; text: string; speaker?: string }; // seconds
export type CaptionTrack = {
  id: string;
  style: string;
  cues: CaptionCue[];
  props?: Record<string, unknown>;
  hidden?: boolean;
};

export type Marker = { frame: number; label: string; color?: string };

export type VideoDoc = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  theme: string;
  background?: string;
  scenes: Scene[];
  effects?: EffectConfig[];
  audio?: AudioTrack[];
  captions?: CaptionTrack[];
  markers?: Marker[];
  seed?: number;
  meta?: Record<string, unknown>;
};

/* ------------ Schema-driven props ------------ */
export type PropField =
  | { type: "number"; label?: string; default: number; min?: number; max?: number; step?: number; group?: string }
  | { type: "color"; label?: string; default: string; group?: string }
  | { type: "colors"; label?: string; default: string[]; group?: string }
  | { type: "select"; label?: string; default: string; options: string[]; group?: string }
  | { type: "text"; label?: string; default: string; group?: string; multiline?: boolean }
  | { type: "boolean"; label?: string; default: boolean; group?: string }
  | { type: "url"; label?: string; default: string; group?: string }
  | { type: "list"; label?: string; default: string[]; group?: string }
  | { type: "data"; label?: string; default: number[]; group?: string };
export type PropSchema = Record<string, PropField>;

export type Capabilities = { browser: boolean; video: boolean; server: boolean; three?: boolean; webgl?: boolean; physics?: boolean; audio?: boolean };
export type PerfBudget = { cpu: "low" | "medium" | "high"; gpu: "low" | "medium" | "high"; memory: "low" | "medium" | "high" };
export type Tier = "free" | "community" | "pro" | "premium";

export type AssetKind =
  | "node" | "motion" | "typography" | "background" | "shader" | "particles" | "effect" | "transition"
  | "material" | "lighting" | "camera" | "three" | "ui" | "chart" | "device" | "logo" | "caption"
  | "template" | "shape" | "theme" | "font";

export type AssetDef = {
  id: string;
  name: string;
  kind: AssetKind;
  category: string; // gallery category
  description: string;
  tags: string[];
  schema: PropSchema;
  defaults: Record<string, unknown>;
  capabilities: Capabilities;
  performance: PerfBudget;
  tier: Tier;
  /** Builds an insertable scene node (for node-backed assets). */
  node?: (w: number, h: number, props?: Record<string, unknown>) => SceneNode;
  /** Builds a self-contained preview document. */
  preview?: (props?: Record<string, unknown>) => VideoDoc;
  /** Developer code snippet. */
  code?: string;
};

/* --- Additional types from ZIP1 for full compatibility --- */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type AspectRatio = Aspect;
export type QualityLevel = Quality;
export type NodeType =
  | 'group'
  | 'background'
  | 'text'
  | 'shape'
  | 'ui'
  | 'chart'
  | 'effect'
  | 'three:model'
  | 'audio'
  | 'caption';

export type RepeatType = 'loop' | 'reverse' | 'mirror';
export type EaseName =
  | 'linear'
  | 'easeOut'
  | 'easeIn'
  | 'easeInOut'
  | 'circOut'
  | 'backOut'
  | 'anticipate';

export type PropertyTrack = {
  id: string;
  nodeId: string;
  property: keyof Transform | 'color' | 'background';
  keyframes: Keyframe[];
  enabled?: boolean;
};

export type MotionConfig = {
  preset?: string;
  entrance?: string;
  exit?: string;
  loop?: string;
  ease?: EaseName;
  stagger?: number;
  speed?: number;
};

export type MotionElement = {
  id: string;
  name: string;
  type: NodeType;
  transform?: Transform;
  timing?: Timing;
  animation?: MotionConfig;
  style?: Record<string, JsonValue>;
  props?: Record<string, JsonValue>;
  children?: MotionElement[];
  locked?: boolean;
  hidden?: boolean;
  capabilities?: CapabilityFlags;
};

export type Brand = {
  name: string;
  primary: string;
  accent: string;
  ink: string;
};

export type Composition = {
  version: 1;
  id: string;
  name: string;
  description: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  aspectRatio: AspectRatio;
  quality: QualityLevel;
  seed: number;
  brand: Brand;
  scenes: Scene[];
  tracks: any[];
  propertyTracks: PropertyTrack[];
  markers: Marker[];
  layoutVariants?: Partial<Record<Exclude<AspectRatio, 'custom'>, LayoutVariant>>;
};

export type LayoutVariant = {
  width: number;
  height: number;
  nodeTransforms: Record<string, Transform>;
};

export type CapabilityFlags = {
  browser: boolean;
  video: boolean;
  server: boolean;
  three?: boolean;
};

export type PerformanceCost = {
  cpu: 'low' | 'medium' | 'high';
  gpu: 'low' | 'medium' | 'high';
  memory: 'low' | 'medium' | 'high';
};

export type SchemaField = {
  type: 'color' | 'number' | 'text' | 'select' | 'boolean' | 'range';
  label: string;
  default: JsonValue;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string }>;
  help?: string;
};

export type AssetSchema = Record<string, SchemaField>;

export type AssetCategory =
  | 'motion'
  | 'typography'
  | 'background'
  | 'transition'
  | 'effect'
  | 'particle'
  | 'material'
  | 'three'
  | 'ui'
  | 'chart'
  | 'logo'
  | 'template';

export type RegistryEntry<TDefaults extends Record<string, JsonValue> = Record<string, JsonValue>> = {
  id: string;
  name: string;
  category: AssetCategory;
  description: string;
  preview: string;
  schema: AssetSchema;
  defaults: TDefaults;
  tags: string[];
  capabilities: CapabilityFlags;
  performance: PerformanceCost;
};

export type EngineSearchResult = RegistryEntry & { score: number };

export type RenderedNodeState = {
  transform: Required<Transform>;
  style: Record<string, JsonValue>;
  props: Record<string, JsonValue>;
  visible: boolean;
};
