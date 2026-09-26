import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

export type Track = {
  title: string;
  artist: string;
  // Two colours for the generated cover and the record's label: album art
  // is data here, so raw colours are the point.
  art: [string, string];
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SLIDE = { type: "spring", duration: 0.5, bounce: 0.15 } as const;
const SWAP = { duration: 0.28, ease: EASE_OUT } as const;

// A record turns at 33 1/3 rpm, 1.8s a turn; the equalizer bars bounce at
// three unrelated rates so they never fall into step.
const CSS = `
@keyframes np-spin { to { transform: rotate(360deg) } }
@keyframes np-eq { 0%, 100% { transform: scaleY(.3) } 50% { transform: scaleY(1) } }
@keyframes np-marquee { 0%, 18% { transform: translateX(0) } 62%, 80% { transform: translateX(var(--np-shift)) } 100% { transform: translateX(0) } }
`;

export function NowPlaying({
  track,
  playing,
  onPlayingChange,
  onSkip,
  paused = false,
  className,
}: {
  track: Track;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  onSkip?: () => void;
  // Freezes every loop, for idle previews.
  paused?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const still = paused || reduceMotion;
  const moving = playing && !still;

  return (
    <div
      className={cn(
        "group/np relative flex h-14 w-[min(320px,100%)] items-center rounded-full bg-background p-2 pr-3 shadow-raised",
        className,
      )}
    >
      <style>{CSS}</style>
      <button
        type="button"
        onClick={() => onPlayingChange(!playing)}
        aria-label={playing ? `Pause ${track.title}` : `Play ${track.title}`}
        aria-pressed={playing}
        className="absolute inset-0 rounded-full outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
      />

      {/* Cover in front, the record behind it. Room is kept for the record
          whether it's out or tucked in, so the text never shifts. */}
      <div className="pointer-events-none relative h-10 w-[64px] shrink-0">
        <motion.div
          className="absolute top-0 left-0"
          initial={false}
          // Playing slides the record out; paused it only peeks.
          animate={{ x: playing ? 22 : 7 }}
          transition={reduceMotion ? { duration: 0 } : SLIDE}
        >
          <Vinyl label={track.art[0]} spinning={moving} />
        </motion.div>
        <div className="absolute top-0 left-0 size-10 overflow-hidden rounded-[9px] shadow-[0_1px_3px_oklch(0_0_0/0.25)]">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={track.title}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 1.08 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={SWAP}
            >
              <Cover art={track.art} />
            </motion.div>
          </AnimatePresence>
          {/* Play and pause show on hover, over the art. */}
          <span className="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity duration-150 ease-out group-hover/np:opacity-100">
            <svg
              viewBox="0 0 16 16"
              className="size-4"
              fill="currentColor"
              aria-hidden
            >
              {playing ? (
                <path d="M4.5 3h2.2v10H4.5zM9.3 3h2.2v10H9.3z" />
              ) : (
                <path d="M5 3.2v9.6a.5.5 0 0 0 .76.43l7.6-4.8a.5.5 0 0 0 0-.86l-7.6-4.8A.5.5 0 0 0 5 3.2Z" />
              )}
            </svg>
          </span>
        </div>
      </div>

      <div className="pointer-events-none ml-1 min-w-0 flex-1">
        <p className="text-[11px] leading-none font-medium tracking-wide text-muted uppercase">
          {playing ? "Listening to" : "Paused"}
        </p>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={track.title}
            initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{
              opacity: 0,
              y: -4,
              filter: "blur(4px)",
              transition: { duration: 0.15 },
            }}
            transition={SWAP}
            className="mt-1"
          >
            <Marquee running={moving}>
              <span className="text-[14px] font-medium text-foreground">
                {track.title}
              </span>
              <span className="text-[14px] text-muted"> · {track.artist}</span>
            </Marquee>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* The equalizer and skip share one slot: bars at rest, skip on
          hover, so a hidden button never eats the title's room. */}
      <div className="relative ml-2 grid size-8 shrink-0 place-items-center">
        <span
          className={cn(
            "transition-[opacity] duration-150 ease-out",
            onSkip &&
              "group-hover/np:opacity-0 group-has-[:focus-visible]/np:opacity-0",
          )}
        >
          <Equalizer moving={moving} playing={playing} />
        </span>
        {onSkip && (
          // Above the pill's own button, so skipping never also pauses.
          <button
            type="button"
            aria-label="Next track"
            onClick={onSkip}
            className="absolute inset-0 grid touch-manipulation place-items-center rounded-full text-muted opacity-0 outline-hidden transition-[opacity,color,scale] duration-150 ease-out group-hover/np:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96]"
          >
            <svg
              viewBox="0 0 16 16"
              className="size-4"
              fill="currentColor"
              aria-hidden
            >
              <path d="M3.5 3.4v9.2a.5.5 0 0 0 .78.42L10.5 8.4a.5.5 0 0 0 0-.8L4.28 2.98a.5.5 0 0 0-.78.42ZM11.5 3h1.6v10h-1.6z" />
            </svg>
          </button>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {playing ? `Playing ${track.title} by ${track.artist}` : "Paused"}
      </span>
    </div>
  );
}

// A black record in either theme: fine grooves, a coloured label with a
// spindle hole, and a sheen that doesn't turn with it, so the spin reads as
// light sliding across the grooves.
function Vinyl({ label, spinning }: { label: string; spinning: boolean }) {
  return (
    <div className="relative size-10 rounded-full bg-[oklch(0.16_0_0)] shadow-[0_1px_3px_oklch(0_0_0/0.3),inset_0_0_0_1px_oklch(1_0_0/0.12)]">
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "repeating-radial-gradient(circle at center, oklch(0.2 0 0) 0 0.6px, oklch(0.14 0 0) 0.6px 1.6px)",
          animation: "np-spin 1.8s linear infinite",
          animationPlayState: spinning ? "running" : "paused",
        }}
      >
        <div
          className="absolute inset-[30%] rounded-full"
          style={{ background: label }}
        >
          {/* Off-centre print on the label, so the turn is visible. */}
          <span className="absolute top-[18%] left-[42%] h-[22%] w-[16%] rounded-full bg-white/60" />
          <span className="absolute inset-[42%] rounded-full bg-[oklch(0.16_0_0)]" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 rounded-full bg-[conic-gradient(from_30deg,transparent_0deg,oklch(1_0_0/0.14)_40deg,transparent_80deg,transparent_180deg,oklch(1_0_0/0.1)_220deg,transparent_260deg)]" />
    </div>
  );
}

// Generated art: a sun over a horizon, in the track's two colours.
function Cover({ art: [a, b] }: { art: [string, string] }) {
  return (
    <svg viewBox="0 0 40 40" className="size-full" aria-hidden>
      <rect width="40" height="40" fill={b} />
      <circle cx="20" cy="22" r="11" fill={a} />
      <rect y="24" width="40" height="16" fill={b} />
      <path
        d="M0 27h40M0 31h40M0 35h40"
        stroke={a}
        strokeWidth="1.4"
        opacity="0.7"
      />
    </svg>
  );
}

function Equalizer({ moving, playing }: { moving: boolean; playing: boolean }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none flex h-4 items-end gap-[3px]"
    >
      {[0.9, 0.7, 1.1].map((d, i) => (
        <span
          key={i}
          className="w-[3px] origin-bottom rounded-full bg-foreground transition-[transform,opacity] duration-300 ease-out"
          style={{
            height: "100%",
            animation: moving
              ? `np-eq ${d}s ease-in-out ${i * -0.3}s infinite`
              : "none",
            // Paused, the bars settle low and dim instead of freezing mid-hop.
            transform: moving ? undefined : `scaleY(${[0.35, 0.55, 0.3][i]})`,
            opacity: playing ? 1 : 0.4,
          }}
        />
      ))}
    </span>
  );
}

