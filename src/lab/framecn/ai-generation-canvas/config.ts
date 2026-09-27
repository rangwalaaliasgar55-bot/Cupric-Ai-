// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/ai-generation-canvas
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS } from "../customizer-config";

export const aiGenerationCanvasConfig: ComponentConfig = {
  componentName: "AIGenerationCanvas",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: { default: "#7c3aed", label: "Accent color", type: "color" },
    cardCount: {
      default: 4,
      label: "Card count",
      max: 8,
      min: 1,
      step: 1,
      type: "number",
    },
    prompt: {
      default: "Generate a dashboard",
      label: "Prompt text",
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
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/ai-generation-canvas",
};
