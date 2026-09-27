// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/shader-voronoi
// Only import paths changed. See src/lab/framecn/LICENSE.
import { FPS, H, W } from "../customizer-config";
import type { ComponentConfig } from "../customizer-config";

export const shaderVoronoiConfig: ComponentConfig = {
  componentName: "ShaderVoronoi",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    colorGap: { default: "#12121a", label: "Gap Color", type: "color" },
    distortion: {
      default: 0.4,
      label: "Distortion",
      max: 1,
      min: 0,
      step: 0.05,
      type: "number",
    },
    gap: {
      default: 0.04,
      label: "Gap",
      max: 0.2,
      min: 0,
      step: 0.01,
      type: "number",
    },
    glow: {
      default: 0,
      label: "Glow",
      max: 1,
      min: 0,
      step: 0.05,
      type: "number",
    },
    speed: {
      default: 1,
      label: "Speed",
      max: 4,
      min: 0.1,
      step: 0.1,
      type: "number",
    },
  },
  durationInFrames: 150,
  fps: FPS,
  importPath: "@/components/framecn/shader-voronoi",
};
