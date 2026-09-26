# ASSET_CATALOG.md

Generated from the live registry (`WRITE_CATALOG=1 npx vitest run src/tests/system.test.ts`). **648 registered assets.** Counts are real registrations — no duplicated placeholder entries.

| Kind | Count |
|---|---|
| background | 53 |
| camera | 10 |
| caption | 9 |
| chart | 30 |
| device | 8 |
| effect | 35 |
| lighting | 10 |
| logo | 30 |
| material | 20 |
| motion | 116 |
| node | 25 |
| particles | 34 |
| shader | 22 |
| shape | 21 |
| template | 32 |
| theme | 12 |
| three | 31 |
| transition | 53 |
| typography | 63 |
| ui | 34 |

Additional: 84 entrance + 32 loop motion presets; 150 chart×animation variants; exits reuse any entrance preset.

## background

- `background:linear` — **Linear Gradient**: Directional multi-stop gradient. _(cpu low, gpu low; gradient, gradient, clean)_
- `background:radial` — **Radial Glow**: Centered radial glow over the base. _(cpu low, gpu low; gradient, glow, spotlight)_
- `background:conic` — **Conic Sweep**: Rotating conic gradient. _(cpu low, gpu low; gradient, holographic, vibrant)_
- `background:mesh` — **Mesh Gradient**: Organic mesh gradient of drifting colour points. _(cpu low, gpu low; gradient, saas, premium, soft)_
- `background:aurora` — **Aurora**: Layered aurora curtains. _(cpu low, gpu low; gradient, ai, premium, northern-lights)_
- `background:animatedGradient` — **Animated Gradient**: Gradient that pans across its colours. _(cpu low, gpu low; gradient, animated, saas)_
- `background:liquid` — **Liquid Blobs**: Gooey liquid colour blobs. _(cpu low, gpu low; gradient, liquid, fluid, blob)_
- `background:holographicBg` — **Holographic Foil**: Hue-shifting holographic foil. _(cpu high, gpu low; gradient, holographic, iridescent, futuristic)_
- `background:iridescent` — **Iridescent Film**: Thin-film interference bands. _(cpu high, gpu low; gradient, iridescent, luxury)_
- `background:spotlight` — **Spotlight**: Moving stage spotlight cone. _(cpu low, gpu low; gradient, cinematic, stage)_
- `background:horizon` — **Horizon Glow**: Glowing horizon line with atmospheric falloff. _(cpu low, gpu low; gradient, cinematic, sunset)_
- `background:duotone` — **Duotone Split**: Two-tone diagonal split with soft seam. _(cpu low, gpu low; gradient, editorial, bold)_
- `background:noise` — **Value Noise**: Smooth animated value noise. _(cpu high, gpu low; procedural, noise, texture)_
- `background:fractalNoise` — **Fractal Noise**: Multi-octave fractal clouds. _(cpu high, gpu low; procedural, noise, clouds)_
- `background:flowingNoise` — **Flowing Noise**: Domain-warped flowing noise. _(cpu high, gpu low; procedural, fluid, organic)_
- `background:plasma` — **Plasma**: Classic sine plasma. _(cpu high, gpu low; procedural, retro, psychedelic)_
- `background:metaballs` — **Metaballs**: Iso-surface metaballs. _(cpu high, gpu low; procedural, liquid, blob)_
- `background:voronoi` — **Voronoi Cells**: Animated Voronoi cellular pattern. _(cpu high, gpu low; procedural, cells, organic, tech)_
- `background:topographic` — **Topographic**: Contour lines of a noise terrain. _(cpu high, gpu low; procedural, map, contour, minimal)_
- `background:waves` — **Waves**: Stacked sine wave bands. _(cpu low, gpu low; procedural, waves, calm)_
- `background:waveLines` — **Wave Lines**: Fine animated wave line field. _(cpu low, gpu low; procedural, lines, minimal, tech)_
- `background:blobs` — **Floating Blobs**: Soft noise-deformed blobs. _(cpu low, gpu low; procedural, soft, friendly)_
- `background:vectorField` — **Vector Field**: Noise-driven vector field arrows. _(cpu low, gpu low; procedural, tech, data, science)_
- `background:fluidField` — **Fluid Streamlines**: Streamlines traced through a flow field. _(cpu high, gpu low; procedural, fluid, flow, premium)_
- `background:perspectiveGrid` — **Perspective Grid**: Infinite perspective floor grid. _(cpu low, gpu low; grid, synthwave, retro, cyber)_
- `background:infiniteGrid` — **Infinite Grid**: Scrolling square grid with radial fade. _(cpu low, gpu low; grid, saas, minimal, tech)_
- `background:dotGrid` — **Dot Grid**: Dot matrix with a travelling pulse. _(cpu low, gpu low; grid, minimal, saas)_
- `background:lineGrid` — **Line Grid**: Major/minor blueprint grid. _(cpu low, gpu low; grid, blueprint)_
- `background:isometric` — **Isometric Grid**: Isometric lattice with elevated tiles. _(cpu low, gpu low; grid, 3d, tech)_
- `background:cyberGrid` — **Cyber Grid**: Neon grid with scanning beam. _(cpu low, gpu low; grid, cyber, neon, hud)_
- `background:holoGrid` — **Holographic Grid**: Shimmering holographic lattice. _(cpu low, gpu low; grid, holographic, futuristic)_
- `background:radialGrid` — **Radial Grid**: Polar grid with radar sweep. _(cpu low, gpu low; grid, radar, hud)_
- `background:dataGrid` — **Data Grid**: Cells lighting up like live data. _(cpu low, gpu low; grid, data, tech, ai)_
- `background:hexGrid` — **Hex Grid**: Honeycomb grid with waves of light. _(cpu low, gpu low; grid, tech, honeycomb)_
- `background:ribbons` — **Silk Ribbons**: Flowing translucent silk ribbons. _(cpu low, gpu low; abstract, premium, luxury, flowing)_
- `background:orbs` — **Bokeh Orbs**: Out-of-focus floating light orbs. _(cpu low, gpu low; abstract, bokeh, soft, cinematic)_
- `background:rings` — **Pulse Rings**: Expanding concentric rings. _(cpu low, gpu low; abstract, radar, ai, sonar)_
- `background:lightRays` — **Light Rays**: Volumetric god rays from above. _(cpu low, gpu low; abstract, volumetric, cinematic, god-rays)_
- `background:beams` — **Falling Beams**: Vertical light beams falling along columns. _(cpu low, gpu low; abstract, saas, tech, meteor)_
- `background:geometric` — **Geometric Drift**: Slowly rotating outlined polygons. _(cpu low, gpu low; abstract, geometric, minimal, bauhaus)_
- `background:starfield` — **Starfield**: Parallax twinkling starfield. _(cpu low, gpu low; abstract, space, stars, cosmic)_
- `background:warpSpeed` — **Warp Speed**: Hyperspace star streaks. _(cpu low, gpu low; abstract, space, hyperspace, energetic)_
- `background:matrixRain` — **Code Rain**: Falling glyph columns. _(cpu low, gpu low; abstract, hacker, code, cyber)_
- `background:stripes` — **Motion Stripes**: Diagonal animated stripes. _(cpu low, gpu low; abstract, bold, sport)_
- `background:sunburst` — **Sunburst**: Rotating radial sunburst rays. _(cpu low, gpu low; abstract, retro, celebration)_
- `background:halftone` — **Halftone**: Animated halftone dot gradient. _(cpu low, gpu low; abstract, print, editorial, pop-art)_
- `background:circuit` — **Circuit Traces**: PCB traces with travelling pulses. _(cpu low, gpu low; abstract, tech, hardware, ai)_
- `background:constellation` — **Constellation**: Drifting nodes connected by proximity. _(cpu low, gpu low; abstract, network, ai, space)_
- `background:meteors` — **Meteor Shower**: Diagonal meteors with tails. _(cpu low, gpu low; abstract, space, dramatic)_
- `background:gradientGrain` — **Grainy Gradient**: Soft gradient with film-grain texture. _(cpu low, gpu low; abstract, editorial, trendy, film)_
- `background:checkerWarp` — **Warped Checker**: Op-art warped checkerboard. _(cpu high, gpu low; abstract, psychedelic, op-art)_
- `background:lightLeakBg` — **Light Leaks**: Warm drifting film light leaks. _(cpu low, gpu low; abstract, film, warm, cinematic)_
- `background:concentric` — **Concentric Squares**: Rotating nested squares. _(cpu low, gpu low; abstract, hypnotic, minimal)_

## camera

- `camera:PRODUCT` — **PRODUCT Camera**: Deterministic product camera move. _(cpu low, gpu medium; camera, product)_
- `camera:SAAS` — **SAAS Camera**: Deterministic saas camera move. _(cpu low, gpu medium; camera, saas)_
- `camera:CINEMATIC` — **CINEMATIC Camera**: Deterministic cinematic camera move. _(cpu low, gpu medium; camera, cinematic)_
- `camera:TECH` — **TECH Camera**: Deterministic tech camera move. _(cpu low, gpu medium; camera, tech)_
- `camera:LUXURY` — **LUXURY Camera**: Deterministic luxury camera move. _(cpu low, gpu medium; camera, luxury)_
- `camera:MACRO` — **MACRO Camera**: Deterministic macro camera move. _(cpu low, gpu medium; camera, macro)_
- `camera:DRAMATIC` — **DRAMATIC Camera**: Deterministic dramatic camera move. _(cpu low, gpu medium; camera, dramatic)_
- `camera:OVERHEAD` — **OVERHEAD Camera**: Deterministic overhead camera move. _(cpu low, gpu medium; camera, overhead)_
- `camera:ORBIT` — **ORBIT Camera**: Deterministic orbit camera move. _(cpu low, gpu medium; camera, orbit)_
- `camera:HERO` — **HERO Camera**: Deterministic hero camera move. _(cpu low, gpu medium; camera, hero)_

## caption

- `caption:caption-basic` — **Basic Captions**: Clean centred subtitle. _(cpu low, gpu low; captions, subtitle, minimal)_
- `caption:caption-wordByWord` — **Word by Word Captions**: Words appear as they're spoken. _(cpu low, gpu low; captions, social, kinetic)_
- `caption:caption-karaoke` — **Karaoke Captions**: Active word colour sweep. _(cpu low, gpu low; captions, music, social)_
- `caption:caption-highlight` — **Highlight Captions**: Active word gets a marker box. _(cpu low, gpu low; captions, social, shorts, tiktok)_
- `caption:caption-kinetic` — **Kinetic Captions**: Active word pops large with spring. _(cpu low, gpu low; captions, shorts, reels, energetic)_
- `caption:caption-speaker` — **Speaker Captions**: Speaker label + subtitle for interviews. _(cpu low, gpu low; captions, podcast, interview)_
- `caption:caption-social` — **Social Bold Captions**: Heavy uppercase with stroke (short-form). _(cpu low, gpu low; captions, tiktok, reels, shorts)_
- `caption:caption-aiSubtitle` — **AI Gradient Captions**: Glassy pill with gradient active word. _(cpu low, gpu low; captions, ai, saas, futuristic)_
- `caption:caption-youtube` — **YouTube Captions**: Classic boxed YouTube CC style. _(cpu low, gpu low; captions, youtube, accessibility)_

## chart

