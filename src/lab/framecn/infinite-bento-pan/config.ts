// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/infinite-bento-pan
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const infiniteBentoPanConfig: ComponentConfig = {
  componentName: "InfiniteBentoPan",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: {
      default: "#7c3aed",
      label: "Accent color",
      type: "color",
    },
    panSpeed: {
      default: 1,
      label: "Pan speed",
      max: 3,
      min: 0.25,
      step: 0.25,
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
  durationInFrames: 300,
  fps: FPS,
  importPath: "@/components/framecn/infinite-bento-pan",
};
