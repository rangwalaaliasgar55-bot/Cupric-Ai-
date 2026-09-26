import { useId, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type TabBarItem = {
  id: string;
  label: string;
  // Drawn once and reused for both states: outline when idle, filled when
  // active, so the two can never drift apart.
  icon: React.ReactNode;
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
// The pill and the widths share one spring so the row reflows as a single
// motion. No bounce: a pill that overshoots its tab reads as imprecise.
const SLIDE = { type: "spring", visualDuration: 0.3, bounce: 0 } as const;
const INSTANT = { duration: 0 } as const;
// Waits a beat for the tab to start widening, so the label fades into room
// that is opening rather than being squeezed.
const LABEL_IN = { duration: 0.2, delay: 0.05, ease: EASE_OUT };
const LABEL_OUT = { duration: 0.1, ease: EASE_OUT };

export function TabBar({
  items,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  items: readonly TabBarItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  // Lets the caller point tab panels back at their tabs.
  idBase: string;
  className?: string;
}) {
  const reduce = useReducedMotion() ?? false;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const index = Math.max(
    items.findIndex((t) => t.id === value),
    0,
  );
  const layout = reduce ? INSTANT : SLIDE;

  return (
    <LayoutGroup id={idBase}>
      <div
        role="tablist"
        aria-label={label}
        className={cn("flex items-center justify-between", className)}
        onKeyDown={(e) => {
          const target = {
            ArrowRight: index + 1,
            ArrowLeft: index - 1,
            Home: 0,
            End: items.length - 1,
          }[e.key];
          if (target === undefined) return;
          e.preventDefault();
          // Automatic activation, animated exactly like a tap.
          const next = items[(target + items.length) % items.length].id;
          onChange(next);
          refs.current.get(next)?.focus();
        }}
      >
        {items.map((item) => {
          const active = item.id === items[index].id;
          return (
            <motion.button
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${idBase}-tab-${item.id}`}
              aria-selected={active}
              aria-controls={active ? `${idBase}-panel-${item.id}` : undefined}
              aria-label={item.label}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.id)}
              layout
              // Only a change of tab moves anything, so unrelated renders
              // skip the measure.
              layoutDependency={value}
              transition={{ layout }}
              // Radius set in style so Motion can correct it while the
              // button's box is scaled mid-morph.
              style={{ borderRadius: 24 }}
              className={cn(
                "group relative flex h-12 touch-manipulation items-center overflow-hidden px-3 outline-hidden select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground",
                active ? "text-foreground" : "text-muted",
                "transition-[color] duration-150 ease-out",
              )}
            >
              {active && (
                <motion.span
                  layoutId="pill"
                  aria-hidden
                  className="absolute inset-0 bg-foreground/[0.07]"
                  style={{ borderRadius: 24 }}
                  transition={{ layout }}
                />
              )}
              {/* Position-only, so the icon and label ride along with the
                  morph without being stretched by it. */}
              <motion.span
                layout="position"
                layoutDependency={value}
                transition={{ layout }}
                className="relative flex"
              >
                <span className="relative flex items-center gap-2 transition-[scale] duration-150 ease-out group-active:scale-[0.96] motion-reduce:transition-none">
                  <Icon active={active}>{item.icon}</Icon>
                  <AnimatePresence initial={false} mode="popLayout">
                    {active && (
                      <motion.span
                        key="label"
                        aria-hidden
                        initial={{
                          opacity: 0,
                          filter: reduce ? "blur(0px)" : "blur(4px)",
                        }}
                        animate={{
                          opacity: 1,
                          filter: "blur(0px)",
                          transition: LABEL_IN,
                        }}
                        exit={{
                          opacity: 0,
                          filter: "blur(0px)",
                          transition: LABEL_OUT,
                        }}
                        className="pr-1 text-sm font-medium whitespace-nowrap"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </span>
              </motion.span>
            </motion.button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

function Icon({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="grid size-6 shrink-0" aria-hidden>
      <svg
        viewBox="0 0 24 24"
        className="col-start-1 row-start-1 size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
      {/* The fill floods out from the icon's middle and drains back in: a
          clip-path transition, so a quick second tap reverses it midway. */}
      <svg
        viewBox="0 0 24 24"
        className={cn(
          "col-start-1 row-start-1 size-6 transition-[clip-path,opacity] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:[clip-path:none]",
          active
            ? "[clip-path:circle(75%_at_50%_55%)] opacity-100 duration-200"
            : "[clip-path:circle(0%_at_50%_55%)] opacity-0 duration-150",
        )}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

const ITEMS: TabBarItem[] = [
  {
    id: "home",
    label: "Home",
    icon: (
      <path d="M4 10.25 12 4l8 6.25V19a1 1 0 0 1-1 1h-4.5v-5.25h-5V20H5a1 1 0 0 1-1-1Z" />
    ),
  },
  {
    id: "search",
    label: "Search",
    icon: (
      <>
        <circle cx="11" cy="11" r="6.25" />
        <path d="m20 20-4.5-4.5" />
      </>
    ),
  },
  {
    id: "activity",
    label: "Activity",
    icon: (
      <>
        <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15Z" />
        <path d="M10 20.75a2 2 0 0 0 4 0Z" />
      </>
    ),
  },
  {
    id: "profile",
    label: "Profile",
    icon: (
      <>
        <circle cx="12" cy="8.5" r="3.75" />
        <path d="M5.25 20c.7-3.4 3.4-5.5 6.75-5.5s6.05 2.1 6.75 5.5Z" />
      </>
    ),
  },
];

const panel = {
  enter: (reduce: boolean) => ({
    opacity: 0,
    y: reduce ? 0 : 6,
    filter: reduce ? "blur(0px)" : "blur(4px)",
  }),
  center: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.24, ease: EASE_OUT },
  },
  // Faster and without movement, so the outgoing screen never competes with
  // the incoming one.
  exit: {
    opacity: 0,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.12, ease: EASE_OUT },
  },
};

function Row({
  title,
  meta,
  lead,
}: {
  title: string;
  meta: string;
  lead?: string;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {lead && (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-[13px] font-medium text-foreground">
          {lead}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] text-foreground">{title}</span>
        <span className="truncate text-[13px] text-muted">{meta}</span>
      </span>
    </li>
  );
}

const SCREENS: Record<string, { title: string; body: React.ReactNode }> = {
  home: {
    title: "Home",
    body: (
      <>
        <p className="text-[15px] text-muted">Three things on today.</p>
        <ul className="mt-3 divide-y divide-border">
          <Row title="Standup notes" meta="9:30, with the design team" />
          <Row title="Review tab bar" meta="11:00, two comments open" />
          <Row title="Ship the release" meta="Before 5, tagged v2.4" />
        </ul>
      </>
    ),
  },
  search: {
    title: "Search",
    body: (
      <>
        <input
          type="search"
          aria-label="Search"
          placeholder="Search notes and people"
          className="h-11 w-full rounded-xl bg-surface px-3.5 text-[15px] text-foreground outline-hidden placeholder:text-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground"
        />
        <p className="mt-5 text-[13px] font-medium text-muted">Recent</p>
        <ul className="mt-1 divide-y divide-border">
          <Row title="spring presets" meta="Searched yesterday" />
          <Row title="Mira Chen" meta="Person" />
          <Row title="release checklist" meta="Searched Monday" />
        </ul>
      </>
    ),
  },
  activity: {
    title: "Activity",
    body: (
      <ul className="divide-y divide-border">
        <Row lead="MC" title="Mira liked your note" meta="2 minutes ago" />
        <Row lead="JO" title="Jon replied in Review" meta="18 minutes ago" />
        <Row lead="AK" title="Ana shared a folder" meta="1 hour ago" />
      </ul>
    ),
  },
  profile: {
    title: "Profile",
    body: (
      <>
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface text-[15px] font-medium text-foreground">
            YB
          </span>
          <span className="flex flex-col">
            <span className="text-[15px] font-medium text-foreground">
              Yash Bavadiya
            </span>
            <span className="text-[13px] text-muted">@xevrion</span>
          </span>
        </div>
        <ul className="mt-4 divide-y divide-border">
          <Row title="Notifications" meta="Mentions and replies" />
          <Row title="Appearance" meta="Follows the system" />
          <Row title="Privacy" meta="Profile visible to team" />
        </ul>
      </>
    ),
  },
};

export default function TabBarDemo() {
  const reduce = useReducedMotion() ?? false;
  const base = useId();
  const [tab, setTab] = useState("home");
  const screen = SCREENS[tab];

  return (
    // 44px outer radius = the screen's 36px plus the 8px bezel.
    <div className="flex h-[560px] w-[min(320px,100%)] flex-col rounded-[44px] bg-surface p-2 shadow-raised">
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-[36px] bg-background">
        <div
          aria-hidden
          className="flex h-11 shrink-0 items-center justify-between px-7 pt-1 text-[13px] font-semibold text-foreground tabular-nums"
        >
          <span>9:41</span>
          <svg viewBox="0 0 26 12" className="h-3 w-[26px]" fill="none">
            <rect
              x="0.5"
              y="0.5"
              width="22"
              height="11"
              rx="3"
              stroke="currentColor"
              opacity="0.4"
            />
            <rect x="2" y="2" width="15" height="8" rx="1.75" fill="currentColor" />
            <path d="M24.5 4v4" stroke="currentColor" opacity="0.4" strokeLinecap="round" />
          </svg>
        </div>

        {/* Screens share one grid cell while they cross, so the old one
            never pushes the new one around. */}
        <div className="grid min-h-0 flex-1">
          <AnimatePresence initial={false} custom={reduce}>
            <motion.div
              key={tab}
              role="tabpanel"
              id={`${base}-panel-${tab}`}
              aria-labelledby={`${base}-tab-${tab}`}
              tabIndex={0}
              custom={reduce}
              variants={panel}
              initial="enter"
              animate="center"
              exit="exit"
              className="col-start-1 row-start-1 min-h-0 overflow-hidden px-5 pt-3 outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground"
            >
              <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                {screen.title}
              </h3>
              <div className="mt-3">{screen.body}</div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="shrink-0 border-t border-border px-4 pt-2">
          <TabBar
            idBase={base}
            label="Sections"
            items={ITEMS}
            value={tab}
            onChange={setTab}
          />
          <div aria-hidden className="mx-auto mt-3 mb-2 h-1 w-28 rounded-full bg-foreground/25" />
        </div>
      </div>
    </div>
  );
}