- `chart:line` — **Line Chart**: Smooth line that draws left to right. _(cpu low, gpu low; chart, data, trend, growth)_
- `chart:area` — **Area Chart**: Gradient area chart revealing with its line. _(cpu low, gpu low; chart, data, trend, saas, revenue)_
- `chart:multiLine` — **Multi-line**: Two series drawing in sequence. _(cpu low, gpu low; chart, data, comparison, trend)_
- `chart:step` — **Step Line**: Stepped line chart. _(cpu low, gpu low; chart, data, discrete, status)_
- `chart:sparkline` — **Sparkline**: Compact inline trend line. _(cpu low, gpu low; chart, data, kpi, mini)_
- `chart:bar` — **Bar Chart**: Vertical bars growing with stagger. _(cpu low, gpu low; chart, data, comparison, data)_
- `chart:hbar` — **Horizontal Bars**: Horizontal bars with values. _(cpu low, gpu low; chart, data, ranking, comparison)_
- `chart:stacked` — **Stacked Bars**: Stacked two-series bars. _(cpu low, gpu low; chart, data, composition, data)_
- `chart:histogram` — **Histogram**: Gap-less distribution bars. _(cpu low, gpu low; chart, data, distribution, statistics)_
- `chart:waterfall` — **Waterfall**: Cumulative waterfall bridge chart. _(cpu low, gpu low; chart, data, finance, bridge)_
- `chart:candlestick` — **Candlestick**: OHLC candles appearing in sequence. _(cpu low, gpu low; chart, data, finance, trading, crypto)_
- `chart:pie` — **Pie Chart**: Pie slices sweeping in. _(cpu low, gpu low; chart, data, composition, share)_
- `chart:donut` — **Donut**: Donut with centre total. _(cpu low, gpu low; chart, data, composition, kpi)_
- `chart:polar` — **Polar Area**: Polar area wedges growing outward. _(cpu low, gpu low; chart, data, composition, radial)_
- `chart:radar` — **Radar**: Radar polygon expanding from centre. _(cpu low, gpu low; chart, data, comparison, skills)_
- `chart:scatter` — **Scatter**: Points popping in by index. _(cpu low, gpu low; chart, data, correlation, science)_
- `chart:bubble` — **Bubble**: Bubbles sized by value. _(cpu low, gpu low; chart, data, correlation, market)_
- `chart:heatmap` — **Heatmap**: Grid cells warming up diagonally. _(cpu low, gpu low; chart, data, density, activity)_
- `chart:calendarHeat` — **Contribution Graph**: GitHub-style contribution grid. _(cpu low, gpu low; chart, data, activity, developer)_
- `chart:funnel` — **Funnel**: Conversion funnel stages. _(cpu low, gpu low; chart, data, conversion, marketing)_
- `chart:counter` — **Counter**: Large number counting up. _(cpu low, gpu low; chart, data, kpi, number)_
- `chart:kpi` — **KPI Tile**: KPI tile with delta and sparkline. _(cpu low, gpu low; chart, data, kpi, dashboard)_
- `chart:progressRing` — **Progress Ring**: Circular progress ring with percentage. _(cpu low, gpu low; chart, data, progress, goal)_
- `chart:progressBars` — **Progress Bars**: Multiple labelled progress bars. _(cpu low, gpu low; chart, data, progress, goals)_
- `chart:gauge` — **Gauge**: Speedometer gauge with needle settle. _(cpu low, gpu low; chart, data, kpi, performance)_
- `chart:timeline` — **Timeline**: Milestones along a drawing line. _(cpu low, gpu low; chart, data, roadmap, history)_
- `chart:network` — **Network Graph**: Force-style graph with edges drawing in. _(cpu low, gpu low; chart, data, graph, relationships, ai)_
- `chart:treemap` — **Treemap**: Squarified-ish treemap tiles. _(cpu low, gpu low; chart, data, hierarchy, composition)_
- `chart:leaderboard` — **Leaderboard**: Ranked rows with bars and positions. _(cpu low, gpu low; chart, data, ranking, gaming, sales)_
- `chart:comparison` — **Comparison Bars**: Before/after comparison pair. _(cpu low, gpu low; chart, data, versus, comparison)_

## device

- `device:iphone` — **iPhone**: iPhone mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, mobile, ios, app)_
- `device:android` — **Android**: Android mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, mobile, android, app)_
- `device:laptop` — **Laptop**: Laptop mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, desktop, macbook)_
- `device:desktop` — **Desktop Display**: Desktop Display mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, desktop, imac)_
- `device:tablet` — **Tablet**: Tablet mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, tablet, ipad)_
- `device:watch` — **Watch**: Watch mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, wearable, watch)_
- `device:browserFrame` — **Browser**: Browser mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, web, browser)_
- `device:tv` — **TV**: TV mockup that hosts any UI component or image. _(cpu low, gpu low; device, mockup, tv, streaming)_

## effect

- `effect:bloom` — **Bloom**: Bright areas bleed soft light. _(cpu high, gpu low; light, glow, cinematic)_
- `effect:glow` — **Soft Glow**: Diffuse dreamy glow over the whole frame. _(cpu high, gpu low; light, dreamy, soft)_
- `effect:blur` — **Gaussian Blur**: Uniform gaussian blur. _(cpu low, gpu low; lens, blur, focus)_
- `effect:depthOfField` — **Depth of Field**: Tilt-shift style focus band with blurred foreground/background. _(cpu high, gpu low; lens, cinematic, bokeh, focus)_
- `effect:rackFocus` — **Rack Focus**: Animated focus pull from blurred to sharp. _(cpu low, gpu low; lens, cinematic, camera)_
- `effect:chromatic` — **Chromatic Aberration**: Red/blue fringing towards the edges. _(cpu high, gpu low; lens, lens, cinematic, tech)_
- `effect:rgbSplit` — **RGB Split**: Animated RGB channel separation. _(cpu high, gpu low; digital, glitch, music)_
- `effect:lensDistortion` — **Lens Distortion**: Barrel distortion approximated with concentric scaling. _(cpu low, gpu low; lens, lens, fisheye)_
- `effect:grain` — **Film Grain**: Animated seeded film grain. _(cpu low, gpu low; texture, film, cinematic, texture)_
- `effect:noise` — **Digital Noise**: Coloured digital sensor noise. _(cpu low, gpu low; texture, noise, tv)_
- `effect:vignette` — **Vignette**: Darkened frame edges. _(cpu low, gpu low; lens, cinematic, focus)_
- `effect:colorGrade` — **Color Grade**: Exposure, contrast, saturation and hue in one pass. _(cpu low, gpu low; color, grade, color)_
- `effect:exposure` — **Exposure**: Brightness adjustment. _(cpu low, gpu low; color, color)_
- `effect:saturation` — **Saturation**: Saturation adjustment. _(cpu low, gpu low; color, color)_
- `effect:contrast` — **Contrast**: Contrast adjustment. _(cpu low, gpu low; color, color)_
- `effect:hueShift` — **Hue Shift**: Animated hue rotation. _(cpu low, gpu low; color, color, psychedelic)_
- `effect:monochrome` — **Monochrome**: Black and white conversion. _(cpu low, gpu low; color, bw, editorial)_
- `effect:sepia` — **Vintage**: Warm vintage sepia tone. _(cpu low, gpu low; color, retro, warm)_
- `effect:duotone` — **Duotone**: Map luminance to two colours. _(cpu low, gpu low; color, editorial, bold)_
- `effect:tealOrange` — **Teal & Orange**: Blockbuster teal shadows and orange highlights. _(cpu low, gpu low; color, cinematic, blockbuster)_
- `effect:scanlines` — **Scanlines**: CRT scanlines with rolling bar. _(cpu low, gpu low; digital, retro, crt, tech)_
- `effect:glitch` — **Glitch**: Seeded slice displacement bursts. _(cpu low, gpu low; digital, glitch, cyber)_
- `effect:pixelate` — **Pixelate**: Mosaic pixelation. _(cpu low, gpu low; digital, retro, 8bit)_
- `effect:vhs` — **VHS**: Tape wobble, colour bleed and tracking noise. _(cpu low, gpu low; digital, retro, tape)_
- `effect:sharpen` — **Clarity**: Local contrast boost (unsharp-mask style). _(cpu low, gpu low; lens, crisp)_
- `effect:fog` — **Fog**: Drifting low fog layers. _(cpu low, gpu low; cinematic, atmosphere, moody)_
- `effect:lightLeak` — **Light Leak**: Warm film light leaks drifting across frame. _(cpu low, gpu low; cinematic, film, warm)_
- `effect:lensFlare` — **Lens Flare**: Anamorphic streak with ghost orbs. _(cpu low, gpu low; cinematic, cinematic, anamorphic, sci-fi)_
- `effect:lightSweep` — **Light Sweep**: Diagonal specular sweep across frame. _(cpu low, gpu low; cinematic, premium, logo, shine)_
- `effect:volumetric` — **Volumetric Light**: God rays from a light source. _(cpu low, gpu low; cinematic, god-rays, atmosphere)_
- `effect:bokehOverlay` — **Bokeh Overlay**: Foreground out-of-focus light discs. _(cpu low, gpu low; cinematic, bokeh, dreamy)_
- `effect:dust` — **Dust & Scratches**: Film dust specks and vertical scratches. _(cpu low, gpu low; texture, film, vintage)_
- `effect:letterbox` — **Letterbox**: Cinemascope bars (2.39:1) with optional animation. _(cpu low, gpu low; cinematic, cinematic, widescreen)_
- `effect:cameraShake` — **Camera Shake**: Deterministic camera shake / handheld wobble. _(cpu low, gpu low; cinematic, camera, impact, handheld)_
- `effect:motionBlur` — **Motion Blur**: Directional motion blur (multi-tap). _(cpu low, gpu low; lens, speed, cinematic)_

## lighting

- `lighting:STUDIO` — **STUDIO Lighting**: Reusable studio light rig. _(cpu low, gpu medium; lighting, studio)_
- `lighting:PRODUCT` — **PRODUCT Lighting**: Reusable product light rig. _(cpu low, gpu medium; lighting, product)_
- `lighting:CINEMATIC` — **CINEMATIC Lighting**: Reusable cinematic light rig. _(cpu low, gpu medium; lighting, cinematic)_
- `lighting:NEON` — **NEON Lighting**: Reusable neon light rig. _(cpu low, gpu medium; lighting, neon)_
- `lighting:RIM` — **RIM Lighting**: Reusable rim light rig. _(cpu low, gpu medium; lighting, rim)_
- `lighting:SOFTBOX` — **SOFTBOX Lighting**: Reusable softbox light rig. _(cpu low, gpu medium; lighting, softbox)_
- `lighting:DRAMATIC` — **DRAMATIC Lighting**: Reusable dramatic light rig. _(cpu low, gpu medium; lighting, dramatic)_
- `lighting:DARK_LUXURY` — **DARK LUXURY Lighting**: Reusable dark luxury light rig. _(cpu low, gpu medium; lighting, dark_luxury)_
- `lighting:FUTURISTIC` — **FUTURISTIC Lighting**: Reusable futuristic light rig. _(cpu low, gpu medium; lighting, futuristic)_
- `lighting:HOLOGRAPHIC` — **HOLOGRAPHIC Lighting**: Reusable holographic light rig. _(cpu low, gpu medium; lighting, holographic)_

## logo

