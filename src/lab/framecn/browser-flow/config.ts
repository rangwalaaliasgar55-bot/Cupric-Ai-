// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/browser-flow
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const browserFlowConfig: ComponentConfig = {
  componentName: "BrowserFlow",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    speed: {
      default: 1,
      label: "Speed",
      max: 3,
      min: 0.25,
      step: 0.25,
      type: "number",
    },
    url: {
      default: "framecn.dev",
      label: "URL",
      type: "text",
    },
  },
  durationInFrames: 270,
  fps: FPS,
  importPath: "@/components/framecn/browser-flow",
};
