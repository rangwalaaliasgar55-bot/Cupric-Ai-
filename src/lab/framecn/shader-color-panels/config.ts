// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/shader-color-panels
// Only import paths changed. See src/lab/framecn/LICENSE.
import { FPS, H, W } from "../customizer-config";
import type { ComponentConfig } from "../customizer-config";

export const shaderColorPanelsConfig: ComponentConfig = {
  componentName: "ShaderColorPanels",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    colorBack: { default: "#12121a", label: "Background", type: "color" },
    density: {
      default: 3,
      label: "Density",
      max: 8,
      min: 1,
      step: 1,
      type: "number",
    },
    length: {
      default: 1.1,
      label: "Length",
      max: 3,
      min: 0.5,
      step: 0.1,
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
  importPath: "@/components/framecn/shader-color-panels",
};
