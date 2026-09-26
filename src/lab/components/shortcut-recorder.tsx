import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, animate, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { usePreviewPlay } from "@/lab/preview-play";
import { cn } from "@/lib/cn";

// A shortcut is a list of tokens: modifiers first, then one key. "Mod" is
// ⌘ on a Mac and Ctrl elsewhere, so one saved shortcut works on both.
export type Shortcut = string[];

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const noop = () => () => {};
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "OS"]);
const ARROWS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

// Held modifiers in the order each platform prints them.
function modifiers(e: KeyboardEvent, mac: boolean): string[] {
  if (mac) {
    return [
      e.ctrlKey && "Ctrl",
      e.altKey && "Alt",
      e.shiftKey && "Shift",
      e.metaKey && "Mod",
    ].filter(Boolean) as string[];
  }
  return [e.ctrlKey && "Mod", e.altKey && "Alt", e.shiftKey && "Shift"].filter(
    Boolean,
  ) as string[];
}

// Reads the physical key, so Option+K on a Mac records K, not "˚".
function keyName(e: KeyboardEvent) {
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (ARROWS[e.key]) return ARROWS[e.key];
  if (e.key === " ") return "Space";
  if (e.key === "Enter") return "↵";
  if (e.key.length === 1) return e.key.toUpperCase();
  return e.key;
}

function label(token: string, mac: boolean) {
  if (token === "Mod") return mac ? "⌘" : "Ctrl";
  if (token === "Ctrl") return "⌃";
  if (token === "Alt") return mac ? "⌥" : "Alt";
  if (token === "Shift") return mac ? "⇧" : "Shift";
  return token;
}

const same = (a: Shortcut, b: Shortcut) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

