import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type ActivityKind = "commit" | "comment" | "deploy";
export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  actor: string;
  action: string;
  target: string;
  detail: string;
  // Epoch milliseconds.
  at: number;
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The row opens its own height while the content blurs in just behind it, so
// the space is there before the words arrive.
const OPEN = { duration: 0.28, ease: EASE_OUT };
const REVEAL = { duration: 0.25, ease: EASE_OUT, delay: 0.06 };
const LEAVE = { duration: 0.15, ease: EASE_OUT };
const INSTANT = { duration: 0 };
// Relative times only change by the minute, so a 15s tick is plenty and keeps
// re-renders rare.
const TICK = 15_000;

export function relativeTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ActivityTimeline({
  events,
  now,
  label = "Activity",
  className,
}: {
  events: ActivityEvent[];
  // Passed in so every row agrees on the time and one tick updates them all.
  now: number;
  label?: string;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      <AnimatePresence initial={false}>
        {events.map((event, i) => (
          <motion.li
            key={event.id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: reduceMotion ? INSTANT : LEAVE }}
            transition={reduceMotion ? INSTANT : OPEN}
            className="relative overflow-hidden"
          >
            {i < events.length - 1 && (
              // Runs from 4px under this node to 4px above the next one. It
              // lives in the row, so a new row opening draws its own segment
              // and the line grows with it.
              <span
                aria-hidden
                className="absolute top-9 bottom-1 left-[15.5px] w-px bg-border"
              />
            )}
            <motion.div
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, filter: "blur(4px)", y: -6 }
              }
              animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              transition={REVEAL}
              className="flex gap-3 pb-5"
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-background text-muted inset-ring inset-ring-border"
              >
                <KindIcon kind={event.kind} />
              </span>
              {/* 6px down centers the 20px first line on the 32px node. */}
              <div className="min-w-0 flex-1 pt-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-sm text-muted">
                    <span className="font-medium text-foreground">{event.actor}</span>{" "}
                    {event.action}{" "}
                    <span className="font-medium text-foreground">{event.target}</span>
                  </p>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {relativeTime(now - event.at)}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-1 text-sm text-muted",
                    event.kind === "commit" && "font-mono text-[13px]",
                  )}
                >
                  {event.detail}
                </p>
              </div>
            </motion.div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

function KindIcon({ kind }: { kind: ActivityKind }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "commit" && (
        <>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M1.75 8h3.75M10.5 8h3.75" />
        </>
      )}
      {kind === "comment" && (
        <path d="M3.5 2.75h9a1.25 1.25 0 0 1 1.25 1.25v6a1.25 1.25 0 0 1-1.25 1.25H7.5l-3 2.5v-2.5h-1A1.25 1.25 0 0 1 2.25 10V4A1.25 1.25 0 0 1 3.5 2.75Z" />
      )}
      {kind === "deploy" && <path d="M8 10.5V2.75M4.75 6 8 2.75 11.25 6M3 13.25h10" />}
    </svg>
  );
}

type Template = Omit<ActivityEvent, "id" | "at">;

const POOL: Template[] = [
  { kind: "commit", actor: "Yash", action: "pushed to", target: "main", detail: "fix: debounce the search input" },
  { kind: "comment", actor: "Mira", action: "commented on", target: "#482", detail: "Looks good, one nit on the spacing." },
  { kind: "deploy", actor: "Deploys", action: "shipped", target: "v2.4.1", detail: "Production, build finished in 48s" },
  { kind: "commit", actor: "Arjun", action: "pushed to", target: "feat/timeline", detail: "feat: relative times that update" },
  { kind: "comment", actor: "Yash", action: "replied on", target: "#479", detail: "Pinned it to the top, try again?" },
  { kind: "deploy", actor: "Deploys", action: "shipped", target: "preview-913", detail: "Preview for feat/timeline is ready" },
];

// Offsets for the seed rows. Built from a start time captured once, so the
// server and client render the same "2m ago" text.
const SEED: { template: Template; ago: number }[] = [
  { template: POOL[1], ago: 2 * 60_000 },
  { template: POOL[0], ago: 18 * 60_000 },
  { template: POOL[2], ago: 60 * 60_000 },
  { template: POOL[4], ago: 3 * 60 * 60_000 },
  { template: POOL[3], ago: 26 * 60 * 60_000 },
];
// Older rows fall off the bottom so the feed never grows without bound.
const MAX_EVENTS = 20;

export default function ActivityTimelineDemo() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  const [events, setEvents] = useState<ActivityEvent[]>(() =>
    SEED.map(({ template, ago }, i) => ({ ...template, id: `seed-${i}`, at: start - ago })),
  );
  const [announcement, setAnnouncement] = useState("");
  const next = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK);
    return () => clearInterval(id);
  }, []);

  const add = () => {
    const n = next.current++;
    const template = POOL[(n + 2) % POOL.length];
    const at = Date.now();
    setNow(at);
    setEvents((list) => [{ ...template, id: `new-${n}`, at }, ...list].slice(0, MAX_EVENTS));
    setAnnouncement(`${template.actor} ${template.action} ${template.target}`);
  };

  return (
    <div className="w-[min(440px,100%)] overflow-hidden rounded-[24px] bg-background shadow-raised">
      <div className="flex items-center justify-between gap-3 border-b border-border py-3 pr-3 pl-5">
        <h2 className="text-base font-medium text-foreground">Activity</h2>
        <button
          type="button"
          onClick={add}
          className="h-9 touch-manipulation rounded-full bg-surface px-3.5 text-sm font-medium text-foreground outline-hidden transition-[scale,background-color] duration-150 ease-out select-none hover:bg-border focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[background-color]"
        >
          Simulate event
        </button>
      </div>
      {/* Fixed height with its own scroll, so new rows never push the page
          or the button. The bottom fades out to show there is more. */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Activity feed"
        className="h-[400px] overflow-y-auto overscroll-contain px-5 pt-5 pb-6 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground"
        style={{
          maskImage: "linear-gradient(to bottom, black calc(100% - 32px), transparent)",
        }}
      >
        <ActivityTimeline events={events} now={now} />
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