- `logo:fade` — **Fade Logo**: Soft fade with slight scale. _(cpu low, gpu low; logo, minimal)_
- `logo:minimal` — **Minimal Logo**: Mark then wordmark slide. _(cpu low, gpu low; logo, minimal, clean)_
- `logo:lineDraw` — **Line Draw Logo**: Mark outline draws, then fills. _(cpu low, gpu low; logo, elegant, outline)_
- `logo:shapeBuild` — **Shape Build Logo**: Mark assembles from rotating shards. _(cpu low, gpu low; logo, geometric, tech)_
- `logo:particle` — **Particle Assemble Logo**: Particles converge into the mark. _(cpu medium, gpu low; logo, particles, ai, magic)_
- `logo:lightSweep` — **Light Sweep Logo**: Specular sweep across the logo. _(cpu low, gpu low; logo, premium, shine)_
- `logo:glitch` — **Glitch Logo**: Glitch-in with RGB split. _(cpu low, gpu low; logo, cyber, gaming)_
- `logo:neon` — **Neon Logo**: Neon tube flicker on. _(cpu low, gpu low; logo, neon, night)_
- `logo:chrome` — **Chrome Logo**: Chrome gradient with shine. _(cpu low, gpu low; logo, chrome, premium)_
- `logo:glass` — **Glass Logo**: Frosted glass plate reveal. _(cpu low, gpu low; logo, glass, frosted)_
- `logo:liquid` — **Liquid Logo**: Liquid fill rising inside the wordmark. _(cpu low, gpu low; logo, liquid, fluid)_
- `logo:holographic` — **Holographic Logo**: Hue-shifting foil. _(cpu low, gpu low; logo, holographic, futuristic)_
- `logo:energy` — **Energy Logo**: Charging rings then burst. _(cpu low, gpu low; logo, energy, electric)_
- `logo:luxury` — **Luxury Logo**: Slow gold reveal with tracking. _(cpu low, gpu low; logo, luxury, gold)_
- `logo:logo3d` — **3D Extrude Logo**: Extruded depth with tilt. _(cpu low, gpu low; logo, 3d, bold)_
- `logo:stamp` — **Stamp Logo**: Slams in with shake. _(cpu low, gpu low; logo, impact, bold)_
- `logo:typewriter` — **Typewriter Logo**: Wordmark types in. _(cpu low, gpu low; logo, code, tech)_
- `logo:split` — **Split Reveal Logo**: Halves slide apart to reveal. _(cpu low, gpu low; logo, editorial)_
- `logo:orbitRing` — **Orbit Ring Logo**: Orbiting ring settles around mark. _(cpu low, gpu low; logo, space, ai)_
- `logo:zoomThrough` — **Zoom Through Logo**: Rushes out of depth. _(cpu low, gpu low; logo, energetic, youtube)_
- `logo:blurFocus` — **Blur Focus Logo**: Rack focus into logo. _(cpu low, gpu low; logo, cinematic)_
- `logo:strokeFill` — **Stroke to Fill Logo**: Outline wordmark fills in. _(cpu low, gpu low; logo, outline)_
- `logo:kinetic` — **Kinetic Letters Logo**: Letters bounce in sequence. _(cpu low, gpu low; logo, kinetic, playful)_
- `logo:spinMark` — **Spin Mark Logo**: Mark spins in, wordmark follows. _(cpu low, gpu low; logo, dynamic)_
- `logo:pixelBuild` — **Pixel Build Logo**: Mark builds from pixels. _(cpu low, gpu low; logo, retro, gaming)_
- `logo:shutter` — **Shutter Logo**: Aperture blades open. _(cpu low, gpu low; logo, camera, photo)_
- `logo:burst` — **Burst Logo**: Radial burst behind the logo. _(cpu low, gpu low; logo, celebration)_
- `logo:inkReveal` — **Ink Reveal Logo**: Ink blot mask reveal. _(cpu low, gpu low; logo, organic, artistic)_
- `logo:gradientFlow` — **Gradient Flow Logo**: Flowing gradient wordmark. _(cpu low, gpu low; logo, saas, vibrant)_
- `logo:pulseRings` — **Pulse Rings Logo**: Sonar rings emanate from the mark. _(cpu low, gpu low; logo, tech, signal)_

## material

- `material:glass` — **Glass**: Glass physically-based material. _(cpu low, gpu medium; material, glass, premium)_
- `material:frostedGlass` — **Frosted Glass**: Frosted Glass physically-based material. _(cpu low, gpu medium; material, glass, frosted, soft)_
- `material:chrome` — **Chrome**: Chrome physically-based material. _(cpu low, gpu medium; material, chrome, metal, premium)_
- `material:metal` — **Brushed Metal**: Brushed Metal physically-based material. _(cpu low, gpu medium; material, metal, industrial)_
- `material:gold` — **Gold**: Gold physically-based material. _(cpu low, gpu medium; material, gold, luxury)_
- `material:silver` — **Silver**: Silver physically-based material. _(cpu low, gpu medium; material, silver, metal)_
- `material:copper` — **Copper**: Copper physically-based material. _(cpu low, gpu medium; material, copper, warm, metal)_
- `material:plastic` — **Plastic**: Plastic physically-based material. _(cpu low, gpu medium; material, plastic, product)_
- `material:matte` — **Matte**: Matte physically-based material. _(cpu low, gpu medium; material, matte, minimal)_
- `material:glossy` — **Glossy**: Glossy physically-based material. _(cpu low, gpu medium; material, glossy, candy)_
- `material:crystal` — **Crystal**: Crystal physically-based material. _(cpu low, gpu medium; material, crystal, gem, luxury)_
- `material:holographic` — **Holographic**: Holographic physically-based material. _(cpu low, gpu medium; material, holographic, futuristic)_
- `material:iridescent` — **Iridescent**: Iridescent physically-based material. _(cpu low, gpu medium; material, iridescent, soap)_
- `material:liquid` — **Liquid**: Liquid physically-based material. _(cpu low, gpu medium; material, liquid, water)_
- `material:emissive` — **Emissive**: Emissive physically-based material. _(cpu low, gpu medium; material, neon, glow, energy)_
- `material:wireframe` — **Wireframe**: Wireframe physically-based material. _(cpu low, gpu medium; material, wireframe, tech, blueprint)_
- `material:ceramic` — **Ceramic**: Ceramic physically-based material. _(cpu low, gpu medium; material, ceramic, clean)_
- `material:carbon` — **Carbon**: Carbon physically-based material. _(cpu low, gpu medium; material, carbon, sport, dark)_
- `material:pearl` — **Pearl**: Pearl physically-based material. _(cpu low, gpu medium; material, pearl, luxury, soft)_
- `material:obsidian` — **Obsidian**: Obsidian physically-based material. _(cpu low, gpu medium; material, dark, luxury, glossy)_

## motion

