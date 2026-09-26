import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

// The orb's soft accent: mist in a pale blue, a violet and a cool cyan. Raw
// colours on purpose, as the one accent this component carries; each is a
// light-dark() pair so the mist glows on a dark page and stays airy on a
// light one.
const MIST = [
  "light-dark(oklch(0.72 0.14 255), oklch(0.62 0.17 262))",
  "light-dark(oklch(0.8 0.1 300), oklch(0.62 0.13 300))",
  "light-dark(oklch(0.86 0.09 210), oklch(0.7 0.1 215))",
  "light-dark(oklch(0.78 0.12 240), oklch(0.55 0.14 250))",
];

// Per blob: orbit rate and the Lissajous ratio of its path, so the four
// never fall into step and the mist never repeats visibly.
const BLOBS = [
  { rate: 0.9, a: 1, b: 1.6, phase: 0 },
  { rate: 0.7, a: 1.4, b: 1, phase: 2.1 },
  { rate: 1.1, a: 1, b: 1.3, phase: 4.2 },
  { rate: 0.55, a: 1.7, b: 1.1, phase: 5.3 },
];

// Per state: how lively the mist is (drift speed) and how far the blobs
// wander from the centre, as a share of the orb.
// Slow on purpose: the mist should drift like weather, never race. Even the
// busiest state takes well over ten seconds per lap.
const MOODS: Record<OrbState, { speed: number; spread: number }> = {
  idle: { speed: 0.14, spread: 0.12 },
  listening: { speed: 0.22, spread: 0.15 },
  // A slow shared swirl, so thinking reads as one motion, not noise.
  thinking: { speed: 0.5, spread: 0.18 },
  speaking: { speed: 0.32, spread: 0.17 },
};

