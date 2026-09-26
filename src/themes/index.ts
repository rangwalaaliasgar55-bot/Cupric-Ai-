/* Design tokens, theme presets, font presets, palette + gradient generators, FontManager. */
import { clamp, hsl, parseColor, rgbToHsl, shiftHue } from "@/core/math";

export type Theme = {
  id: string;
  name: string;
  dark: boolean;
  colors: { bg: string; surface: string; surface2: string; text: string; muted: string; primary: string; secondary: string; accent: string; border: string; success: string; warning: string; danger: string };
  gradient: string[];
  font: FontPreset;
  radius: number;
  shadow: number;
  motion: { enter: string; ease: string; duration: number; stagger: number };
  tags: string[];
};

export type FontPreset = { id: string; display: string; body: string; mono: string; displayWeight: number; bodyWeight: number; tracking: number; uppercase?: boolean; lineHeight: number };

const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const GROTESK = "'Helvetica Neue', Inter, ui-sans-serif, system-ui, Arial, sans-serif";
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
const DIDONE = "Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, serif";
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";

export const FONT_PRESETS: Record<string, FontPreset> = {
  SAAS: { id: "SAAS", display: SANS, body: SANS, mono: MONO, displayWeight: 700, bodyWeight: 450, tracking: -0.03, lineHeight: 1.05 },
  TECH: { id: "TECH", display: MONO, body: SANS, mono: MONO, displayWeight: 600, bodyWeight: 400, tracking: -0.02, lineHeight: 1.1 },
  LUXURY: { id: "LUXURY", display: DIDONE, body: SERIF, mono: MONO, displayWeight: 400, bodyWeight: 400, tracking: 0.02, lineHeight: 1.05 },
  EDITORIAL: { id: "EDITORIAL", display: SERIF, body: SERIF, mono: MONO, displayWeight: 500, bodyWeight: 400, tracking: -0.02, lineHeight: 1.0 },
  FUTURISTIC: { id: "FUTURISTIC", display: GROTESK, body: SANS, mono: MONO, displayWeight: 300, bodyWeight: 400, tracking: 0.12, uppercase: true, lineHeight: 1.1 },
  MINIMAL: { id: "MINIMAL", display: SANS, body: SANS, mono: MONO, displayWeight: 500, bodyWeight: 400, tracking: -0.02, lineHeight: 1.1 },
  CINEMATIC: { id: "CINEMATIC", display: GROTESK, body: SANS, mono: MONO, displayWeight: 200, bodyWeight: 300, tracking: 0.25, uppercase: true, lineHeight: 1.15 },
  CORPORATE: { id: "CORPORATE", display: SANS, body: SANS, mono: MONO, displayWeight: 600, bodyWeight: 400, tracking: -0.01, lineHeight: 1.15 },
};

