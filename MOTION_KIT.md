# Motion kit — 3D, shapes, cursor, fonts, rich captions

## 3D (every visual clip)
Inspector → **3D**: Tilt X, Turn Y, Perspective + presets (Lean back, Turn left/right, Hero tilt, Floor).
Keyframes carry Tilt/Turn, so card flips and swings animate. Rendered by strip projection
(`renderExtras.project3D`), so preview = export.

## Shapes (55, toolbar → Shape)
| Job | Shape | Animation | How pros use it |
|---|---|---|---|
| Before → after | curved-arrow, elbow-arrow | draw-on | From the caption to the result photo, 0.4–0.6 s |
| Stress one word/number | underline, circle-scribble, highlight-bar | draw-on | One per beat, brand colour, 6–10 px stroke |
| Price / NEW / −50% | burst, seal, sparkle | pop | Top corner of the product, tilted about 8° |
| Do vs don't | check, cross | draw-on | Paired, green and red |
| Name / title | lower-third, callout-box | grow | Behind the text, 70% opacity |
| Isolate a detail | brackets, frame, ring | draw-on | Tighten the viewer's eye |
| UI mockups | button, toggle, browser, progress-bar | pop | Combine with Cursor |
| Soft backdrop | blob | pop | Behind cut-out people/products |

## Cursor (toolbar → Cursor, or the agent)
Select a clip and click **Cursor**. The pointer travels in, clicks (ripple), and the target presses in.
On hover the target lifts instead. Recorded components switch to *interact*, so they really react.
**When to use it:** buttons, toggles, inputs, menus, sliders, app/website walkthroughs.
**When not to:** backgrounds, text reveals, loaders, charts, logos. Cupric refuses these and says why;
Shift-click forces one anyway. The component director adds cursors to interactive CTA/control components automatically.

## Fonts (all bundled, OFL; export works offline)
- **Montserrat 800**: talking-head captions (6–8% of frame height).
- **Instrument Serif italic**: the single emphasis word.
- **Bebas Neue / Anton**: hype titles, uppercase only.
- **Geist / Outfit / Poppins**: product, SaaS, explainers.
- **JetBrains Mono**: code and stats.

Customise with weight, size, colour, glow, a caption-style stroke, and rich markup.

## Rich captions (markup in any text clip)
`*word*` serif italic emphasis · `==words==` highlight box · `{words}` accent colour · `^30^` big · newline = stacked.
Presets: Stacked hook, Highlight box, Accent phrase, Big stat, Name + detail, Credibility line.
Kinetic and word-reveal animate each word.

## Javis.jl (MIT): ideas adopted, no code copied
Draw-on stroke reveals, actions scheduled on frame ranges, and parent→child linking
(the cursor is linked to its target).

## framecn (MIT): 112 video components in the Components tab
Categories: Captions (15), Text (27), Transitions (14), Scenes (23), Shaders & backgrounds (21), Motion primitives (10).
- Vendored verbatim into `src/lab/framecn` by `scripts/vendor-framecn.mjs <clone>`; only import paths change.
- Editframe is proprietary and is **not** included. Cupric's own `editframe-shim.tsx` provides the only two names the components use.
- Shaders use `@paper-design/shaders-react` (Apache-2.0).
- Each component has its own settings (text, colours, sizes) in the inspector. **Apply & re-record** records it again through the single component recorder.
- The agent passes `props` on `addComponent`; they are validated against the component's controls.
- Upstream quirk handled: 3 components default to font weights missing from their own options, so a control's default is always accepted.

## Fonts: bundled, yours, and Fontshare
- 20 bundled OFL families. New this round: Plus Jakarta Sans, Bricolage Grotesque, Syne, Unbounded, Archivo Black, Fraunces, DM Serif Display.
- **Your fonts:** Text inspector → Add fonts takes a .zip, .woff2, .otf or .ttf. Family, weight and italic are read from the font's own tables. Fonts are stored in IndexedDB on this computer and embedded in exports.
- **Fontshare:** Satoshi, Clash Display, General Sans, Cabinet Grotesk, Switzer, Zodiak and others are ITF Free Font License fonts. That licence forbids apps from offering them to users, even via the API. So Cupric lists 21 verified families with links; the user downloads one and adds the zip. The agent only uses Fontshare fonts the user has added and otherwise suggests them.
- **Suggested looks:** reads the mood of the words (tech, luxury, hype, fitness, education, story, friendly) and builds complete looks: headline and emphasis pairing, weight, animation, and colours from the Brand Kit plus in-between tones, all readable on dark.

## Cursor v2
- Human aim: fast launch, long deceleration, a small overshoot that springs back, and a slight idle drift. It lands exactly on the target at the click.
- The pointer leans into its motion and leaves a motion-blur trail.
- On click: press, rebound, flash and a double ripple.
- Styles: Auto (arrow while travelling, hand over the target), Arrow, Hand, I-beam for inputs, Dot, Ring, Touch.
- **Click journeys:** multiple stops, each clicked in turn on alternating arcs.
