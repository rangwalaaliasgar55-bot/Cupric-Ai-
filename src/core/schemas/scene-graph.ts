export interface TransformProperties {
  x?: number;
  y?: number;
  z?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  skewX?: number;
  skewY?: number;
  opacity?: number;
  blur?: number;
}

export interface AnimationKeyframe {
  frame: number; // Discrete frame index (0..totalFrames)
  properties: TransformProperties;
  easing?: string;
}

export interface MotionPresetDefinition {
  id: string;
  name: string;
  category: 'entrance' | 'exit' | 'loop' | 'cinematic' | 'saas' | 'tech' | 'luxury';
  description: string;
  tags: string[];
  durationFrames: number;
  evaluate: (frame: number, durationFrames: number) => TransformProperties;
  cssStyle?: (progress: number) => React.CSSProperties;
}

export type SceneNodeType =
  | 'text'
  | 'shape'
  | 'image'
  | 'video'
  | '3d'
  | 'particles'
  | 'background'
  | 'ui'
  | 'chart'
  | 'effect'
  | 'audio'
  | 'group';

export interface SceneNode {
  id: string;
  name: string;
  type: SceneNodeType;
  startFrame: number;
  durationFrames: number;
  locked?: boolean;
  visible?: boolean;
  transform: TransformProperties;
  animationPreset?: string;
  customProps: Record<string, any>;
  children?: SceneNode[];
}

export interface CompositionSchema {
  id: string;
  title: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5' | '21:9';
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  theme: {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
    fontFamily: string;
  };
  audioTrack?: {
    src?: string;
    volume?: number;
    bpm?: number;
  };
  nodes: SceneNode[];
}
