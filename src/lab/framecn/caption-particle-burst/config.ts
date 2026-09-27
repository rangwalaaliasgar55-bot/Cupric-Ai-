// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-particle-burst
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionParticleBurstConfig: ComponentConfig = {
  componentName: "CaptionParticleBurst",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    burstColor: { default: "#fbbf24", label: "Burst color", type: "color" },
    color: { default: "#ffffff", label: "Text color", type: "color" },
    fontSize: {
      default: 80,
      label: "Font size",
      max: 160,
      min: 24,
      step: 2,
      type: "number",
    },
    fontWeight: {
      default: "700",
      label: "Font weight",
      options: FONT_WEIGHT_OPTIONS,
      type: "select",
    },
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/caption-particle-burst",
};
