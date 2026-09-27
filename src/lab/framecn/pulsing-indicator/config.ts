// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/pulsing-indicator
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS } from "../customizer-config";

export const pulsingIndicatorConfig: ComponentConfig = {
  componentName: "PulsingIndicator",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    background: { default: "white", label: "Background", type: "color" },
    color: { default: "#22c55e", label: "Dot color", type: "color" },
    period: {
      default: 8,
      label: "Period (frames)",
      max: 30,
      min: 2,
      step: 1,
      type: "number",
    },
    size: {
      default: 16,
      label: "Size",
      max: 64,
      min: 4,
      step: 2,
      type: "number",
    },
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
  importPath: "@/components/framecn/pulsing-indicator",
};
