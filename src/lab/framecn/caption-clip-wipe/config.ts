// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-clip-wipe
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionClipWipeConfig: ComponentConfig = {
  componentName: "CaptionClipWipe",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    color: { default: "#ffffff", label: "Word color", type: "color" },
    fontSize: {
      default: 72,
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
    keywordColor: { default: "#FFD700", label: "Keyword color", type: "color" },
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/caption-clip-wipe",
};