export function ShortcutRecorder({
  name,
  value,
  onChange,
  taken,
  demo,
  className,
}: {
  // What the shortcut does, e.g. "Open command menu".
  name: string;
  value: Shortcut;
  onChange: (next: Shortcut) => void;
  // Returns the action already using a combination, if any.
  taken?: (combo: Shortcut) => string | null;
  // Drives the field from outside (the card preview) without listening.
  demo?: { recording: boolean; held: Shortcut } | null;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const mac = useSyncExternalStore(noop, isMac, () => false);
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<Shortcut>([]);
  const [error, setError] = useState<{ text: string } | null>(null);
  const [settled, setSettled] = useState(0);
  const field = useRef<HTMLButtonElement>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isRecording = demo ? demo.recording : recording;
  const shownHeld = demo ? demo.held : held;

  const fail = (text: string) => {
    clearTimeout(errorTimer.current);
    setError({ text });
    errorTimer.current = setTimeout(() => setError(null), 2200);
    // A small shake when a combination isn't accepted.
    if (field.current && !reduceMotion) {
      animate(field.current, { x: [0, -4, 4, -3, 3, 0] }, { duration: 0.32, ease: "easeOut" });
    }
  };

  // While recording, every key belongs to the field: it's taken before the
  // page (or the lab's own ⌘K) can act on it.
  const latest = useRef({ mac, value, onChange, taken, fail });
  useEffect(() => {
    latest.current = { mac, value, onChange, taken, fail };
  });
  useEffect(() => {
    if (!recording) return;
    const stop = () => {
      setRecording(false);
      setHeld([]);
    };
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const { mac, value, onChange, taken, fail } = latest.current;
      const mods = modifiers(e, mac);
      if (MODIFIER_KEYS.has(e.key)) return setHeld(mods);
      if (!mods.length && e.key === "Escape") return stop();
      if (!mods.length && (e.key === "Backspace" || e.key === "Delete")) {
        onChange([]);
        return stop();
      }
      const key = keyName(e);
      if (!mods.length && !/^F\d{1,2}$/.test(key)) {
        return fail(`Add ${mac ? "⌘, ⌥ or ⇧" : "Ctrl, Alt or Shift"}`);
      }
      const combo = [...mods, key];
      const owner = same(combo, value) ? null : taken?.(combo);
      if (owner) return fail(`Used by ${owner}`);
      onChange(combo);
      setSettled((s) => s + 1);
      stop();
    };
    const onUp = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      setHeld(modifiers(e, latest.current.mac));
    };
    const onAway = (e: Event) => {
      if (e.type === "blur" || !field.current?.contains(e.target as Node)) {
        stop();
      }
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onAway);
    document.addEventListener("pointerdown", onAway);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onAway);
      document.removeEventListener("pointerdown", onAway);
    };
  }, [recording]);

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  const caps = isRecording ? shownHeld : value;
  const fade = reduceMotion ? { duration: 0 } : { duration: 0.18, ease: EASE_OUT };

  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="relative min-w-0">
        <p className="text-[14px] text-foreground">{name}</p>
        {/* Hangs below the name without taking room, so names stay
            centred against their fields. */}
        <div className="absolute inset-x-0 top-full h-4">
          <AnimatePresence initial={false}>
            {error && (
              <motion.p
                key={error.text}
                role="status"
                initial={{ opacity: 0, y: -2, filter: "blur(3px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
                transition={fade}
                className="absolute inset-x-0 top-0.5 truncate text-[12px] text-danger"
              >
                {error.text}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <motion.button
        ref={field}
        type="button"
        aria-label={`${name} shortcut: ${value.length ? value.map((t) => label(t, mac)).join(" ") : "none"}. ${isRecording ? "Recording, press the new keys, Escape to cancel, Backspace to clear." : "Press to change."}`}
        aria-pressed={isRecording}
        onClick={() => {
          if (demo) return;
          setError(null);
          setRecording((r) => !r);
          setHeld([]);
        }}
        className={cn(
          "flex h-9 min-w-24 shrink-0 items-center justify-end gap-1 rounded-[10px] px-1.5 outline-hidden transition-[background-color,box-shadow] duration-150 ease-out",
          // Recording already draws a dark edge; a focus ring on top of it
          // would double up.
          isRecording
            ? "bg-background shadow-[inset_0_0_0_1.5px_var(--foreground)]"
            : "bg-surface shadow-[inset_0_0_0_1px_var(--border)] hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-foreground",
        )}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {caps.length ? (
            caps.map((t, i) => (
              <motion.kbd
                key={`${t}-${settled}`}
                layout="position"
                initial={
                  isRecording
                    ? { opacity: 0, scale: 0.8, filter: "blur(3px)" }
                    : { opacity: 0.6, y: -3, scale: 1.08 }
                }
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", duration: 0.3, bounce: 0.3, delay: isRecording ? 0 : i * 0.03 }
                }
                className="grid h-6 min-w-6 place-items-center rounded-md bg-background px-1.5 font-sans text-[12px] font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border),0_1px_0_var(--border)]"
              >
                {label(t, mac)}
              </motion.kbd>
            ))
          ) : (
            <motion.span
              key={isRecording ? "listening" : "none"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              transition={fade}
              className="flex items-center gap-1.5 px-1.5 text-[13px] text-muted"
            >
              {isRecording ? (
                <>
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-danger"
                    style={{
                      animation: reduceMotion ? "none" : "sr-blink 1.1s ease-in-out infinite",
                    }}
                  />
                  Press keys
                </>
              ) : (
                "None"
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <style>{`@keyframes sr-blink { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }`}</style>
    </div>
  );
}

const ROWS = [
  { id: "palette", name: "Open command menu", keys: ["Mod", "K"] },
  { id: "note", name: "New note", keys: ["Mod", "N"] },
  { id: "sidebar", name: "Toggle sidebar", keys: ["Mod", "B"] },
];

export default function ShortcutRecorderDemo() {
  const play = usePreviewPlay();
  const [keys, setKeys] = useState<Record<string, Shortcut>>(() =>
    Object.fromEntries(ROWS.map((r) => [r.id, r.keys])),
  );
  const [demo, setDemo] = useState<{ recording: boolean; held: Shortcut } | null>(
    null,
  );

  // The card's hover show: the first shortcut is re-recorded as ⇧⌘P, key
  // by key, then set back.
  useEffect(() => {
    if (play !== true) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const record = (base: number, held: Shortcut[], final: Shortcut) => {
      at(base, () => setDemo({ recording: true, held: [] }));
      held.forEach((h, i) => at(base + 500 + i * 380, () => setDemo({ recording: true, held: h })));
      at(base + 500 + held.length * 380, () => {
        setKeys((k) => ({ ...k, palette: final }));
        setDemo({ recording: false, held: [] });
      });
    };
    const run = () => {
      record(300, [["Mod"], ["Shift", "Mod"]], ["Shift", "Mod", "P"]);
      record(3000, [["Mod"]], ["Mod", "K"]);
      at(5600, run);
    };
    run();
    return () => {
      timers.forEach(clearTimeout);
      setDemo(null);
      setKeys(Object.fromEntries(ROWS.map((r) => [r.id, r.keys])));
    };
  }, [play]);

  return (
    <div className="w-[min(420px,100%)] rounded-2xl bg-background p-2 shadow-raised">
      <p className="px-4 pt-3 pb-1 text-[12px] font-medium text-muted">
        Keyboard shortcuts
      </p>
      <div className="divide-y divide-border">
        {ROWS.map((row, i) => (
          <ShortcutRecorder
            key={row.id}
            className="px-4 py-3"
            name={row.name}
            value={keys[row.id]}
            onChange={(next) => setKeys((k) => ({ ...k, [row.id]: next }))}
            taken={(combo) =>
              ROWS.find((r) => r.id !== row.id && same(keys[r.id], combo))
                ?.name ?? null
            }
            demo={play === true && i === 0 ? demo ?? { recording: false, held: [] } : null}
          />
        ))}
      </div>
    </div>
  );
}
