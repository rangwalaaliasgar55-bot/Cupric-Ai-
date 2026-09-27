// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/blur-reveal
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const blurRevealConfig: ComponentConfig = {
  componentName: "BlurReveal",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    blur: {
      default: 10,
      label: "Blur",
      max: 30,
      min: 1,
      step: 1,
      type: "number",
    },
    color: { default: "#171717", label: "Color", type: "color" },
    fontSize: {
      default: 72,
      label: "Font size",
      max: 160,
      min: 12,
      step: 1,
      type: "number",
    },
    fontWeight: {
      default: "600",
      label: "Font weight",
      options: FONT_WEIGHT_OPTIONS,
      type: "select",
    },
    speed: {
      default: 1,
      label: "Speed",
      max: 3,
      min: 0.25,
      step: 0.25,
      type: "number",
    },
    text: { default: "BlurReveal", label: "Text", type: "text" },
  },
  durationInFrames: 90,
  fps: FPS,
  importPath: "@/components/framecn/blur-reveal",
};
