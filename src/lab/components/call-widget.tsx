import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";
import { useDriverSeconds } from "@/lib/progress";

export type CallPhase = "incoming" | "active" | "declined" | "ended";

// Accept is green the world over, so it's the one colour here that isn't a
// theme token: a convention, not decoration.
const ANSWER = "light-dark(oklch(0.62 0.16 150), oklch(0.66 0.16 150))";

const MORPH = { type: "spring", duration: 0.45, bounce: 0.1 } as const;
const FADE = { duration: 0.2, ease: [0.23, 1, 0.32, 1] } as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// One button's width plus the gap, so a control can start tucked exactly
// behind the one to its right.
const STEP = 52;

// The ring spreads and fades like sound leaving a phone; the wiggle is a
// short buzz with a long rest, so it nudges without nagging.
const CALL_CSS = `
@keyframes call-ring { from { transform: scale(1); opacity: .6 } to { transform: scale(1.7); opacity: 0 } }
@keyframes call-wiggle { 0%, 70%, 100% { transform: rotate(0) } 74% { transform: rotate(-14deg) } 78% { transform: rotate(12deg) } 82% { transform: rotate(-9deg) } 86% { transform: rotate(6deg) } 90% { transform: rotate(0) } }
`;

const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function CallWidget({
  name,
  avatar,
  kind = "video",
  phase,
  onPhaseChange,
  muted,
  onMutedChange,
  cameraOff,
  onCameraOffChange,
  sharing,
  onSharingChange,
  seconds,
  className,
}: {
  name: string;
  avatar: string;
  kind?: "video" | "voice";
  phase: CallPhase;
  onPhaseChange: (phase: CallPhase) => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  cameraOff: boolean;
  onCameraOffChange: (off: boolean) => void;
  sharing: boolean;
  onSharingChange: (sharing: boolean) => void;
  // Time in the call, owned by whoever runs the call.
  seconds: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const ringing = phase === "incoming";
  const inCall = phase === "active";
  const over = !ringing && !inCall;
  const transition = reduceMotion ? { duration: 0 } : MORPH;

  const subtitle = ringing
    ? `Incoming ${kind} call`
    : inCall
      ? clock(seconds)
      : phase === "declined"
        ? "Call declined"
        : `Call ended · ${clock(seconds)}`;

  const toggles = [
    { key: "mic", label: "Mute", on: muted, set: onMutedChange, icon: <MicIcon off={muted} /> },
    ...(kind === "video"
      ? [{ key: "cam", label: "Turn camera off", on: cameraOff, set: onCameraOffChange, icon: <VideoIcon off={cameraOff} /> }]
      : []),
    { key: "share", label: "Share screen", on: sharing, set: onSharingChange, icon: <ShareIcon /> },
  ];

  return (
    <motion.div
      layout
      transition={transition}
      style={{ borderRadius: 28 }}
      className={cn(
        "flex w-fit max-w-full items-center gap-3 bg-background p-2 shadow-raised",
        className,
      )}
    >
      <style>{CALL_CSS}</style>
      {/* The caller stays in place through every phase; only what's around
          them changes. */}
      <motion.span
        layout="position"
        transition={transition}
        className="relative size-11 shrink-0"
      >
        {ringing && !reduceMotion && (
          <>
            <span className="absolute inset-0 animate-[call-ring_2s_ease-out_infinite] rounded-full border border-foreground/25" />
            <span className="absolute inset-0 animate-[call-ring_2s_ease-out_1s_infinite] rounded-full border border-foreground/25" />
          </>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny local SVG */}
        <img
          src={avatar}
          alt=""
          className={cn(
            "relative size-11 rounded-full bg-[oklch(0.97_0_0)] transition-[opacity,filter] duration-200 ease-out",
            over && "opacity-50 grayscale",
          )}
        />
      </motion.span>

      <motion.span
        layout="position"
        transition={transition}
        className="flex min-w-0 flex-1 flex-col pr-1"
      >
        <span className="truncate text-[15px] font-medium text-foreground">
          {name}
        </span>
        <span className="grid text-[13px] text-muted tabular-nums">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={ringing ? "ring" : inCall ? "call" : phase}
              initial={{ opacity: 0, y: 3, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(2px)", transition: { duration: 0.1 } }}
              transition={FADE}
              className="col-start-1 row-start-1 truncate whitespace-nowrap"
            >
              {subtitle}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.span>

      <span aria-live="polite" className="sr-only">
        {ringing ? `${name} is calling` : subtitle}
      </span>

      <div className="ml-1 flex shrink-0 items-center gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {/* Decline bows out where it stands: it isn't the one you chose. */}
          {ringing && (
            <motion.button
              key="decline"
              type="button"
              aria-label="Decline"
              onClick={() => onPhaseChange("declined")}
              initial={{ opacity: 0, scale: 0.6, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.6, filter: "blur(4px)", transition: { duration: 0.15 } }}
              transition={FADE}
              className="grid size-11 touch-manipulation place-items-center rounded-full bg-danger text-white outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-[color-mix(in_oklab,var(--danger)_88%,white)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]"
            >
              <PhoneIcon down />
            </motion.button>
          )}
          {/* The controls unfold out of the End button: each starts tucked
              behind it and slides out to its place, the nearest first. */}
          {inCall &&
            toggles.map((t, i) => {
              const behind = (toggles.length - i) * STEP;
              return (
                <motion.button
                  key={t.key}
                  type="button"
                  aria-label={t.label}
                  aria-pressed={t.on}
                  onClick={() => t.set(!t.on)}
                  initial={reduceMotion ? { opacity: 0 } : { x: behind, opacity: 0, scale: 0.8 }}
                  animate={{ x: 0, opacity: 1, scale: 1 }}
                  // Leaving, they fade where they stand: the pill is
                  // shrinking at the same time, so sliding back would carry
                  // them out past its edge as ghosts.
                  exit={{
                    opacity: 0,
                    scale: reduceMotion ? 1 : 0.8,
                    filter: "blur(3px)",
                    transition: { duration: 0.12 },
                  }}
                  transition={{
                    ...MORPH,
                    delay: reduceMotion ? 0 : (toggles.length - 1 - i) * 0.05 + 0.08,
                  }}
                  // Switched on means something is held back (muted, camera
                  // off), so it inverts: the odd one out is the one to notice.
                  className={cn(
                    "grid size-11 touch-manipulation place-items-center rounded-full outline-hidden transition-[scale,background-color,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]",
                    t.on
                      ? "bg-foreground text-background"
                      : "bg-surface text-foreground hover:bg-foreground/10",
                  )}
                >
                  {t.icon}
                </motion.button>
              );
            })}
        </AnimatePresence>

        {/* One button throughout: Accept becomes End becomes Call again. It
            never leaves the spot you clicked, it only changes what it is:
            green to red as the handset tips over to hang up, then quiet. */}
        <motion.button
          layout
          transition={transition}
          type="button"
          aria-label={ringing ? "Accept" : inCall ? "End call" : undefined}
          onClick={() => onPhaseChange(ringing ? "active" : inCall ? "ended" : "incoming")}
          style={{ borderRadius: 999 }}
          className={cn(
            "group/call relative z-10 grid h-11 touch-manipulation place-items-center overflow-hidden bg-surface outline-hidden transition-[scale,color] duration-200 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]",
            over ? "px-4 text-foreground" : "w-11 text-white",
            inCall && "w-14",
          )}
        >
          {/* Colours never cross-fade: half-transparent red over green reads
              as brown, and over grey as pink. The red wipes in instead, a
              circle filling out from the centre, and drains back into it on
              hang-up. The green underneath waits until it's covered. */}
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 transition-opacity ease-out",
              ringing ? "opacity-100 duration-200" : "opacity-0 delay-300 duration-0",
            )}
            style={{ background: ANSWER }}
          />
          <span
            aria-hidden
            // Fills generously, drains fast: the red is gone before the next
            // label arrives, so the two never share the button.
            className={cn(
              "absolute inset-0 bg-danger transition-[clip-path] motion-reduce:transition-none",
              inCall
                ? "duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                : "duration-150 ease-[cubic-bezier(0.4,0,1,1)]",
            )}
            style={{
              clipPath: inCall
                ? "circle(75% at 50% 50%)"
                : "circle(0% at 50% 50%)",
            }}
          />
          {/* Hover lightens with a veil rather than a filter, which can
              leave square corners on a button that is changing size. */}
          <span
            aria-hidden
            className="absolute inset-0 bg-white/0 transition-[background-color] duration-150 ease-out group-hover/call:bg-white/12"
          />
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={over ? "again" : "phone"}
              layout="position"
              initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)", transition: { duration: 0.12 } }}
              // "Call again" waits for the red to drain first.
              transition={{ ...ICON_SWAP, delay: over && !reduceMotion ? 0.14 : 0 }}
              className="relative grid place-items-center"
            >
              {over ? (
                <span className="text-sm font-medium whitespace-nowrap">Call again</span>
              ) : (
                <motion.span
                  className="grid"
                  initial={false}
                  // The handset rotates over rather than swapping icons, so
                  // accepting reads as picking up and hanging up as putting
                  // it down.
                  animate={{ rotate: inCall ? 135 : 0 }}
                  transition={reduceMotion ? { duration: 0 } : MORPH}
                >
                  <span
                    className={cn(
                      "grid",
                      ringing && !reduceMotion && "animate-[call-wiggle_2.4s_ease-in-out_infinite]",
                    )}
                  >
                    <PhoneIcon />
                  </span>
                </motion.span>
              )}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </motion.div>
  );
}

const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "size-5",
  "aria-hidden": true,
} as const;

