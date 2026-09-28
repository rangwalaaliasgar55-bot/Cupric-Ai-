import { EASE_SOFT } from '../lib/motion'
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { exportCompositionJson, importCompositionFile } from "@/core/serialization";
import { findNode, getActiveScene } from "@/core/timeline";
import type { AssetCategory, AssetSchema, Composition, JsonValue, MotionElement, RegistryEntry, Transform } from "@/core/types";
import { getComponentSchema, listAssets, searchAssets } from "@/registry";
import { SceneCanvas } from "@/renderer/scene-canvas";
import { applyAspectRatio, getTemplate, listTemplates, type TemplateId } from "@/templates";
import { guardedJson } from "@/lib/net";

type StudioProps = { initialTemplate?: TemplateId };

type Notice = { type: "success" | "error" | "info"; message: string } | null;

const categories: Array<{ id: AssetCategory | "all"; label: string; icon: string }> = [
  { id: "all", label: "All assets", icon: "✦" },
  { id: "template", label: "Templates", icon: "▦" },
  { id: "typography", label: "Text", icon: "T" },
  { id: "background", label: "Backgrounds", icon: "◒" },
  { id: "ui", label: "UI surfaces", icon: "▤" },
  { id: "chart", label: "Charts", icon: "⌁" },
  { id: "effect", label: "Effects", icon: "◌" },
  { id: "transition", label: "Transitions", icon: "↔" },
  { id: "three", label: "3D", icon: "◇" },
];

const presetMap: Record<string, string> = {
  "motion.fade-up": "FADE_UP",
  "motion.fade-down": "FADE_DOWN",
  "motion.pop": "POP",
  "motion.spring": "SPRING",
  "motion.blur-scale": "BLUR_SCALE",
  "motion.cinematic": "CINEMATIC",
  "motion.tech": "FADE_UP",
  "motion.float": "SCALE",
};

function updateNodes(nodes: MotionElement[], id: string, updater: (node: MotionElement) => MotionElement): MotionElement[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children) return { ...node, children: updateNodes(node.children, id, updater) };
    return node;
  });
}

function updateCompositionNode(composition: Composition, id: string, updater: (node: MotionElement) => MotionElement) {
  return { ...composition, scenes: composition.scenes.map((scene) => ({ ...scene, nodes: updateNodes(scene.nodes as any, id, updater) })) };
}

function findCompositionNode(composition: Composition, id?: string) {
  if (!id) return undefined;
  for (const scene of composition.scenes) {
    const result = findNode(composition, id);
    if (result) return result;
  }
  return undefined;
}

function nodeAssetId(node: MotionElement) {
  if (node.type === "background") return `background.${String(node.props?.variant ?? "aurora")}`;
  if (node.type === "text") return "type.cinematic";
  if (node.type === "chart") return "chart.signal";
  if (node.type === "ui") return "ui.browser";
  return "motion.fade-up";
}

