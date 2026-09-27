// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/typewriter
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS, FONT_WEIGHT_OPTIONS } from "../customizer-config";

export const typewriterConfig: ComponentConfig = {
  componentName: "Typewriter",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    charsPerSecond: {
      default: 20,
      label: "Chars / sec",
      max: 60,
      min: 4,
      step: 1,
      type: "number",
    },
    color: { default: "#171717", label: "Color", type: "color" },
    cursor: { default: true, label: "Show cursor", type: "boolean" },
    cursorColor: { default: "#171717", label: "Cursor color", type: "color" },
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
    text: {
      default: "console.log('hello, world')",
      label: "Text",
      type: "text",
    },
  },
  durationInFrames: 120,
  fps: FPS,
  importPath: "@/components/framecn/typewriter",
};