// A slash that draws across the icon as it switches off, and back.
function Slash({ on }: { on: boolean }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.path
      d="M4 4l16 16"
      initial={false}
      animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
      transition={reduceMotion ? { duration: 0 } : ICON_SWAP}
    />
  );
}

function MicIcon({ off = false }: { off?: boolean }) {
  return (
    <svg {...STROKE}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      <Slash on={off} />
    </svg>
  );
}

function VideoIcon({ off = false }: { off?: boolean }) {
  return (
    <svg {...STROKE}>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="m15.5 10.5 5-3v9l-5-3" />
      <Slash on={off} />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg {...STROKE}>
      <rect x="3" y="4.5" width="18" height="12.5" rx="2.5" />
      <path d="M8.5 21h7M12 13.5v-5M9.5 10.5 12 8l2.5 2.5" />
    </svg>
  );
}

function PhoneIcon({ down = false }: { down?: boolean }) {
  return (
    <svg
      {...STROKE}
      // The same handset, tipped over to hang up.
      style={down ? { transform: "rotate(135deg)" } : undefined}
    >
      <path d="M6.6 3.5h2.6l1.3 4.1-2 1.3a11 11 0 0 0 6.6 6.6l1.3-2 4.1 1.3v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" />
    </svg>
  );
}

