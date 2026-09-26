import { Fragment, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { usePreviewPlay } from "@/lab/preview-play";

export function FocusParagraph({
  sentences,
  active: activeProp,
  className,
}: {
  sentences: string[];
  /**
   * Which sentence is lit, from outside (null lights none). Leave undefined
   * to follow the reader's pointer and keyboard.
   */
  active?: number | null;
  className?: string;
}) {
  const [hovered, setActive] = useState<number | null>(null);
  const active = activeProp === undefined ? hovered : activeProp;
  // The sentence holding keyboard focus, so a mouse leaving the paragraph
  // hands focus back to it instead of clearing everything.
  const focused = useRef<number | null>(null);

  return (
    <p
      className={cn("max-w-[440px] text-base leading-7 text-pretty text-foreground", className)}
      onPointerLeave={(e) => {
        if (e.pointerType === "touch") return;
        setActive(focused.current);
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focused.current = null;
        setActive(null);
      }}
    >
      {sentences.map((sentence, i) => (
        <Fragment key={i}>
          {/* Gaps between sentences are bare text, not spans, so crossing one
              fires no enter event and the last sentence simply stays lit. */}
          {i > 0 && " "}
          <span
            // Each sentence is a stop for keyboard readers.
            tabIndex={0}
            data-state={active === null ? "idle" : active === i ? "focus" : "dim"}
            onPointerEnter={(e) => {
              if (e.pointerType !== "touch") setActive(i);
            }}
            onPointerUp={(e) => {
              // Touch has no hover, so a tap toggles the sentence instead.
              if (e.pointerType === "touch") setActive((a) => (a === i ? null : i));
            }}
            onFocus={(e) => {
              // A mouse click focuses the span too; only a keyboard visit
              // should pin the focus, or leaving would no longer restore.
              if (!e.currentTarget.matches(":focus-visible")) return;
              focused.current = i;
              setActive(i);
            }}
            className={cn(
              "rounded-[3px] box-decoration-clone outline-hidden",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground/40",
              "transition-[opacity,filter] ease-[cubic-bezier(0.23,1,0.32,1)]",
              // Coming into focus is quick, stepping back is softer: the eye
              // should land on the sentence before the rest has settled.
              "data-[state=dim]:opacity-40 data-[state=dim]:blur-[0.6px] data-[state=dim]:duration-300",
              "data-[state=focus]:duration-200 data-[state=idle]:duration-300",
              "motion-reduce:data-[state=dim]:filter-none",
            )}
          >
            {sentence}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

const SENTENCES = [
  "Good interfaces rarely ask for attention.",
  "They wait at the edge of the page until your hand arrives, then answer with the smallest possible gesture.",
  "A button settles when pressed.",
  "A sentence steps forward while you read it.",
  "Everything else politely steps back.",
];

export default function FocusParagraphDemo() {
  const play = usePreviewPlay();
  const [reading, setReading] = useState<number | null>(null);

  // Index preview: the eye reads down the paragraph, lingering on each
  // sentence for about as long as it takes to read, then lets go.
  useEffect(() => {
    if (!play) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const show = () => {
      let at = 250;
      SENTENCES.forEach((sentence, i) => {
        timers.push(setTimeout(() => setReading(i), at));
        // A quick skim, not real reading speed, so the show stays short.
        at += 450 + sentence.length * 9;
      });
      timers.push(setTimeout(() => setReading(null), at));
      timers.push(setTimeout(show, at + 1300));
    };
    show();
    return () => {
      timers.forEach(clearTimeout);
      setReading(null);
    };
  }, [play]);

  return <FocusParagraph sentences={SENTENCES} active={play === null ? undefined : play ? reading : null} />;
}
