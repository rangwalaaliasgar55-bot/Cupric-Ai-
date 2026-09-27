// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/shader-spiral
// Only import paths changed. See src/lab/framecn/LICENSE.
import { FPS, H, W } from "../customizer-config";
import type { ComponentConfig } from "../customizer-config";

export const shaderSpiralConfig: ComponentConfig = {
  componentName: "ShaderSpiral",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    colorBack: { default: "#12121a", label: "Background", type: "color" },
    density: {
      default: 1,
      label: "Density",
      max: 4,
      min: 0.2,
      step: 0.1,
      type: "number",
    },
    softness: {
      default: 0.2,
      label: "Softness",
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
    strokeWidth: {
      default: 0.5,
      label: "Stroke",
      max: 1,
      min: 0.05,
      step: 0.05,
      type: "number",
    },
  },
  durationInFrames: 150,
  fps: FPS,
  importPath: "@/components/framecn/shader-spiral",
};