/** Autoplay script as a pure function of time: answer, mute, unmute, hang up, ring again. */
export function callScriptAt(t: number): { phase: CallPhase; muted: boolean; seconds: number } {
  const loop = 5.8;
  const c = ((t % loop) + loop) % loop;
  if (c < 0.7) return { phase: "incoming", muted: false, seconds: 0 };
  if (c < 4.4) return { phase: "active", muted: c >= 2.2 && c < 3.1, seconds: Math.floor(c - 0.7) };
  return { phase: "ended", muted: false, seconds: Math.floor(4.4 - 0.7) };
}

export default function CallWidgetDemo() {
  const play = usePreviewPlay();
  const [phase, setPhase] = useState<CallPhase>("incoming");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const started = useRef(0);
  // Captured: everything below is a pure function of the driving clock.
  const driven = useDriverSeconds();
  const drivenStart = useRef(0);

  // The call clock runs only while a call is live, and only a tick a second.
  useEffect(() => {
    if (phase !== "active" || driven !== null) return;
    const id = setInterval(
      () => setSeconds(Math.floor((performance.now() - started.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [phase]);

  const change = (next: CallPhase) => {
    if (next === "active") {
      started.current = performance.now();
      drivenStart.current = driven ?? 0;
      setSeconds(0);
      setMuted(false);
      setCameraOff(false);
      setSharing(false);
    }
    setPhase(next);
  };

  // In an index card, hovering answers, mutes for a moment and hangs up.
  const changeRef = useRef(change);
  useEffect(() => {
    changeRef.current = change;
  });
  useEffect(() => {
    if (play !== true || driven !== null) return;
    const steps: [() => void, number][] = [
      [() => changeRef.current("active"), 700],
      [() => setMuted(true), 1500],
      [() => setMuted(false), 900],
      [() => changeRef.current("ended"), 1300],
      [() => changeRef.current("incoming"), 1400],
    ];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const [run, wait] = steps[i % steps.length];
      i++;
      timer = setTimeout(() => {
        run();
        next();
      }, wait);
    };
    next();
    return () => {
      clearTimeout(timer);
      changeRef.current("incoming");
    };
  }, [play, driven]);

  // The same autoplay script, read off the clock instead of timers.
  const script = driven !== null && play === true ? callScriptAt(driven) : null;
  const shownPhase = script ? script.phase : phase;
  const shownMuted = script ? script.muted : muted;
  const shownSeconds = script
    ? script.seconds
    : driven !== null && phase === "active"
      ? Math.max(0, Math.floor(driven - drivenStart.current))
      : seconds;

  return (
    // Centred in every phase; the widget grows evenly both ways as the
    // controls unfold, so the button you pressed only drifts half the width.
    <div className="flex w-[460px] max-w-full justify-center">
      <CallWidget
        name="Maya Chen"
        avatar="/avatars/cara.svg"
        phase={shownPhase}
        onPhaseChange={change}
        muted={shownMuted}
        onMutedChange={setMuted}
        cameraOff={cameraOff}
        onCameraOffChange={setCameraOff}
        sharing={sharing}
        onSharingChange={setSharing}
        seconds={shownSeconds}
      />
    </div>
  );
}