- `motion:fade` — **Fade**: Pure opacity fade. _(cpu low, gpu low; entrance, minimal, basic)_
- `motion:fadeUp` — **Fade Up**: Fade while rising from below. _(cpu low, gpu low; entrance, saas, basic)_
- `motion:fadeDown` — **Fade Down**: Fade while dropping from above. _(cpu low, gpu low; entrance, basic)_
- `motion:fadeLeft` — **Fade Left**: Fade in travelling leftwards. _(cpu low, gpu low; entrance, basic)_
- `motion:fadeRight` — **Fade Right**: Fade in travelling rightwards. _(cpu low, gpu low; entrance, basic)_
- `motion:slideUp` — **Slide Up**: Travel a long distance upward without fading. _(cpu low, gpu low; entrance, bold)_
- `motion:slideDown` — **Slide Down**: Travel from above. _(cpu low, gpu low; entrance, bold)_
- `motion:slideLeft` — **Slide Left**: Travel in from the right edge. _(cpu low, gpu low; entrance, bold)_
- `motion:slideRight` — **Slide Right**: Travel in from the left edge. _(cpu low, gpu low; entrance, bold)_
- `motion:riseIn` — **Rise**: Slow long rise with late fade. _(cpu low, gpu low; entrance, elegant, slow)_
- `motion:dropIn` — **Drop**: Falls under gravity and bounces to rest. _(cpu low, gpu low; entrance, playful, gravity)_
- `motion:scaleIn` — **Scale**: Scale from 85% with fade. _(cpu low, gpu low; entrance, basic)_
- `motion:scaleUp` — **Scale Up**: Grow from 40%. _(cpu low, gpu low; entrance, bold)_
- `motion:scaleDown` — **Scale Down**: Settle down from 140%. _(cpu low, gpu low; entrance, cinematic)_
- `motion:pop` — **Pop**: Quick overshoot pop. _(cpu low, gpu low; entrance, playful, ui)_
- `motion:springIn` — **Spring**: Physically simulated spring scale. _(cpu low, gpu low; entrance, physical, ui)_
- `motion:springUp` — **Spring Up**: Spring rise with overshoot and settle. _(cpu low, gpu low; entrance, physical, saas)_
- `motion:bounceIn` — **Bounce**: Scale with bounce settle. _(cpu low, gpu low; entrance, playful)_
- `motion:elasticIn` — **Elastic**: Elastic overshoot scale. _(cpu low, gpu low; entrance, playful, energetic)_
- `motion:unfold` — **Unfold**: Unfold vertically from a line. _(cpu low, gpu low; entrance, ui)_
- `motion:expandX` — **Expand X**: Expand horizontally from centre. _(cpu low, gpu low; entrance, ui, line)_
- `motion:stretchIn` — **Stretch**: Horizontal stretch with blur. _(cpu low, gpu low; entrance, futuristic)_
- `motion:squashIn` — **Squash & Stretch**: Classic squash then stretch. _(cpu low, gpu low; entrance, cartoon, playful)_
- `motion:jackInTheBox` — **Jack in the Box**: Scale with swinging rotation. _(cpu low, gpu low; entrance, playful)_
- `motion:heartbeatIn` — **Heartbeat**: Double pulse into place. _(cpu low, gpu low; entrance, emphasis)_
- `motion:blurIn` — **Blur**: Defocus to focus. _(cpu low, gpu low; entrance, cinematic, soft)_
- `motion:blurScale` — **Blur Scale**: Blur with scale settle. _(cpu low, gpu low; entrance, cinematic, premium)_
- `motion:blurUp` — **Blur Up**: Rise from blur (modern SaaS signature). _(cpu low, gpu low; entrance, saas, modern)_
- `motion:zoomBlur` — **Zoom Blur**: Rush in from the camera. _(cpu low, gpu low; entrance, energetic)_
- `motion:focusPull` — **Focus Pull**: Slow rack-focus reveal. _(cpu low, gpu low; entrance, cinematic, film)_
- `motion:maskUp` — **Mask Up**: Revealed by a mask rising. _(cpu low, gpu low; entrance, editorial, text)_
- `motion:maskDown` — **Mask Down**: Revealed from the top. _(cpu low, gpu low; entrance, editorial)_
- `motion:maskLeft` — **Mask Left**: Revealed right-to-left. _(cpu low, gpu low; entrance, editorial)_
- `motion:maskRight` — **Mask Right**: Revealed left-to-right. _(cpu low, gpu low; entrance, editorial)_
- `motion:wipeRight` — **Wipe Right**: Hard wipe revealing to the right with slide. _(cpu low, gpu low; entrance, clean)_
- `motion:wipeLeft` — **Wipe Left**: Hard wipe revealing to the left with slide. _(cpu low, gpu low; entrance, clean)_
- `motion:wipeUp` — **Wipe Up**: Vertical wipe upward. _(cpu low, gpu low; entrance, clean)_
- `motion:wipeDown` — **Wipe Down**: Vertical wipe downward. _(cpu low, gpu low; entrance, clean)_
- `motion:circleReveal` — **Iris**: Circular iris opening. _(cpu low, gpu low; entrance, cinematic)_
- `motion:diamondReveal` — **Diamond**: Diamond aperture. _(cpu low, gpu low; entrance, geometric)_
- `motion:curtain` — **Curtain**: Opens from the centre outward. _(cpu low, gpu low; entrance, theatrical)_
- `motion:blinds` — **Blinds**: Opens vertically from centre. _(cpu low, gpu low; entrance, theatrical)_
- `motion:rotateIn` — **Rotate**: Rotate into place. _(cpu low, gpu low; entrance, playful)_
- `motion:rotateInLeft` — **Rotate from Left**: Pivot in from the left. _(cpu low, gpu low; entrance, dynamic)_
- `motion:spinIn` — **Spin**: Full spin with scale. _(cpu low, gpu low; entrance, energetic)_
- `motion:flipX` — **Flip X**: Flip around the vertical axis. _(cpu low, gpu low; entrance, 3d, card)_
- `motion:flipY` — **Flip Y**: Flip around the horizontal axis. _(cpu low, gpu low; entrance, 3d, card)_
- `motion:flipUp3D` — **Flip Up 3D**: Tilt up from perspective. _(cpu low, gpu low; entrance, 3d, text)_
- `motion:perspectiveIn` — **Perspective**: Swing in with perspective. _(cpu low, gpu low; entrance, 3d, premium)_
- `motion:swingIn` — **Swing**: Hinged swing settle. _(cpu low, gpu low; entrance, playful)_
- `motion:tiltIn` — **Tilt**: Small tilt settle. _(cpu low, gpu low; entrance, subtle)_
- `motion:rollIn` — **Roll**: Roll in from the left. _(cpu low, gpu low; entrance, playful)_
- `motion:orbitIn` — **Orbit In**: Travel an arc into place. _(cpu low, gpu low; entrance, space)_
- `motion:spiralIn` — **Spiral**: Spiral inwards. _(cpu low, gpu low; entrance, space, energetic)_
- `motion:skewIn` — **Skew**: Skewed entry that straightens. _(cpu low, gpu low; entrance, dynamic)_
- `motion:lightSpeedIn` — **Light Speed**: Fast skewed streak. _(cpu low, gpu low; entrance, fast)_
- `motion:whipLeft` — **Whip Left**: Motion-blurred whip from the right. _(cpu low, gpu low; entrance, fast, transition)_
- `motion:whipRight` — **Whip Right**: Motion-blurred whip from the left. _(cpu low, gpu low; entrance, fast, transition)_
- `motion:shutterIn` — **Shutter**: Stepped shutter reveal. _(cpu low, gpu low; entrance, tech)_
- `motion:backIn` — **Anticipate**: Pulls back before launching in. _(cpu low, gpu low; entrance, character)_
- `motion:glitchIn` — **Glitch**: Digital glitch with RGB split. _(cpu low, gpu low; entrance, tech, cyber)_
- `motion:distortIn` — **Distort**: Warped skew and stretch settle. _(cpu low, gpu low; entrance, experimental)_
- `motion:rgbSplitIn` — **RGB Split**: Chromatic separation converging. _(cpu low, gpu low; entrance, tech, music)_
- `motion:flicker` — **Flicker**: Neon tube flicker on. _(cpu low, gpu low; entrance, neon, retro)_
- `motion:pixelateIn` — **Pixelate**: Stepped blur resolve. _(cpu low, gpu low; entrance, retro, tech)_
- `motion:scanIn` — **Scan**: HUD scan line reveal. _(cpu low, gpu low; entrance, tech, hud)_
- `motion:dissolveIn` — **Dissolve**: Noisy dissolve. _(cpu low, gpu low; entrance, soft)_
- `motion:cinematic` — **Cinematic**: Slow blur, rise and exposure settle. _(cpu low, gpu low; entrance, cinematic, premium, film)_
- `motion:minimal` — **Minimal**: Barely-there 8px lift. _(cpu low, gpu low; entrance, minimal, clean)_
- `motion:saas` — **SaaS**: Lift + blur with emphasized easing. _(cpu low, gpu low; entrance, saas, modern, product)_
- `motion:tech` — **Tech**: Quantized HUD reveal. _(cpu low, gpu low; entrance, tech, hud)_
- `motion:luxury` — **Luxury**: Slow exposure and gentle scale settle. _(cpu low, gpu low; entrance, luxury, premium, elegant)_
- `motion:editorial` — **Editorial**: Masked rise with slight skew. _(cpu low, gpu low; entrance, editorial, magazine)_
- `motion:futuristic` — **Futuristic**: Stretched blur resolving with chroma. _(cpu low, gpu low; entrance, futuristic, tech, ai)_
- `motion:hero` — **Hero**: Large confident rise. _(cpu low, gpu low; entrance, hero, landing)_
- `motion:dramatic` — **Dramatic**: Dark to bright zoom from far. _(cpu low, gpu low; entrance, cinematic, dramatic)_
- `motion:playful` — **Playful**: Pop with tilt. _(cpu low, gpu low; entrance, playful, social)_
- `motion:corporate` — **Corporate**: Measured fade-left. _(cpu low, gpu low; entrance, corporate, clean)_
- `motion:social` — **Social**: Punchy snap for short-form. _(cpu low, gpu low; entrance, social, shorts, fast)_
- `motion:magnetic` — **Magnetic**: Attracted into place with damped oscillation. _(cpu low, gpu low; entrance, interactive)_
- `motion:parallax` — **Parallax**: Depth-staggered travel. _(cpu low, gpu low; entrance, depth)_
- `motion:float` — **Float In**: Weightless float into position. _(cpu low, gpu low; entrance, soft)_
- `motion:zoomIn` — **Zoom In**: Zoom from small. _(cpu low, gpu low; entrance, basic)_
- `motion:zoomOut` — **Zoom Out**: Zoom from large. _(cpu low, gpu low; entrance, basic)_
- `motion:floatLoop` — **Float**: Gentle vertical float. _(cpu low, gpu low; loop, ambient, 3d)_
- `motion:bob` — **Bob**: Quick bob. _(cpu low, gpu low; loop, ambient)_
- `motion:orbit` — **Orbit**: Circular orbit path. _(cpu low, gpu low; loop, space)_
- `motion:pulse` — **Pulse**: Scale pulse. _(cpu low, gpu low; loop, emphasis)_
- `motion:breathe` — **Breathe**: Slow breathing scale and opacity. _(cpu low, gpu low; loop, ambient, calm)_
- `motion:wiggle` — **Wiggle**: Noise wiggle. _(cpu low, gpu low; loop, playful)_
- `motion:shake` — **Shake**: Horizontal shake. _(cpu low, gpu low; loop, emphasis, error)_
- `motion:jitter` — **Jitter**: Random positional jitter. _(cpu low, gpu low; loop, tech, glitch)_
- `motion:swing` — **Swing**: Pendulum swing. _(cpu low, gpu low; loop, playful)_
- `motion:spin` — **Spin**: Continuous rotation. _(cpu low, gpu low; loop, loader)_
- `motion:spinSlow` — **Slow Spin**: Slow continuous rotation. _(cpu low, gpu low; loop, ambient)_
- `motion:heartbeat` — **Heartbeat**: Double-beat scale. _(cpu low, gpu low; loop, emphasis)_
- `motion:flickerLoop` — **Flicker**: Occasional neon flicker. _(cpu low, gpu low; loop, neon)_
- `motion:glitchLoop` — **Glitch**: Periodic glitch bursts. _(cpu low, gpu low; loop, cyber)_
- `motion:parallaxDrift` — **Parallax Drift**: Slow lissajous drift. _(cpu low, gpu low; loop, depth, ambient)_
- `motion:magneticDrift` — **Magnetic Drift**: Organic noise drift. _(cpu low, gpu low; loop, interactive)_
- `motion:hover` — **Hover**: Float + subtle tilt. _(cpu low, gpu low; loop, ui, 3d)_
- `motion:tada` — **Tada**: Attention seeker. _(cpu low, gpu low; loop, emphasis)_
- `motion:rubberBand` — **Rubber Band**: Elastic stretch. _(cpu low, gpu low; loop, playful)_
- `motion:jello` — **Jello**: Jello skew wobble. _(cpu low, gpu low; loop, playful)_
- `motion:wobble` — **Wobble**: Side wobble. _(cpu low, gpu low; loop, playful)_
- `motion:headShake` — **Head Shake**: No-no shake. _(cpu low, gpu low; loop, emphasis)_
- `motion:blink` — **Blink**: Cursor blink. _(cpu low, gpu low; loop, ui)_
- `motion:glowPulse` — **Glow Pulse**: Brightness pulse. _(cpu low, gpu low; loop, neon, energy)_
- `motion:sway` — **Sway**: Wind sway. _(cpu low, gpu low; loop, ambient)_
- `motion:levitate` — **Levitate**: Float with breathing scale. _(cpu low, gpu low; loop, 3d, product)_
- `motion:tilt3D` — **Tilt 3D**: Card tilt in 3D. _(cpu low, gpu low; loop, 3d, card)_
- `motion:rock` — **Rock**: Rocking boat. _(cpu low, gpu low; loop, ambient)_
- `motion:driftX` — **Drift X**: Endless horizontal drift. _(cpu low, gpu low; loop, ambient)_
- `motion:driftY` — **Drift Y**: Endless vertical drift. _(cpu low, gpu low; loop, ambient)_
- `motion:handheld` — **Handheld**: Handheld camera micro-shake. _(cpu low, gpu low; loop, cinematic, camera)_
- `motion:kenBurns` — **Ken Burns**: Slow push in and pan. _(cpu low, gpu low; loop, cinematic, photo)_

## node

