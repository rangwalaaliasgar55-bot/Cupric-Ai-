// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/bounding-box-selector
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const boundingBoxSelectorConfig: ComponentConfig = {
  componentName: "BoundingBoxSelector",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    appearAt: {
      default: 15,
      label: "Appear at (frame)",
      max: 60,
      min: 0,
      step: 1,
      type: "number",
    },
    background: { default: "#fafafa", label: "Background", type: "color" },
    borderColor: { default: "#0ea5e9", label: "Border color", type: "color" },
    borderWidth: {
      default: 2,
      label: "Border width",
      max: 8,
      min: 1,
      step: 1,
      type: "number",
    },
    handleColor: { default: "#0ea5e9", label: "Handle color", type: "color" },
    speed: {
      default: 1,
      label: "Speed",
      max: 3,
      min: 0.25,
      step: 0.25,
      type: "number",
    },
  },
  durationInFrames: 90,
  fps: FPS,
  importPath: "@/components/framecn/bounding-box-selector",
};
