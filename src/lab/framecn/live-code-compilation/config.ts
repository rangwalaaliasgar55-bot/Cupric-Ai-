// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/live-code-compilation
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const liveCodeCompilationConfig: ComponentConfig = {
  componentName: "LiveCodeCompilation",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: {
      default: "#3b82f6",
      label: "Accent color",
      type: "color",
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
  durationInFrames: 260,
  fps: FPS,
  importPath: "@/components/framecn/live-code-compilation",
};
