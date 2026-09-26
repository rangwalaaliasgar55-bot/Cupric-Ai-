import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

export type Incident = {
  // Days before today: 0 is today.
  daysAgo: number;
  level: "degraded" | "outage";
  title: string;
  minutes: number;
};

export type Service = { name: string; incidents: Incident[] };

// Status colours are data, so raw values. Healthy days are a quiet,
// low-chroma green so two months of calm doesn't shout; amber and red keep
// their strength, since incidents are what you came to find.
const COLOR = {
  ok: "light-dark(oklch(0.8 0.09 160), oklch(0.58 0.08 160))",
  degraded: "oklch(0.8 0.15 78)",
  outage: "oklch(0.64 0.2 25)",
} as const;

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const DAY_MINUTES = 1440;

const ago = (d: number) =>
  d === 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`;

const short = (m: number) =>
  m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;

function uptime(service: Service, days: number) {
  const down = service.incidents
    .filter((i) => i.daysAgo < days)
    // Degraded counts at a third: slow isn't down, but it isn't fine.
    .reduce(
      (t, i) => t + (i.level === "outage" ? i.minutes : i.minutes / 3),
      0,
    );
  return (100 * (1 - down / (days * DAY_MINUTES))).toFixed(2);
}

type Spot = { row: number; day: number };

export function UptimeBar({
  services,
  spot: controlled,
  className,
}: {
  services: Service[];
  // Drives the highlight from outside (the card preview); null clears it.
  spot?: Spot | null;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  // A phone gets half the history so every day stays a real, tappable bar.
  const [days, setDays] = useState(60);
  const [hover, setHover] = useState<Spot | null>(null);
  const spot = controlled !== undefined ? controlled : hover;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setDays(el.offsetWidth < 400 ? 30 : 60);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const incidentOn = (s: Service, day: number) =>
    s.incidents.find((i) => i.daysAgo === day);
  const operational = services.every((s) => !incidentOn(s, 0));

  // Divides out any CSS scale, so the maths holds inside a scaled card.
  const pick = (row: number, e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (rect.width / el.offsetWidth || 1);
    const index = Math.min(
      days - 1,
      Math.max(0, Math.floor((x / el.offsetWidth) * days)),
    );
    const day = days - 1 - index;
    if (hover?.row !== row || hover.day !== day) setHover({ row, day });
  };

  const swap = reduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: EASE_OUT };

  return (
    <div ref={root} className={cn("w-[min(440px,100%)]", className)}>
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-[15px] font-medium text-foreground">
          <span
            className="size-2 rounded-full"
            style={{ background: operational ? COLOR.ok : COLOR.degraded }}
          />
          {operational ? "All systems operational" : "Some systems degraded"}
        </p>
        <p className="text-[13px] text-muted tabular-nums">
          Last {days} days
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-6">
        {services.map((s, r) => {
          const here = spot?.row === r ? spot : null;
          const inc = here ? incidentOn(s, here.day) : undefined;
          return (
            <div key={s.name}>
              <div className="mb-2.5 flex h-5 items-center justify-between gap-4 text-[14px]">
                <span className="shrink-0 font-medium text-foreground">
                  {s.name}
                </span>
                {/* The caption is the readout: point at a day and the
                    uptime figure becomes that day's story, in place. */}
                <span className="flex min-w-0 items-center justify-end gap-2 text-muted">
                  {here && (
                    <span className="shrink-0 tabular-nums">
                      {ago(here.day)}
                    </span>
                  )}
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.span
                      key={here ? (inc ? inc.title : "ok") : "uptime"}
                      initial={{ opacity: 0, y: 4, filter: "blur(4px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{
                        opacity: 0,
                        y: -4,
                        filter: "blur(4px)",
                        transition: { duration: 0.12 },
                      }}
                      transition={swap}
                      className="flex min-w-0 items-center gap-1.5"
                    >
                      {here ? (
                        <>
                          <span
                            className="size-1.5 shrink-0 rounded-full"
                            style={{
                              background: inc ? COLOR[inc.level] : COLOR.ok,
                            }}
                          />
                          <span
                            className={cn("truncate", inc && "text-foreground")}
                          >
                            {inc
                              ? `${inc.title}, ${short(inc.minutes)}`
                              : "No downtime"}
                          </span>
                        </>
                      ) : (
                        <span className="tabular-nums">
                          {uptime(s, days)}% uptime
                        </span>
                      )}
                    </motion.span>
                  </AnimatePresence>
                </span>
              </div>

              <div
                role="group"
                tabIndex={0}
                aria-label={`${s.name}: ${uptime(s, days)}% uptime over ${days} days. Arrow keys step through days.`}
                onPointerMove={(e) => pick(r, e)}
                onPointerLeave={() => setHover(null)}
                onFocus={() =>
                  setHover((h) => (h?.row === r ? h : { row: r, day: 0 }))
                }
                onBlur={() => setHover(null)}
                onKeyDown={(e) => {
                  const step =
                    e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
                  if (e.key === "Home") setHover({ row: r, day: days - 1 });
                  else if (e.key === "End") setHover({ row: r, day: 0 });
                  else if (e.key === "Escape") setHover(null);
                  else if (step) {
                    e.preventDefault();
                    setHover((h) => ({
                      row: r,
                      day: Math.min(
                        days - 1,
                        Math.max(0, (h?.row === r ? h.day : 0) + step),
                      ),
                    }));
                  }
                }}
                className="flex h-7 cursor-default gap-[3px] rounded-[4px] outline-hidden focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-solid focus-visible:outline-foreground"
              >
                {Array.from({ length: days }, (_, i) => {
                  const day = days - 1 - i;
                  const bad = incidentOn(s, day);
                  const on = here?.day === day;
                  return (
                    <span
                      key={day}
                      className="h-full min-w-0 flex-1 rounded-[2px] transition-[opacity,transform] duration-150 ease-out"
                      style={{
                        background: bad ? COLOR[bad.level] : COLOR.ok,
                        // The rest of the row steps back so the day you're
                        // on is the one that reads.
                        opacity: here && !on ? 0.35 : 1,
                        transform:
                          on && !reduceMotion ? "scaleY(1.15)" : "none",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex justify-between text-[12px] text-muted">
        <span>{days} days ago</span>
        <span>Today</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {spot
          ? `${services[spot.row].name}, ${ago(spot.day)}: ${(() => {
              const inc = incidentOn(services[spot.row], spot.day);
              return inc ? `${inc.title}, ${short(inc.minutes)}` : "no downtime";
            })()}`
          : ""}
      </p>
    </div>
  );
}

const SERVICES: Service[] = [
  {
    name: "API",
    incidents: [
      { daysAgo: 51, level: "degraded", title: "Elevated errors", minutes: 38 },
      { daysAgo: 22, level: "outage", title: "Database failover", minutes: 72 },
      { daysAgo: 6, level: "degraded", title: "High latency", minutes: 21 },
    ],
  },
  {
    name: "Dashboard",
    incidents: [
      { daysAgo: 40, level: "degraded", title: "Slow page loads", minutes: 44 },
      { daysAgo: 12, level: "degraded", title: "Stale charts", minutes: 16 },
    ],
  },
  {
    name: "Webhooks",
    incidents: [
      { daysAgo: 57, level: "degraded", title: "Delayed deliveries", minutes: 30 },
      { daysAgo: 18, level: "outage", title: "Deliveries paused", minutes: 26 },
      { daysAgo: 17, level: "degraded", title: "Retry backlog", minutes: 55 },
    ],
  },
];

// The card's hover show: skimming the API row, resting on the outage, then
// the same on webhooks. [where, how long to stay]
const SWEEP: [Spot, number][] = [
  [{ row: 0, day: 30 }, 120],
  [{ row: 0, day: 27 }, 120],
  [{ row: 0, day: 24 }, 120],
  [{ row: 0, day: 22 }, 1500],
  [{ row: 2, day: 22 }, 120],
  [{ row: 2, day: 20 }, 120],
  [{ row: 2, day: 18 }, 1500],
  [{ row: 2, day: 17 }, 1300],
];

export default function UptimeBarDemo() {
  const play = usePreviewPlay();
  const [spot, setSpot] = useState<Spot | null>(null);

  useEffect(() => {
    if (play !== true) return;
    let timer: ReturnType<typeof setTimeout>;
    let i = 0;
    const next = () => {
      const [s, stay] = SWEEP[i % SWEEP.length];
      setSpot(s);
      i++;
      timer = setTimeout(next, stay);
    };
    timer = setTimeout(next, 200);
    return () => {
      clearTimeout(timer);
      setSpot(null);
    };
  }, [play]);

  return (
    <UptimeBar services={SERVICES} spot={play === null ? undefined : spot} />
  );
}
