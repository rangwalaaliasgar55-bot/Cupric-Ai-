# MOTION_SPEC.md
* `AnimationConfig` = `{ preset?, from?, to?, duration, delay, ease, spring?, stagger?, repeat, repeatType: 'loop'|'reverse'|'mirror', keyframes? }`
* Easing: 40+ named curves (Penner family, expo/circ/back/elastic/bounce, cubic-bezier, steps, `anticipate`, `overshoot`) — `src/core/easing.ts`.
* Spring: analytical damped harmonic oscillator (under/critical/over-damped) — pure function of t.
* Keyframes: property tracks `{ t, value, ease }[]` with numeric/color interpolation.
* Timeline: `tween`, `sequence`, `parallel`, `stagger`, nested timelines, labels, markers, callbacks fired on crossing (play mode) — evaluated by `timeline.seek(t)`.
* Engine abstraction `animate({ target, property, from, to, duration, easing, engine })` → `native` (deterministic rAF) or `motion` (Motion `animate()`), same config.
* Presets: entrance / exit / emphasis / loop families registered through `registerMotionPreset()`; each preset is a function of config (distance, intensity, direction) returning keyframes, so presets are configurable, not static.
* Principles encoded: anticipation (back-in presets), overshoot & settle (spring), hierarchy (stagger by role: headline → body → UI), rhythm (beat-snapped durations).
* Reduced motion: `prefers-reduced-motion` switches presets to opacity-only fades (`reduceMotion()`).
