// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-neon-glow
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionNeonGlowConfig: ComponentConfig = {
  componentName: "CaptionNeonGlow",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
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
    glowColor: { default: "#00fff0", label: "Glow color", type: "color" },
    wordsPerGroup: {
      default: 6,
      label: "Words per group",
      max: 10,
      min: 1,
      step: 1,
      type: "number",
    },
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/caption-neon-glow",
};
