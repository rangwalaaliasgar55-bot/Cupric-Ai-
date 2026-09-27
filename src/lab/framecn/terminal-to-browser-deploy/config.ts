// Vendored from framecn (MIT) — https://github.com/shadcn-labs/framecn/tree/main/registry/bases/editframe/components/terminal-to-browser-deploy
// Only import paths changed. See src/lab/framecn/LICENSE.
import type { ComponentConfig } from "../customizer-config";
import { H, W, FPS } from "../customizer-config";

export const terminalToBrowserDeployConfig: ComponentConfig = {
  componentName: "TerminalToBrowserDeploy",
  compositionHeight: H,
  compositionWidth: W,
  controls: {
    accentColor: { default: "#22c55e", label: "Accent color", type: "color" },
    siteUrl: {
      default: "https://app.example.com",
      label: "Site URL",
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
  durationInFrames: 210,
  fps: FPS,
  importPath: "@/components/framecn/terminal-to-browser-deploy",
};