// Scrolls a title that doesn't fit once to show its end, holds, and glides
// back, then rests. Short titles never move.
function Marquee({
  running,
  children,
}: {
  running: boolean;
  children: React.ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setShift(Math.max(0, i.scrollWidth - o.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={outer}
      className={cn(
        "overflow-hidden",
        shift > 0 &&
          "[mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]",
      )}
    >
      <div
        ref={inner}
        className="w-max whitespace-nowrap"
        style={
          {
            "--np-shift": `${-shift}px`,
            animation:
              running && shift > 0
                ? `np-marquee ${4 + shift / 30}s cubic-bezier(0.65,0,0.35,1) 1.2s 1 both`
                : "none",
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

const TRACKS: Track[] = [
  { title: "Night Drive", artist: "Neon Coast", art: ["#ff7a59", "#2b2d6e"] },
  { title: "Glass Rooms", artist: "Mira Sol", art: ["#f4d35e", "#0d3b3e"] },
  {
    title: "Everything We Built Under the Summer Light",
    artist: "The Hollow Hours",
    art: ["#9ad1d4", "#3a2e4f"],
  },
];

export default function NowPlayingDemo() {
  const play = usePreviewPlay();
  const [playing, setPlaying] = useState(true);
  const [index, setIndex] = useState(0);

  return (
    <NowPlaying
      track={TRACKS[index]}
      playing={playing}
      onPlayingChange={setPlaying}
      onSkip={() => {
        setIndex((i) => (i + 1) % TRACKS.length);
        setPlaying(true);
      }}
      paused={play === false}
    />
  );
}
