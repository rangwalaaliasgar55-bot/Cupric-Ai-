import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useDemoProps } from "@/lab/demo-props";

type State = "idle" | "holding" | "done";

// The lid slams, then the can swaps for a check once it has shut. Long
// enough to see the lid land, short enough that "Deleted" still feels like
// the answer to letting go.
const SWAP_DELAY = 0.22;

// A one-shot, so a keyframe: the button gives a small gulp as the lid
// shuts, the way a bin jolts when its lid drops.
const CSS = `
@keyframes htd-gulp {
  0% { scale: 1; }
  35% { scale: 0.97; }
  100% { scale: 1; }
}
.htd-gulp { animation: htd-gulp 320ms cubic-bezier(0.23, 1, 0.32, 1) 120ms; }
@media (prefers-reduced-motion: reduce) {
  .htd-gulp { animation: none; }
}
`;

// JOB 6 — the words on the button are the user's, not ours. Both labels are
// editable props; without them the component keeps its own defaults, so
// nothing that already uses it changes.
export const HOLD_TO_DELETE_DEFAULTS = {
  label: "Hold to delete",
  doneLabel: "Deleted",
};

export function HoldToDelete({
  onDelete,
  className,
  label,
  doneLabel,
}: {
  onDelete?: () => void;
  className?: string;
  label?: string;
  doneLabel?: string;
}) {
  const demoProps = useDemoProps();
  const fromProps = (key: "label" | "doneLabel") => {
    const v = demoProps?.[key];
    return typeof v === "string" && v.trim() ? v : HOLD_TO_DELETE_DEFAULTS[key];
  };
  const labels = {
    label: label ?? fromProps("label"),
    doneLabel: doneLabel ?? fromProps("doneLabel"),
  };
  const [state, setState] = useState<State>("idle");
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(reset.current), []);

  const press = () => setState((s) => (s === "idle" ? "holding" : s));
  const release = () => setState((s) => (s === "holding" ? "idle" : s));

  return (
    <button
      type="button"
      className={cn(
        "relative h-10 touch-manipulation rounded-full bg-surface px-4 text-sm font-medium text-foreground shadow-raised transition-[scale] duration-150 ease-out select-none active:scale-[0.96] motion-reduce:transition-none",
        state === "done" && "htd-gulp",
        className,
      )}
      onPointerDown={(e) => {
        if (e.button === 0) press();
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          press();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") release();
      }}
    >
      <style href="hold-to-delete" precedence="default">
        {CSS}
      </style>
      <Label state={state} labels={labels} />
      {/* Fills over 2s while held but snaps back in 200ms on release: slow
          where the user is deciding, fast where the interface responds. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-full bg-danger px-4 text-white",
          state === "idle" &&
            "[clip-path:inset(0_100%_0_0)] transition-[clip-path] duration-200 ease-out",
          state === "holding" &&
            "[clip-path:inset(0)] transition-[clip-path] duration-[2000ms] ease-linear",
          state === "done" && "[clip-path:inset(0)]",
        )}
        onTransitionEnd={(e) => {
          if (e.propertyName !== "clip-path" || state !== "holding") return;
          setState("done");
          onDelete?.();
          navigator.vibrate?.(10);
          reset.current = setTimeout(() => setState("idle"), 2000);
        }}
      >
        <Label state={state} labels={labels} />
      </span>
      <span className="sr-only" aria-live="polite">
        {state === "done" ? labels.doneLabel : ""}
      </span>
    </button>
  );
}

// Both labels share one grid cell, so the button keeps the width of the
// longer one and never jumps when they swap.
function Label({ state, labels }: { state: State; labels: { label: string; doneLabel: string } }) {
  const done = state === "done";
  // Only the swap into "Deleted" waits for the lid; the way back is instant.
  const delay = done ? SWAP_DELAY : 0;
  return (
    <span className="grid">
      <Variant visible={!done} delay={delay} icon={<Bin state={state} />}>
        {labels.label}
      </Variant>
      <Variant
        visible={done}
        delay={delay}
        icon={<path d="m3.5 8.5 3 3 6-7" />}
      >
        {labels.doneLabel}
      </Variant>
    </span>
  );
}

// The bin opens as you commit. The lid is hinged at its right end and lifts
// on the same 2s hold as the fill, but eased out, so it cracks open at once
// (the press was heard) and then creeps wider while you decide. Letting go
// early lowers it in 200ms; finishing slams it shut with a small overshoot.
function Bin({ state }: { state: State }) {
  return (
    <>
      <g
        className={cn(
          // View-box units, so the hinge sits exactly on the lid's right end.
          "[transform-box:view-box] [transform-origin:13.25px_4.25px]",
          state === "holding"
            ? "translate-y-[-1px] rotate-[38deg] transition-[rotate,translate] duration-[2000ms] ease-[cubic-bezier(0.23,1,0.32,1)]"
            : state === "done"
              ? "transition-[rotate,translate] duration-[260ms] ease-[cubic-bezier(0.34,1.8,0.64,1)]"
              : "transition-[rotate,translate] duration-200 ease-out",
          "motion-reduce:translate-y-0 motion-reduce:rotate-0 motion-reduce:transition-none",
        )}
      >
        <path d="M2.75 4.25h10.5M6.25 4.25v-1.5h3.5v1.5" />
      </g>
      <path d="M4 4.25l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1M6.75 7v3.75M9.25 7v3.75" />
    </>
  );
}

function Variant({
  visible,
  delay,
  icon,
  children,
}: {
  visible: boolean;
  delay: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="col-start-1 row-start-1 flex items-center justify-center gap-2">
      <Icon visible={visible} delay={delay}>
        {icon}
      </Icon>
      <span
        style={{ transitionDelay: `${delay}s` }}
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

function Icon({
  visible,
  delay,
  children,
}: {
  visible: boolean;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.svg
      viewBox="0 0 16 16"
      // The open lid swings past the icon's box, so nothing may clip it.
      className="size-4 shrink-0 overflow-visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={false}
      animate={
        visible
          ? { scale: 1, opacity: 1, filter: "blur(0px)" }
          : { scale: 0.25, opacity: 0, filter: "blur(4px)" }
      }
      transition={{ type: "spring", duration: 0.3, bounce: 0, delay }}
    >
      {children}
    </motion.svg>
  );
}

export default function HoldToDeleteDemo() {
  return <HoldToDelete />;
}
