// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/dashboard-populate
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const dashboardPopulateConfig: ComponentConfig = {
  componentName: "DashboardPopulate",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: {
      default: "#22c55e",
      label: "Accent color",
      type: "color",
    },
    kpiTarget: {
      default: 128_400,
      label: "KPI target",
      max: 1_000_000,
      min: 1000,
      step: 100,
      type: "number",
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
  importPath: "@/components/framecn/dashboard-populate",
};
