// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/caption-neon-accent
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const captionNeonAccentConfig: ComponentConfig = {
  componentName: "CaptionNeonAccent",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: { default: "#a855f7", label: "Accent color", type: "color" },
    accentScale: {
      default: 1.5,
      label: "Accent size scale",
      max: 2.5,
      min: 1.2,
      step: 0.1,
      type: "number",
    },
    color: { default: "#ffffff", label: "Word color", type: "color" },
    fontSize: {
      default: 64,
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
  importPath: "@/components/framecn/caption-neon-accent",
};
