import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LayoutGroup, motion } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/cn";

export type TreeNode = { name: string; children?: TreeNode[] };

type Item = { id: string; name: string; parent: string | null; folder: boolean };

// Each level steps in by 16px, the width of the chevron column, so a child's
// chevron sits just right of its parent's guide.
const INDENT = 16;
const ROW_PAD = 8;
const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
const HIGHLIGHT = { type: "spring", duration: 0.25, bounce: 0 } as const;
// Long enough to type "pa" at a normal pace, short enough that a fresh
// letter a moment later starts a new search.
const TYPEAHEAD_RESET = 500;

const join = (parent: string | null, name: string) => (parent ? `${parent}/${name}` : name);

// The rows a keyboard user can reach: everything not inside a closed folder.
function flatten(nodes: TreeNode[], open: Set<string>, parent: string | null = null): Item[] {
  return nodes.flatMap((node) => {
    const id = join(parent, node.name);
    const item = { id, name: node.name, parent, folder: !!node.children };
    return node.children && open.has(id) ? [item, ...flatten(node.children, open, id)] : [item];
  });
}

// A toggled folder row never moves: only rows below it shift, siblings never
// auto-collapse, and toggling never scrolls. Pin the demo with anchor "top".
export function TreeView({
  nodes,
  label,
  defaultOpen = [],
  defaultSelected,
  onSelect,
  className,
}: {
  nodes: TreeNode[];
  label: string;
  defaultOpen?: string[];
  defaultSelected?: string;
  onSelect?: (path: string) => void;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();
  const group = useId();
  const [open, setOpen] = useState(() => new Set(defaultOpen));
  const [selected, setSelected] = useState(defaultSelected ?? null);
  const visible = useMemo(() => flatten(nodes, open), [nodes, open]);
  const [focused, setFocused] = useState(() => defaultSelected ?? visible[0]?.id);
  const items = useRef(new Map<string, HTMLLIElement>());
  const typed = useRef("");
  const typedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(typedTimer.current), []);

  const focus = (id: string) => {
    setFocused(id);
    items.current.get(id)?.focus();
  };

  const setFolder = (id: string, next: boolean) =>
    setOpen((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });

  const activate = (item: Item) => {
    if (item.folder) return setFolder(item.id, !open.has(item.id));
    setSelected(item.id);
    onSelect?.(item.id);
  };

  const typeahead = (key: string, from: number) => {
    clearTimeout(typedTimer.current);
    typedTimer.current = setTimeout(() => (typed.current = ""), TYPEAHEAD_RESET);
    const next = typed.current + key.toLowerCase();
    // Repeating one letter cycles through the items that start with it.
    const repeat = [...next].every((c) => c === next[0]);
    typed.current = repeat ? next[0] : next;
    const start = repeat ? from + 1 : from;
    for (let n = 0; n < visible.length; n++) {
      const item = visible[(start + n) % visible.length];
      if (item.name.toLowerCase().startsWith(typed.current)) return focus(item.id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent, item: Item) => {
    const index = visible.findIndex((v) => v.id === item.id);
    const isOpen = open.has(item.id);
    const go = (i: number) => {
      const target = visible[i];
      if (target) focus(target.id);
    };
    switch (e.key) {
      case "ArrowDown":
        go(index + 1);
        break;
      case "ArrowUp":
        go(index - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(visible.length - 1);
        break;
      case "ArrowRight":
        if (item.folder && isOpen) go(index + 1);
        else if (item.folder) setFolder(item.id, true);
        break;
      case "ArrowLeft":
        if (item.folder && isOpen) setFolder(item.id, false);
        else if (item.parent) focus(item.parent);
        break;
      case "Enter":
      case " ":
        activate(item);
        break;
      default:
        if (e.key.length !== 1 || e.key === " " || e.metaKey || e.ctrlKey || e.altKey) return;
        typeahead(e.key, index);
    }
    e.preventDefault();
    // Items nest inside their parent's item; without this the parent would
    // handle the same key again.
    e.stopPropagation();
  };

  const selectedFolder = selected?.includes("/") ? selected.slice(0, selected.lastIndexOf("/")) : null;

  const render = (list: TreeNode[], depth: number, parent: string | null): React.ReactNode =>
    list.map((node) => {
      const id = join(parent, node.name);
      const item: Item = { id, name: node.name, parent, folder: !!node.children };
      const isOpen = open.has(id);
      const isSelected = selected === id;
      return (
        <li
          key={id}
          ref={(el) => {
            if (el) items.current.set(id, el);
            else items.current.delete(id);
          }}
          role="treeitem"
          aria-expanded={item.folder ? isOpen : undefined}
          aria-selected={item.folder ? undefined : isSelected}
          tabIndex={focused === id ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, item)}
          onFocus={(e) => {
            if (e.target === e.currentTarget) setFocused(id);
          }}
          // The item holds its children too, so the ring goes on the row alone.
          className="outline-hidden [&:focus-visible>div]:outline-2 [&:focus-visible>div]:outline-solid [&:focus-visible>div]:-outline-offset-2 [&:focus-visible>div]:outline-foreground"
        >
          <div
            onClick={() => activate(item)}
            style={{ paddingLeft: ROW_PAD + depth * INDENT }}
            className={cn(
              "relative flex h-8 cursor-default items-center gap-1.5 rounded-md pr-2 text-[15px] transition-[color,background-color] duration-150 ease-out select-none hover:bg-surface/60",
              isSelected || item.folder ? "text-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {/* Every row spans the full width, so moving the highlight is a
                pure translate and nothing inside it stretches. */}
            {isSelected && (
              <motion.span
                layoutId="tree-highlight"
                transition={reduceMotion ? { duration: 0 } : HIGHLIGHT}
                className="absolute inset-0 rounded-md bg-surface"
              />
            )}
            <span className="relative flex size-4 shrink-0 items-center justify-center text-muted">
              {item.folder && (
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden
                  className={cn(
                    "size-3.5 transition-[rotate] duration-200 motion-reduce:transition-none",
                    EASE,
                    isOpen && "rotate-90",
                  )}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 4 4 4-4 4" />
                </svg>
              )}
            </span>
            <svg
              viewBox="0 0 16 16"
              aria-hidden
              className="relative size-4 shrink-0 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {item.folder ? (
                <path d="M2.25 4.5A1.25 1.25 0 0 1 3.5 3.25h2.6l1.4 1.5h5a1.25 1.25 0 0 1 1.25 1.25v5.5a1.25 1.25 0 0 1-1.25 1.25h-9A1.25 1.25 0 0 1 2.25 11.5z" />
              ) : (
                <path d="M4.25 2.25h4.5l3 3v7.25a1.25 1.25 0 0 1-1.25 1.25h-6.25A1.25 1.25 0 0 1 3 12.5v-9a1.25 1.25 0 0 1 1.25-1.25zM8.5 2.5v3h3" />
              )}
            </svg>
            <span className="relative truncate">{node.name}</span>
          </div>
          {node.children && (
            <Collapse open={isOpen}>
              <ul role="group" className="relative">
                {render(node.children, depth + 1, id)}
                {/* After the rows so it paints over the highlight, the way an
                    editor draws its guides; 7.5px centres it under the
                    parent's 16px chevron column. */}
                <span
                  aria-hidden
                  style={{ left: ROW_PAD + depth * INDENT + 7.5 }}
                  className={cn(
                    "pointer-events-none absolute inset-y-0 w-px transition-[background-color] duration-150 ease-out",
                    selectedFolder === id ? "bg-foreground/35" : "bg-border",
                  )}
                />
              </ul>
            </Collapse>
          )}
        </li>
      );
    });

  return (
    <LayoutGroup id={group}>
      <ul role="tree" aria-label={label} className={cn("flex flex-col", className)}>
        {render(nodes, 0, null)}
      </ul>
    </LayoutGroup>
  );
}

// Animates grid-template-rows between 0fr and 1fr, so the folder reaches its
// real height without anything being measured.
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  // Clipping is only needed while the rows move. A folder that has finished
  // opening stops clipping, so the highlight can glide in from a row outside
  // it without being cut off at its edge.
  const [settledAt, setSettledAt] = useState(open);
  const settled = open && settledAt === open;
  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === "grid-template-rows") {
          setSettledAt(open);
        }
      }}
      className={cn(
        "grid motion-reduce:transition-none",
        EASE,
        open
          ? "grid-rows-[1fr] transition-[grid-template-rows] duration-250"
          : "grid-rows-[0fr] transition-[grid-template-rows] duration-200",
      )}
    >
      {/* Rows fade in a beat behind the opening and leave at once, so text is
          never seen squeezed by a closing folder. */}
      <div
        className={cn(
          "min-h-0 motion-reduce:transition-[opacity]",
          settled ? "overflow-visible" : "overflow-hidden",
          open
            ? "opacity-100 blur-[0px] transition-[opacity,filter] delay-50 duration-200 ease-out"
            : "opacity-0 blur-[2px] transition-[opacity,filter] duration-120 ease-out",
        )}
      >
        {children}
      </div>
    </div>
  );
}

const PROJECT: TreeNode[] = [
  {
    name: "src",
    children: [
      {
        name: "app",
        children: [{ name: "layout.tsx" }, { name: "page.tsx" }, { name: "globals.css" }],
      },
      {
        name: "lab",
        children: [
          {
            name: "components",
            children: [
              { name: "code-block.tsx" },
              { name: "reading-progress.tsx" },
              { name: "tree-view.tsx" },
            ],
          },
          { name: "registry.ts" },
        ],
      },
      { name: "lib", children: [{ name: "cn.ts" }] },
    ],
  },
  { name: "public", children: [{ name: "favicon.svg" }, { name: "og.png" }] },
  { name: "package.json" },
  { name: "README.md" },
];

export default function TreeViewDemo() {
  return (
    // 6px of padding around 6px row corners keeps the radii concentric: 12 = 6 + 6.
    <div className="w-[360px] max-w-full rounded-xl bg-background p-1.5 shadow-raised">
      <TreeView
        nodes={PROJECT}
        label="Project files"
        defaultOpen={["src", "src/app"]}
        defaultSelected="src/app/page.tsx"
      />
    </div>
  );
}
