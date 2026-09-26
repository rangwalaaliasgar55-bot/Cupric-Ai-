import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  type AnimationPlaybackControls,
} from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/* The teachable part: the waveform is drawn twice, a quiet copy and an inked
   copy clipped to the playhead, so progress is one clip-path write per frame
   instead of recolouring a hundred bars. Position lives in a motion value:
   playback sets it, and seeks and scrubs spring it, so every jump glides
   and a scrub that changes direction keeps its momentum. */

export type Chapter = { start: number; title: string };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// Critically damped: the ink should land on the spot you clicked, never
// overshoot past it and come back.
const SEEK = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
// Tighter while dragging, so the ink stays under the finger.
const SCRUB = { type: "spring", visualDuration: 0.12, bounce: 0 } as const;
const RATES = [1, 1.5, 2] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stand-in peaks with the texture of a conversation: turns of speech at
// different loudness, short breaths between them, a steady music bed at the
// top, and a real pause wherever a chapter begins. Seeded, so the server and
// client draw the same wave.
export function speechPeaks(
  count: number,
  duration: number,
  chapters: Chapter[] = [],
  seed = 7,
) {
  const rand = mulberry32(seed);
  const out: number[] = [];
  let level = 0.6;
  let run = 0;
  const breaks = new Set(
    chapters.slice(1).map((c) => Math.round((c.start / duration) * count)),
  );
  for (let i = 0; i < count; i++) {
    if (i < 4) {
      // The intro music: loud and even, unlike speech.
      out.push(0.72 + rand() * 0.08);
      continue;
    }
    if (breaks.has(i) || breaks.has(i + 1)) {
      out.push(0.08 + rand() * 0.06);
      run = 0;
      continue;
    }
    if (run <= 0) {
      if (rand() < 0.2) {
        level = 0.1 + rand() * 0.1;
        run = 1;
      } else {
        level = 0.4 + rand() * 0.55;
        run = 3 + Math.floor(rand() * 7);
      }
    }
    out.push(Math.min(1, level * (0.55 + rand() * 0.45)));
    run--;
  }
  return out;
}

