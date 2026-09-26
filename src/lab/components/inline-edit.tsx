import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
// Long enough to notice after the field settles, short enough that the
// pencil is back before the next edit.
const SAVED_FOR = 1600;

export function InlineEdit({
  label,
  value,
  onSave,
  placeholder,
  multiline = false,
  className,
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  // Typography goes here; the display and the editor share it exactly.
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Keyboard exits hand focus back to the text; a click elsewhere keeps
  // focus wherever the click put it.
  const refocus = useRef(false);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  useEffect(() => {
    if (editing) {
      const field = fieldRef.current;
      field?.focus();
      // Caret at the end, where most edits start.
      field?.setSelectionRange(field.value.length, field.value.length);
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };

  const finish = (commit: boolean, keyboard: boolean) => {
    if (!editing) return;
    refocus.current = keyboard;
    setEditing(false);
    const next = multiline ? draft.trim() : draft.replace(/\s+/g, " ").trim();
    if (!commit || next === value) return;
    onSave(next);
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_FOR);
  };

  // Identical box, padding, font and line-height for the display and the
  // editor, so the swap doesn't move a single glyph.
  const box = cn(
    "col-start-1 row-start-1 block w-full rounded-lg py-1 pr-9 pl-2 text-left",
    multiline ? "whitespace-pre-wrap break-words" : "truncate whitespace-pre",
    className,
  );
  const empty = value.trim() === "";

  return (
    // Pulled out by its own padding, so the text lines up with the
    // surrounding content while the tint still has room to breathe.
    <div className="group relative -mx-2 grid">
      <button
        ref={buttonRef}
        type="button"
        onClick={start}
        // Hidden while editing, but still sizing the cell, so the editor
        // inherits its exact width and starting height.
        className={cn(
          box,
          "cursor-text outline-hidden transition-[background-color] duration-150 ease-out",
          "hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground",
          editing && "invisible",
          empty && "text-muted",
        )}
      >
        <span className="sr-only">Edit {label}: </span>
        {/* While editing, it mirrors the draft so a textarea grows with it.
            The trailing space keeps a new empty line from collapsing. */}
        {editing ? `${draft} ` : empty ? placeholder : value}
      </button>

      {editing &&
        (multiline ? (
          <textarea
            ref={fieldRef}
            aria-label={label}
            value={draft}
            placeholder={placeholder}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true, false)}
            onKeyDown={(e) => {
              // Shift+Enter still adds a line break.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                finish(true, true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false, true);
              }
            }}
            className={cn(
              box,
              "h-full resize-none overflow-hidden bg-background text-foreground ring-[1.5px] ring-foreground/25 outline-hidden placeholder:text-muted",
            )}
          />
        ) : (
          <input
            ref={fieldRef}
            aria-label={label}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true, false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                finish(true, true);
              } else if (e.key === "Escape") {
                e.preventDefault();
                finish(false, true);
              }
            }}
            className={cn(
              box,
              "h-full bg-background text-foreground ring-[1.5px] ring-foreground/25 outline-hidden placeholder:text-muted",
            )}
          />
        ))}

      {/* Pencil on hover or focus, a check right after saving. Pinned to the
          first line's height so it stays put as the text grows. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1 right-1.5 grid size-6 place-items-center text-muted",
          editing && "invisible",
        )}
      >
        <SwapIcon
          visible={!saved}
          reduceMotion={reduceMotion}
          className="opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
        >
          <path d="M9.75 3.75 12.25 6.25M3.25 12.75l.6-2.6 6.9-6.9a1.25 1.25 0 0 1 1.77 0l.73.73a1.25 1.25 0 0 1 0 1.77l-6.9 6.9Z" />
        </SwapIcon>
        <SwapIcon visible={saved} reduceMotion={reduceMotion} className="text-foreground">
          <path d="m3.5 8.5 3 3 6-7" />
        </SwapIcon>
      </span>
    </div>
  );
}

function SwapIcon({
  visible,
  reduceMotion,
  className,
  children,
}: {
  visible: boolean;
  reduceMotion: boolean | null;
  className?: string;
  children: React.ReactNode;
}) {
  const hidden = reduceMotion
    ? { opacity: 0 }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  // The motion layer owns the swap; the wrapper owns the hover fade, so
  // the two never fight over one opacity.
  return (
    <span className={cn("col-start-1 row-start-1", className)}>
      <motion.svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4"
        initial={false}
        animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
        transition={ICON_SWAP}
      >
        {children}
      </motion.svg>
    </span>
  );
}

export default function InlineEditDemo() {
  const [name, setName] = useState("Ava Moreno");
  const [bio, setBio] = useState(
    "Design engineer. Builds the small interactions nobody notices until they are missing.",
  );
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => () => clearTimeout(timer.current), []);

  const saved = (apply: () => void) => {
    apply();
    setShowSaved(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShowSaved(false), SAVED_FOR);
  };

  return (
    <section
      aria-label="Profile"
      className="w-[400px] max-w-full rounded-[24px] bg-background p-5 shadow-raised"
    >
      <div className="mb-4 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny local SVG gains nothing from next/image. */}
        <img
          src="/avatars/ava.svg"
          alt=""
          className="size-14 rounded-full bg-[oklch(0.97_0_0)] outline-1 -outline-offset-1 outline-[oklch(0_0_0/0.1)] dark:outline-[oklch(1_0_0/0.1)]"
        />
        <span
          aria-hidden
          className={cn(
            "flex items-center gap-1.5 text-xs text-muted transition-[opacity,filter,translate] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-[opacity]",
            showSaved
              ? "translate-y-0 opacity-100 blur-[0px] duration-200"
              : "translate-y-0.5 opacity-0 blur-[4px] duration-150 motion-reduce:translate-y-0",
          )}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
          >
            <path d="m3.5 8.5 3 3 6-7" />
          </svg>
          Saved
        </span>
        <span className="sr-only" aria-live="polite">
          {showSaved ? "Saved" : ""}
        </span>
      </div>
      <InlineEdit
        label="Name"
        value={name}
        placeholder="Add your name"
        onSave={(v) => saved(() => setName(v))}
        className="text-lg leading-7 font-semibold text-foreground"
      />
      <p className="mb-2 text-sm text-muted">@ava · Lisbon</p>
      <InlineEdit
        label="Bio"
        value={bio}
        placeholder="Add a short bio"
        multiline
        onSave={(v) => saved(() => setBio(v))}
        className="text-[15px] leading-6 text-foreground"
      />
    </section>
  );
}