- `node:scene-logo` — **Story: Logo Reveal**: Brand logo animation. _(cpu medium, gpu low; story, scene, logo)_
- `node:scene-hook` — **Story: Hook**: Big attention-grabbing statement. _(cpu medium, gpu low; story, scene, hook)_
- `node:scene-title` — **Story: Title**: Headline with supporting subtitle. _(cpu medium, gpu low; story, scene, title)_
- `node:scene-problem` — **Story: Problem**: Pain point with strike-through emphasis. _(cpu medium, gpu low; story, scene, problem)_
- `node:scene-statement` — **Story: Statement**: Editorial statement with masked lines. _(cpu medium, gpu low; story, scene, statement)_
- `node:scene-aiPrompt` — **Story: AI Prompt**: Prompt being typed into an AI interface. _(cpu medium, gpu low; story, scene, demo)_
- `node:scene-aiProcessing` — **Story: AI Processing**: Neural visualization while AI thinks. _(cpu medium, gpu low; story, scene, process)_
- `node:scene-product` — **Story: Product**: Product in a device/browser with copy (responsive row/stack). _(cpu medium, gpu low; story, scene, product)_
- `node:scene-dashboard` — **Story: Dashboard Demo**: Full animated SaaS dashboard in a browser. _(cpu medium, gpu low; story, scene, demo)_
- `node:scene-features` — **Story: Features**: Feature cards with staggered entrance (grid adapts). _(cpu medium, gpu low; story, scene, feature)_
- `node:scene-metrics` — **Story: Metrics**: KPI counters and a growth chart. _(cpu medium, gpu low; story, scene, statistic)_
- `node:scene-statistic` — **Story: Big Statistic**: One huge counting number. _(cpu medium, gpu low; story, scene, statistic)_
- `node:scene-comparison` — **Story: Comparison**: Before/after comparison bars. _(cpu medium, gpu low; story, scene, comparison)_
- `node:scene-testimonial` — **Story: Testimonial**: Customer quote with stars. _(cpu medium, gpu low; story, scene, testimonial)_
- `node:scene-process` — **Story: Process**: Workflow graph of steps. _(cpu medium, gpu low; story, scene, process)_
- `node:scene-automation` — **Story: Automation**: Agent run checklist completing. _(cpu medium, gpu low; story, scene, demo)_
- `node:scene-phone` — **Story: App Showcase**: Phone mockup with floating notification. _(cpu medium, gpu low; story, scene, product)_
- `node:scene-product3d` — **Story: 3D Product**: Glass 3D hero object with copy. _(cpu medium, gpu low; story, scene, product)_
- `node:scene-result` — **Story: Result**: Outcome with progress ring. _(cpu medium, gpu low; story, scene, result)_
- `node:scene-cta` — **Story: Call to Action**: Brand + CTA button + URL. _(cpu medium, gpu low; story, scene, cta)_
- `node:scene-outro` — **Story: Outro**: Logo end card with tagline. _(cpu medium, gpu low; story, scene, outro)_
- `node:scene-kinetic` — **Story: Kinetic Words**: Rapid kinetic typography sequence. _(cpu medium, gpu low; story, scene, statement)_
- `node:scene-pricing` — **Story: Pricing**: Pricing card spotlight. _(cpu medium, gpu low; story, scene, cta)_
- `node:scene-code` — **Story: Developer Code**: Code editor typing an API call. _(cpu medium, gpu low; story, scene, demo)_
- `node:scene-youtubeIntro` — **Story: YouTube Intro**: Fast channel intro with flash and burst logo. _(cpu medium, gpu low; story, scene, hook)_

## particles

- `particles:stars` — **Stars**: Twinkling parallax stars. _(cpu medium, gpu low; particles, drift, space, calm)_
- `particles:dust` — **Dust Motes**: Floating dust in a light beam. _(cpu medium, gpu low; particles, drift, cinematic, ambient)_
- `particles:sparks` — **Sparks**: Hot sparks shooting upward. _(cpu low, gpu low; particles, emitter, energy, fire, dramatic)_
- `particles:rain` — **Rain**: Slanted rain streaks. _(cpu medium, gpu low; particles, fall, weather, moody)_
- `particles:snow` — **Snow**: Soft falling snow with sway. _(cpu medium, gpu low; particles, fall, weather, winter, calm)_
- `particles:galaxy` — **Galaxy**: Spiral galaxy with rotating arms. _(cpu high, gpu low; particles, orbit, space, cosmic, hero)_
- `particles:neural` — **Neural Network**: Linked nodes like neurons firing. _(cpu low, gpu low; particles, network, ai, network, data)_
- `particles:data` — **Data Stream**: Horizontal packets of data. _(cpu low, gpu low; particles, drift, data, tech)_
- `particles:energy` — **Energy Vortex**: Energy spiralling into a core. _(cpu high, gpu low; particles, vortex, energy, portal)_
- `particles:magic` — **Magic Sparkles**: Twinkling sparkles rising gently. _(cpu low, gpu low; particles, rise, magic, fantasy)_
- `particles:smoke` — **Smoke**: Soft rolling smoke puffs. _(cpu low, gpu low; particles, rise, smoke, moody)_
- `particles:fire` — **Fire**: Flame particles with shrink and cool-down. _(cpu medium, gpu low; particles, rise, fire, warm)_
- `particles:fireflies` — **Fireflies**: Blinking fireflies wandering. _(cpu low, gpu low; particles, drift, nature, night, calm)_
- `particles:bubbles` — **Bubbles**: Rising outlined bubbles. _(cpu low, gpu low; particles, rise, water, playful)_
- `particles:confetti` — **Confetti**: Celebratory confetti burst. _(cpu medium, gpu low; particles, explode, celebration, social)_
- `particles:embers` — **Embers**: Slow drifting embers. _(cpu low, gpu low; particles, rise, fire, cinematic)_
- `particles:warp` — **Warp Drive**: Hyperspace streaks. _(cpu medium, gpu low; particles, warp, space, energetic)_
- `particles:vortex` — **Vortex**: Swirling vortex funnel. _(cpu high, gpu low; particles, vortex, hypnotic)_
- `particles:explosion` — **Explosion**: Radial burst with drag and trails. _(cpu medium, gpu low; particles, explode, dramatic, impact)_
- `particles:fountain` — **Fountain**: Arcing fountain under gravity. _(cpu medium, gpu low; particles, emitter, playful)_
- `particles:constellation` — **Constellation**: Sparse linked stars. _(cpu low, gpu low; particles, network, space, network, minimal)_
- `particles:flowField` — **Flow Field**: Particles traced along a noise field. _(cpu high, gpu low; particles, flow, fluid, generative, premium)_
- `particles:plankton` — **Bioluminescence**: Glowing plankton drifting in currents. _(cpu high, gpu low; particles, flow, water, nature)_
- `particles:meteorShower` — **Meteor Shower**: Streaking meteors with long trails. _(cpu low, gpu low; particles, fall, space, dramatic)_
- `particles:bokeh` — **Bokeh**: Large out-of-focus bokeh discs. _(cpu low, gpu low; particles, drift, cinematic, soft)_
- `particles:pollen` — **Pollen**: Pollen drifting on a breeze. _(cpu low, gpu low; particles, drift, nature, warm)_
- `particles:ash` — **Ash**: Falling ash flakes. _(cpu low, gpu low; particles, fall, moody, apocalyptic)_
- `particles:portal` — **Portal Ring**: Orbiting ring of particles. _(cpu high, gpu low; particles, orbit, portal, sci-fi)_
- `particles:dnaHelix` — **DNA Helix**: Double helix of particles. _(cpu low, gpu low; particles, helix, science, biotech)_
- `particles:swarm` — **Swarm**: A flocking swarm chasing a moving target. _(cpu medium, gpu low; particles, swarm, organic, ai)_
- `particles:heartBurst` — **Heart Burst**: Pink burst of hearts-like glow. _(cpu low, gpu low; particles, explode, love, social)_
- `particles:sparkleBurst` — **Sparkle Burst**: Golden twinkling burst. _(cpu low, gpu low; particles, explode, celebration, luxury)_
- `particles:orbitRings` — **Orbit Rings**: Particles on discrete orbital shells. _(cpu medium, gpu low; particles, orbit, space, atom)_
- `particles:lanterns` — **Sky Lanterns**: Lanterns rising slowly into the sky. _(cpu low, gpu low; particles, rise, warm, celebration)_

## shader

- `shader:liquid` — **Liquid Chrome**: Domain-warped liquid metal flow. _(cpu low, gpu high; shader, webgl, gpu, liquid, chrome)_
- `shader:noiseField` — **Noise Field**: Smooth fbm colour field. _(cpu low, gpu high; shader, webgl, gpu, noise, organic)_
- `shader:wave` — **Sine Waves**: Layered glowing sine waves. _(cpu low, gpu high; shader, webgl, gpu, waves, calm)_
- `shader:distortion` — **Warp Distortion**: Swirling UV distortion of colour bands. _(cpu low, gpu high; shader, webgl, gpu, distortion, psychedelic)_
- `shader:meshGradient` — **Shader Mesh Gradient**: GPU mesh gradient with grain. _(cpu low, gpu high; shader, webgl, gpu, gradient, saas)_
- `shader:hologram` — **Hologram**: Holographic interference with scanlines. _(cpu low, gpu high; shader, webgl, gpu, holographic, futuristic)_
- `shader:scanline` — **CRT Scanlines**: Rolling CRT scanlines over gradient. _(cpu low, gpu high; shader, webgl, gpu, retro, crt)_
- `shader:pixel` — **Pixel Mosaic**: Animated pixel mosaic. _(cpu low, gpu high; shader, webgl, gpu, pixel, retro)_
- `shader:dissolve` — **Dissolve**: Noise dissolve between two colours. _(cpu low, gpu high; shader, webgl, gpu, dissolve, transition)_
- `shader:energy` — **Energy Plasma**: Crackling energy tendrils. _(cpu low, gpu high; shader, webgl, gpu, energy, electric)_
- `shader:heat` — **Heat Haze**: Rising heat shimmer gradient. _(cpu low, gpu high; shader, webgl, gpu, heat, desert)_
- `shader:glass` — **Glass Refraction**: Fluted glass refraction bands. _(cpu low, gpu high; shader, webgl, gpu, glass, premium)_
- `shader:chromatic` — **Chromatic Rings**: Chromatic-dispersed concentric rings. _(cpu low, gpu high; shader, webgl, gpu, chromatic, prism)_
- `shader:glitchShader` — **Digital Glitch**: Block glitch displacement. _(cpu low, gpu high; shader, webgl, gpu, glitch, cyber)_
- `shader:terrain` — **Ridge Terrain**: Ridged noise mountain silhouettes. _(cpu low, gpu high; shader, webgl, gpu, terrain, landscape)_
- `shader:starfieldShader` — **Deep Starfield**: GPU starfield with nebula. _(cpu low, gpu high; shader, webgl, gpu, space, stars)_
- `shader:auroraShader` — **GPU Aurora**: Volumetric aurora curtains. _(cpu low, gpu high; shader, webgl, gpu, aurora, ai)_
- `shader:tunnel` — **Tunnel**: Infinite polar tunnel. _(cpu low, gpu high; shader, webgl, gpu, tunnel, hypnotic)_
- `shader:fire` — **Fire**: Procedural rising flames. _(cpu low, gpu high; shader, webgl, gpu, fire, warm)_
- `shader:caustics` — **Caustics**: Underwater light caustics. _(cpu low, gpu high; shader, webgl, gpu, water, pool)_
- `shader:silk` — **Silk**: Soft flowing silk folds. _(cpu low, gpu high; shader, webgl, gpu, silk, luxury)_
- `shader:lava` — **Lava Lamp**: Smooth metaball lava. _(cpu low, gpu high; shader, webgl, gpu, lava, retro)_

## shape

