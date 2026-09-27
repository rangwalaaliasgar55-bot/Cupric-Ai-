/**
 * Customizer configs for the ObsidianUI-inspired components, in the same shape
 * as framecn's, so the inspector, prop validation and the agent treat them
 * identically. Slugs are `ob-*`.
 */
import type { ComponentConfig } from '../framecn/customizer-config'
import { FONT_WEIGHT_OPTIONS, FPS, H, W } from '../framecn/customizer-config'

const base = (componentName: string, seconds: number, controls: ComponentConfig['controls']): ComponentConfig => ({
  componentName, controls, compositionWidth: W, compositionHeight: H, durationInFrames: Math.round(seconds * FPS), fps: FPS, importPath: `@/lab/obsidian#${componentName}`,
})
const weight = (d: string) => ({ type: 'select' as const, default: d, label: 'Font weight', options: [...FONT_WEIGHT_OPTIONS, '800', '900'] })
const bg = (d: string) => ({ type: 'color' as const, default: d, label: 'Background' })

export const OBSIDIAN_CONFIGS: Record<string, ComponentConfig> = {
  'ob-flip-text': base('FlipText', 4, {
    text: { type: 'text', default: 'Flip every letter', label: 'Text' },
    color: { type: 'color', default: '#f4f1ea', label: 'Text colour' },
    fontSize: { type: 'number', default: 110, min: 24, max: 220, step: 2, label: 'Font size' },
    fontWeight: weight('700'),
    duration: { type: 'number', default: 2.2, min: 0.6, max: 6, step: 0.1, label: 'Cycle (s)' },
    together: { type: 'boolean', default: false, label: 'All letters together' },
    loop: { type: 'boolean', default: true, label: 'Loop' },
    background: bg('#0b0b10'),
  }),
  'ob-text-stream': base('TextStream', 6, {
    prefix: { type: 'text', default: 'We make', label: 'Prefix' },
    items: { type: 'text', default: 'launch videos, product demos, app walkthroughs, social reels', label: 'Words (comma separated)' },
    color: { type: 'color', default: '#f4f1ea', label: 'Text colour' },
    accentColor: { type: 'color', default: '#c8f542', label: 'Active word colour' },
    fontSize: { type: 'number', default: 96, min: 24, max: 200, step: 2, label: 'Font size' },
    fontWeight: weight('700'),
    speed: { type: 'number', default: 1, min: 0.25, max: 3, step: 0.05, label: 'Speed' },
    stepped: { type: 'boolean', default: true, label: 'Step word by word' },
    background: bg('#0b0b10'),
  }),
  'ob-click-spark': base('ClickSpark', 3, {
    color: { type: 'color', default: '#c8f542', label: 'Spark colour' },
    sparkCount: { type: 'number', default: 8, min: 3, max: 24, step: 1, label: 'Sparks' },
    sparkSize: { type: 'number', default: 34, min: 6, max: 120, step: 1, label: 'Spark length' },
    sparkRadius: { type: 'number', default: 70, min: 10, max: 300, step: 2, label: 'Burst radius' },
    strokeWidth: { type: 'number', default: 4, min: 1, max: 12, step: 0.5, label: 'Line width' },
    durationMs: { type: 'number', default: 450, min: 150, max: 1500, step: 10, label: 'Burst length (ms)' },
    interval: { type: 'number', default: 1, min: 0.25, max: 4, step: 0.05, label: 'Seconds between bursts' },
    bursts: { type: 'select', default: 'center', options: ['center', 'scatter'], label: 'Where' },
    background: bg('transparent'),
  }),
  'ob-marquee-band': base('MarqueeBand', 6, {
    text: { type: 'text', default: 'Now live, Built for teams, Ship faster', label: 'Phrases (comma separated)' },
    separator: { type: 'text', default: '✦', label: 'Separator' },
    color: { type: 'color', default: '#0b0b10', label: 'Text colour' },
    bandColor: { type: 'color', default: '#c8f542', label: 'Band colour' },
    secondBandColor: { type: 'color', default: '#f4f1ea', label: 'Second band colour' },
    fontSize: { type: 'number', default: 64, min: 20, max: 160, step: 2, label: 'Font size' },
    fontWeight: weight('800'),
    speed: { type: 'number', default: 1, min: 0.2, max: 4, step: 0.05, label: 'Speed' },
    angle: { type: 'number', default: -6, min: -20, max: 20, step: 0.5, label: 'Tilt (°)' },
    crossed: { type: 'boolean', default: true, label: 'Crossed second band' },
    uppercase: { type: 'boolean', default: true, label: 'Uppercase' },
    background: bg('#0b0b10'),
  }),
}

