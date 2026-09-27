// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/landing-code-showcase
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS } from "../customizer-config";

export const landingCodeShowcaseConfig: ComponentConfig = {
  componentName: "LandingCodeShowcase",
  compositionHeight: 900,
  compositionWidth: 2080,
  controls: {
    accentColor: {
      default: "#FFB38E",
      label: "Accent color",
      type: "color",
    },
  },
  durationInFrames: 720,
  fps: FPS,
  importPath: "@/components/framecn/landing-code-showcase",
};