- `shape:shape-circle` — **Circle Shape**: Morphable, drawable circle. _(cpu low, gpu low; shape, vector, circle)_
- `shape:shape-rect` — **Rect Shape**: Morphable, drawable rect. _(cpu low, gpu low; shape, vector, rect)_
- `shape:shape-roundedRect` — **RoundedRect Shape**: Morphable, drawable roundedRect. _(cpu low, gpu low; shape, vector, roundedRect)_
- `shape:shape-triangle` — **Triangle Shape**: Morphable, drawable triangle. _(cpu low, gpu low; shape, vector, triangle)_
- `shape:shape-polygon` — **Polygon Shape**: Morphable, drawable polygon. _(cpu low, gpu low; shape, vector, polygon)_
- `shape:shape-star` — **Star Shape**: Morphable, drawable star. _(cpu low, gpu low; shape, vector, star)_
- `shape:shape-line` — **Line Shape**: Morphable, drawable line. _(cpu low, gpu low; shape, vector, line)_
- `shape:shape-arrow` — **Arrow Shape**: Morphable, drawable arrow. _(cpu low, gpu low; shape, vector, arrow)_
- `shape:shape-ring` — **Ring Shape**: Morphable, drawable ring. _(cpu low, gpu low; shape, vector, ring)_
- `shape:shape-blob` — **Blob Shape**: Morphable, drawable blob. _(cpu low, gpu low; shape, vector, blob)_
- `shape:shape-capsule` — **Capsule Shape**: Morphable, drawable capsule. _(cpu low, gpu low; shape, vector, capsule)_
- `shape:shape-heart` — **Heart Shape**: Morphable, drawable heart. _(cpu low, gpu low; shape, vector, heart)_
- `shape:shape-cross` — **Cross Shape**: Morphable, drawable cross. _(cpu low, gpu low; shape, vector, cross)_
- `shape:shape-spiral` — **Spiral Shape**: Morphable, drawable spiral. _(cpu low, gpu low; shape, vector, spiral)_
- `shape:shape-wave` — **Wave Shape**: Morphable, drawable wave. _(cpu low, gpu low; shape, vector, wave)_
- `shape:shape-hexagon` — **Hexagon Shape**: Morphable, drawable hexagon. _(cpu low, gpu low; shape, vector, hexagon)_
- `shape:shape-diamond` — **Diamond Shape**: Morphable, drawable diamond. _(cpu low, gpu low; shape, vector, diamond)_
- `shape:shape-burst` — **Burst Shape**: Morphable, drawable burst. _(cpu low, gpu low; shape, vector, burst)_
- `shape:shape-check` — **Check Shape**: Morphable, drawable check. _(cpu low, gpu low; shape, vector, check)_
- `shape:shape-infinity` — **Infinity Shape**: Morphable, drawable infinity. _(cpu low, gpu low; shape, vector, infinity)_
- `shape:shape-path` — **Path Shape**: Morphable, drawable path. _(cpu low, gpu low; shape, vector, path)_

## template

- `template:productLaunch` — **Product Launch**: Logo → Hook → Product → Features → UI → Metrics → CTA. _(cpu medium, gpu medium; saas, horizontal, saas, launch, product)_
- `template:aiLaunch` — **AI Launch**: Prompt → AI processing → result → dashboard → automation → CTA. _(cpu medium, gpu medium; ai, horizontal, ai, launch, futuristic)_
- `template:startupStory` — **Startup Story**: Problem → insight → solution → product → differentiation → CTA. _(cpu medium, gpu medium; startup, horizontal, startup, pitch, story)_
- `template:appPromo` — **App Promo**: Phone → UI → features → social proof → CTA. _(cpu medium, gpu medium; app, vertical, app, mobile, social)_
- `template:futuristicAd` — **Futuristic AI SaaS Ad**: 7-scene premium AI advertisement: hook, problem, AI viz, product UI, features, metrics, CTA. _(cpu medium, gpu medium; ai, horizontal, ai, saas, premium)_
- `template:logoRevealCinematic` — **Cinematic Logo Reveal**: Cinematic logo reveal with light rays and letterbox. _(cpu medium, gpu medium; cinematic, horizontal, logo, cinematic, intro)_
- `template:youtubeIntro` — **YouTube Intro**: Punchy 4-second channel intro. _(cpu medium, gpu medium; youtube, horizontal, youtube, intro, fast)_
- `template:shortsHook` — **Shorts Hook**: Vertical kinetic hook → stat → CTA for Shorts/Reels/TikTok. _(cpu medium, gpu medium; shorts, vertical, shorts, vertical, social)_
- `template:reelsProduct` — **Reels Product**: Vertical product reveal with 3D hero. _(cpu medium, gpu medium; reels, vertical, reels, vertical, product)_
- `template:tiktokExplainer` — **TikTok Explainer**: Problem → process → result, vertical. _(cpu medium, gpu medium; tiktok, vertical, tiktok, vertical, explainer)_
- `template:explainer` — **Explainer**: Title → problem → process → result → CTA. _(cpu medium, gpu medium; explainer, horizontal, explainer, education, process)_
- `template:education` — **Course Trailer**: Hook → what you'll learn → stats → testimonial → CTA. _(cpu medium, gpu medium; education, horizontal, education, course, learning)_
- `template:financeReport` — **Finance Report**: Metrics, comparison and results for investor updates. _(cpu medium, gpu medium; finance, horizontal, finance, data, report)_
- `template:techKeynote` — **Tech Keynote**: Keynote-style 3D product reveal. _(cpu medium, gpu medium; technology, horizontal, tech, keynote, 3d)_
- `template:cyberSecurity` — **Cyber Security**: Threat → detection → dashboard → CTA with glitch language. _(cpu medium, gpu medium; cyber, horizontal, cyber, security, hacker)_
- `template:luxuryBrand` — **Luxury Brand Film**: Slow gold typography, 3D gold object and logo. _(cpu medium, gpu medium; luxury, horizontal, luxury, gold, premium)_
- `template:minimalLaunch` — **Minimal Launch**: Understated launch with clean grid and typography. _(cpu medium, gpu medium; minimal, horizontal, minimal, clean, launch)_
- `template:editorialStory` — **Editorial Story**: Magazine-style statements with masked lines. _(cpu medium, gpu medium; editorial, horizontal, editorial, magazine, story)_
- `template:gamingTrailer` — **Gaming Trailer**: High-energy tunnel, zoom cuts and burst logo. _(cpu medium, gpu medium; gaming, horizontal, gaming, energetic, trailer)_
- `template:dataStory` — **Data Story**: Data-driven narrative with charts and counters. _(cpu medium, gpu medium; data, horizontal, data, charts, analytics)_
- `template:cinematicTrailer` — **Cinematic Trailer**: Letterboxed trailer: hook, statement, product, logo. _(cpu medium, gpu medium; cinematic, horizontal, cinematic, trailer, film)_
- `template:corporatePresentation` — **Corporate Presentation**: Title, process, metrics, testimonial, outro. _(cpu medium, gpu medium; corporate, horizontal, corporate, presentation, business)_
- `template:saasSquare` — **SaaS Feed Ad (1:1)**: Square feed ad for LinkedIn/Instagram. _(cpu medium, gpu medium; saas, square, saas, social, square)_
- `template:saasVertical` — **SaaS Story Ad (9:16)**: Vertical story ad for SaaS. _(cpu medium, gpu medium; saas, vertical, saas, vertical, stories)_
- `template:featureSpotlight` — **Feature Spotlight**: Single-feature release announcement. _(cpu medium, gpu medium; saas, horizontal, saas, feature, release)_
- `template:devTool` — **Developer Tool**: Code editor, terminal feel, metrics. _(cpu medium, gpu medium; technology, horizontal, developer, api, code)_
- `template:pricingPromo` — **Pricing Promo**: Hook → features → pricing → CTA. _(cpu medium, gpu medium; saas, horizontal, pricing, offer, conversion)_
- `template:testimonialAd` — **Customer Story**: Customer quote, results and CTA. _(cpu medium, gpu medium; corporate, horizontal, testimonial, social-proof, case-study)_
- `template:fintechApp` — **Fintech App**: Mobile banking app promo. _(cpu medium, gpu medium; finance, vertical, fintech, app, mobile)_
- `template:productHunt` — **Product Hunt Launch**: Launch-day teaser: logo, hook, dashboard, CTA. _(cpu medium, gpu medium; startup, horizontal, launch, startup, product-hunt)_
- `template:neonEvent` — **Neon Event Promo**: Neon event/music promo with beat-synced visuals. _(cpu medium, gpu medium; gaming, square, event, neon, music)_
- `template:ai3dReveal` — **AI 3D Reveal**: Holographic 3D core, AI prompt, CTA. _(cpu medium, gpu medium; ai, horizontal, ai, 3d, reveal)_

## theme

- `theme:midnight` — **Midnight**: Midnight design-token theme (SAAS typography). _(cpu low, gpu low; theme, dark, saas, premium)_
- `theme:aurora` — **Aurora AI**: Aurora AI design-token theme (SAAS typography). _(cpu low, gpu low; theme, ai, dark, futuristic)_
- `theme:luxury` — **Dark Luxury**: Dark Luxury design-token theme (LUXURY typography). _(cpu low, gpu low; theme, luxury, premium, gold)_
- `theme:editorial` — **Editorial**: Editorial design-token theme (EDITORIAL typography). _(cpu low, gpu low; theme, editorial, light, magazine)_
- `theme:cyber` — **Cyber**: Cyber design-token theme (FUTURISTIC typography). _(cpu low, gpu low; theme, cyber, neon, futuristic, gaming)_
- `theme:corporate` — **Corporate**: Corporate design-token theme (CORPORATE typography). _(cpu low, gpu low; theme, corporate, light, business)_
- `theme:pastel` — **Pastel**: Pastel design-token theme (MINIMAL typography). _(cpu low, gpu low; theme, pastel, light, friendly)_
- `theme:mono` — **Monochrome**: Monochrome design-token theme (MINIMAL typography). _(cpu low, gpu low; theme, minimal, monochrome, dark)_
- `theme:neon` — **Neon Night**: Neon Night design-token theme (TECH typography). _(cpu low, gpu low; theme, neon, dark, music)_
- `theme:cinema` — **Cinematic**: Cinematic design-token theme (CINEMATIC typography). _(cpu low, gpu low; theme, cinematic, film, dramatic)_
- `theme:light` — **Clean Light**: Clean Light design-token theme (SAAS typography). _(cpu low, gpu low; theme, light, saas, minimal)_
- `theme:finance` — **Finance**: Finance design-token theme (CORPORATE typography). _(cpu low, gpu low; theme, finance, data, dark)_

## three

