import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

// A demo: files are only read for their name and size, and the "upload" is
// a timer. Nothing is sent anywhere and nothing leaves the browser.

type Entry = { id: number; name: string; size: number };

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
const ENTER = { duration: 0.25, ease: EASE_OUT };
const LEAVE = { duration: 0.15, ease: EASE_OUT };
const INSTANT = { duration: 0 };
// One progress update this often, each eased with a 300ms transition, so the
// bar moves in the uneven surges of a real upload instead of a smooth ramp.
const TICK = 280;

// The edge's length in pathLength units: 120 dash-and-gap pairs of one unit
// each, about 12px apiece on the 440 x 300 zone. A whole number, so the
// pattern always meets itself cleanly where the path starts and ends.
const EDGE_LENGTH = 120;
// Marching loops, so keyframes; each loop moves the dashes exactly one
// period, so it repeats without a hitch. Closing the gaps is a transition,
// so a file that leaves mid-seal reverses from wherever it got to.
const CSS = `
@keyframes dz-march { to { stroke-dashoffset: -1; } }
.dz-edge {
  stroke-dasharray: 0.5 0.5;
  transition: stroke-dasharray 240ms cubic-bezier(0.23, 1, 0.32, 1), color 150ms ease-out;
}
@media (hover: hover) and (pointer: fine) {
  .dz-zone:hover .dz-edge[data-state="idle"] { animation: dz-march 1.6s linear infinite; }
}
.dz-edge[data-state="dragging"] { animation: dz-march 0.6s linear infinite; }
.dz-edge[data-state="over"] { stroke-dasharray: 1 0; }
@media (prefers-reduced-motion: reduce) {
  .dz-edge { animation: none !important; }
}
`;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function hasFiles(e: DragEvent | React.DragEvent) {
  return !!e.dataTransfer?.types.includes("Files");
}