const LABELS: Record<OrbState, string> = {
  idle: "Tap listen to talk",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

// Attack faster than release, so sounds land quickly and fade away, but
// both soft enough that the orb breathes with a voice instead of twitching
// on every syllable.
const ATTACK = 7;
const RELEASE = 2.8;

type Mic = { stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode };

export function VoiceOrb({
  state,
  size = 208,
  mic,
  paused = false,
  className,
}: {
  state: OrbState;
  size?: number;
  // A live microphone to follow while listening. Without one, listening
  // shows a quiet simulated room.
  mic?: Mic | null;
  // Holds a still frame and runs nothing, for idle previews.
  paused?: boolean;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const blobRefs = useRef<(HTMLDivElement | null)[]>([]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ringRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stateRef = useRef(state);
  const micRef = useRef(mic);

  useEffect(() => {
    stateRef.current = state;
    micRef.current = mic;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!root || paused) return;
    let frame = 0;
    let visible = true;
    let last = performance.now();
    let t = 0;
    // Each blob's angle advances a little every frame. Computing it as
    // time x speed instead would make any change of speed rescale all the
    // time gone by, flinging every blob around the orb in one frame.
    const angles = BLOBS.map((b) => b.phase);
    let level = 0;
    let speed = MOODS[stateRef.current].speed;
    let spread = MOODS[stateRef.current].spread;
    // Speech: a target that hops every syllable, with the odd pause.
    let syllable = 0;
    let target = 0;
    const samples = new Float32Array(512);

    const read = (dt: number) => {
      const s = stateRef.current;
      if (s === "listening") {
        const m = micRef.current;
        if (m) {
          m.analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const v of samples) sum += v * v;
          const rms = Math.sqrt(sum / samples.length);
          // Room tone sits near 0.005; normal speech peaks around 0.1.
          return Math.min(Math.max((rms - 0.008) * 9, 0), 1);
        }
        // No mic: a quiet room with the occasional murmur.
        return 0.08 + 0.06 * Math.sin(t * 2.3) + 0.04 * Math.sin(t * 5.1);
      }
      if (s === "speaking") {
        syllable -= dt;
        if (syllable <= 0) {
          const pause = Math.random() < 0.14;
          syllable = pause ? 0.3 + Math.random() * 0.3 : 0.16 + Math.random() * 0.18;
          target = pause ? 0.05 : 0.35 + Math.random() * 0.5;
        }
        return target;
      }
      if (s === "thinking") return 0.14 + 0.08 * Math.sin(t * 3.2);
      return 0.06 + 0.04 * Math.sin(t * 1.3);
    };

    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      const mood = MOODS[stateRef.current];
      // Moods blend rather than switch, so a change of state eases in.
      // About a second to settle into a new state.
      const k = 1 - Math.exp(-1.6 * dt);
      speed += (mood.speed - speed) * k;
      spread += (mood.spread - spread) * k;
      const want = read(dt);
      level += (want - level) * (1 - Math.exp(-(want > level ? ATTACK : RELEASE) * dt));
      t += dt * (reduceMotion ? 0.2 : 1);

      const drift = reduceMotion ? 0 : 1;
      BLOBS.forEach((b, i) => {
        const el = blobRefs.current[i];
        if (!el) return;
        angles[i] += dt * speed * b.rate * drift;
        const angle = angles[i];
        // The voice mostly swells and brightens the mist; it only nudges
        // where the blobs are, so loud moments never throw them around.
        const r = (spread + level * 0.03) * size * drift;
        const x = Math.cos(angle * b.a) * r;
        const y = Math.sin(angle * b.b) * r;
        const s = 1 + level * (i % 2 ? 0.22 : 0.14);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;
      });
      // The whole orb swells a touch with the voice; the rings carry the
      // rest of it outward, the outer one lagging behind.
      if (bodyRef.current)
        bodyRef.current.style.transform = `scale(${(1 + level * 0.025 * drift).toFixed(3)})`;
      ringRefs.current.forEach((ring, i) => {
        if (!ring) return;
        const grow = 1 + (0.06 + i * 0.07) + level * (0.05 + i * 0.06) * drift;
        ring.style.transform = `scale(${grow.toFixed(3)})`;
        ring.style.opacity = (0.35 + level * 0.5 - i * 0.12).toFixed(3);
      });

      frame = visible ? requestAnimationFrame(step) : 0;
    };

    // Sleeps offscreen, so a page full of other things never pays for it.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !frame) {
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
    });
    io.observe(root);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, [paused, reduceMotion, size]);

  const blob = size * 0.62;

  return (
    <div
      ref={rootRef}
      className={cn("relative grid place-items-center", className)}
      style={{ width: size * 1.5, height: size * 1.5 }}
    >
      {/* Two faint rings around the orb carry the voice outward. */}
      {[0, 1].map((i) => (
        <div
          key={i}
          ref={(el) => void (ringRefs.current[i] = el)}
          aria-hidden
          className="absolute rounded-full border border-foreground/10"
          style={{
            width: size,
            height: size,
            transform: `scale(${1.06 + i * 0.07})`,
            opacity: 0.35 - i * 0.12,
          }}
        />
      ))}
      <div
        ref={bodyRef}
        aria-hidden
        className="relative overflow-hidden rounded-full bg-[light-dark(oklch(0.985_0.005_250),oklch(0.2_0.02_260))]"
        style={{ width: size, height: size }}
      >
        {/* The mist: soft blobs drifting on their own paths, blurred together
            so they read as one moving light inside the glass. */}
        <div className="absolute inset-0 blur-[14px]">
          {BLOBS.map((_, i) => (
            <div
              key={i}
              ref={(el) => void (blobRefs.current[i] = el)}
              className="absolute top-1/2 left-1/2 rounded-full"
              style={{
                width: blob,
                height: blob,
                marginLeft: -blob / 2,
                marginTop: -blob / 2,
                background: `radial-gradient(circle, ${MIST[i]} 0%, transparent 68%)`,
                opacity: i === 3 ? 0.7 : 0.9,
              }}
            />
          ))}
        </div>
        {/* Glass: a lit upper edge, a darker lower one, and a soft
            highlight, so it reads as a sphere, not a flat disc. */}
        <div className="absolute inset-0 rounded-full shadow-[inset_0_2px_10px_oklch(1_0_0/0.55),inset_0_-14px_30px_oklch(0_0_0/0.06),inset_0_0_0_1px_oklch(0_0_0/0.05)] dark:shadow-[inset_0_2px_12px_oklch(1_0_0/0.12),inset_0_-14px_30px_oklch(0_0_0/0.35),inset_0_0_0_1px_oklch(1_0_0/0.08)]" />
        <div className="absolute top-[9%] left-[22%] h-[22%] w-[38%] rotate-[-18deg] rounded-full bg-[radial-gradient(closest-side,oklch(1_0_0/0.5),transparent)] dark:opacity-40" />
      </div>
    </div>
  );
}

