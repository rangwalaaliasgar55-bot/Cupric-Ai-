// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/text-fade-replace
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS } from "../customizer-config";

export const textFadeReplaceConfig: ComponentConfig = {
  componentName: "TextFadeReplace",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    color: { default: "#171717", label: "Text color", type: "color" },
    fontSize: {
      default: 48,
      label: "Font size",
      max: 120,
      min: 16,
      step: 4,
      type: "number",
    },
    fontWeight: {
      default: 600,
      label: "Font weight",
      max: 900,
      min: 100,
      step: 100,
      type: "number",
    },
    from: {
      default: "Hello",
      label: "From text",
      type: "text",
    },
    speed: {
      default: 1,
      label: "Speed",
      max: 3,
      min: 0.25,
      step: 0.25,
      type: "number",
    },
    to: {
      default: "World",
      label: "To text",
      type: "text",
    },
  },
  durationInFrames: 90,
  fps: FPS,
  importPath: "@/components/framecn/text-fade-replace",
};
