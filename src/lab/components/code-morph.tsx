import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

/* The teachable part: every step is diffed against the last one at token
   level. Tokens both versions share keep their identity and glide to their
   new line and column, the way Keynote's Magic Move carries objects between
   slides, so a reader sees what moved instead of rereading the whole block. */

export type CodeStep = { label: string; title: string; code: string };

type Kind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "fn"
  | "type"
  | "punct"
  | "plain";
type Tok = { text: string; kind: Kind; row: number; col: number };
type Placed = Tok & { id: number; state: "idle" | "stay" | "enter" | "exit" };

// Syntax colors are data: they encode token kinds, the same way the swatches
// in color-swatches are data, so they sit outside the token palette. Each
// pair keeps its hue across themes at roughly 4.5:1 on the surface.
const COLORS: Record<Kind, string | undefined> = {
  keyword: "light-dark(oklch(0.5 0.15 300), oklch(0.78 0.12 300))",
  string: "light-dark(oklch(0.5 0.11 150), oklch(0.8 0.12 150))",
  number: "light-dark(oklch(0.54 0.14 50), oklch(0.8 0.12 60))",
  fn: "light-dark(oklch(0.5 0.14 255), oklch(0.78 0.11 250))",
  type: "light-dark(oklch(0.5 0.1 200), oklch(0.8 0.1 195))",
  comment: "var(--muted)",
  punct: "color-mix(in oklab, var(--foreground) 55%, transparent)",
  plain: undefined,
};

const KEYWORDS = new Set(
  "import from export default function return const let var if else new true false null undefined async await try catch finally throw typeof".split(
    " ",
  ),
);

// Alternatives in priority order, so a number inside a string stays part of
// the string. Multi-character operators come first so `=>` moves as one
// piece rather than two.
const PATTERN =
  /(\/\/[^\n]*)|("[^"\n]*"|'[^'\n]*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(=>|===|!==|&&|\|\||\?\.|\.\.\.|[^\s\w])/g;

function tokenize(code: string): Tok[] {
  const out: Tok[] = [];
  let row = 0;
  let col = 0;
  let last = 0;
  // Whitespace never becomes a token: it only advances the cursor, so
  // re-indenting a line moves its tokens rather than replacing them.
  const advance = (text: string) => {
    for (const ch of text) {
      if (ch === "\n") {
        row++;
        col = 0;
      } else col++;
    }
  };
  for (const m of code.matchAll(PATTERN)) {
    const index = m.index ?? 0;
    advance(code.slice(last, index));
    const text = m[0];
    let kind: Kind = "plain";
    if (m[1]) kind = "comment";
    else if (m[2]) kind = "string";
    else if (m[3]) kind = "number";
    else if (m[5]) kind = "punct";
    else if (KEYWORDS.has(text)) kind = "keyword";
    else if (code[index + text.length] === "(") kind = "fn";
    else if (/^[A-Z]/.test(text)) kind = "type";
    out.push({ text, kind, row, col });
    advance(text);
    last = index + text.length;
  }
  return out;
}

