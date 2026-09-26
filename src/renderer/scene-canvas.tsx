"use client";

import type { CSSProperties, KeyboardEvent } from "react";
import { motion } from "motion/react";
import { evaluateNode, getActiveScene } from "@/core/timeline";
import type { Composition, MotionElement, RenderedNodeState } from "@/core/types";

type SceneCanvasProps = {
  composition: Composition;
  frame: number;
  selectedNodeId?: string;
  onSelectNode?: (id: string) => void;
  reducedMotion?: boolean;
};

function asText(value: unknown, fallback = "") {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" ? value : fallback;
}

function transformStyle(state: RenderedNodeState): CSSProperties {
  const { transform } = state;
  return {
    opacity: state.visible ? transform.opacity : 0,
    filter: transform.blur ? `blur(${transform.blur}px)` : undefined,
    transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) translateZ(${transform.z}px) rotateX(${transform.rotateX}deg) rotateY(${transform.rotateY}deg) rotate(${transform.rotateZ}deg) scale(${transform.scale * transform.scaleX}, ${transform.scale * transform.scaleY})`,
  };
}

function SignalShape({ label, frame, state }: { label: string; frame: number; state: RenderedNodeState }) {
  const pulse = 1 + Math.sin(frame / 11) * 0.025;
  if (label === "AI") {
    return (
      <div className="orb-object" style={{ transform: `scale(${pulse})`, background: `radial-gradient(circle at 34% 28%, #f6ffff, ${asText(state.props.color, "#55f0cc")} 12%, #4f52ff 46%, #171932 73%)` }}>
        <span className="orb-core">AI</span>
        <i className="orb-orbit orb-orbit-one" />
        <i className="orb-orbit orb-orbit-two" />
      </div>
    );
  }
  if (label.length === 1) return <div className="brand-mark">{label}</div>;
  return (
    <div className="signal-shape" aria-hidden="true">
      <span /><span /><span /><b />
    </div>
  );
}

function BrowserVisual({ productName }: { productName: string }) {
  return (
    <div className="browser-visual" aria-label={`${productName} product workspace`}>
      <div className="browser-chrome"><div className="browser-dots"><i /><i /><i /></div><span>{productName.toLowerCase()}.studio / command</span><b>⌘ K</b></div>
      <div className="browser-workspace">
        <aside><div className="mini-mark">N</div><span className="nav-active">Overview</span><span>Signals</span><span>Automations</span><span>Library</span><div className="aside-bottom">•••</div></aside>
        <section>
          <header><div><small>GOOD MORNING, ALEX</small><h4>Clarity, on demand.</h4></div><div className="avatar-stack"><i>JT</i><i>RS</i><button type="button" aria-label="Invite collaborator">+</button></div></header>
          <div className="signal-card"><div><small>LIVE INTELLIGENCE</small><h5>What needs your attention?</h5><p>Three product signals are ready to move.</p></div><div className="signal-badge">✦</div></div>
          <div className="metric-row"><div><small>MOMENTUM</small><strong>84<span>%</span></strong><em>↗ 18.4%</em></div><div><small>READY TO SHIP</small><strong>12</strong><em>↗ 4 this week</em></div><div><small>FOCUS TIME</small><strong>7.2<span>h</span></strong><em>↗ +1.6h</em></div></div>
          <div className="browser-chart"><div className="chart-label"><span>Momentum</span><b>+24.8%</b></div><svg viewBox="0 0 330 82" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="browser-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#8d79ff" stopOpacity=".42"/><stop offset="1" stopColor="#8d79ff" stopOpacity="0"/></linearGradient></defs><path d="M0 72 C18 65 26 68 42 61 S66 65 82 52 S110 54 126 42 S154 48 170 32 S200 36 216 23 S245 33 260 18 S290 18 330 2 L330 82 L0 82Z" fill="url(#browser-fill)"/><path d="M0 72 C18 65 26 68 42 61 S66 65 82 52 S110 54 126 42 S154 48 170 32 S200 36 216 23 S245 33 260 18 S290 18 330 2" fill="none" stroke="#b6aaff" strokeWidth="2.2"/></svg></div>
        </section>
      </div>
    </div>
  );
}

