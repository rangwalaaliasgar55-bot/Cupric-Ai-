// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/pricing-tier-focus
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { FPS, H, W } from "../customizer-config";

export const pricingTierFocusConfig: ComponentConfig = {
  componentName: "PricingTierFocus",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: {
      default: "#22c55e",
      label: "Accent color",
      type: "color",
    },
    focusedTier: {
      default: "1",
      label: "Focused tier",
      options: ["0", "1", "2"],
      type: "select",
    },
  },
  durationInFrames: 180,
  fps: FPS,
  importPath: "@/components/framecn/pricing-tier-focus",
};
