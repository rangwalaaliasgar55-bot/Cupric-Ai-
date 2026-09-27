// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-glitch-rgb
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionGlitchRgbConfig: ComponentConfig = {
  componentName: "CaptionGlitchRgb",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    color: { default: "#ffffff", label: "Text color", type: "color" },
    fontSize: {
      default: 88,
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
    glitchCyanColor: {
      default: "#00e5ff",
      label: "Glitch cyan",
      type: "color",
    },
    glitchRedColor: { default: "#ff003c", label: "Glitch red", type: "color" },
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/caption-glitch-rgb",
};
