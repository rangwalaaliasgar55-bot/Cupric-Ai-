import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type CodeFile = { name: string; language: "tsx" | "css"; code: string };

type Kind = "keyword" | "string" | "comment" | "number" | "plain";
type Token = { kind: Kind; text: string };

// Syntax colors are data, like the swatches in color-swatches: they encode
// token kinds rather than decorate, so they sit outside the token palette.
// Each pair keeps the same hue and roughly 4.5:1 against the surface in both
// themes; comments and plain text stay on the muted and foreground tokens.
const COLORS: Record<Kind, string | undefined> = {
  keyword: "light-dark(oklch(0.5 0.14 285), oklch(0.78 0.11 285))",
  string: "light-dark(oklch(0.5 0.1 155), oklch(0.8 0.1 155))",
  number: "light-dark(oklch(0.5 0.14 285), oklch(0.78 0.11 285))",
  comment: "var(--muted)",
  plain: undefined,
};

const TS_KEYWORDS = new Set(
  "import from export default function return const let type interface if else as new true false null undefined async await".split(
    " ",
  ),
);

// One pass per language. Earlier alternatives win, so a number inside a
// string or comment stays part of that string or comment.
// Each group maps, in order, to the kind in GROUPS. A TS word is only a
// keyword when it is in TS_KEYWORDS; a CSS keyword is an at-rule or a
// property name at the start of a line.
const PATTERNS = {
  tsx: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g,
  css: /(\/\*[\s\S]*?\*\/)|("[^"\n]*"|'[^'\n]*')|(\b\d+(?:\.\d+)?(?:px|ms|s|rem|em|%)?)|(@[\w-]+|(?<=^[ \t]*)[a-z-]+(?=\s*:))/gm,
};
const GROUPS = ["comment", "string", "number", "word"] as const;

function tokenize(code: string, language: CodeFile["language"]): Token[][] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of code.matchAll(PATTERNS[language])) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "plain", text: code.slice(last, index) });
    const group = GROUPS[match.slice(1).findIndex((g) => g !== undefined)];
    const kind: Kind =
      group !== "word"
        ? group
        : language === "css" || TS_KEYWORDS.has(match[0])
          ? "keyword"
          : "plain";
    tokens.push({ kind, text: match[0] });
    last = index + match[0].length;
  }
  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });

  // Split into lines, cutting any token that spans one, like a block comment.
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    token.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

