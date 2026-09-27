// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/drag-and-drop-flow
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const dragAndDropFlowConfig: ComponentConfig = {
  componentName: "DragAndDropFlow",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accent: { default: "#0ea5e9", label: "Accent", type: "color" },
    background: { default: "#fafafa", label: "Background", type: "color" },
    dropzoneLabel: {
      default: "Drop file to upload",
      label: "Dropzone label",
      type: "text",
    },
    fileName: { default: "design.fig", label: "File name", type: "text" },
    speed: {
      default: 1,
      label: "Speed",
      max: 3,
      min: 0.25,
      step: 0.25,
      type: "number",
    },
  },
  durationInFrames: 150,
  fps: FPS,
  importPath: "@/components/framecn/drag-and-drop-flow",
};