const base = { success: "#34d399", warning: "#fbbf24", danger: "#f87171" };
export const THEMES: Record<string, Theme> = {
  midnight: { id: "midnight", name: "Midnight", dark: true, colors: { bg: "#07080c", surface: "#0e1017", surface2: "#161925", text: "#f4f5f8", muted: "#8a90a2", primary: "#7c8cff", secondary: "#38bdf8", accent: "#c084fc", border: "#23273a", ...base }, gradient: ["#7c8cff", "#38bdf8", "#c084fc"], font: FONT_PRESETS.SAAS, radius: 20, shadow: 40, motion: { enter: "saas", ease: "emphasized", duration: 26, stagger: 3 }, tags: ["dark", "saas", "premium"] },
  aurora: { id: "aurora", name: "Aurora AI", dark: true, colors: { bg: "#050608", surface: "#0c1014", surface2: "#131a20", text: "#effaf7", muted: "#7f9994", primary: "#2dd4bf", secondary: "#818cf8", accent: "#f0abfc", border: "#1c2a2e", ...base }, gradient: ["#2dd4bf", "#818cf8", "#f0abfc"], font: FONT_PRESETS.SAAS, radius: 22, shadow: 50, motion: { enter: "blurUp", ease: "emphasized", duration: 30, stagger: 3 }, tags: ["ai", "dark", "futuristic"] },
  luxury: { id: "luxury", name: "Dark Luxury", dark: true, colors: { bg: "#0a0908", surface: "#141210", surface2: "#1d1a16", text: "#f3ede2", muted: "#9c9282", primary: "#d4b16a", secondary: "#a78b52", accent: "#f5e6c4", border: "#2d2820", ...base }, gradient: ["#f5e6c4", "#d4b16a", "#7a5f2c"], font: FONT_PRESETS.LUXURY, radius: 4, shadow: 60, motion: { enter: "luxury", ease: "luxury", duration: 50, stagger: 5 }, tags: ["luxury", "premium", "gold"] },
  editorial: { id: "editorial", name: "Editorial", dark: false, colors: { bg: "#f3efe7", surface: "#ffffff", surface2: "#ebe5d9", text: "#141210", muted: "#6b645a", primary: "#d9480f", secondary: "#141210", accent: "#1c7ed6", border: "#d8d0c2", ...base }, gradient: ["#d9480f", "#f59f00", "#141210"], font: FONT_PRESETS.EDITORIAL, radius: 2, shadow: 10, motion: { enter: "editorial", ease: "easeOutQuart", duration: 30, stagger: 4 }, tags: ["editorial", "light", "magazine"] },
  cyber: { id: "cyber", name: "Cyber", dark: true, colors: { bg: "#04030a", surface: "#0d0a1c", surface2: "#16112b", text: "#f2f0ff", muted: "#8b84b0", primary: "#ff2bd6", secondary: "#00f0ff", accent: "#faff00", border: "#2a2150", ...base }, gradient: ["#ff2bd6", "#7b2bff", "#00f0ff"], font: FONT_PRESETS.FUTURISTIC, radius: 6, shadow: 30, motion: { enter: "glitchIn", ease: "linear", duration: 22, stagger: 2 }, tags: ["cyber", "neon", "futuristic", "gaming"] },
  corporate: { id: "corporate", name: "Corporate", dark: false, colors: { bg: "#f6f8fb", surface: "#ffffff", surface2: "#eef2f7", text: "#0f172a", muted: "#64748b", primary: "#2563eb", secondary: "#0ea5e9", accent: "#10b981", border: "#dde3ec", ...base }, gradient: ["#2563eb", "#0ea5e9", "#10b981"], font: FONT_PRESETS.CORPORATE, radius: 14, shadow: 20, motion: { enter: "corporate", ease: "easeOutCubic", duration: 24, stagger: 3 }, tags: ["corporate", "light", "business"] },
  pastel: { id: "pastel", name: "Pastel", dark: false, colors: { bg: "#fbf7f4", surface: "#ffffff", surface2: "#f4ede8", text: "#2b2530", muted: "#857b8c", primary: "#f472b6", secondary: "#a78bfa", accent: "#5eead4", border: "#eadfd8", ...base }, gradient: ["#fbcfe8", "#ddd6fe", "#99f6e4"], font: FONT_PRESETS.MINIMAL, radius: 28, shadow: 20, motion: { enter: "springUp", ease: "overshoot", duration: 26, stagger: 3 }, tags: ["pastel", "light", "friendly"] },
  mono: { id: "mono", name: "Monochrome", dark: true, colors: { bg: "#000000", surface: "#0c0c0c", surface2: "#161616", text: "#ffffff", muted: "#8a8a8a", primary: "#ffffff", secondary: "#bdbdbd", accent: "#ffffff", border: "#262626", ...base }, gradient: ["#ffffff", "#8a8a8a", "#2a2a2a"], font: FONT_PRESETS.MINIMAL, radius: 0, shadow: 0, motion: { enter: "minimal", ease: "easeOutQuart", duration: 20, stagger: 2 }, tags: ["minimal", "monochrome", "dark"] },
  neon: { id: "neon", name: "Neon Night", dark: true, colors: { bg: "#030712", surface: "#0b1120", surface2: "#111a2e", text: "#e6f6ff", muted: "#7d93ad", primary: "#22d3ee", secondary: "#a3e635", accent: "#f472b6", border: "#1c2940", ...base }, gradient: ["#22d3ee", "#a3e635", "#f472b6"], font: FONT_PRESETS.TECH, radius: 12, shadow: 40, motion: { enter: "flicker", ease: "linear", duration: 24, stagger: 2 }, tags: ["neon", "dark", "music"] },
  cinema: { id: "cinema", name: "Cinematic", dark: true, colors: { bg: "#050505", surface: "#0e0d0c", surface2: "#171513", text: "#f2efe9", muted: "#8f887d", primary: "#ff7a45", secondary: "#3aa6b9", accent: "#ffd6a5", border: "#262220", ...base }, gradient: ["#ff7a45", "#ffd6a5", "#3aa6b9"], font: FONT_PRESETS.CINEMATIC, radius: 0, shadow: 60, motion: { enter: "cinematic", ease: "cinematic", duration: 48, stagger: 4 }, tags: ["cinematic", "film", "dramatic"] },
  light: { id: "light", name: "Clean Light", dark: false, colors: { bg: "#ffffff", surface: "#f7f7f8", surface2: "#efeff1", text: "#0a0a0b", muted: "#6e6e76", primary: "#5b5bf6", secondary: "#0a0a0b", accent: "#f97316", border: "#e4e4e7", ...base }, gradient: ["#5b5bf6", "#a855f7", "#f97316"], font: FONT_PRESETS.SAAS, radius: 16, shadow: 24, motion: { enter: "fadeUp", ease: "standard", duration: 22, stagger: 3 }, tags: ["light", "saas", "minimal"] },
  finance: { id: "finance", name: "Finance", dark: true, colors: { bg: "#06100c", surface: "#0b1813", surface2: "#12241c", text: "#ecfdf5", muted: "#7fa393", primary: "#34d399", secondary: "#a7f3d0", accent: "#fde68a", border: "#1b3329", ...base }, gradient: ["#34d399", "#a7f3d0", "#fde68a"], font: FONT_PRESETS.CORPORATE, radius: 14, shadow: 30, motion: { enter: "fadeUp", ease: "emphasized", duration: 24, stagger: 3 }, tags: ["finance", "data", "dark"] },
};