function ChartVisual({ state, frame }: { state: RenderedNodeState; frame: number }) {
  const value = asText(state.props.value, "+240%");
  const label = asText(state.props.label, "Momentum");
  const dashOffset = Math.max(0, 144 - (frame % 90) * 2.2);
  return (
    <div className="chart-visual">
      <div className="chart-visual-top"><span>{label}</span><b>{value}</b></div>
      <svg viewBox="0 0 250 118" aria-label={`${label}: ${value}`}>
        <path className="chart-grid" d="M0 94H250M0 62H250M0 30H250" />
        <path d="M3 92 C24 79, 35 86, 53 72 S79 75, 96 60 S125 63, 141 44 S164 50, 180 30 S210 40, 246 10" fill="none" stroke="#5CE7C4" strokeWidth="3" strokeLinecap="round" pathLength="144" strokeDasharray="144" strokeDashoffset={dashOffset} />
        <path d="M3 92 C24 79, 35 86, 53 72 S79 75, 96 60 S125 63, 141 44 S164 50, 180 30 S210 40, 246 10 L246 116 L3 116Z" fill="url(#chart-fill)" opacity=".65" />
        <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#56E8C6" stopOpacity=".26"/><stop offset="1" stopColor="#56E8C6" stopOpacity="0"/></linearGradient></defs>
      </svg>
    </div>
  );
}

function BackgroundVisual({ state }: { state: RenderedNodeState }) {
  const variant = asText(state.props.variant, "aurora");
  const primary = asText(state.props.primary, "#7C5CFF");
  const accent = asText(state.props.accent, "#4EE7C0");
  return <div className={`scene-background background-${variant}`} style={{ "--primary": primary, "--accent": accent } as CSSProperties} />;
}

function TextVisual({ state }: { state: RenderedNodeState }) {
  const variant = asText(state.props.variant, "body");
  const content = asText(state.props.content);
  return <div className={`canvas-text text-${variant}`} style={{ color: asText(state.style.color, "#F6F5FF") }}>{content.split("\n").map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</div>;
}

function renderContent(node: MotionElement, state: RenderedNodeState, frame: number) {
  if (node.type === "background") return <BackgroundVisual state={state} />;
  if (node.type === "text" || node.type === "caption") return <TextVisual state={state} />;
  if (node.type === "shape") return <SignalShape label={asText(state.props.label, asText(state.props.shape, ""))} frame={frame} state={state} />;
  if (node.type === "ui") {
    const variant = asText(state.props.variant);
    if (variant === "browser") return <BrowserVisual productName={asText(state.props.productName, "NOVA")} />;
    return <div className="cta-button-visual"><span>{asText(state.props.label, "Start now")}</span><b>↗</b></div>;
  }
  if (node.type === "chart") return <ChartVisual state={state} frame={frame} />;
  if (node.type === "effect") return <div className="effect-grain" aria-hidden="true" />;
  if (node.type === "three:model") return <div className="three-fallback"><span>3D</span><small>R3F adapter fallback</small></div>;
  return null;
}

function CanvasNode({
  composition,
  node,
  frame,
  selectedNodeId,
  onSelectNode,
}: {
  composition: Composition;
  node: MotionElement;
  frame: number;
  selectedNodeId?: string;
  onSelectNode?: (id: string) => void;
}) {
  const state = evaluateNode(node, composition, frame);
  const interactive = node.type !== "background";
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Enter" || event.key === " ") && interactive) {
      event.preventDefault();
      onSelectNode?.(node.id);
    }
  };
  return (
    <motion.div
      className={`canvas-node node-${node.type.replace(":", "-")} ${node.id === selectedNodeId ? "is-selected" : ""} ${interactive ? "is-interactive" : ""}`}
      style={transformStyle(state)}
      initial={false}
      transition={{ duration: 0.08, ease: "linear" }}
      onClick={() => interactive && onSelectNode?.(node.id)}
      onKeyDown={onKeyDown}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Select ${node.name}` : undefined}
    >
      {renderContent(node, state, frame)}
      {node.children?.map((child) => <CanvasNode key={child.id} composition={composition} node={child} frame={frame} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />)}
    </motion.div>
  );
}

export function SceneCanvas({ composition, frame, selectedNodeId, onSelectNode, reducedMotion }: SceneCanvasProps) {
  const active = getActiveScene(composition, frame);
  const scene = (active?.scene as any) ?? composition.scenes[0];
  const startFrame = scene.startFrame ?? 0;
  const safeFrame = reducedMotion ? startFrame + 55 : frame;
  return (
    <div className="scene-frame" style={{ aspectRatio: `${composition.width} / ${composition.height}` }}>
      <div className="scene-stage" aria-label={`${composition.name} frame ${safeFrame + 1}`}>
        {(scene.nodes as any[])?.map((node: any) => <CanvasNode key={node.id} composition={composition} node={node} frame={safeFrame} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />)}
        <div className="scene-safe-zone" aria-hidden="true" />
      </div>
    </div>
  );
}

export function MiniFrame({ composition, frame }: Pick<SceneCanvasProps, "composition" | "frame">) {
  return <SceneCanvas composition={composition} frame={frame} reducedMotion />;
}