- `three:object-sphere` — **3D sphere**: Parametric sphere object. _(cpu low, gpu medium; 3d, object, sphere)_
- `three:object-cube` — **3D cube**: Parametric cube object. _(cpu low, gpu medium; 3d, object, cube)_
- `three:object-torus` — **3D torus**: Parametric torus object. _(cpu low, gpu medium; 3d, object, torus)_
- `three:object-torusKnot` — **3D torusKnot**: Parametric torusKnot object. _(cpu low, gpu medium; 3d, object, torusKnot)_
- `three:object-cylinder` — **3D cylinder**: Parametric cylinder object. _(cpu low, gpu medium; 3d, object, cylinder)_
- `three:object-cone` — **3D cone**: Parametric cone object. _(cpu low, gpu medium; 3d, object, cone)_
- `three:object-capsule` — **3D capsule**: Parametric capsule object. _(cpu low, gpu medium; 3d, object, capsule)_
- `three:object-plane` — **3D plane**: Parametric plane object. _(cpu low, gpu medium; 3d, object, plane)_
- `three:object-icosahedron` — **3D icosahedron**: Parametric icosahedron object. _(cpu low, gpu medium; 3d, object, icosahedron)_
- `three:object-octahedron` — **3D octahedron**: Parametric octahedron object. _(cpu low, gpu medium; 3d, object, octahedron)_
- `three:object-dodecahedron` — **3D dodecahedron**: Parametric dodecahedron object. _(cpu low, gpu medium; 3d, object, dodecahedron)_
- `three:object-ring` — **3D ring**: Parametric ring object. _(cpu low, gpu medium; 3d, object, ring)_
- `three:object-tube` — **3D tube**: Parametric tube object. _(cpu low, gpu medium; 3d, object, tube)_
- `three:object-star` — **3D star**: Parametric star object. _(cpu low, gpu medium; 3d, object, star)_
- `three:object-hexPrism` — **3D hexPrism**: Parametric hexPrism object. _(cpu low, gpu medium; 3d, object, hexPrism)_
- `three:object-heart` — **3D heart**: Parametric heart object. _(cpu low, gpu medium; 3d, object, heart)_
- `three:object-blob` — **3D blob**: Parametric blob object. _(cpu low, gpu medium; 3d, object, blob)_
- `three:anim-heroFloat` — **3D heroFloat**: 3D animation preset: heroFloat. _(cpu medium, gpu medium; 3d, animation, heroFloat)_
- `three:anim-turntable` — **3D turntable**: 3D animation preset: turntable. _(cpu medium, gpu medium; 3d, animation, turntable)_
- `three:anim-tumble` — **3D tumble**: 3D animation preset: tumble. _(cpu medium, gpu medium; 3d, animation, tumble)_
- `three:anim-orbit` — **3D orbit**: 3D animation preset: orbit. _(cpu medium, gpu medium; 3d, animation, orbit)_
- `three:anim-pulse` — **3D pulse**: 3D animation preset: pulse. _(cpu medium, gpu medium; 3d, animation, pulse)_
- `three:anim-reveal` — **3D reveal**: 3D animation preset: reveal. _(cpu medium, gpu medium; 3d, animation, reveal)_
- `three:anim-wave` — **3D wave**: 3D animation preset: wave. _(cpu medium, gpu medium; 3d, animation, wave)_
- `three:anim-explode` — **3D explode**: 3D animation preset: explode. _(cpu medium, gpu medium; 3d, animation, explode)_
- `three:physics-stack` — **Physics: stack**: Rapier rigid-body simulation (stack), deterministic & scrubbable. _(cpu high, gpu medium; physics, 3d, stack)_
- `three:physics-drop` — **Physics: drop**: Rapier rigid-body simulation (drop), deterministic & scrubbable. _(cpu high, gpu medium; physics, 3d, drop)_
- `three:physics-explosion` — **Physics: explosion**: Rapier rigid-body simulation (explosion), deterministic & scrubbable. _(cpu high, gpu medium; physics, 3d, explosion)_
- `three:physics-dominoes` — **Physics: dominoes**: Rapier rigid-body simulation (dominoes), deterministic & scrubbable. _(cpu high, gpu medium; physics, 3d, dominoes)_
- `three:physics-attractor` — **Physics: attractor**: Rapier rigid-body simulation (attractor), deterministic & scrubbable. _(cpu high, gpu medium; physics, 3d, attractor)_
- `three:physics-pyramid` — **Physics: pyramid**: Rapier rigid-body simulation (pyramid), deterministic & scrubbable. _(cpu high, gpu medium; physics, 3d, pyramid)_

## transition

- `transition:cut` — **Cut**: Instant cut at the midpoint. _(cpu medium, gpu low; basic, hard, fast)_
- `transition:fade` — **Fade Through Black**: Fade out to black then in. _(cpu medium, gpu low; basic, classic)_
- `transition:fadeWhite` — **Fade Through White**: Fade through white. _(cpu medium, gpu low; basic, bright, dreamy)_
- `transition:crossfade` — **Crossfade**: Dissolve A into B. _(cpu medium, gpu low; basic, smooth, minimal)_
- `transition:blur` — **Blur Dissolve**: Defocus out, refocus in. _(cpu medium, gpu low; basic, soft, cinematic)_
- `transition:flash` — **Flash**: White flash cut. _(cpu medium, gpu low; light, impact, music)_
- `transition:dipColor` — **Dip to Color**: Dip through a brand colour. _(cpu medium, gpu low; basic, brand)_
- `transition:slideLeft` — **Slide Left**: B slides over from the right. _(cpu medium, gpu low; motion, slide)_
- `transition:slideRight` — **Slide Right**: B slides over from the left. _(cpu medium, gpu low; motion, slide)_
- `transition:slideUp` — **Slide Up**: B slides up over A. _(cpu medium, gpu low; motion, slide, social)_
- `transition:slideDown` — **Slide Down**: B slides down over A. _(cpu medium, gpu low; motion, slide)_
- `transition:pushLeft` — **Push Left**: B pushes A out to the left. _(cpu medium, gpu low; motion, push)_
- `transition:pushRight` — **Push Right**: B pushes A out to the right. _(cpu medium, gpu low; motion, push)_
- `transition:pushUp` — **Push Up**: B pushes A upward. _(cpu medium, gpu low; motion, push, vertical)_
- `transition:pushDown` — **Push Down**: B pushes A downward. _(cpu medium, gpu low; motion, push)_
- `transition:whip` — **Whip Pan**: Motion-blurred whip pan. _(cpu medium, gpu low; motion, fast, energetic, youtube)_
- `transition:zoomIn` — **Zoom Through**: Zoom into A and out of B. _(cpu medium, gpu low; motion, zoom, energetic)_
- `transition:zoomOut` — **Zoom Out**: A shrinks away revealing B. _(cpu medium, gpu low; motion, zoom)_
- `transition:camera` — **Camera Move**: Parallax camera dolly between scenes. _(cpu medium, gpu low; motion, camera, cinematic)_
- `transition:spin` — **Spin**: Rotating swap. _(cpu medium, gpu low; motion, playful)_
- `transition:stretch` — **Stretch**: Horizontal stretch swap. _(cpu medium, gpu low; motion, elastic)_
- `transition:wipeLeft` — **Wipe Left**: Hard edge wipe right-to-left. _(cpu medium, gpu low; mask, wipe, clean)_
- `transition:wipeRight` — **Wipe Right**: Hard edge wipe left-to-right. _(cpu medium, gpu low; mask, wipe, clean)_
- `transition:wipeUp` — **Wipe Up**: Vertical wipe upward. _(cpu medium, gpu low; mask, wipe)_
- `transition:wipeDiagonal` — **Diagonal Wipe**: Angled wipe. _(cpu medium, gpu low; mask, wipe, dynamic)_
- `transition:softWipe` — **Soft Wipe**: Feathered gradient wipe. _(cpu medium, gpu low; mask, soft, premium)_
- `transition:iris` — **Iris**: Circular iris open. _(cpu medium, gpu low; mask, circle, cinematic)_
- `transition:irisClose` — **Iris Close**: Close iris on A, open on B. _(cpu medium, gpu low; mask, circle, retro)_
- `transition:diamond` — **Diamond**: Diamond aperture. _(cpu medium, gpu low; mask, geometric)_
- `transition:barn` — **Barn Doors**: Split open from centre. _(cpu medium, gpu low; mask, doors, reveal)_
- `transition:blinds` — **Venetian Blinds**: Horizontal blinds reveal. _(cpu medium, gpu low; mask, pattern)_
- `transition:stripes` — **Stripe Reveal**: Staggered vertical stripes. _(cpu medium, gpu low; mask, pattern, dynamic)_
- `transition:checker` — **Checkerboard**: Checker tiles reveal. _(cpu medium, gpu low; mask, pattern, retro)_
- `transition:shapeMorph` — **Shape Morph**: Rounded shape grows from centre to fill. _(cpu medium, gpu low; mask, shape, brand)_
- `transition:clock` — **Clock Wipe**: Radial clock sweep. _(cpu medium, gpu low; mask, radial, retro)_
- `transition:ink` — **Ink Spread**: Organic ink blobs spreading. _(cpu medium, gpu low; organic, ink, organic, artistic)_
- `transition:flip` — **Flip**: Card flip around Y axis. _(cpu medium, gpu low; 3d, 3d, card)_
- `transition:flipVertical` — **Flip Vertical**: Flip around X axis. _(cpu medium, gpu low; 3d, 3d)_
- `transition:cube` — **Cube Rotate**: Faux 3D cube rotation. _(cpu medium, gpu low; 3d, 3d, cube)_
- `transition:doorway` — **Doorway**: Doors swing open to reveal B pushing in. _(cpu medium, gpu low; 3d, 3d, reveal)_
- `transition:pageTurn` — **Page Turn**: Page curl across. _(cpu medium, gpu low; 3d, editorial, book)_
- `transition:glitch` — **Glitch**: Slice displacement + RGB split swap. _(cpu medium, gpu low; digital, glitch, cyber, tech)_
- `transition:pixel` — **Pixelate**: Pixelate out then in. _(cpu medium, gpu low; digital, retro, 8bit)_
- `transition:scanReveal` — **Scan Reveal**: Bright scanline sweeping down revealing B. _(cpu medium, gpu low; digital, hud, tech)_
- `transition:dataMosh` — **Datamosh**: Smeared block datamosh. _(cpu medium, gpu low; digital, glitch, experimental)_
- `transition:noiseDissolve` — **Noise Dissolve**: Blocky noise dissolve. _(cpu medium, gpu low; digital, dissolve, organic)_
- `transition:liquid` — **Liquid**: Wavy liquid edge sweeping upward. _(cpu medium, gpu low; organic, liquid, fluid, premium)_
- `transition:wave` — **Wave**: Sine-displaced rows during swap. _(cpu medium, gpu low; organic, wave)_
- `transition:particle` — **Particle Dissolve**: A disintegrates into drifting particles. _(cpu medium, gpu low; organic, particles, magic)_
- `transition:distortion` — **Heat Distortion**: Warped heat-haze crossfade. _(cpu medium, gpu low; organic, distortion, warp)_
- `transition:lightSweep` — **Light Sweep**: Bright diagonal light band carries the cut. _(cpu medium, gpu low; light, premium, shine)_
- `transition:lensFlareCut` — **Flare Cut**: Anamorphic flare burst hides the cut. _(cpu medium, gpu low; light, cinematic, anamorphic)_
- `transition:lumaFade` — **Luma Fade**: Overexposed crossfade. _(cpu medium, gpu low; light, premium, exposure)_

## typography