export function useMicrophone() {
  const [mic, setMic] = useState<Mic | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (mic) return mic;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const next = { stream, ctx, analyser };
      setMic(next);
      setError(null);
      return next;
    } catch {
      setError("Microphone is blocked, so this is a pretend room.");
      return null;
    }
  };

  const stop = () => {
    if (!mic) return;
    mic.stream.getTracks().forEach((track) => track.stop());
    void mic.ctx.close();
    setMic(null);
  };

  // Never leaves the mic open behind a closed page.
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  });
  useEffect(
    () => () => {
      const m = micRef.current;
      m?.stream.getTracks().forEach((track) => track.stop());
      void m?.ctx.close();
    },
    [],
  );

  return { mic, error, start, stop };
}

const ACTIONS: { state: OrbState; label: string }[] = [
  { state: "listening", label: "Listen" },
  { state: "thinking", label: "Think" },
  { state: "speaking", label: "Speak" },
];

export default function VoiceOrbDemo() {
  const play = usePreviewPlay();
  const [state, setState] = useState<OrbState>("idle");
  const { mic, error, start, stop } = useMicrophone();

  // In an index card, hovering acts out one exchange: a beat of thought,
  // then an answer, then back to rest, on repeat.
  useEffect(() => {
    if (play !== true) return;
    const script: [OrbState, number][] = [
      ["thinking", 1100],
      ["speaking", 2800],
      ["idle", 900],
    ];
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const [s, ms] = script[i % script.length];
      setState(s);
      i++;
      timer = setTimeout(next, ms);
    };
    timer = setTimeout(next, 150);
    // Unhovered: back to rest, through the orb's own easing.
    return () => {
      clearTimeout(timer);
      setState("idle");
    };
  }, [play]);

  const choose = async (next: OrbState) => {
    const leaving = state === next;
    const target = leaving ? "idle" : next;
    if (target === "listening") await start();
    else stop();
    setState(target);
  };

  return (
    <div className="flex w-[min(360px,100%)] flex-col items-center">
      <VoiceOrb state={state} mic={mic} paused={play === false} />
      <div className="-mt-6 grid h-6 place-items-center">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.p
            key={state}
            aria-live="polite"
            initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, filter: "blur(4px)", transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
            className="col-start-1 row-start-1 text-[15px] text-muted"
          >
            {LABELS[state]}
          </motion.p>
        </AnimatePresence>
      </div>
      <div className="mt-5 flex gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.state}
            type="button"
            aria-pressed={state === a.state}
            onClick={() => void choose(a.state)}
            className={cn(
              "h-9 touch-manipulation rounded-full px-4 text-sm font-medium outline-hidden transition-[scale,background-color,color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]",
              state === a.state
                ? "bg-foreground text-background"
                : "bg-surface text-foreground hover:bg-foreground/10",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="mt-3 h-4 text-xs text-muted">
        {state === "listening"
          ? (error ?? (mic ? "Using your mic. Nothing is recorded." : ""))
          : ""}
      </p>
    </div>
  );
}
