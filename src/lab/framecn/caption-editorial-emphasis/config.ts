// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-editorial-emphasis
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionEditorialEmphasisConfig: ComponentConfig = {
  componentName: "CaptionEditorialEmphasis",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    color: { default: "#f5f0d0", label: "Text color", type: "color" },
    emphasisScale: {
      default: 2,
      label: "Emphasis scale",
      max: 3,
      min: 1.2,
      step: 0.1,
      type: "number",
    },
    fontSize: {
      default: 56,
      label: "Font size",
      max: 120,
      min: 24,
      step: 2,
      type: "number",
    },
    fontWeight: {
      default: "400",
      label: "Font weight",
      options: FONT_WEIGHT_OPTIONS,
      type: "select",
    },
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/caption-editorial-emphasis",
};
