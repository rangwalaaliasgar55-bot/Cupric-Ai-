import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIsDriven, useStep } from "@/lib/progress";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

type Letter = { id: number; ch: string };
type Exiting = Letter & { left: number };

const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";
// Shared letters can travel most of a word across, so they get longer than a
// typical UI tween; any shorter and the glide reads as a jump.
const GLIDE_MS = 440;
const ENTER_MS = 320;
// Leaving letters are gone before the glide lands, so the eye follows the
// letters that stay rather than the ones that go.
const EXIT_MS = 200;
const STAGGER_MS = 28;

// Longest common subsequence, so the most letters possible survive the swap
// while keeping their order ("fast" to "honest" keeps both s and t).
function matchLetters(prev: string[], next: string[]) {
  const dp = Array.from({ length: prev.length + 1 }, () =>
    new Array<number>(next.length + 1).fill(0),
  );
  for (let i = prev.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      dp[i][j] =
        prev[i] === next[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  // next index -> prev index
  const pairs = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < prev.length && j < next.length) {
    if (prev[i] === next[j]) {
      pairs.set(j, i);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

export function WordRotator({
  words,
  // Long enough to read the whole sentence once per word.
  interval = 2600,
  paused: pausedProp = false,
  className,
}: {
  words: string[];
  interval?: number;
  /** Stops rotating and settles back on the first word. */
  paused?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const nextId = useRef(words[0].length);

  const [index, setIndex] = useState(0);
  const [letters, setLetters] = useState<Letter[]>(() =>
    [...words[0]].map((ch, id) => ({ id, ch })),
  );
  const [exiting, setExiting] = useState<Exiting[]>([]);

  const box = useRef<HTMLSpanElement>(null);
  const nodes = useRef(new Map<number, HTMLSpanElement>());
  // Where things were on screen just before a swap, read back after it.
  const before = useRef<{
    lefts: Map<number, number>;
    width: number;
    entering: Set<number>;
  } | null>(null);
  const paused = useRef(false);
  const driven = useIsDriven();
  const drivenIndex = useStep(words.length, interval / 1000);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const swapTo = (nextIndex: number) => {
      if (!box.current) return;
      const from = box.current.getBoundingClientRect();
      // Rects are post-transform; a scaled ancestor (a zoomed preview) would
      // otherwise have every offset below applied twice.
      const s = from.width / box.current.offsetWidth || 1;
      const lefts = new Map<number, number>();
      for (const l of letters) {
        const el = nodes.current.get(l.id);
        // Visual position, mid-animation included, so a swap that lands
        // during a glide continues from where the letter really is.
        if (el)
          lefts.set(l.id, (el.getBoundingClientRect().left - from.left) / s);
      }

      const nextChars = [...words[nextIndex]];
      // Reduced motion is a plain crossfade: nothing travels.
      const pairs = reduceMotion
        ? new Map<number, number>()
        : matchLetters(
            letters.map((l) => l.ch),
            nextChars,
          );
      const kept = new Set(pairs.values());
      const entering = new Set<number>();
      const nextLetters = nextChars.map((ch, j) => {
        const p = pairs.get(j);
        if (p !== undefined) return letters[p];
        const l = { id: nextId.current++, ch };
        entering.add(l.id);
        return l;
      });

      before.current = { lefts, width: from.width / s, entering };
      setExiting(
        letters
          .filter((_, i) => !kept.has(i))
          .map((l) => ({ ...l, left: lefts.get(l.id) ?? 0 })),
      );
      setLetters(nextLetters);
      setIndex(nextIndex);
      clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => setExiting([]), EXIT_MS + 40);
    };

    if (pausedProp) {
      // One last swap home after a short beat, then nothing runs.
      if (index === 0) return;
      const home = setTimeout(() => swapTo(0), 250);
      return () => clearTimeout(home);
    }
    // Driven by a clock (a capture or a scrub): the index is derived, not
    // ticked, so the same time always shows the same word.
    if (driven) {
      if (drivenIndex !== index) swapTo(drivenIndex);
      return;
    }
    const tick = setInterval(() => {
      if (paused.current || document.hidden) return;
      swapTo((index + 1) % words.length);
    }, interval);
    return () => clearInterval(tick);
  }, [index, letters, words, interval, reduceMotion, pausedProp, driven, drivenIndex]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  useLayoutEffect(() => {
    const prev = before.current;
    const el = box.current;
    if (!prev || !el) return;
    before.current = null;

    // Settle everything first so the measurements below are the final
    // layout, then animate from the old picture to it.
    el.getAnimations().forEach((a) => a.cancel());
    for (const l of letters)
      nodes.current
        .get(l.id)
        ?.getAnimations()
        .forEach((a) => a.cancel());
    const to = el.getBoundingClientRect();
    const s = to.width / el.offsetWidth || 1;
    const toWidth = to.width / s;
    const nows = new Map<number, number>();
    for (const l of letters) {
      const node = nodes.current.get(l.id);
      if (node)
        nows.set(l.id, (node.getBoundingClientRect().left - to.left) / s);
    }

    // Width, not scale: the sentence needs real layout space so the words
    // around it slide instead of snapping. It is one inline box, so the
    // reflow per frame is tiny.
    if (!reduceMotion && Math.abs(toWidth - prev.width) > 0.5) {
      el.animate([{ width: `${prev.width}px` }, { width: `${toWidth}px` }], {
        duration: GLIDE_MS,
        easing: EASE_IN_OUT,
      });
    }

    let order = 0;
    for (const l of letters) {
      const node = nodes.current.get(l.id);
      if (!node) continue;
      if (prev.entering.has(l.id)) {
        node.animate(
          reduceMotion
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                {
                  opacity: 0,
                  transform: "translateY(0.4em)",
                  filter: "blur(4px)",
                },
                { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" },
              ],
          {
            duration: ENTER_MS,
            // A beat for the leaving letters to clear the space, then a
            // small left-to-right cascade.
            delay: reduceMotion ? 0 : 90 + order++ * STAGGER_MS,
            easing: EASE_OUT,
            fill: "backwards",
          },
        );
      } else {
        const was = prev.lefts.get(l.id);
        const now = nows.get(l.id);
        if (was === undefined || now === undefined) continue;
        if (Math.abs(was - now) < 0.5) continue;
        node.animate(
          [
            { transform: `translateX(${was - now}px)` },
            { transform: "translateX(0)" },
          ],
          { duration: GLIDE_MS, easing: EASE_IN_OUT },
        );
      }
    }
  }, [letters, reduceMotion]);

  // Leaving letters stay where they stood, then float up and out.
  const exitRef = (node: HTMLSpanElement | null) => {
    if (!node || node.dataset.leaving) return;
    node.dataset.leaving = "1";
    node.animate(
      reduceMotion
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" },
            {
              opacity: 0,
              transform: "translateY(-0.35em)",
              filter: "blur(4px)",
            },
          ],
      { duration: EXIT_MS, easing: EASE_OUT, fill: "forwards" },
    );
  };

  return (
    <span
      className={cn("relative inline-block", className)}
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch") paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
    >
      {/* Read once as a list of every word instead of announcing each swap. */}
      <span className="sr-only">{words.join(", ")}</span>
      <span
        ref={box}
        aria-hidden
        className="relative inline-block text-left whitespace-pre"
      >
        {letters.map((l) => (
          <span
            key={l.id}
            ref={(n) => {
              if (n) nodes.current.set(l.id, n);
              else nodes.current.delete(l.id);
            }}
            className="inline-block"
          >
            {l.ch}
          </span>
        ))}
        {exiting.map((l) => (
          <span
            key={l.id}
            ref={exitRef}
            className="pointer-events-none absolute top-0 inline-block"
            style={{ left: l.left }}
          >
            {l.ch}
          </span>
        ))}
      </span>
    </span>
  );
}

// In an index card the rotator waits at rest and plays quicker on hover.
const PREVIEW_INTERVAL = 1400;

export default function WordRotatorDemo() {
  const play = usePreviewPlay();
  return (
    <h2 className="relative text-center text-2xl font-semibold tracking-tight text-muted sm:text-4xl">
      Design that feels{" "}
      <WordRotator
        words={["calm", "fast", "honest", "alive"]}
        paused={play === false}
        interval={play ? PREVIEW_INTERVAL : undefined}
        className="text-foreground"
      />
    </h2>
  );
}