export function FileDropzone({
  onFiles,
  className,
}: {
  onFiles?: (files: File[]) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const hintId = useId();
  const [entries, setEntries] = useState<Entry[]>([]);
  // Somewhere on the page vs over the zone itself: a hint, then an invitation.
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const zoneRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const removeRefs = useRef(new Map<number, HTMLButtonElement>());
  const nextId = useRef(0);
  // dragenter and dragleave fire for every child crossed, so a boolean
  // would flicker off and on. Counting them only reaches 0 on a real exit.
  const zoneDepth = useRef(0);

  useEffect(() => {
    let depth = 0;
    const reset = () => {
      depth = 0;
      zoneDepth.current = 0;
      setDragging(false);
      setOver(false);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (++depth === 1) setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) reset();
    };
    const dragover = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Without this, a file dropped a few pixels off target would be opened
      // by the browser, navigating away from the page.
      e.preventDefault();
      if (!zoneRef.current?.contains(e.target as Node) && e.dataTransfer) {
        e.dataTransfer.dropEffect = "none";
      }
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", dragover);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", dragover);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const add = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setEntries((prev) => [
      ...prev,
      ...files.map((f) => ({
        id: nextId.current++,
        name: f.name,
        size: f.size,
      })),
    ]);
    setAnnouncement(
      files.length === 1
        ? `Added ${files[0].name}`
        : `Added ${files.length} files`,
    );
    onFiles?.(files);
  };

  const remove = (entry: Entry) => {
    const index = entries.findIndex((e) => e.id === entry.id);
    const next = entries[index + 1] ?? entries[index - 1];
    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    setAnnouncement(`Removed ${entry.name}`);
    // Focus would otherwise fall to the body with the removed button.
    (next ? removeRefs.current.get(next.id) : zoneRef.current)?.focus();
  };

  return (
    <div className={cn("flex w-[min(440px,100%)] flex-col gap-3", className)}>
      <button
        ref={zoneRef}
        type="button"
        aria-describedby={hintId}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          if (!hasFiles(e)) return;
          if (++zoneDepth.current === 1) setOver(true);
        }}
        onDragLeave={(e) => {
          if (!hasFiles(e)) return;
          zoneDepth.current = Math.max(0, zoneDepth.current - 1);
          if (zoneDepth.current === 0) setOver(false);
        }}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
        className={cn(
          "dz-zone relative flex h-[300px] touch-manipulation flex-col items-center justify-center gap-4 rounded-[24px] px-6 text-center outline-hidden select-none",
          "transition-[background-color,scale] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-foreground active:scale-[0.99] motion-reduce:transition-[background-color]",
          over ? "bg-foreground/5" : dragging ? "bg-foreground/[0.02]" : "",
        )}
      >
        <style href="file-dropzone" precedence="default">
          {CSS}
        </style>
        {/* The dashed edge is drawn, not a CSS border, so its dashes can
            move. At rest they sit still; a pointer over the zone sets them
            slowly marching, a file anywhere on the page makes them hurry,
            and a file right over the zone closes every gap into one solid
            line: the zone sealing around what you are about to drop. */}
        <svg
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 size-full overflow-visible",
            over
              ? "text-foreground"
              : dragging
                ? "text-foreground/45"
                : "text-foreground/20 [.dz-zone:hover_&]:text-foreground/35",
          )}
        >
          <rect
            x="1"
            y="1"
            rx="23"
            style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
            pathLength={EDGE_LENGTH}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            data-state={over ? "over" : dragging ? "dragging" : "idle"}
            className="dz-edge"
          />
        </svg>
        {/* Lifts toward the cursor when a file is right over it, as if
            reaching up to take it. */}
        <svg
          viewBox="0 0 24 24"
          className={cn(
            "size-8 text-foreground transition-[translate] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            over && "-translate-y-1.5 motion-reduce:translate-y-0",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 15V4.5M7.75 8.5 12 4.25l4.25 4.25" />
          <path d="M4.75 14.5v3.25a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V14.5" />
        </svg>
        <span className="flex flex-col gap-1">
          {/* Both labels share one cell and crossfade, so the zone never
              reflows as a file passes over it. */}
          <span className="grid text-base font-medium text-foreground">
            <span
              className={cn(
                "col-start-1 row-start-1 transition-[opacity,filter] duration-150 ease-out",
                over && "opacity-0 blur-[4px]",
              )}
            >
              Drop files here or click to browse
            </span>
            <span
              aria-hidden
              className={cn(
                "col-start-1 row-start-1 transition-[opacity,filter] duration-150 ease-out",
                !over && "opacity-0 blur-[4px]",
              )}
            >
              Release to add
            </span>
          </span>
          <span id={hintId} className="text-sm text-muted">
            Demo only, files never leave your device
          </span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          // Cleared so picking the same file again still fires a change.
          e.target.value = "";
        }}
      />

      {/* Grows downward from under the zone; past four rows it scrolls, so
          the demo never grows without bound. */}
      <motion.div
        layoutScroll
        className="max-h-[264px] overflow-y-auto overscroll-contain [scrollbar-width:thin]"
      >
        <ul aria-label="Files" className="relative flex flex-col">
          <AnimatePresence mode="popLayout" initial={false}>
            {entries.map((entry) => (
              <motion.li
                key={entry.id}
                layout="position"
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, y: 6, filter: "blur(4px)" }
                }
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={
                  reduceMotion
                    ? { opacity: 0, transition: LEAVE }
                    : { opacity: 0, scale: 0.98, transition: LEAVE }
                }
                transition={{
                  ...ENTER,
                  layout: reduceMotion ? INSTANT : ENTER,
                }}
              >
                <FileRow
                  entry={entry}
                  reduceMotion={reduceMotion}
                  removeRef={(el) => {
                    if (el) removeRefs.current.set(entry.id, el);
                    else removeRefs.current.delete(entry.id);
                  }}
                  onRemove={() => remove(entry)}
                  onDone={() => setAnnouncement(`Uploaded ${entry.name}`)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </motion.div>

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

function FileRow({
  entry,
  reduceMotion,
  removeRef,
  onRemove,
  onDone,
}: {
  entry: Entry;
  reduceMotion: boolean | null;
  removeRef: (el: HTMLButtonElement | null) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    // Bigger files take more ticks: about one per 400 KB, between 5 and 16,
    // so a small file is done in about 1.5s and none take more than ~5s.
    const ticks = Math.min(16, Math.max(5, entry.size / 400_000));
    let p = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      // One tick in six stalls, the way real uploads hang on a slow packet,
      // and chunks shrink toward the end as the server finishes up.
      const stall = Math.random() < 1 / 6;
      const chunk = stall
        ? 0
        : ((0.6 + Math.random() * 0.8) / ticks) * (1.2 - p * 0.5);
      p = Math.min(1, p + chunk);
      setProgress(p);
      if (p < 1) {
        timer = setTimeout(step, TICK);
      } else {
        // Lets the bar finish its last surge before the check replaces it.
        timer = setTimeout(() => {
          setDone(true);
          onDoneRef.current();
        }, 300);
      }
    };
    timer = setTimeout(step, 150);
    return () => clearTimeout(timer);
  }, [entry.size]);

  const hidden = reduceMotion
    ? { scale: 1, opacity: 0, filter: "blur(0px)" }
    : { scale: 0.25, opacity: 0, filter: "blur(4px)" };

  return (
    <div className="flex h-16 items-center gap-3 rounded-2xl pr-1 pl-3.5 transition-[background-color] duration-150 ease-out hover:bg-surface">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] leading-5 font-medium text-foreground">
          {entry.name}
        </span>
        <div className="flex h-5 items-center gap-3 text-[13px] text-muted">
          <span className="shrink-0 tabular-nums">
            {formatSize(entry.size)}
          </span>
          {/* The bar and "Uploaded" share one cell and crossfade. */}
          <span className="grid flex-1 items-center">
            <span
              role="progressbar"
              aria-label={`Uploading ${entry.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              className={cn(
                "col-start-1 row-start-1 h-1 overflow-hidden rounded-full bg-foreground/10 transition-[opacity] duration-200 ease-out",
                done && "opacity-0",
              )}
            >
              <span
                className="block h-full origin-left rounded-full bg-foreground transition-[scale] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                style={{ scale: `${progress} 1` }}
              />
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 transition-[opacity,filter] duration-200 ease-out",
                !done && "opacity-0 blur-[4px]",
              )}
            >
              Uploaded
            </span>
          </span>
        </div>
      </div>

      {/* Percentage while uploading, then the check, in one cell. */}
      <span className="grid w-9 shrink-0 place-items-center text-[13px] text-muted tabular-nums">
        <span
          aria-hidden
          className={cn(
            "col-start-1 row-start-1 transition-[opacity,filter] duration-150 ease-out",
            done && "opacity-0 blur-[4px]",
          )}
        >
          {Math.round(progress * 100)}%
        </span>
        <motion.svg
          viewBox="0 0 16 16"
          className="col-start-1 row-start-1 size-4 text-foreground"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          initial={false}
          animate={
            done ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden
          }
          transition={ICON_SWAP}
        >
          <path d="m3.5 8.5 3 3 6-7" />
        </motion.svg>
      </span>

      <button
        ref={removeRef}
        type="button"
        aria-label={`Remove ${entry.name}`}
        onClick={onRemove}
        className="flex size-9 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="m4.75 4.75 6.5 6.5M11.25 4.75l-6.5 6.5" />
        </svg>
      </button>
    </div>
  );
}

export default function FileDropzoneDemo() {
  return <FileDropzone />;
}