function formatTime(frame: number, fps: number) {
  const seconds = Math.floor(frame / fps);
  const frames = frame % fps;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

function Icon({ name }: { name: "play" | "pause" | "restart" | "export" | "import" | "save" | "copy" | "spark" | "close" }) {
  const paths = {
    play: "▶",
    pause: "Ⅱ",
    restart: "↺",
    export: "⇧",
    import: "⇩",
    save: "⊙",
    copy: "⧉",
    spark: "✦",
    close: "×",
  };
  return <span className="icon-glyph" aria-hidden="true">{paths[name]}</span>;
}

function SchemaControls({ schema, node, onUpdate }: { schema?: AssetSchema; node: MotionElement; onUpdate: (key: string, value: JsonValue) => void }) {
  if (!schema || !Object.keys(schema).length) return <p className="inspector-empty">This element exposes transform and timing controls.</p>;
  return (
    <div className="schema-controls">
      {Object.entries(schema).slice(0, 4).map(([key, field]) => {
        const value = node.props?.[key] ?? field.default;
        if (field.type === "boolean") {
          return <label className="control-row toggle-row" key={key}><span>{field.label}</span><input type="checkbox" checked={Boolean(value)} onChange={(event) => onUpdate(key, event.target.checked)} /></label>;
        }
        if (field.type === "select") {
          return <label className="control-row" key={key}><span>{field.label}</span><select value={String(value)} onChange={(event) => onUpdate(key, event.target.value)}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
        }
        if (field.type === "color") {
          return <label className="control-row color-row" key={key}><span>{field.label}</span><input type="color" value={String(value)} onChange={(event) => onUpdate(key, event.target.value)} /><code>{String(value)}</code></label>;
        }
        const numeric = field.type === "number" || field.type === "range";
        return <label className="control-row" key={key}><span>{field.label}</span><div className="control-number"><input type={numeric ? "number" : "text"} min={field.min} max={field.max} step={field.step} value={String(value)} onChange={(event) => onUpdate(key, numeric ? Number(event.target.value) : event.target.value)} />{field.type === "range" && <input className="control-range" type="range" min={field.min} max={field.max} step={field.step} value={Number(value)} onChange={(event) => onUpdate(key, Number(event.target.value))} />}</div></label>;
      })}
    </div>
  );
}

export function Studio({ initialTemplate = "ai-product-launch" }: StudioProps) {
  const reduceMotion = useReducedMotion();
  const [composition, setComposition] = useState<Composition>(() => getTemplate(initialTemplate));
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("hero.headline");
  const [assetCategory, setAssetCategory] = useState<AssetCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [assetFocus, setAssetFocus] = useState<RegistryEntry | null>(null);
  const [notice, setNotice] = useState<Notice>({ type: "info", message: "Composition loaded locally. Every edit changes the shared scene graph." });
  const [timelineScale, setTimelineScale] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedNode = useMemo(() => findCompositionNode(composition, selectedNodeId), [composition, selectedNodeId]);
  const activeScene = useMemo(() => getActiveScene(composition, frame) ?? composition.scenes[0], [composition, frame]);
  const focusedSchema = assetFocus?.schema ?? (selectedNode ? getComponentSchema(nodeAssetId(selectedNode)) : undefined);
  const filteredAssets = useMemo(() => {
    const list = search.trim() ? searchAssets(search, assetCategory === "all" ? undefined : assetCategory) : listAssets(assetCategory === "all" ? undefined : assetCategory);
    return list.slice(0, 12);
  }, [assetCategory, search]);

  useEffect(() => {
    if (!playing || reduceMotion) return;
    const interval = window.setInterval(() => {
      setFrame((current) => current >= composition.durationInFrames - 1 ? 0 : current + 1);
    }, 1000 / composition.fps);
    return () => window.clearInterval(interval);
  }, [composition.durationInFrames, composition.fps, playing, reduceMotion]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.matches("input, textarea, select")) return;
      if (event.code === "Space") { event.preventDefault(); setPlaying((value) => !value); }
      if (event.key === "ArrowRight") setFrame((value) => Math.min(composition.durationInFrames - 1, value + 1));
      if (event.key === "ArrowLeft") setFrame((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [composition.durationInFrames]);

  const changeNode = (id: string, updater: (node: MotionElement) => MotionElement) => {
    setComposition((current) => updateCompositionNode(current, id, updater) as any);
  };

  const updateTransform = (key: keyof Transform, raw: string) => {
    if (!selectedNode) return;
    const value = Number(raw);
    changeNode(selectedNode.id, (node) => ({ ...node, transform: { ...node.transform, [key]: Number.isFinite(value) ? value : 0 } }));
  };

  const updateNodeProp = (key: string, value: JsonValue) => {
    if (!selectedNode) return;
    changeNode(selectedNode.id, (node) => ({ ...node, props: { ...node.props, [key]: value } }));
  };

  const chooseTemplate = (id: TemplateId) => {
    setComposition(getTemplate(id));
    setFrame(0);
    setPlaying(false);
    setSelectedNodeId("hero.headline");
    setNotice({ type: "success", message: `${listTemplates().find((template) => template.id === id)?.name ?? "Template"} is now active.` });
  };

  const applyAsset = (asset: RegistryEntry) => {
    setAssetFocus(asset);
    if (!selectedNode) return;
    if (asset.category === "motion" || asset.category === "typography") {
      const preset = presetMap[asset.id] ?? "FADE_UP";
      changeNode(selectedNode.id, (node) => ({ ...node, animation: { ...node.animation, entrance: preset } }));
      setNotice({ type: "success", message: `${asset.name} applied to ${selectedNode.name}.` });
      return;
    }
    if (asset.category === "background") {
      const target = (activeScene.scene?.nodes as any[])?.find((node) => node.type === "background");
      if (target) {
        changeNode(target.id, (node) => ({ ...node, props: { ...node.props, variant: asset.id.replace("background.", "") } }));
        setSelectedNodeId(target.id);
        setNotice({ type: "success", message: `${asset.name} applied to ${(activeScene.scene?.name || "Scene")}.` });
      }
      return;
    }
    setNotice({ type: "info", message: `${asset.name} is selected. Its editable schema is available in the inspector.` });
  };

  const exportJson = () => {
    const blob = new Blob([exportCompositionJson(composition)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${composition.id}.template.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({ type: "success", message: "Validated template JSON downloaded." });
  };

  const importJson = async (file?: File) => {
    if (!file) return;
    const result = await importCompositionFile(file);
    if (result.success) {
      setComposition(result.data);
      setFrame(0);
      setSelectedNodeId(result.data.scenes[0]?.nodes[0]?.id ?? "");
      setNotice({ type: "success", message: "Template imported and validated." });
    } else setNotice({ type: "error", message: result.errors[0] ?? "Import failed." });
  };

  const copyConfiguration = async () => {
    try {
      await navigator.clipboard.writeText(exportCompositionJson(composition));
      setNotice({ type: "success", message: "Composition JSON copied to your clipboard." });
    } catch {
      setNotice({ type: "error", message: "Clipboard access is unavailable in this browser." });
    }
  };

  const persistComposition = async () => {
    try {
      // F-3: guarded — the compositions API only exists behind the dev server.
      const response = await guardedJson<{ error?: string; savedAt?: string }>("/api/compositions", { allowOffline: true, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: exportCompositionJson(composition) } });
      if (!response.ok) throw new Error(response.reason);
      if (response.data.error) throw new Error(response.data.error);
      setNotice({ type: "success", message: `Saved to local workspace at ${new Date(response.data.savedAt ?? Date.now()).toLocaleTimeString()}.` });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "Could not save composition." });
    }
  };

  const selectFrame = (next: number) => {
    setPlaying(false);
    setFrame(Math.max(0, Math.min(composition.durationInFrames - 1, next)));
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Prism Motion OS home"><span className="brand-sigil"><i /><i /><i /></span><span>PRISM <em>MOTION OS</em></span></a>
        <nav className="top-nav" aria-label="Primary navigation"><a href="#studio">Studio</a><a href="#library">Library</a><a href="#timeline">Timeline</a><a href="/docs">Docs</a></nav>
        <div className="top-actions"><span className="autosave"><i />Local-first</span><button className="button ghost" onClick={copyConfiguration}><Icon name="copy" />Copy JSON</button><button className="button primary" onClick={exportJson}><Icon name="export" />Export template</button></div>
      </header>

      <section className="projectbar">
        <div className="project-title"><button className="project-switcher" onClick={() => setAssetCategory("template")} aria-label="Browse templates">{composition.name}<span>⌄</span></button><span className="project-dot" /><small>{composition.width} × {composition.height} · {composition.fps} FPS · {Math.round(composition.durationInFrames / composition.fps)} SEC</small></div>
        <div className="project-actions"><label className="format-select"><span>FORMAT</span><select value={composition.aspectRatio} onChange={(event) => setComposition((current) => applyAspectRatio(current, event.target.value as Composition["aspectRatio"]))}><option value="16:9">16:9 Landscape</option><option value="9:16">9:16 Portrait</option><option value="1:1">1:1 Square</option></select></label><button className="button dark" onClick={persistComposition}><Icon name="save" />Save</button><button className="icon-button" onClick={() => setComposition(getTemplate(initialTemplate))} aria-label="Reset composition"><Icon name="restart" /></button></div>
      </section>

      <div className="workspace" id="studio">
        <aside className="asset-panel" id="library">
          <div className="panel-heading"><div><span className="overline">COMPOSITION LIBRARY</span><h2>Build from a system.</h2></div><button className="panel-close" aria-label="Collapse library" onClick={() => setAssetCategory("all")}><Icon name="close" /></button></div>
          <label className="asset-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" /></label>
          <div className="asset-categories" role="tablist" aria-label="Asset categories">{categories.map((category) => <button key={category.id} role="tab" aria-selected={assetCategory === category.id} className={assetCategory === category.id ? "active" : ""} onClick={() => setAssetCategory(category.id)}><i>{category.icon}</i>{category.label}</button>)}</div>
          {assetCategory === "template" && !search ? <div className="template-stack">{listTemplates().map((template, index) => <button className={`template-card ${composition.id === template.id ? "current" : ""}`} key={template.id} onClick={() => chooseTemplate(template.id as TemplateId)}><span className={`template-thumb template-thumb-${index}`}><i /><i /><b /></span><span><strong>{template.name.replace(" / ", " · ")}</strong><small>{template.description}</small></span><em>{composition.id === template.id ? "Active" : "Load"}</em></button>)}</div> : <div className="asset-results">{filteredAssets.map((asset) => <article className={`asset-card asset-${asset.category}`} key={asset.id}><div className="asset-preview"><span>{asset.category === "background" ? "◌" : asset.category === "typography" ? "Aa" : asset.category === "three" ? "◇" : "✦"}</span><i /></div><div><p>{asset.category}</p><h3>{asset.name}</h3><small>{asset.description}</small></div><button onClick={() => applyAsset(asset)}>{asset.category === "motion" || asset.category === "background" || asset.category === "typography" ? "Apply" : "Inspect"}<span>→</span></button></article>)}{filteredAssets.length === 0 && <p className="empty-state">No original asset matches that search.</p>}</div>}
          <div className="library-foot"><span><Icon name="spark" />Schema-driven assets</span><small>{listAssets().length} shipping building blocks</small></div>
        </aside>

        <section className="preview-panel">
          <div className="preview-toolbar"><div className="scene-crumb"><span>SCENE</span><strong>{(activeScene.scene?.name || "Scene")}</strong><i>›</i><button onClick={() => selectedNode && setSelectedNodeId(selectedNode.id)}>{selectedNode?.name ?? "No selection"}</button></div><div className="preview-quality"><span className="quality-dot" />FRAME SAFE <b>HIGH</b></div></div>
          <div className="preview-surface"><motion.div className="canvas-wrap" layout transition={{ duration: 0.2, ease: EASE_SOFT }}><SceneCanvas composition={composition} frame={frame} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} reducedMotion={reduceMotion ?? false} /></motion.div></div>
          <div className="preview-controls"><div className="transport"><button className="transport-button" onClick={() => selectFrame(0)} aria-label="Restart"><Icon name="restart" /></button><button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause preview" : "Play preview"} disabled={Boolean(reduceMotion)}><Icon name={playing ? "pause" : "play"} /></button><button className="transport-button" onClick={() => selectFrame(Math.min(composition.durationInFrames - 1, frame + 1))} aria-label="Advance one frame">›</button></div><span className="timecode">{formatTime(frame, composition.fps)} <i>/</i> {formatTime(composition.durationInFrames, composition.fps)}</span><div className="preview-hints"><kbd>SPACE</kbd><span>Play</span><kbd>←</kbd><kbd>→</kbd><span>Frames</span></div></div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-heading"><div><span className="overline">INSPECTOR</span><h2>{assetFocus ? assetFocus.name : selectedNode?.name ?? "Scene"}</h2></div><button className="inspector-more" aria-label="More element actions">•••</button></div>
          <div className="inspector-tabs"><button className="active">Design</button><button>Motion</button><button>Data</button></div>
          {selectedNode ? <div className="inspector-content">
            <section className="inspector-section"><h3>TRANSFORM <span>⌃</span></h3><div className="transform-grid">{(["x", "y", "scale", "rotateZ", "opacity"] as Array<keyof Transform>).map((key) => <label key={key}><span>{key === "rotateZ" ? "Rotate" : key.toUpperCase()}</span><input type="number" step={key === "opacity" ? 0.05 : 1} value={selectedNode.transform?.[key] ?? (key === "scale" || key === "opacity" ? 1 : 0)} onChange={(event) => updateTransform(key, event.target.value)} />{key === "rotateZ" ? <i>°</i> : null}</label>)}</div></section>
            <section className="inspector-section"><h3>CONTENT <span>⌃</span></h3>{selectedNode.type === "text" ? <label className="text-area-control"><span>Copy</span><textarea value={String(selectedNode.props?.content ?? "")} onChange={(event) => updateNodeProp("content", event.target.value)} /></label> : <SchemaControls schema={focusedSchema} node={selectedNode} onUpdate={updateNodeProp} />}</section>
            <section className="inspector-section"><h3>ANIMATION <span>⌃</span></h3><label className="control-row"><span>Entrance</span><select value={selectedNode.animation?.entrance ?? "FADE_UP"} onChange={(event) => changeNode(selectedNode.id, (node) => ({ ...node, animation: { ...node.animation, entrance: event.target.value } }))}>{["FADE", "FADE_UP", "FADE_DOWN", "SCALE", "POP", "SPRING", "BLUR", "BLUR_SCALE", "CINEMATIC"].map((preset) => <option key={preset} value={preset}>{preset.replace("_", " ")}</option>)}</select></label><label className="control-row"><span>Start frame</span><input type="number" min="0" max={composition.durationInFrames - 1} value={selectedNode.timing?.start ?? 0} onChange={(event) => changeNode(selectedNode.id, (node) => ({ ...node, timing: { ...node.timing!, start: Number(event.target.value) } }))} /></label><label className="control-row"><span>Duration</span><input type="number" min="1" max="600" value={selectedNode.timing?.duration ?? 24} onChange={(event) => changeNode(selectedNode.id, (node) => ({ ...node, timing: { ...node.timing!, duration: Number(event.target.value) } }))} /></label></section>
            <section className="inspector-section schema-section"><h3>{assetFocus ? "ASSET SCHEMA" : "COMPONENT SCHEMA"} <span>⌃</span></h3>{assetFocus ? <SchemaControls schema={assetFocus.schema} node={selectedNode} onUpdate={updateNodeProp} /> : <p className="schema-note">{selectedNode.type} · {nodeAssetId(selectedNode)}<br />Controls are generated from registry metadata.</p>}</section>
          </div> : <div className="inspector-empty">Select an element on the canvas or timeline.</div>}
        </aside>
      </div>

      <section className="timeline-panel" id="timeline">
        <div className="timeline-header"><div className="timeline-title"><span className="overline">TIMELINE</span><strong>{(activeScene.scene?.name || "Scene")}</strong><span className="timeline-duration">{Math.round(composition.durationInFrames / composition.fps)}.0 s</span></div><div className="timeline-actions"><label><span>Zoom</span><input type="range" min="0.65" max="1.7" step="0.05" value={timelineScale} onChange={(event) => setTimelineScale(Number(event.target.value))} /></label><button className="button ghost" onClick={() => fileInput.current?.click()}><Icon name="import" />Import</button><button className="button ghost" onClick={exportJson}><Icon name="export" />Export</button><input ref={fileInput} className="sr-only" type="file" accept="application/json" onChange={(event) => importJson(event.target.files?.[0])} /></div></div>
        <div className="timeline-body"><div className="timeline-labels"><div className="ruler-spacer" />{composition.tracks.map((track) => <div className="track-label" key={track.id}><span>{track.kind.slice(0, 3)}</span><b>{track.name}</b><i>{track.locked ? "⌧" : "◌"}</i></div>)}</div><div className="timeline-scroll"><div className="ruler" style={{ minWidth: `${composition.durationInFrames * timelineScale}px` }}>{Array.from({ length: Math.ceil(composition.durationInFrames / composition.fps) + 1 }, (_, index) => <span key={index} style={{ left: `${index * composition.fps * timelineScale}px` }}>{index}s</span>)}<i className="playhead" style={{ left: `${frame * timelineScale}px` }} /></div><div className="timeline-tracks" style={{ minWidth: `${composition.durationInFrames * timelineScale}px` }}>{composition.tracks.map((track) => <div className="track-row" key={track.id}>{track.nodeIds.map((id: any) => { const node = findCompositionNode(composition, id); if (!node) return null; const start = node.timing?.start ?? 0; const duration = node.timing?.duration ?? 24; return <button className={`timeline-clip clip-${track.kind.toLowerCase()} ${selectedNodeId === id ? "selected" : ""}`} key={id} style={{ left: `${start * timelineScale}px`, width: `${Math.max(42, duration * timelineScale)}px` }} onClick={() => { setSelectedNodeId(id); selectFrame(start); }}><span>{node.name}</span></button>; })}</div>)}</div><input className="timeline-scrubber" aria-label="Timeline playhead" type="range" min="0" max={composition.durationInFrames - 1} value={frame} onChange={(event) => selectFrame(Number(event.target.value))} /></div></div>
      </section>

      {notice && <motion.div className={`studio-notice notice-${notice.type}`} role="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><span>{notice.type === "success" ? "✓" : notice.type === "error" ? "!" : "i"}</span>{notice.message}<button onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></motion.div>}
    </main>
  );
}
