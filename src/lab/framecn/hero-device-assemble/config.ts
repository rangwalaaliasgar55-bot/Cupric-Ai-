// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/hero-device-assemble
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const heroDeviceAssembleConfig: ComponentConfig = {
  componentName: "HeroDeviceAssemble",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: {
      default: "#22c55e",
      label: "Accent color",
      type: "color",
    },
    assembleStart: {
      default: 0,
      label: "Assemble start",
      max: 60,
      min: 0,
      step: 1,
      type: "number",
    },
    device: {
      default: "laptop",
      label: "Device",
      options: ["laptop", "phone"],
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
  },
  durationInFrames: 150,
  fps: FPS,
  importPath: "@/components/framecn/hero-device-assemble",
};
