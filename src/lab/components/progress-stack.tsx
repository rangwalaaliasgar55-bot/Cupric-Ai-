import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Loader } from "lucide-react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// After the Forge UI "Progress Stack" (forgeui.in/components), rebuilt on the
// icon set this app already ships so it adds no dependency.
//
// The stack is three cards deep: the finished step below, the running step in
// focus, the next step above. Only the middle bar animates — the other two are
// end states, which is what makes the middle one read as "now".

type ProgressStackProps = {
  /** Milliseconds for one fill. The loop restarts two seconds after it lands. */
  duration?: number;
  step1?: string;
  step2?: string;
  step3?: string;
  className?: string;
};

export function ProgressStack({
  duration = 3000,
  step1 = "Welcome Aboard",
  step2 = "Verifying Details",
  step3 = "Account Created",
  className,
}: ProgressStackProps) {
  const reduceMotion = useReducedMotion();
  const [progress, setProgress] = useState(0);
  // Bumping the key remounts the bar, which is cheaper and more reliable than
  // animating width back to 0 and waiting for that to finish.
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      setProgress(100);
      return;
    }
    const forward = window.setTimeout(() => setProgress(100), 100);
    const restart = window.setTimeout(() => {
      setProgress(0);
      setRunKey((k) => k + 1);
    }, duration + 2000);
    return () => {
      window.clearTimeout(forward);
      window.clearTimeout(restart);
    };
  }, [runKey, duration, reduceMotion]);

  return (
    <div className={cn("relative flex flex-col items-center justify-center gap-1 p-1", className)}>
      <Row label={step3} dim>
        <span className={cn("text-muted", reduceMotion ? undefined : "animate-spin [animation-duration:2.4s]")}>
          <Loader size={13} />
        </span>
      </Row>

      <div className="flex min-w-[250px] flex-col justify-center gap-2 rounded-md border border-line bg-panel py-2 pl-3 pr-16">
        <div className="flex items-center justify-start gap-1.5 text-xs">
          <span className={cn("text-muted", reduceMotion ? undefined : "animate-spin")}>
            <Loader size={13} />
          </span>
          <span>{step2}</span>
        </div>
        <div className="ml-5 h-1.5 w-full overflow-hidden rounded-full bg-panel-alt">
          <motion.div
            key={runKey}
            className="h-full bg-accent"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: reduceMotion ? 0 : duration / 1000, ease: "easeInOut" }}
          />
        </div>
      </div>

      <Row label={step1} dim done>
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-ink">
          <Check size={10} strokeWidth={3} />
        </span>
      </Row>

      {/* The stack is a window onto a longer list, so both ends fade out. */}
      <div className="pointer-events-none absolute top-0 h-[40%] w-full bg-gradient-to-b from-bg via-bg/60 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 h-[40%] w-full bg-gradient-to-t from-bg via-bg/60 to-transparent" />
    </div>
  );
}

function Row({
  label,
  children,
  dim,
  done,
}: {
  label: string;
  children: React.ReactNode;
  dim?: boolean;
  done?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[250px] flex-col justify-center gap-2 rounded-md border border-line bg-panel py-2 pl-3 pr-16",
        dim && "scale-90 opacity-80",
      )}
    >
      <div className="flex items-center justify-start gap-1.5 text-xs">
        {children}
        <span>{label}</span>
      </div>
      <div className={cn("ml-5 h-1.5 w-full overflow-hidden rounded-full", done ? "bg-accent" : "bg-panel-alt")} />
    </div>
  );
}

export default function ProgressStackDemo() {
  return <ProgressStack />;
}