- `typography:charFadeUp` — **Char Fade Up**: Characters rise and fade in sequence. _(cpu medium, gpu low; char, saas, clean)_
- `typography:charBlurUp` — **Char Blur Up**: Characters resolve from blur while rising. _(cpu medium, gpu low; char, saas, premium)_
- `typography:charPop` — **Char Pop**: Characters pop with overshoot. _(cpu medium, gpu low; char, playful, social)_
- `typography:charSpring` — **Char Spring**: Spring physics per character. _(cpu medium, gpu low; char, physical)_
- `typography:charDrop` — **Char Drop**: Characters fall and bounce. _(cpu medium, gpu low; char, playful)_
- `typography:charElastic` — **Char Elastic**: Elastic scale per character. _(cpu medium, gpu low; char, energetic)_
- `typography:charFlip3D` — **Char Flip 3D**: 3D flip-up per character. _(cpu medium, gpu low; char, 3d, tech)_
- `typography:charRotate` — **Char Rotate**: Characters rotate into place. _(cpu medium, gpu low; char, playful)_
- `typography:charGlitch` — **Char Glitch**: Glitch per character. _(cpu medium, gpu low; char, cyber, tech)_
- `typography:charFlicker` — **Neon Flicker**: Neon flicker per character. _(cpu medium, gpu low; char, neon)_
- `typography:charZoom` — **Char Zoom**: Characters rush from camera. _(cpu medium, gpu low; char, energetic)_
- `typography:charScale` — **Char Scale**: Characters grow from small. _(cpu medium, gpu low; char, bold)_
- `typography:charSkew` — **Char Skew**: Skewed character entrance. _(cpu medium, gpu low; char, dynamic)_
- `typography:charMask` — **Char Mask**: Characters rise through a mask. _(cpu medium, gpu low; char, editorial)_
- `typography:charSpiral` — **Char Spiral**: Characters spiral in. _(cpu medium, gpu low; char, space)_
- `typography:charDissolve` — **Char Dissolve**: Noisy dissolve per character. _(cpu medium, gpu low; char, soft)_
- `typography:charCenter` — **Center Out**: Stagger from the centre outward. _(cpu medium, gpu low; char, symmetric)_
- `typography:charRandom` — **Random Order**: Characters appear in random order. _(cpu medium, gpu low; char, organic)_
- `typography:wordFadeUp` — **Word Fade Up**: Words rise sequentially. _(cpu low, gpu low; word, saas, basic)_
- `typography:wordBlurUp` — **Word Blur Up**: Words resolve from blur. _(cpu low, gpu low; word, saas, premium, cinematic)_
- `typography:wordPop` — **Word Pop**: Words pop in. _(cpu low, gpu low; word, social, playful)_
- `typography:wordSlide` — **Word Slide**: Words slide in from the left. _(cpu low, gpu low; word, corporate)_
- `typography:wordZoom` — **Word Zoom**: Words settle from large. _(cpu low, gpu low; word, cinematic)_
- `typography:wordFlip` — **Word Flip**: Words flip in. _(cpu low, gpu low; word, 3d)_
- `typography:wordMask` — **Word Mask**: Words rise through masks. _(cpu low, gpu low; word, editorial)_
- `typography:wordStomp` — **Stomp**: Punchy per-word stomp for short-form. _(cpu low, gpu low; word, social, shorts, bold)_
- `typography:wordCinematic` — **Word Cinematic**: Slow cinematic words. _(cpu low, gpu low; word, cinematic, film)_
- `typography:wordSpring` — **Word Spring**: Spring per word. _(cpu low, gpu low; word, physical)_
- `typography:wordLuxury` — **Word Luxury**: Slow exposure per word. _(cpu low, gpu low; word, luxury)_
- `typography:lineMaskUp` — **Line Mask Up**: Lines rise through masks. _(cpu low, gpu low; line, editorial, premium)_
- `typography:lineFadeUp` — **Line Fade Up**: Lines rise and fade. _(cpu low, gpu low; line, clean)_
- `typography:lineWipe` — **Line Wipe**: Lines wipe in. _(cpu low, gpu low; line, clean)_
- `typography:lineBlur` — **Line Blur**: Lines focus in. _(cpu low, gpu low; line, soft)_
- `typography:lineEditorial` — **Line Editorial**: Masked rise with skew per line. _(cpu low, gpu low; line, editorial, magazine)_
- `typography:linePerspective` — **Line Perspective**: Lines swing in with perspective. _(cpu low, gpu low; line, 3d)_
- `typography:blockFade` — **Fade**: Whole-block fade. _(cpu low, gpu low; none, minimal)_
- `typography:blockCinematic` — **Cinematic Title**: Whole-block cinematic reveal. _(cpu low, gpu low; none, cinematic)_
- `typography:blockFuturistic` — **Futuristic**: Stretch/blur/chroma resolve. _(cpu low, gpu low; none, futuristic, ai)_
- `typography:typewriter` — **Typewriter**: Typed characters with blinking caret. _(cpu medium, gpu low; char, code, tech)_
- `typography:scramble` — **Scramble Decode**: Random glyphs decode into the text. _(cpu medium, gpu low; char, tech, hacker, ai)_
- `typography:trackingIn` — **Tracking In**: Letter-spacing contracts into place. _(cpu low, gpu low; none, cinematic, luxury)_
- `typography:trackingOut` — **Tracking Expand**: Letter-spacing slowly expands. _(cpu low, gpu low; none, cinematic)_
- `typography:wave` — **Wave**: Continuous sine wave through characters. _(cpu medium, gpu low; char, playful, music)_
- `typography:bounceLoop` — **Bounce Loop**: Characters bounce continuously. _(cpu medium, gpu low; char, playful)_
- `typography:gradientSweep` — **Gradient Sweep**: Animated gradient flowing through text. _(cpu low, gpu low; none, saas, ai)_
- `typography:highlight` — **Marker Highlight**: Marker highlight grows behind key words. _(cpu low, gpu low; word, explainer, education)_
- `typography:underline` — **Underline Draw**: Underline draws under the text. _(cpu low, gpu low; none, editorial)_
- `typography:strike` — **Strike Through**: Strike-through line draws across. _(cpu low, gpu low; none, comparison)_
- `typography:chromeShine` — **Chrome Shine**: Chrome fill with moving specular sweep. _(cpu low, gpu low; none, chrome, premium)_
- `typography:goldLuxury` — **Gold Luxury**: Gold metallic fill with slow reveal. _(cpu low, gpu low; word, luxury, gold)_
- `typography:holographic` — **Holographic**: Hue-cycling holographic fill. _(cpu low, gpu low; none, holographic, futuristic)_
- `typography:liquid` — **Liquid**: Characters undulate like liquid. _(cpu medium, gpu low; char, liquid, fluid)_
- `typography:extrude3D` — **3D Extrusion**: Stacked depth extrusion. _(cpu low, gpu low; none, 3d, bold)_
- `typography:neonGlow` — **Neon Glow**: Neon tube glow with flicker. _(cpu medium, gpu low; char, neon, cyber)_
- `typography:outlineFill` — **Outline to Fill**: Outline fills from bottom to top. _(cpu low, gpu low; none, bold)_
- `typography:counter` — **Number Counter**: Counts numbers in the text up from zero. _(cpu low, gpu low; none, data, metrics)_
- `typography:rotator` — **Word Rotator**: Cycles the last word through alternatives (use | separators). _(cpu low, gpu low; none, saas, hero)_
- `typography:karaoke` — **Karaoke Fill**: Color fill sweeps across the text. _(cpu low, gpu low; none, captions, music)_
- `typography:glitchText` — **Glitch Text**: Persistent RGB glitch slices. _(cpu low, gpu low; none, cyber, gaming)_
- `typography:longShadow` — **Long Shadow**: Retro long-shadow typography. _(cpu low, gpu low; none, retro, bold)_
- `typography:spotlightText` — **Spotlight**: Spotlight passes across text. _(cpu low, gpu low; none, cinematic)_
- `typography:jitterText` — **Jitter**: Characters jitter nervously. _(cpu medium, gpu low; char, grunge)_
- `typography:splitColor` — **Split Color**: Top/bottom halves in two colors. _(cpu low, gpu low; none, editorial)_

## ui

- `ui:browser` — **Browser Window**: Browser chrome with an animated dashboard page. _(cpu low, gpu low; ui, saas, web, mockup)_
- `ui:dashboard` — **Analytics Dashboard**: Sidebar, KPI row, growing chart and activity list. _(cpu low, gpu low; ui, saas, dashboard, analytics, data)_
- `ui:sidebar` — **Sidebar**: Navigation sidebar with animated selection pill. _(cpu low, gpu low; ui, navigation, saas)_
- `ui:navbar` — **Navbar**: Landing page navbar with CTA. _(cpu low, gpu low; ui, navigation, landing)_
- `ui:pricingCard` — **Pricing Card**: Pricing tier with counting price and feature checks. _(cpu low, gpu low; ui, pricing, saas, conversion)_
- `ui:metricCard` — **Metric Card**: KPI card with counter and sparkline. _(cpu low, gpu low; ui, kpi, data, saas)_
- `ui:progress` — **Progress**: Animated labelled progress bar. _(cpu low, gpu low; ui, progress, loader)_
- `ui:notification` — **Notification**: Slide-in system notification. _(cpu low, gpu low; ui, notification, ios, social-proof)_
- `ui:toast` — **Toast**: Success toast with countdown bar. _(cpu low, gpu low; ui, feedback, ui)_
- `ui:modal` — **Modal Dialog**: Modal dialog with confirm/cancel. _(cpu low, gpu low; ui, dialog, ui)_
- `ui:commandPalette` — **Command Palette**: ⌘K palette with typed query and filtered results. _(cpu low, gpu low; ui, search, power-user, saas)_
- `ui:search` — **Search Bar**: Search field with typing and suggestions pulse. _(cpu low, gpu low; ui, search, input)_
- `ui:input` — **Text Input**: Labelled input with focus ring. _(cpu low, gpu low; ui, form, input)_
- `ui:button` — **Button**: Primary button with hover shine and press. _(cpu low, gpu low; ui, cta, button)_
- `ui:toggle` — **Toggle**: Spring-animated toggle switch. _(cpu low, gpu low; ui, form, switch)_
- `ui:slider` — **Slider**: Range slider with moving thumb and value. _(cpu low, gpu low; ui, form, control)_
- `ui:calendar` — **Calendar**: Month grid with selected range sweep. _(cpu low, gpu low; ui, calendar, scheduling)_
- `ui:avatar` — **Avatar Stack**: Overlapping avatars with counter. _(cpu low, gpu low; ui, social-proof, team)_
- `ui:profile` — **Profile Card**: Profile card with stats. _(cpu low, gpu low; ui, profile, social)_
- `ui:table` — **Data Table**: Table rows streaming in with status pills. _(cpu low, gpu low; ui, table, data, crm)_
- `ui:kanban` — **Kanban Board**: Kanban columns with a card moving across. _(cpu low, gpu low; ui, project, productivity)_
- `ui:chat` — **Chat**: Conversation with typing indicator and bubbles. _(cpu low, gpu low; ui, messaging, social)_
- `ui:aiChat` — **AI Chat**: Prompt → streaming AI response with thinking shimmer. _(cpu low, gpu low; ui, ai, chatbot, llm)_
- `ui:codeEditor` — **Code Editor**: Syntax-highlighted code typing in. _(cpu low, gpu low; ui, code, developer, api)_
- `ui:terminal` — **Terminal**: CLI session with typed commands and logs. _(cpu low, gpu low; ui, cli, developer, deploy)_
- `ui:workflow` — **Workflow**: Node graph with data pulses along edges. _(cpu low, gpu low; ui, automation, nodes, ai)_
- `ui:automation` — **Automation Run**: Steps completing with spinners and checkmarks. _(cpu low, gpu low; ui, automation, ai, checklist)_
- `ui:database` — **Database**: Stacked database cylinders with sync pulses. _(cpu low, gpu low; ui, infra, data, backend)_
- `ui:cloud` — **Cloud**: Cloud with uploading data particles. _(cpu low, gpu low; ui, infra, cloud, deploy)_
- `ui:api` — **API**: API endpoint with request/response packets. _(cpu low, gpu low; ui, developer, api, integration)_
- `ui:analytics` — **Analytics**: Animated bar growth icon. _(cpu low, gpu low; ui, data, analytics, growth)_
- `ui:cursorDemo` — **Cursor Click-through**: Cursor travels between UI targets with click ripples. _(cpu low, gpu low; ui, demo, product, tutorial)_
- `ui:featureCard` — **Feature Card**: Feature tile with icon glow and copy. _(cpu low, gpu low; ui, feature, saas, bento)_
- `ui:testimonialCard` — **Testimonial**: Quote card with stars filling in. _(cpu low, gpu low; ui, social-proof, testimonial)_