export function CodeBlock({ files, className }: { files: CodeFile[]; className?: string }) {
  const reduceMotion = useReducedMotion();
  const id = useId();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const highlighted = useMemo(() => files.map((f) => tokenize(f.code.trim(), f.language)), [files]);

  return (
    <div
      className={cn(
        "w-[520px] max-w-full overflow-hidden rounded-2xl bg-surface shadow-raised",
        className,
      )}
    >
      <div className="flex h-11 items-stretch justify-between border-b border-border pr-2 pl-2">
        <LayoutGroup id={id}>
          <div role="tablist" aria-label="Files" className="flex min-w-0">
            {files.map((file, i) => {
              const selected = i === active;
              return (
                <button
                  key={file.name}
                  ref={(el) => {
                    tabs.current[i] = el;
                  }}
                  id={`${id}-tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`${id}-panel-${i}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={(e) => {
                    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
                    const target =
                      step !== undefined
                        ? (i + step + files.length) % files.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? files.length - 1
                            : null;
                    if (target === null) return;
                    e.preventDefault();
                    setActive(target);
                    tabs.current[target]?.focus();
                  }}
                  className={cn(
                    "group relative touch-manipulation px-3 font-mono text-[13px] outline-hidden transition-[color] duration-150 ease-out select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-4 focus-visible:outline-foreground",
                    selected ? "text-foreground" : "text-muted hover:text-foreground",
                  )}
                >
                  {/* Press feedback on the label only, so the underline is
                      never measured mid-scale when the tab changes. */}
                  <span className="inline-block transition-[scale] duration-150 ease-out group-active:scale-[0.96] motion-reduce:transition-none">
                    {file.name}
                  </span>
                  {selected && (
                    <motion.span
                      layoutId="code-tab-underline"
                      transition={
                        reduceMotion ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0 }
                      }
                      // Sits on the header's border so the two read as one line.
                      className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-foreground"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </LayoutGroup>
        <div className="flex items-center">
          <CopyCode value={files[active].code.trim()} />
        </div>
      </div>

      {/* Every file keeps its own scroll box, stacked in one fixed-height
          cell, so switching is a true crossfade and each file remembers
          where you had scrolled to. */}
      <div className="relative h-[280px]">
        {files.map((file, i) => {
          const selected = i === active;
          return (
            <div
              key={file.name}
              id={`${id}-panel-${i}`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${i}`}
              tabIndex={selected ? 0 : -1}
              inert={!selected}
              className={cn(
                "absolute inset-0 overflow-auto overscroll-contain outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-foreground",
                "transition-[opacity,filter] ease-out motion-reduce:transition-[opacity]",
                selected
                  ? "opacity-100 blur-[0px] duration-200"
                  : "opacity-0 blur-[4px] duration-150 motion-reduce:blur-[0px]",
              )}
            >
              <pre className="min-w-max py-3 font-mono text-[14px] leading-6">
                <code>
                  {highlighted[i].map((line, n) => (
                    <div key={n} className="flex">
                      {/* Sticky, so numbers stay put while long lines scroll
                          sideways underneath them. */}
                      <span
                        aria-hidden
                        className="sticky left-0 w-11 shrink-0 bg-surface pr-4 text-right text-muted/60 tabular-nums select-none"
                      >
                        {n + 1}
                      </span>
                      <span className="pr-5 whitespace-pre text-foreground">
                        {line.map((token, t) => (
                          <span key={t} style={{ color: COLORS[token.kind] }}>
                            {token.text}
                          </span>
                        ))}
                        {/* Keeps empty lines one row tall. */}
                        {line.length === 0 && " "}
                      </span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Status = "idle" | "copied" | "failed";

function CopyCode({ value }: { value: string }) {
  const reduceMotion = useReducedMotion();
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attempt = useRef(0);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (next: Status) => {
    setStatus(next);
    clearTimeout(timer.current);
    // Long enough to read the label, short enough to copy again soon.
    timer.current = setTimeout(() => setStatus("idle"), 1600);
  };

  const copy = async () => {
    const id = ++attempt.current;
    // Confirms on press; the write is near instant and waiting for it makes
    // the click feel ignored.
    show("copied");
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
    } catch {
      // A newer click has already taken over the label.
      if (id === attempt.current) show("failed");
    }
  };

  const labels: Record<Status, string> = { idle: "Copy", copied: "Copied", failed: "Failed" };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy code"
      className={cn(
        "relative flex h-8 touch-manipulation items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted outline-hidden transition-[scale,color,background-color] duration-150 ease-out select-none hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-foreground active:scale-[0.96] motion-reduce:transition-[color,background-color]",
        // Grows the hit area to 40px tall without growing the button.
        "after:absolute after:-inset-1",
        status !== "idle" && "text-foreground",
      )}
    >
      <span className="grid" aria-hidden>
        <Icon visible={status !== "copied"} reduceMotion={reduceMotion}>
          <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" />
          <path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" />
        </Icon>
        <Icon visible={status === "copied"} reduceMotion={reduceMotion}>
          <path d="m3.5 8.5 3 3 6-7" />
        </Icon>
      </span>
      {/* All three labels share one cell, so the button keeps the width of
          the longest and never jumps. */}
      <span className="grid" aria-hidden>
        {(Object.keys(labels) as Status[]).map((key) => (
          <span
            key={key}
            className={cn(
              "col-start-1 row-start-1 transition-[opacity,filter] ease-out",
              key === status ? "opacity-100 blur-[0px] duration-200" : "opacity-0 blur-[4px] duration-150",
            )}
          >
            {labels[key]}
          </span>
        ))}
      </span>
      <span className="sr-only" aria-live="polite">
        {status === "copied" ? "Copied" : status === "failed" ? "Couldn't copy" : ""}
      </span>
    </button>
  );
}

function Icon({
  visible,
  reduceMotion,
  children,
}: {
  visible: boolean;
  reduceMotion: boolean | null;
  children: React.ReactNode;
}) {
  const hidden = reduceMotion ? { opacity: 0 } : { scale: 0.25, opacity: 0, filter: "blur(4px)" };
  return (
    <motion.svg
      viewBox="0 0 16 16"
      className="col-start-1 row-start-1 size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={false}
      animate={visible ? { scale: 1, opacity: 1, filter: "blur(0px)" } : hidden}
      transition={{ type: "spring", duration: 0.3, bounce: 0 }}
    >
      {children}
    </motion.svg>
  );
}

const FILES: CodeFile[] = [
  {
    name: "button.tsx",
    language: "tsx",
    code: `
import { cn } from "@/lib/cn";

type ButtonProps = React.ComponentProps<"button">;

// Scales to 0.96 on press, so the click feels physical.
export function Button({ className, ...props }: ButtonProps) {
  return (
    <button
      className={cn("h-10 rounded-full px-4 transition-[scale] duration-150 active:scale-[0.96]", className)}
      {...props}
    />
  );
}

export default function Demo() {
  return <Button onClick={() => console.log(42)}>Save</Button>;
}
`,
  },
  {
    name: "styles.css",
    language: "css",
    code: `
/* Strong ease-out: responds at once, then settles. */
.button {
  height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  transition: scale 150ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease;
}

.button:active {
  scale: 0.96;
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: background-color 150ms ease;
  }
}
`,
  },
];

export default function CodeBlockDemo() {
  return <CodeBlock files={FILES} />;
}
