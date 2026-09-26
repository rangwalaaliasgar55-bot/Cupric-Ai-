import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789#%&*+=/<>";
// Head start before the first character settles, so the noise registers.
const LEAD = 180;
// Each character settles this long after the one before it.
const STAGGER = 45;
// New noise roughly 25 times a second. Changing it every frame reads as
// flicker rather than decoding.
const TICK = 40;

// One character cell wide, cap height on the baseline, so it sits exactly
// where the letter it covers will land. Letter spacing skips inline blocks,
// so the margin applies tracking-tight by hand to keep the width exact.
const CURSOR =
  "inline-block h-[0.72em] w-[1ch] mr-[-0.025em] bg-current align-baseline";
// Noise is quieter than the settled text, so the eye reads the decoded part
// as the word and the rest as signal still coming in.
const AHEAD = "opacity-35";

function noise(original: string) {
  const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return original === original.toUpperCase() ? glyph.toUpperCase() : glyph;
}

// Writes straight to the node every frame, so decoding never re-renders React.
export function useScramble<T extends HTMLElement>(text: string) {
  const ref = useRef<T>(null);
  const frame = useRef(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const scramble = useCallback(() => {
    const node = ref.current;
    if (!node || reduceMotion) return;
    cancelAnimationFrame(frame.current);

    const chars = [...text];
    const current = chars.map(noise);
    const start = performance.now();
    let lastTick = start;
    let lastHead = -1;

    // A block cursor reads the word in: decoded text behind it, a faint
    // churn of noise ahead. Three nodes built once and rewritten in place,
    // so a frame is at most two text writes.
    const done = document.createTextNode("");
    const cursor = document.createElement("span");
    cursor.className = CURSOR;
    const ahead = document.createElement("span");
    ahead.className = AHEAD;
    node.replaceChildren(done, cursor, ahead);

    const step = (now: number) => {
      const elapsed = now - start;
      const refresh = now - lastTick >= TICK;
      if (refresh) lastTick = now;

      // Characters settle strictly left to right, so everything before the
      // first unsettled one is final.
      let head = chars.length;
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] !== " " && elapsed < LEAD + i * STAGGER) {
          head = i;
          break;
        }
      }
      if (head === chars.length) {
        node.textContent = text;
        return;
      }
      if (refresh) current.forEach((_, i) => (current[i] = noise(chars[i])));
      if (refresh || head !== lastHead) {
        lastHead = head;
        done.data = chars.slice(0, head).join("");
        // The cursor covers the character it is decoding, so the word keeps
        // its exact width the whole way through.
        ahead.textContent = chars
          .map((char, i) => (char === " " ? " " : current[i]))
          .slice(head + 1)
          .join("");
      }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [text, reduceMotion]);

  return { ref, scramble };
}

function ScrambleItem({ index, label }: { index: number; label: string }) {
  const { ref, scramble } = useScramble<HTMLSpanElement>(label);

  return (
    <li>
      <button
        type="button"
        onPointerEnter={scramble}
        onFocus={scramble}
        className="group flex items-baseline gap-4 font-mono text-3xl tracking-tight text-muted uppercase transition-[color] duration-150 ease-out outline-hidden hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground"
      >
        <span className="text-xs tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>
        {/* Mono is load-bearing here: every glyph is the same width, so the
            word doesn't jitter sideways while it decodes. */}
        <span className="sr-only">{label}</span>
        <span ref={ref} aria-hidden>
          {label}
        </span>
      </button>
    </li>
  );
}

const ITEMS = ["Work", "Lab", "Writing", "Contact"];

export default function TextScrambleDemo() {
  return (
    <ul className="flex flex-col gap-2">
      {ITEMS.map((label, i) => (
        <ScrambleItem key={label} index={i} label={label} />
      ))}
    </ul>
  );
}