// Longest common subsequence over token text and kind. Returns, for every
// token in `b`, the index of its partner in `a` or -1 when it is new.
function match(a: Tok[], b: Tok[]): number[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  const same = (i: number, j: number) =>
    a[i].text === b[j].text && a[i].kind === b[j].kind;
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = same(i, j)
        ? dp[(i + 1) * w + j + 1] + 1
        : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const pairs = new Array<number>(m).fill(-1);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(i, j)) {
      pairs[j] = i;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

// Line height in px; tokens sit on this grid, so it is also the distance a
// token travels when a line is inserted above it.
const LINE = 22;
// Vertical padding of the code area, top and bottom.
const PAD = 16;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

// Moves take 480ms, past the usual 300ms UI ceiling on purpose: this is
// explanatory motion, and the eye has to follow each token to its new
// place. New tokens wait 300ms so they arrive into space the moves have
// already opened; removed ones hold their red tint for a beat before going.
const STYLES = `
.cm-token { transition: transform 480ms cubic-bezier(0.77, 0, 0.175, 1), color 200ms ease, background-color 200ms ease; }
.cm-enter { animation: cm-enter 260ms cubic-bezier(0.23, 1, 0.32, 1) 300ms both; }
.cm-exit { animation: cm-exit 360ms cubic-bezier(0.23, 1, 0.32, 1) both; }
@keyframes cm-enter {
  from { opacity: 0; filter: blur(4px); translate: 0 4px; }
  to { opacity: 1; filter: none; translate: 0 0; }
}
@keyframes cm-exit {
  0%, 40% { opacity: 1; filter: none; translate: 0 0; }
  100% { opacity: 0; filter: blur(2px); translate: 0 -3px; }
}
@media (prefers-reduced-motion: reduce) {
  .cm-token { transition: color 200ms ease, background-color 200ms ease; }
  .cm-enter { animation: cm-fade-in 200ms ease 120ms both; }
  .cm-exit { animation: cm-fade-out 160ms ease both; }
  @keyframes cm-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes cm-fade-out { from { opacity: 1; } to { opacity: 0; } }
}
`;

export function CodeMorph({
  steps,
  className,
}: {
  steps: CodeStep[];
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const id = useId();
  const sources = useMemo(() => steps.map((s) => s.code.trim()), [steps]);
  const tokens = useMemo(() => sources.map(tokenize), [sources]);
  const rows = useMemo(() => sources.map((s) => s.split("\n").length), [sources]);
  const cols = useMemo(
    () => Math.max(...sources.flatMap((s) => s.split("\n").map((l) => l.length))),
    [sources],
  );
  const maxRows = Math.max(...rows);

  const nextId = useRef(tokens[0].length);
  const [view, setView] = useState<{
    step: number;
    items: Placed[];
    added: Set<number>;
  }>(() => ({
    step: 0,
    items: tokens[0].map((t, i) => ({ ...t, id: i, state: "idle" })),
    added: new Set(),
  }));
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = (next: number) => {
    if (next === view.step) return;
    // Tokens still fading out from the last change are dropped: they are
    // already leaving and would only muddy this diff.
    const prev = view.items.filter((t) => t.state !== "exit");
    const target = tokens[next];
    const pairs = match(prev, target);
    const used = new Set<number>();
    const added = new Set<number>();
    const items: Placed[] = target.map((t, j) => {
      const partner = pairs[j];
      if (partner >= 0) {
        used.add(partner);
        return { ...t, id: prev[partner].id, state: "stay" };
      }
      added.add(t.row);
      return { ...t, id: nextId.current++, state: "enter" };
    });
    prev.forEach((t, i) => {
      if (!used.has(i)) items.push({ ...t, state: "exit" });
    });
    setView({ step: next, items, added });
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    const last = steps.length - 1;
    const target = {
      ArrowRight: view.step === last ? 0 : view.step + 1,
      ArrowLeft: view.step === 0 ? last : view.step - 1,
      Home: 0,
      End: last,
    }[e.key];
    if (target === undefined) return;
    e.preventDefault();
    go(target);
    tabs.current[target]?.focus();
  };

  const current = steps[view.step];
  const code = sources[view.step];

  return (
    <div
      className={cn(
        "w-[580px] max-w-full overflow-hidden rounded-2xl bg-surface shadow-raised",
        className,
      )}
    >
      <style>{STYLES}</style>
      <div className="flex items-center justify-between gap-3 border-b border-border p-2">
        <div
          role="tablist"
          aria-label="Tutorial steps"
          onKeyDown={onTabKey}
          className="flex items-center gap-1"
        >
          {steps.map((s, i) => {
            const selected = i === view.step;
            return (
              <button
                key={s.label}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => go(i)}
                className={cn(
                  "relative h-9 touch-manipulation rounded-lg px-3 text-sm font-medium outline-hidden select-none",
                  "transition-[scale,color] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-[color]",
                  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-foreground",
                  selected ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {selected && (
                  <motion.span
                    layoutId={`${id}-pill`}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", visualDuration: 0.25, bounce: 0.1 }
                    }
                    className="absolute inset-0 rounded-lg bg-background shadow-raised"
                  />
                )}
                <span className="relative">{s.label}</span>
              </button>
            );
          })}
        </div>
        <CopyCode value={code} />
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${view.step}`}
        tabIndex={0}
        className="overflow-x-auto overflow-y-hidden outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground"
      >
        <pre className="sr-only">{code}</pre>
        <div
          aria-hidden
          className="relative flex font-mono text-[13px] transition-[height] duration-[480ms] ease-[cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none"
          // Fits the current step, so a short step leaves no empty editor
          // below it. The tabs sit above and never move; only the footer
          // rides the edge down, in step with the lines that push it.
          style={{
            height: rows[view.step] * LINE + PAD * 2,
            lineHeight: `${LINE}px`,
            paddingBlock: PAD,
          }}
        >
          {/* Rows that gained code in this step, so the reader knows where
              to look once the motion settles. */}
          {Array.from({ length: maxRows }, (_, r) => (
            <span
              key={r}
              className={cn(
                "pointer-events-none absolute inset-x-0 z-20 border-l-2 border-foreground/25 bg-foreground/[0.04]",
                "transition-opacity ease-out",
                view.added.has(r)
                  ? "opacity-100 delay-300 duration-300"
                  : "opacity-0 duration-150",
              )}
              style={{ top: PAD + r * LINE, height: LINE }}
            />
          ))}
          <div className="sticky left-0 z-10 shrink-0 bg-surface pr-4 pl-4 text-right text-muted/60 tabular-nums select-none">
            {Array.from({ length: maxRows }, (_, r) => (
              <div
                key={r}
                className={cn(
                  "transition-opacity duration-200 ease-out",
                  r < rows[view.step] ? "opacity-100" : "opacity-0",
                )}
              >
                {r + 1}
              </div>
            ))}
          </div>
          <div
            className="relative shrink-0 whitespace-pre"
            style={{ width: `calc(${cols}ch + 20px)` }}
          >
            {view.items.map((t) => (
              <span
                key={t.id}
                className={cn(
                  "cm-token absolute top-0 left-0 rounded-[3px]",
                  t.state === "enter" && "cm-enter",
                  t.state === "exit" && "cm-exit bg-danger/12",
                )}
                style={{
                  transform: `translate(${t.col}ch, ${t.row * LINE}px)`,
                  color: t.state === "exit" ? "var(--danger)" : COLORS[t.kind],
                }}
              >
                {t.text}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex h-12 items-center gap-3 border-t border-border px-4 text-sm">
        <span className="shrink-0 font-medium text-muted tabular-nums">
          {view.step + 1}/{steps.length}
        </span>
        <div className="relative min-w-0 flex-1">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.p
              key={view.step}
              initial={{ opacity: 0, filter: "blur(4px)", y: reduceMotion ? 0 : 4 }}
              animate={{
                opacity: 1,
                filter: "blur(0px)",
                y: 0,
                transition: { duration: 0.24, ease: EASE_OUT },
              }}
              exit={{
                opacity: 0,
                filter: "blur(2px)",
                transition: { duration: 0.12, ease: EASE_OUT },
              }}
              className="truncate text-foreground"
            >
              {current.title}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function CopyCode({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attempt = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (next: "copied" | "failed") => {
    setStatus(next);
    clearTimeout(timer.current);
    // Long enough to notice the check, short enough to copy again soon.
    timer.current = setTimeout(() => setStatus("idle"), 1600);
  };

  const copy = async () => {
    const n = ++attempt.current;
    // Confirm on press: the write is near instant and waiting reads as lag.
    show("copied");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
    } catch {
      if (n === attempt.current) show("failed");
    }
  };

  const done = status === "copied";

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy this step"
        className={cn(
          "relative grid size-9 shrink-0 touch-manipulation place-items-center rounded-lg text-muted outline-hidden hover:text-foreground",
          "transition-[scale,color] duration-150 ease-out active:scale-[0.96] motion-reduce:transition-[color]",
          "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-foreground",
        )}
      >
        {/* Both icons share one grid cell, so the outgoing one stays centred
            under the incoming one. popLayout re-measured the exit mid-press
            and let the two sit side by side in the flex row. */}
        <AnimatePresence initial={false}>
          <motion.svg
            key={done ? "check" : "copy"}
            initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
            transition={ICON_SWAP}
            viewBox="0 0 16 16"
            className="col-start-1 row-start-1 size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            {done ? (
              <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
            ) : (
              <>
                <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
                <path d="M10.75 5.25V4a1.25 1.25 0 0 0-1.25-1.25H4A1.25 1.25 0 0 0 2.75 4v5.5A1.25 1.25 0 0 0 4 10.75h1.25" />
              </>
            )}
          </motion.svg>
        </AnimatePresence>
      </button>
      <span role="status" className="sr-only">
        {status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy" : ""}
      </span>
    </>
  );
}

const STEPS: CodeStep[] = [
  {
    label: "Step 1",
    title: "Fetch the user in an effect",
    code: `
function Profile({ id }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(\`/api/users/\${id}\`)
      .then((res) => res.json())
      .then(setUser);
  }, [id]);

  return <Card user={user} />;
}`,
  },
  {
    label: "Step 2",
    title: "Show a spinner while it loads",
    code: `
function Profile({ id }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(\`/api/users/\${id}\`)
      .then((res) => res.json())
      .then(setUser)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  return <Card user={user} />;
}`,
  },
  {
    label: "Step 3",
    title: "Abort the stale request on a new id",
    code: `
function Profile({ id }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(\`/api/users/\${id}\`, { signal: controller.signal })
      .then((res) => res.json())
      .then(setUser)
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [id]);

  if (loading) return <Spinner />;
  return <Card user={user} />;
}`,
  },
];

export default function CodeMorphDemo() {
  return <CodeMorph steps={STEPS} />;
}
