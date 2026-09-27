// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/product-launch-trailer
// Only import paths changed. See src/lab/framecn/LICENSE.
import { FPS, H, W } from "../customizer-config";
import type { ComponentConfig } from "../customizer-config";

export const productLaunchTrailerConfig: ComponentConfig = {
  componentName: "ProductLaunchTrailer",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentLavender: {
      default: "#D4B3FF",
      label: "Accent lavender",
      type: "color",
    },
    accentMint: { default: "#A1EEBD", label: "Accent mint", type: "color" },
    accentPeach: { default: "#FFB38E", label: "Accent peach", type: "color" },
    background: { default: "#141318", label: "Background", type: "color" },
    logoLabel: { default: "R", label: "Logo label", type: "text" },
    productName: { default: "Framecn", label: "Product name", type: "text" },
    versionLabel: {
      default: "v1.0 is live",
      label: "Version label",
      type: "text",
    },
  },
  durationInFrames: 240,
  fps: FPS,
  importPath: "@/components/framecn/product-launch-trailer",
};
