/**
 * Every settable component prop in one place: framecn (vendored, generated
 * configs) plus Cupric's ObsidianUI-inspired components. The inspector, prop
 * validation and the agent read this, never the two sources separately.
 *
 * Every component that draws DOM text (all but the WebGL shaders) also gets a
 * universal `fontFamily` prop — including ones whose words are built in.
 * The stage applies it over the component's own font (keeping monospace/code
 * text mono), so the agent can set brand fonts inside components too.
 */
import type { ComponentConfig, ControlType } from './framecn/customizer-config'
import { FRAMECN_CONFIGS } from './framecn/configs'
import { OBSIDIAN_CONFIGS } from './obsidian/configs'
import { CUPRIC_CONFIGS } from './cupricConfigs'
import framecn from './framecn/entries.json'

// Shaders draw on WebGL — no DOM text for a font to reach.
const NO_TEXT = new Set(framecn.entries.filter((e) => e.category === 'shaders').map((e) => e.slug))

export const FONT_PROP: ControlType = { type: 'text', default: '', label: 'Font (any Studio font)' }

const withFont = (slug: string, c: ComponentConfig): ComponentConfig =>
  !NO_TEXT.has(slug) && !c.controls.fontFamily ? { ...c, controls: { ...c.controls, fontFamily: FONT_PROP } } : c

export const PROP_CONFIGS: Record<string, ComponentConfig> = Object.fromEntries(
  Object.entries({ ...FRAMECN_CONFIGS, ...OBSIDIAN_CONFIGS, ...CUPRIC_CONFIGS }).map(([slug, c]) => [slug, withFont(slug, c)]),
)

export { FONT_FAMILY_RE } from './fontProp'
