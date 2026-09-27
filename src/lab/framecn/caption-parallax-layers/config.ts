// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-parallax-layers
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionParallaxLayersConfig: ComponentConfig = {
  componentName: "CaptionParallaxLayers",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    behindColor: {
      default: "#a78bfa",
      label: "Behind layer color",
      type: "color",
    },
    color: { default: "#ffffff", label: "Front color", type: "color" },
    fontSize: {
      default: 56,
      label: "Font size",
      max: 120,
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
  importPath: "@/components/framecn/caption-parallax-layers",
};
