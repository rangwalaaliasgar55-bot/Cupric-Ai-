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
