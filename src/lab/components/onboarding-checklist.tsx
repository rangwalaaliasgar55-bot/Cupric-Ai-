import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type Task = {
  id: string;
  title: string;
  description: string;
  action: string;
};

const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Slower than a UI transition on purpose: the ring and its number are the
// reward, and half a second is long enough to watch them count up. No
// bounce, so the number never reads past 100.
const RING = { visualDuration: 0.5, bounce: 0 };
// Lets the last check and the ring reaching 100 land before the card
// changes, so the finish is seen rather than skipped.
const CELEBRATE_AFTER = 700;
const RADIUS = 20;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

export function OnboardingChecklist({
  tasks,
  initialDone = [],
  initialOpen = [],
  onDismiss,
  className,
}: {
  tasks: Task[];
  initialDone?: string[];
  initialOpen?: string[];
  onDismiss?: () => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [done, setDone] = useState(() => new Set(initialDone));
  const [open, setOpen] = useState(() => new Set(initialOpen));
  const [celebrating, setCelebrating] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const titleId = useId();

  const count = tasks.filter((t) => done.has(t.id)).length;
  const complete = count === tasks.length;
  const progress = count / tasks.length;

  const ring = useSpring(progress, RING);
  const percent = useTransform(ring, (v) => Math.round(v * 100));
  useEffect(() => {
    if (reduceMotion) ring.jump(progress);
    else ring.set(progress);
  }, [progress, reduceMotion, ring]);

  useEffect(() => {
    if (!complete) return;
    const id = setTimeout(() => {
      setCelebrating(true);
      setAnnouncement("All tasks complete. You're all set.");
    }, CELEBRATE_AFTER);
    return () => clearTimeout(id);
  }, [complete]);

  const toggle = (task: Task, value: boolean) => {
    const next = new Set(done);
    if (value) next.add(task.id);
    else next.delete(task.id);
    setDone(next);
    const total = tasks.filter((t) => next.has(t.id)).length;
    setAnnouncement(
      `${task.title} ${value ? "done" : "not done"}. ${total} of ${tasks.length} complete.`,
    );
  };

  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "w-[min(400px,100%)] overflow-hidden rounded-[20px] bg-surface text-foreground shadow-raised",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-4 p-5 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="text-lg font-semibold tracking-[-0.01em]">
            Get started
          </h2>
          <p className="text-sm text-muted tabular-nums">
            {count} of {tasks.length} complete
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="relative grid size-12 shrink-0 place-items-center"
        >
          <svg viewBox="0 0 48 48" className="absolute inset-0 size-full -rotate-90" aria-hidden>
            <circle cx={24} cy={24} r={RADIUS} fill="none" strokeWidth={4} className="stroke-foreground/10" />
            <motion.circle
              cx={24}
              cy={24}
              r={RADIUS}
              fill="none"
              strokeWidth={4}
              strokeLinecap="round"
              className="stroke-foreground"
              style={{ pathLength: ring }}
            />
          </svg>
          <span className="relative text-xs font-medium tabular-nums">
            <motion.span>{percent}</motion.span>
            <span className="text-muted">%</span>
          </span>
        </div>
      </header>

      {/* The list and the finished state swap by collapsing one and opening
          the other, so the card only ever changes height below its header. */}
      <Collapse open={!celebrating}>
        <ul className="px-2 pb-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              done={done.has(task.id)}
              open={open.has(task.id)}
              reduceMotion={!!reduceMotion}
              onToggle={(v) => toggle(task, v)}
              onToggleOpen={() => toggleOpen(task.id)}
            />
          ))}
        </ul>
      </Collapse>

      <Collapse open={celebrating}>
        <div className="px-5 pt-1 pb-5">
          {celebrating && (
            <Celebration reduceMotion={!!reduceMotion} onDismiss={onDismiss} />
          )}
        </div>
      </Collapse>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      inert={!open}
      className={cn(
        "grid transition-[grid-template-rows] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
        open ? "grid-rows-[1fr] duration-300" : "grid-rows-[0fr] duration-200",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

function TaskRow({
  task,
  done,
  open,
  reduceMotion,
  onToggle,
  onToggleOpen,
}: {
  task: Task;
  done: boolean;
  open: boolean;
  reduceMotion: boolean;
  onToggle: (value: boolean) => void;
  onToggleOpen: () => void;
}) {
  const detailsId = `${useId()}-details`;
  return (
    <li>
      <div className="flex items-center">
        {/* A 40px hit area around the 20px box. */}
        <label className="group relative grid size-10 shrink-0 cursor-pointer place-items-center">
          <input
            type="checkbox"
            checked={done}
            onChange={(e) => onToggle(e.target.checked)}
            aria-label={task.title}
            className="peer absolute inset-0 cursor-pointer opacity-0"
          />
          <span
            aria-hidden
            className={cn(
              "pointer-events-none grid size-5 place-items-center rounded-md border-[1.5px] transition-[background-color,border-color,scale] duration-150 ease-out group-active:scale-[0.96] peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground motion-reduce:transition-[background-color,border-color]",
              done
                ? "border-foreground bg-foreground text-background"
                : "border-muted/60 [@media(hover:hover)]:group-hover:border-muted",
            )}
          >
            <motion.svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={
                done
                  ? { scale: 1, opacity: 1, filter: "blur(0px)" }
                  : reduceMotion
                    ? { scale: 1, opacity: 0, filter: "blur(0px)" }
                    : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
              }
              transition={ICON_SWAP}
            >
              <path d="m3.5 8.5 3 3 6-7" />
            </motion.svg>
          </span>
        </label>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={onToggleOpen}
          className="flex h-12 min-w-0 flex-1 items-center justify-between gap-3 rounded-[10px] pr-3 pl-1 text-left outline-hidden transition-[background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:bg-foreground/[0.06] [@media(hover:hover)]:hover:bg-foreground/[0.04]"
        >
          <span
            className={cn(
              "relative min-w-0 truncate text-[15px] transition-[color] duration-200 ease-out",
              done ? "text-muted" : "text-foreground",
            )}
          >
            {task.title}
            {/* Draws left to right when checked and retracts faster when
                unchecked: slow where it rewards, quick where it undoes. */}
            <span
              aria-hidden
              className={cn(
                "absolute top-1/2 left-0 h-px w-full origin-left bg-current transition-[scale] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                done ? "scale-x-100 duration-300" : "scale-x-0 duration-150",
              )}
            />
          </span>
          <svg
            viewBox="0 0 16 16"
            className={cn(
              "size-4 shrink-0 text-muted transition-[rotate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              open && "rotate-180",
            )}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      </div>

      {/* 0fr to 1fr animates to the content's real height. The row above
          never moves; only what's below it slides. */}
      <div
        id={detailsId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
          open ? "grid-rows-[1fr] duration-250" : "grid-rows-[0fr] duration-200",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              "flex flex-col items-start gap-3 pr-3 pb-4 pl-11 transition-[opacity,filter,translate] ease-out motion-reduce:transition-[opacity]",
              open
                ? "translate-y-0 opacity-100 blur-[0px] duration-250"
                : "-translate-y-1 opacity-0 blur-[4px] duration-150",
            )}
          >
            <p className="text-sm leading-5 text-pretty text-muted">{task.description}</p>
            <button
              type="button"
              aria-disabled={done}
              onClick={() => {
                if (!done) onToggle(true);
              }}
              className={cn(
                "grid h-9 rounded-full px-4 text-sm font-medium outline-hidden transition-[background-color,color,scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground",
                done
                  ? "cursor-default bg-foreground/[0.06] text-muted"
                  : "bg-foreground text-background active:scale-[0.96]",
              )}
            >
              {/* Both labels share a cell so the button keeps its width. */}
              <ActionLabel visible={!done}>{task.action}</ActionLabel>
              <ActionLabel visible={done} reduceMotion={reduceMotion} icon>
                Done
              </ActionLabel>
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function ActionLabel({
  visible,
  icon,
  reduceMotion,
  children,
}: {
  visible: boolean;
  icon?: boolean;
  reduceMotion?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden={!visible}
      className="col-start-1 row-start-1 flex items-center justify-center gap-1.5"
    >
      {icon && (
        <motion.svg
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={
            visible
              ? { scale: 1, opacity: 1, filter: "blur(0px)" }
              : reduceMotion
                ? { scale: 1, opacity: 0, filter: "blur(0px)" }
                : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
          }
          transition={ICON_SWAP}
        >
          <path d="m3.5 8.5 3 3 6-7" />
        </motion.svg>
      )}
      <span
        className={cn(
          "transition-[opacity,filter] duration-200 ease-out",
          !visible && "opacity-0 blur-[4px]",
        )}
      >
        {children}
      </span>
    </span>
  );
}

function Celebration({
  reduceMotion,
  onDismiss,
}: {
  reduceMotion: boolean;
  onDismiss?: () => void;
}) {
  // A rare, one-time moment, so it gets a gentle staggered entrance: the
  // heading, then the note, then the button, each 80ms apart.
  const enter = (i: number) => ({
    initial: reduceMotion
      ? { opacity: 0 }
      : { opacity: 0, y: 6, filter: "blur(4px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.4, ease: EASE_OUT, delay: 0.12 + i * 0.08 },
  });
  return (
    <div className="flex flex-col items-start gap-1">
      <motion.h3 {...enter(0)} className="text-[17px] font-semibold tracking-[-0.01em]">
        You&apos;re all set
      </motion.h3>
      <motion.p {...enter(1)} className="text-sm leading-5 text-pretty text-muted">
        Your workspace is ready. You can find these steps again any time in Settings.
      </motion.p>
      <motion.div {...enter(2)} className="mt-3">
        <button
          type="button"
          onClick={onDismiss}
          className="h-9 rounded-full bg-foreground px-4 text-sm font-medium text-background outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-none"
        >
          Dismiss
        </button>
      </motion.div>
    </div>
  );
}

const TASKS: Task[] = [
  {
    id: "project",
    title: "Create your first project",
    description: "Projects keep pages, settings and people together in one place.",
    action: "New project",
  },
  {
    id: "invite",
    title: "Invite a teammate",
    description: "Work goes faster together. Each teammate gets their own login.",
    action: "Send invite",
  },
  {
    id: "github",
    title: "Connect GitHub",
    description: "Link a repository so commits and pull requests show up here.",
    action: "Connect",
  },
  {
    id: "notifications",
    title: "Set up notifications",
    description: "Choose where you hear about mentions and reviews: email, desktop or both.",
    action: "Choose channels",
  },
  {
    id: "workspace",
    title: "Personalize your workspace",
    description: "Add a logo and a name so the space feels like yours.",
    action: "Open settings",
  },
];

export default function OnboardingChecklistDemo() {
  const [dismissed, setDismissed] = useState(false);
  // A new key remounts the card fresh after "Show checklist again".
  const [round, setRound] = useState(0);
  const restoreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dismissed) restoreRef.current?.focus();
  }, [dismissed]);

  return (
    <div className="relative flex w-[min(400px,100%)] flex-col items-center">
      <AnimatePresence mode="popLayout" initial={false}>
        {dismissed ? (
          <motion.button
            key="restore"
            ref={restoreRef}
            type="button"
            onClick={() => {
              setRound((r) => r + 1);
              setDismissed(false);
            }}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="h-9 rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised outline-hidden transition-[scale] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.96]"
          >
            Show checklist again
          </motion.button>
        ) : (
          <motion.div
            key={`card-${round}`}
            className="w-full"
            initial={{ opacity: 0, y: -4, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            // Leaves faster and smaller than it arrives.
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.15, ease: EASE_OUT } }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
          >
            <OnboardingChecklist
              tasks={TASKS}
              initialDone={["project"]}
              initialOpen={["invite"]}
              onDismiss={() => setDismissed(true)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