let themeOverrides: Record<string, Theme> = {};
export function registerTheme(t: Theme) { themeOverrides[t.id] = t; }
export function getTheme(id?: string): Theme { return themeOverrides[id ?? ""] ?? THEMES[id ?? ""] ?? THEMES.midnight; }
export function allThemes(): Theme[] { return [...Object.values(THEMES), ...Object.values(themeOverrides)]; }
export function resetThemes() { themeOverrides = {}; }

/* ---------- Generators ---------- */
export type PaletteMode = "dark" | "light" | "monochrome" | "neon" | "luxury" | "pastel" | "corporate" | "ai" | "cyber";
export function generatePalette(primary: string, mode: PaletteMode = "dark"): Theme["colors"] {
  const p = parseColor(primary);
  const [h, s] = rgbToHsl(p.r, p.g, p.b);
  const dark = !["light", "pastel", "corporate"].includes(mode);
  const sat = mode === "monochrome" ? 0 : mode === "pastel" ? 0.7 : mode === "neon" || mode === "cyber" ? 1 : clamp(s, 0.45, 0.9);
  const lum = mode === "pastel" ? 0.78 : mode === "neon" ? 0.6 : 0.62;
  const prim = mode === "monochrome" ? (dark ? "#ffffff" : "#000000") : hsl(h, sat, lum);
  const secDeg = mode === "luxury" ? 20 : mode === "ai" ? -60 : mode === "cyber" ? 150 : 40;
  return {
    bg: dark ? hsl(h, mode === "monochrome" ? 0 : 0.25, 0.035) : hsl(h, 0.3, 0.98),
    surface: dark ? hsl(h, 0.2, 0.07) : "#ffffff",
    surface2: dark ? hsl(h, 0.18, 0.11) : hsl(h, 0.2, 0.94),
    text: dark ? hsl(h, 0.15, 0.96) : hsl(h, 0.3, 0.08),
    muted: dark ? hsl(h, 0.1, 0.58) : hsl(h, 0.08, 0.42),
    primary: prim,
    secondary: mode === "monochrome" ? "#9a9a9a" : shiftHue(prim, secDeg),
    accent: mode === "monochrome" ? prim : shiftHue(prim, -secDeg * 2, 0, 0.05),
    border: dark ? hsl(h, 0.15, 0.16) : hsl(h, 0.15, 0.87),
    ...base,
  };
}
export function generateGradient(primary: string, kind: "analogous" | "complementary" | "triad" | "sunset" | "mono" = "analogous"): string[] {
  switch (kind) {
    case "complementary": return [primary, shiftHue(primary, 180)];
    case "triad": return [primary, shiftHue(primary, 120), shiftHue(primary, 240)];
    case "sunset": return [shiftHue(primary, -30, 0, 0.1), primary, shiftHue(primary, 40, 0, -0.1)];
    case "mono": return [shiftHue(primary, 0, 0, 0.2), primary, shiftHue(primary, 0, 0, -0.25)];
    default: return [shiftHue(primary, -35), primary, shiftHue(primary, 35)];
  }
}
export function generateTheme(opts: { id?: string; name?: string; primary: string; mode?: PaletteMode; font?: keyof typeof FONT_PRESETS }): Theme {
  const mode = opts.mode ?? "dark";
  const colors = generatePalette(opts.primary, mode);
  const baseTheme = mode === "luxury" ? THEMES.luxury : mode === "cyber" ? THEMES.cyber : ["light", "corporate", "pastel"].includes(mode) ? THEMES.light : THEMES.midnight;
  return { ...baseTheme, id: opts.id ?? `custom-${opts.primary.replace("#", "")}-${mode}`, name: opts.name ?? `Custom ${mode}`, dark: !["light", "pastel", "corporate"].includes(mode), colors, gradient: generateGradient(colors.primary), font: FONT_PRESETS[opts.font ?? baseTheme.font.id] ?? baseTheme.font, tags: [mode, "custom"] };
}

/* ---------- FontManager ---------- */
export const FontManager = {
  loaded: new Set<string>(),
  presets: FONT_PRESETS,
  /** CSS font shorthand for canvas. */
  css(o: { family: string; size: number; weight?: number; italic?: boolean }) {
    return `${o.italic ? "italic " : ""}${o.weight ?? 400} ${Math.max(1, o.size)}px ${o.family}`;
  },
  /** Load a web font from a sanitized https URL (FontFace API). Optional variable axes via descriptors. */
  async load(family: string, url: string, descriptors?: FontFaceDescriptors) {
    if (typeof window === "undefined" || this.loaded.has(family)) return;
    if (!/^https:\/\//.test(url) && !url.startsWith("/")) throw new Error("Font URL must be https or same-origin");
    const face = new FontFace(family, `url(${url})`, descriptors);
    await face.load();
    document.fonts.add(face);
    this.loaded.add(family);
  },
  transformCase(text: string, c?: string) {
    if (c === "upper") return text.toUpperCase();
    if (c === "lower") return text.toLowerCase();
    if (c === "title") return text.replace(/\b\w/g, (m) => m.toUpperCase());
    return text;
  },
};
