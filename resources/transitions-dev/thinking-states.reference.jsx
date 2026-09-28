// REFERENCE ONLY — Transitions.dev "Thinking states" (p28), as supplied. Not imported by Cupric.
// See ATTRIBUTION.md. Cupric's implementation: src/lib/studio/loaders.ts, src/components/loaders/ThinkingStates.tsx

// Transitions.dev — Thinking states (React, self-contained)
// Drop into any React project — no extra CSS file needed.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const __TRANSITION_STYLES = `
:root {
  --think-hold: 2000ms;
  --think-swap: 150ms;
  --think-gap: 50ms;
  --think-distance: 8px;
  --think-blur: 2px;
  --think-shimmer: 2000ms;
  --think-base: #9a9a9a;
  --think-highlight: #f5f5f5;
  --think-ease: ease-in-out;
}

.t-think { position: relative; display: inline-block; text-align: center; }
.t-think-sizer { display: block; visibility: hidden; white-space: nowrap; }
.t-think-text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: block;
  color: var(--think-base);
  white-space: nowrap;
  transform: translateY(0);
  filter: blur(0);
  opacity: 1;
  transition:
    transform var(--think-swap) var(--think-ease),
    filter var(--think-swap) var(--think-ease),
    opacity var(--think-swap) var(--think-ease);
  will-change: transform, filter, opacity;
}
.t-think-text::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(90deg,
    transparent 0%, transparent 40%,
    var(--think-highlight) 50%,
    transparent 60%, transparent 100%);
  background-size: 400% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: t-think-shimmer var(--think-shimmer) linear infinite;
}
@keyframes t-think-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: 0% 0; }
}
.t-think-text.is-exit {
  transform: translateY(calc(var(--think-distance) * -1));
  filter: blur(var(--think-blur));
  opacity: 0;
}
.t-think-text.is-enter-start {
  transition: none;
  transform: translateY(var(--think-distance));
  filter: blur(var(--think-blur));
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .t-think-text { transition: none !important; transform: none !important; filter: none !important; }
  .t-think-text::before { display: none !important; }
}
`;
if (typeof document !== "undefined" && !document.getElementById("transitions-p28")) {
  const __style = document.createElement("style");
  __style.id = "transitions-p28";
  __style.textContent = __TRANSITION_STYLES;
  document.head.appendChild(__style);
}

const DEFAULT_STATES = ["Setting up a workplace", "Running a command", "Browsing files"];

const ms = (name, fallback) => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};

export function ThinkingStates({ states = DEFAULT_STATES }) {
  const [current, setCurrent] = useState(0);
  const [leaving, setLeaving] = useState(null);
  const [entering, setEntering] = useState(false);
  const liveRef = useRef(null);

  useEffect(() => {
    const hold = setTimeout(() => {
      setLeaving(current);
      setCurrent((i) => (i + 1) % states.length);
      setEntering(true);
    }, ms("--think-hold", 2000));
    return () => clearTimeout(hold);
  }, [current, states.length]);

  useLayoutEffect(() => {
    if (!entering) return;
    if (liveRef.current) void liveRef.current.offsetWidth;
    const gap = ms("--think-gap", 50);
    const swap = ms("--think-swap", 150);
    const release = setTimeout(() => setEntering(false), gap);
    const done = setTimeout(() => setLeaving(null), swap + gap);
    return () => { clearTimeout(release); clearTimeout(done); };
  }, [entering]);

  const longest = states.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span className="t-think" role="status">
      <span className="t-think-sizer" aria-hidden="true">{longest}</span>
      {leaving !== null && (
        <span className="t-think-text is-exit" data-text={states[leaving]} aria-hidden="true">
          {states[leaving]}
        </span>
      )}
      <span
        key={current}
        ref={liveRef}
        className={"t-think-text" + (entering ? " is-enter-start" : "")}
        data-text={states[current]}
      >
        {states[current]}
      </span>
    </span>
  );
}