export function WaveformPlayer({
  title,
  show,
  duration: durationProp,
  chapters,
  peaks: peaksProp,
  src,
  cover,
  className,
}: {
  title: string;
  show: string;
  // Seconds. Used until the audio reports its own, or throughout when there
  // is no audio and the player runs on a simulated clock.
  duration: number;
  chapters: Chapter[];
  // 0 to 1 per bar; generated when omitted.
  peaks?: number[];
  src?: string;
  cover?: React.ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const id = useId();
  const audio = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(durationProp);
  const peaks = useMemo(
    () => peaksProp ?? speechPeaks(112, durationProp, chapters),
    [peaksProp, durationProp, chapters],
  );
  const barChapter = useMemo(
    () =>
      peaks.map((_, i) => {
        const t = ((i + 0.5) / peaks.length) * duration;
        let c = 0;
        chapters.forEach((ch, j) => {
          if (t >= ch.start) c = j;
        });
        return c;
      }),
    [peaks, chapters, duration],
  );

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const [chapter, setChapter] = useState(0);

  const root = useRef<HTMLDivElement>(null);
  const wave = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLDivElement>(null);
  const chapterInk = useRef<HTMLDivElement>(null);
  const quietSegs = useRef<(HTMLSpanElement | null)[]>([]);
  const inkSegs = useRef<(HTMLSpanElement | null)[]>([]);
  const head = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tipTime = useRef<HTMLSpanElement>(null);
  const tipLabel = useRef<HTMLSpanElement>(null);
  const now = useRef<HTMLSpanElement>(null);
  const baseBars = useRef<(HTMLSpanElement | null)[]>([]);

  // The clock. Simulated playback anchors to wall time, so a paused rAF
  // (offscreen, background tab) catches up instead of drifting.
  const pos = useRef(0);
  const anchor = useRef({ t: 0, wall: 0 });
  const rateRef = useRef<number>(1);
  const playingRef = useRef(false);
  const dragging = useRef(false);
  const seekAnim = useRef<AnimationPlaybackControls | null>(null);
  const shown = useMotionValue(0);
  const lastSecond = useRef(-1);
  const hoverChapter = useRef(-1);

  const chapterAt = useCallback(
    (t: number) => {
      let c = 0;
      chapters.forEach((ch, j) => {
        if (t >= ch.start) c = j;
      });
      return c;
    },
    [chapters],
  );

  // Every visual that follows the position, written straight to the DOM.
  const draw = useCallback(
    (t: number) => {
      const p = duration ? Math.min(Math.max(t / duration, 0), 1) : 0;
      const clip = `inset(0 ${(1 - p) * 100}% 0 0)`;
      if (ink.current) ink.current.style.clipPath = clip;
      if (chapterInk.current) chapterInk.current.style.clipPath = clip;
      if (head.current) head.current.style.left = `${p * 100}%`;
      const sec = Math.floor(t);
      if (sec !== lastSecond.current) {
        lastSecond.current = sec;
        if (now.current) now.current.textContent = fmt(t);
        const c = chapterAt(t);
        wave.current?.setAttribute("aria-valuenow", String(sec));
        wave.current?.setAttribute(
          "aria-valuetext",
          `${fmt(t)} of ${fmt(duration)}, ${chapters[c].title}`,
        );
        setChapter(c);
      }
    },
    [duration, chapters, chapterAt],
  );

  useMotionValueEvent(shown, "change", draw);

  const clock = () =>
    src && audio.current
      ? audio.current.currentTime
      : playingRef.current
        ? anchor.current.t + ((performance.now() - anchor.current.wall) / 1000) * rateRef.current
        : pos.current;

  const seek = (t: number, spring: typeof SEEK | typeof SCRUB | null = SEEK) => {
    const next = Math.min(Math.max(t, 0), duration);
    pos.current = next;
    anchor.current = { t: next, wall: performance.now() };
    if (src && audio.current) audio.current.currentTime = next;
    if (!spring || reduceMotion) {
      seekAnim.current?.stop();
      seekAnim.current = null;
      shown.set(next);
      return;
    }
    // Retargeting the running spring keeps its velocity.
    const anim = animate(shown, next, spring);
    seekAnim.current = anim;
    anim.then(() => {
      if (seekAnim.current === anim) seekAnim.current = null;
    });
  };

  // The playback loop. Runs only while playing and on screen.
  const visible = useRef(true);
  const wake = useRef(() => {});
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      raf = 0;
      if (!visible.current) return;
      let t = clock();
      if (!src && t >= duration) {
        t = duration;
        pos.current = t;
        playingRef.current = false;
        setPlaying(false);
      }
      // A seek or scrub owns the playhead until its spring settles.
      if (!seekAnim.current && !dragging.current) shown.set(t);
      raf = requestAnimationFrame(loop);
    };
    wake.current = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    wake.current();
    return () => {
      cancelAnimationFrame(raf);
      wake.current = () => {};
    };
    // clock only reads refs, so it never needs to restart the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, src, duration, shown]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      wake.current();
    });
    io.observe(el);
    return () => {
      io.disconnect();
      seekAnim.current?.stop();
    };
  }, []);

  const toggle = () => {
    const next = !playingRef.current;
    if (next && pos.current >= duration) pos.current = 0;
    const t = next ? pos.current : clock();
    pos.current = t;
    anchor.current = { t, wall: performance.now() };
    playingRef.current = next;
    setPlaying(next);
    if (src && audio.current) {
      if (next) audio.current.play().catch(() => {
        playingRef.current = false;
        setPlaying(false);
      });
      else audio.current.pause();
    }
  };

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    // Re-anchor so the new speed applies from here, not from play.
    const t = clock();
    pos.current = t;
    anchor.current = { t, wall: performance.now() };
    rateRef.current = next;
    if (audio.current) audio.current.playbackRate = next;
    setRate(next);
  };

  // Hover and scrub feedback: a ghost playhead and a time preview.
  const showTip = (x: number, t: number, label: string) => {
    const w = wave.current;
    const el = tip.current;
    if (!w || !el) return;
    const width = w.offsetWidth;
    const half = el.offsetWidth / 2;
    const cx = Math.min(Math.max(x, half), width - half);
    el.style.transform = `translate(${cx}px, 0) translateX(-50%)`;
    el.style.opacity = "1";
    if (tipTime.current) tipTime.current.textContent = fmt(t);
    if (tipLabel.current) tipLabel.current.textContent = label;
  };
  const hideTip = () => {
    if (tip.current) tip.current.style.opacity = "0";
    if (ghost.current) ghost.current.style.opacity = "0";
    tintChapter(-1);
  };

  // The chapter under the cursor lifts out of the quiet copy of the wave.
  const tintChapter = (c: number) => {
    if (c === hoverChapter.current) return;
    hoverChapter.current = c;
    baseBars.current.forEach((bar, i) => {
      // Twice the resting 0.2, still well short of the played ink.
      if (bar) bar.style.opacity = c >= 0 && barChapter[i] === c ? "0.4" : "";
    });
    // Its segment of the chapter track thickens too, quiet and inked alike.
    [quietSegs, inkSegs].forEach((segs) =>
      segs.current.forEach((seg, i) => {
        if (seg) seg.style.scale = i === c ? "1 2" : "";
      }),
    );
  };

  const timeAt = (clientX: number) => {
    const box = wave.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 0), box.width);
    return { x, t: (x / box.width) * duration };
  };

  const hover = (clientX: number) => {
    const { x, t } = timeAt(clientX);
    if (ghost.current) {
      ghost.current.style.transform = `translateX(${x}px)`;
      ghost.current.style.opacity = "1";
    }
    const c = chapterAt(t);
    tintChapter(c);
    showTip(x, t, chapters[c].title);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const { t } = timeAt(e.clientX);
    seek(t);
    hover(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) {
      seek(timeAt(e.clientX).t, SCRUB);
      hover(e.clientX);
    } else if (e.pointerType !== "touch") hover(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    seek(timeAt(e.clientX).t, SCRUB);
    if (e.pointerType === "touch") hideTip();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = clock();
    pos.current = t;
    const step = {
      ArrowRight: 5,
      ArrowUp: 5,
      ArrowLeft: -5,
      ArrowDown: -5,
      PageUp: 30,
      PageDown: -30,
    }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      seek(t + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seek(duration);
    } else if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    }
  };

  const current = chapters[chapter];

  return (
    <div
      ref={root}
      className={cn(
        "w-[540px] max-w-full rounded-2xl bg-surface p-5 shadow-raised",
        className,
      )}
    >
      {src && (
        <audio
          ref={audio}
          src={src}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDuration(d);
          }}
          onEnded={() => {
            playingRef.current = false;
            setPlaying(false);
          }}
        />
      )}

      <div className="flex items-center gap-4">
        <div className="size-14 shrink-0 overflow-hidden rounded-xl">{cover}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">{title}</p>
          <p className="truncate text-sm text-muted">{show}</p>
        </div>
      </div>

      <div className="mt-5 flex h-5 items-center gap-2 text-sm">
        <span className="shrink-0 text-muted tabular-nums">
          {chapter + 1}/{chapters.length}
        </span>
        <div className="relative h-5 min-w-0 flex-1">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.p
              key={chapter}
              initial={{ opacity: 0, filter: "blur(4px)", y: reduceMotion ? 0 : 4 }}
              animate={{ opacity: 1, filter: "blur(0px)", y: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
              exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.12, ease: EASE_OUT } }}
              className="truncate font-medium text-foreground"
            >
              {current.title}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      {/* Room above the wave for the time preview. */}
      <div className="relative mt-9">
        <div
          ref={tip}
          aria-hidden
          className="pointer-events-none absolute bottom-full left-0 mb-2 flex items-baseline gap-1.5 rounded-lg bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background opacity-0 transition-opacity duration-150 ease-out"
        >
          <span ref={tipTime} className="font-medium tabular-nums" />
          <span ref={tipLabel} className="max-w-40 truncate text-background/65" />
        </div>

        <div
          ref={wave}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={0}
          aria-valuetext={`0:00 of ${fmt(duration)}, ${chapters[0].title}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={(e) => {
            if (!dragging.current && e.pointerType !== "touch") hideTip();
          }}
          onKeyDown={onKeyDown}
          className="relative h-14 cursor-pointer touch-none rounded-md outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-4 focus-visible:outline-foreground"
        >
          <Bars peaks={peaks} className="text-foreground" barClassName="opacity-20" refs={baseBars} />
          <div ref={ink} className="absolute inset-0" style={{ clipPath: "inset(0 100% 0 0)" }}>
            <Bars peaks={peaks} className="text-foreground" />
          </div>
          <div
            ref={ghost}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-px bg-foreground/35 opacity-0 transition-opacity duration-150 ease-out"
          />
          <div
            ref={head}
            aria-hidden
            className="pointer-events-none absolute -inset-y-1 left-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
          />
        </div>

        {/* Chapters as a segmented track under the wave, inked by the same
            clip as the bars. Each segment jumps to its chapter's start. */}
        <div className="relative mt-1 h-6">
          {chapters.map((c, i) => {
            const left = (c.start / duration) * 100;
            const end = chapters[i + 1]?.start ?? duration;
            const width = ((end - c.start) / duration) * 100;
            return (
              <button
                key={c.start}
                type="button"
                aria-label={`Chapter ${i + 1}: ${c.title}, ${fmt(c.start)}`}
                onClick={() => seek(c.start)}
                onPointerEnter={(e) => {
                  if (e.pointerType === "touch" || !wave.current) return;
                  showTip((left / 100) * wave.current.offsetWidth, c.start, c.title);
                  tintChapter(i);
                }}
                onPointerLeave={hideTip}
                onFocus={(e) => {
                  if (!wave.current || !e.currentTarget.matches(":focus-visible")) return;
                  showTip((left / 100) * wave.current.offsetWidth, c.start, c.title);
                  tintChapter(i);
                }}
                onBlur={hideTip}
                className="absolute top-0 h-6 rounded-sm outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            );
          })}
          <Segments chapters={chapters} duration={duration} className="bg-foreground/20" refs={quietSegs} />
          <div ref={chapterInk} className="pointer-events-none absolute inset-0" style={{ clipPath: "inset(0 100% 0 0)" }}>
            <Segments chapters={chapters} duration={duration} className="bg-foreground" refs={inkSegs} />
          </div>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <p className="text-sm text-muted tabular-nums">
          <span ref={now} className="text-foreground">0:00</span>
          {/* Dropped on phones, where the controls need the width. */}
          <span className="max-sm:hidden"> / {fmt(duration)}</span>
        </p>
        <div className="flex items-center gap-1">
          <SkipButton label="Back 15 seconds" onClick={() => seek(clock() - 15)} dir={-1} />
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
            className={cn(
              "flex size-11 touch-manipulation items-center justify-center rounded-full bg-foreground text-background outline-hidden",
              "transition-[scale] duration-150 ease-out active:scale-[0.96]",
              "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.svg
                key={playing ? "pause" : "play"}
                viewBox="0 0 16 16"
                className="size-4.5"
                fill="currentColor"
                aria-hidden
                initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                transition={ICON_SWAP}
              >
                {playing ? (
                  <path d="M4 2.75h2.5v10.5H4zM9.5 2.75H12v10.5H9.5z" />
                ) : (
                  // Nudged right: a centred triangle looks off-centre.
                  <path d="M5.25 2.6v10.8a.6.6 0 0 0 .9.5l8.1-5.4a.6.6 0 0 0 0-1l-8.1-5.4a.6.6 0 0 0-.9.5" />
                )}
              </motion.svg>
            </AnimatePresence>
          </button>
          <SkipButton label="Forward 30 seconds" onClick={() => seek(clock() + 30)} dir={1} />
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={cycleRate}
            aria-label={`Playback speed ${rate}x`}
            className={cn(
              "relative flex h-9 w-14 touch-manipulation items-center justify-center overflow-hidden rounded-full bg-background text-sm font-medium text-foreground tabular-nums shadow-raised outline-hidden",
              "transition-[scale] duration-150 ease-out active:scale-[0.96]",
              "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={rate}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.22, ease: EASE_OUT } }}
                exit={{ opacity: 0, y: reduceMotion ? 0 : -8, filter: "blur(2px)", transition: { duration: 0.14, ease: EASE_OUT } }}
              >
                {rate}x
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </div>
      <span id={`${id}-status`} role="status" className="sr-only">
        {playing ? `Playing at ${rate}x` : "Paused"}
      </span>
    </div>
  );
}

function Bars({
  peaks,
  className,
  barClassName,
  refs,
}: {
  peaks: number[];
  className?: string;
  barClassName?: string;
  refs?: React.RefObject<(HTMLSpanElement | null)[]>;
}) {
  return (
    // The gap is a share of the width, not a fixed 2px: 112 bars with 2px
    // gaps need 334px and would spill out of a phone-width card.
    <div aria-hidden className={cn("absolute inset-0 flex items-center gap-[0.45%]", className)}>
      {peaks.map((p, i) => (
        <span
          key={i}
          ref={
            refs
              ? (el) => {
                  refs.current[i] = el;
                }
              : undefined
          }
          className={cn(
            "min-w-px flex-1 rounded-full bg-current transition-opacity duration-150 ease-out",
            barClassName,
          )}
          // Never below 3px, so silence still reads as part of the track.
          style={{ height: `max(3px, ${p * 100}%)` }}
        />
      ))}
    </div>
  );
}

function Segments({
  chapters,
  duration,
  className,
  refs,
}: {
  chapters: Chapter[];
  duration: number;
  className: string;
  refs: React.RefObject<(HTMLSpanElement | null)[]>;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {chapters.map((c, i) => {
        const end = chapters[i + 1]?.start ?? duration;
        return (
          <span
            key={c.start}
            ref={(el) => {
              refs.current[i] = el;
            }}
            style={{
              left: `${(c.start / duration) * 100}%`,
              // A 3px gap before the next chapter, none after the last.
              width: `calc(${((end - c.start) / duration) * 100}% - ${chapters[i + 1] ? 3 : 0}px)`,
            }}
            className={cn(
              "absolute top-[10px] h-1 rounded-full transition-[scale] duration-150 ease-out",
              className,
            )}
          />
        );
      })}
    </div>
  );
}

function SkipButton({
  label,
  dir,
  onClick,
}: {
  label: string;
  dir: 1 | -1;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-10 touch-manipulation items-center justify-center gap-1 rounded-full px-2 text-muted outline-hidden hover:text-foreground",
        "transition-[scale,color] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-[color]",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-foreground",
      )}
    >
      <svg
        viewBox="0 0 20 20"
        className={cn("size-4.5", dir === 1 && "order-last -scale-x-100")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4.5 9.5a6 6 0 1 0 1.8-4.3M4.5 3.5v3.2h3.2" />
      </svg>
      <span aria-hidden className="text-[13px] font-medium tabular-nums">
        {dir === 1 ? "30" : "15"}
      </span>
    </button>
  );
}

const CHAPTERS: Chapter[] = [
  { start: 0, title: "Cold open" },
  { start: 312, title: "Why we priced in public" },
  { start: 1044, title: "The churn spreadsheet" },
  { start: 1788, title: "Hiring a first designer" },
  { start: 2310, title: "Listener questions" },
];

// The show's artwork. Cover art is content, not interface, so it keeps its
// own printed colours in both themes: burnt orange stock, cream ink, and a
// stack of three jars for the "small batch".
function CoverArt() {
  const ORANGE = "oklch(0.64 0.16 42)";
  const CREAM = "oklch(0.96 0.03 85)";
  return (
    <svg viewBox="0 0 56 56" className="size-full" aria-hidden>
      <rect width="56" height="56" fill={ORANGE} />
      <circle cx="44" cy="12" r="22" fill="oklch(0.7 0.15 55)" />
      <g fill={CREAM}>
        <rect x="8" y="29" width="9" height="19" rx="2.5" />
        <rect x="19.5" y="24" width="10" height="24" rx="2.5" />
        <rect x="32" y="33" width="8" height="15" rx="2.5" />
      </g>
      <g fill={ORANGE}>
        <rect x="10" y="35" width="5" height="3" rx="1" />
        <rect x="21.5" y="31" width="6" height="3" rx="1" />
        <rect x="34" y="38" width="4" height="3" rx="1" />
      </g>
      <text x="8" y="14" fill={CREAM} fontSize="8" fontWeight="700" letterSpacing="-0.2">
        SMALL
      </text>
      <text x="8" y="22" fill={CREAM} fontSize="8" fontWeight="700" letterSpacing="-0.2">
        BATCH
      </text>
      <text x="48" y="14" fill={CREAM} fontSize="7" fontWeight="600" textAnchor="end" opacity="0.85">
        42
      </text>
    </svg>
  );
}

// Generated once at module scope: the same wave on every render.
const PEAKS = speechPeaks(112, 2538, CHAPTERS);

export default function WaveformPlayerDemo() {
  return (
    <WaveformPlayer
      title="Pricing in public, one year later"
      show="Small Batch, Episode 42"
      duration={2538}
      chapters={CHAPTERS}
      peaks={PEAKS}
      cover={<CoverArt />}
    />
  );
}
