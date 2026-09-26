import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type AccordionItem = { question: string; answer: string };

// Panels open independently. Closing one automatically when another opens
// would shift the clicked header up by the closed panel's height; this way a
// header never moves, so it can be closed again without moving the mouse.
export function Accordion({
  items,
  defaultOpen = [],
  className,
}: {
  items: AccordionItem[];
  defaultOpen?: number[];
  className?: string;
}) {
  const [open, setOpen] = useState(() => new Set(defaultOpen));
  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  const headers = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  const focusHeader = (index: number) => {
    const count = items.length;
    headers.current[(index + count) % count]?.focus();
  };

  return (
    <div className={cn("w-[480px] max-w-full divide-y divide-border", className)}>
      {items.map((item, i) => {
        const isOpen = open.has(i);
        const headerId = `${baseId}-header-${i}`;
        const panelId = `${baseId}-panel-${i}`;

        return (
          <div key={item.question}>
            <h3>
              <button
                ref={(el) => {
                  headers.current[i] = el;
                }}
                id={headerId}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(i)}
                onKeyDown={(e) => {
                  const target = {
                    ArrowDown: i + 1,
                    ArrowUp: i - 1,
                    Home: 0,
                    End: items.length - 1,
                  }[e.key];
                  if (target === undefined) return;
                  e.preventDefault();
                  focusHeader(target);
                }}
                className="group flex h-14 w-full items-center justify-between gap-5 rounded-md text-left text-[15px] font-medium text-foreground outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground"
              >
                {item.question}
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  className={cn(
                    "size-[18px] shrink-0 text-muted transition-[rotate,color] duration-250 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:text-foreground motion-reduce:transition-[color]",
                    isOpen && "rotate-180 text-foreground",
                  )}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            </h3>
            {/* Animating grid-template-rows between 0fr and 1fr is the one
                place height animates: the row resolves to the content's real
                height, so nothing is measured and text that reflows at a new
                width is never clipped. */}
            <div
              id={panelId}
              role="region"
              aria-labelledby={headerId}
              inert={!isOpen}
              className={cn(
                "grid ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
                isOpen
                  ? "grid-rows-[1fr] transition-[grid-template-rows] duration-250"
                  : "grid-rows-[0fr] transition-[grid-template-rows] duration-200",
              )}
            >
              <div className="min-h-0 overflow-hidden">
                {/* The answer is a flap folded up under its question: it
                    swings down on a hinge along the header's bottom edge
                    while the row parts, so the motion says where the text
                    came from. The drawer curve lets it fall fast and settle
                    flat; 280ms because the swing has ~70 degrees to cover.
                    Closing folds only partway back and fades out in 150ms,
                    so the text is gone before the row finishes shutting. */}
                <div
                  className={cn(
                    "relative origin-top transition-[transform,opacity] motion-reduce:transform-none motion-reduce:transition-[opacity]",
                    isOpen
                      ? "[transform:perspective(640px)_rotateX(0deg)] opacity-100 duration-280 ease-[cubic-bezier(0.32,0.72,0,1)]"
                      : "[transform:perspective(640px)_rotateX(-72deg)] opacity-0 duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]",
                  )}
                >
                  <p className="pr-10 pb-5 text-[15px] leading-relaxed text-pretty text-muted">
                    {item.answer}
                  </p>
                  {/* The crease: text nearest the hinge stays veiled in the
                      page color until the flap lies flat, so the answer
                      reads as unfolding out of the header, not sliding. */}
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-0 bg-linear-to-b from-background to-transparent to-80% transition-[opacity] ease-out motion-reduce:hidden",
                      isOpen ? "opacity-0 duration-280" : "opacity-100 duration-150",
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const FAQ: AccordionItem[] = [
  {
    question: "What is this lab?",
    answer:
      "A collection of small interface components, each built to get the details right: timing, easing, focus and both themes.",
  },
  {
    question: "How are components built?",
    answer:
      "React with Tailwind, CSS transitions wherever they can do the job, and Motion only for springs and gestures CSS cannot express.",
  },
  {
    question: "Can I use the code?",
    answer:
      "Yes. Every component is a single file with no setup, so copy it into your project and adjust the tokens to match.",
  },
  {
    question: "Does it respect reduced motion?",
    answer:
      "It does. Movement drops out and only gentle fades remain, so every state change is still clear without anything sliding around.",
  },
];

export default function AccordionDemo() {
  return <Accordion items={FAQ} />;
}
