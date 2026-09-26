import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { ChevronDown, DollarSign, MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// After the Forge UI "Stack Ripple" (forgeui.in/components), on this app's own
// icon set and tokens.
//
// The three cards share one parent animation state instead of each owning a
// boolean, so the fan opens as a single gesture: every card reads `open` /
// `close` from the same variant tree and the identical spring keeps them in
// step no matter when a card mounts.

export type StackCardItem = {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  time: string;
};

const SPRING = { type: "spring", damping: 15, stiffness: 200, mass: 1, delay: 0.13 } as const;

const defaultItems: StackCardItem[] = [
  {
    id: "item1",
    icon: (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF3D71] text-white">
        <MessageCircle size={18} />
      </span>
    ),
    title: "New Message",
    description: "Cupric AI",
    time: "3 hrs ago",
  },
  {
    id: "item2",
    icon: (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400 text-black">
        <User size={18} />
      </span>
    ),
    title: "User Signed Up",
    description: "Cupric AI",
    time: "7 hrs ago",
  },
  {
    id: "item3",
    icon: (
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-500 text-black">
        <DollarSign size={18} />
      </span>
    ),
    title: "Billing Reminder",
    description: "Cupric AI",
    time: "9 hrs ago",
  },
];

export function StackRipple({
  stackCardItems = defaultItems,
  className,
}: {
  stackCardItems?: StackCardItem[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [isOpen, setIsOpen] = useState(false);

  const transition = reduceMotion ? { duration: 0 } : SPRING;
  const card = (openState: { y?: number; scale?: number }, closeState: { y?: number; scale?: number }): Variants => ({
    open: { ...openState, transition },
    close: { ...closeState, transition },
  });

  const top = card({ y: -55 }, { y: 0 });
  const middle = card({ scale: 1 }, { scale: 0.95 });
  const bottom = card({ y: 55, scale: 1 }, { y: 0, scale: 0.9 });
  const button: Variants = {
    open: { y: 55, transition },
    close: { y: 0, transition },
  };
  const chevron: Variants = {
    open: { rotate: 180, transition },
    close: { rotate: 0, transition },
  };

  const [first, second, third] = stackCardItems;

  return (
    <motion.div
      initial="close"
      animate={isOpen ? "open" : "close"}
      className={cn("relative flex w-full max-w-[400px] flex-col justify-center rounded-xl p-0.5", className)}
    >
      <div className="relative h-[300px] w-full">
        {third && <StackCard variant={bottom} top="top-[100px]" item={third} />}
        {second && <StackCard variant={middle} top="top-[90px]" item={second} />}
        {first && <StackCard variant={top} top="top-[80px]" item={first} />}

        <motion.button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          variants={button}
          aria-expanded={isOpen}
          className={cn(
            "absolute inset-x-0 top-[168px] mx-auto",
            "flex h-8 w-full max-w-[100px] items-center justify-center gap-1 px-1",
            "rounded-xl border border-line bg-panel text-xs text-muted shadow-sm hover:text-text",
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isOpen ? "hide" : "show"}
              initial={reduceMotion ? false : { opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={reduceMotion ? undefined : { opacity: 0, filter: "blur(4px)" }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {isOpen ? "Hide" : "Show All"}
            </motion.span>
          </AnimatePresence>
          <motion.span variants={chevron} className="flex">
            <ChevronDown size={13} />
          </motion.span>
        </motion.button>
      </div>
    </motion.div>
  );
}

function StackCard({ top, item, variant }: { top: string; item: StackCardItem; variant: Variants }) {
  return (
    <motion.div
      variants={variant}
      className={cn(
        "absolute inset-x-0 mx-auto",
        top,
        "flex h-[60px] w-full max-w-[320px] items-center justify-between",
        "rounded-xl border border-line bg-panel px-2",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.06)]",
      )}
    >
      <div className="flex items-center gap-2.5">
        {item.icon}
        <div className="flex flex-col justify-center gap-px">
          <p className="text-xs font-medium">{item.title}</p>
          <p className="text-[11px] text-muted">{item.description}</p>
        </div>
      </div>
      <div className="text-[11px] text-muted">{item.time}</div>
    </motion.div>
  );
}

export default function StackRippleDemo() {
  return <StackRipple />;
}
