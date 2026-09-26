"use client";
/* Canvas player — renders a VideoDoc through the one deterministic compositor. Controlled or uncontrolled. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { Quality, VideoDoc } from "@/core/types";
import { docDuration } from "@/core/scene-graph";
import { renderFrame } from "@/render/compositor";
import { onAssetLoaded } from "@/render/core";
import { setReducedMotion } from "@/core/animation";
import { mixAudio, playMix, stopMix, prepareAudio } from "@/video/audio";

export type PlayerProps = {
  doc: VideoDoc;
  autoPlay?: boolean;
  loop?: boolean;
  controls?: boolean;
  quality?: Quality;
  thumbnail?: boolean; // static frame until hovered
  thumbFrame?: number;
  frame?: number;
  onFrameChange?: (f: number) => void;
  playing?: boolean;
  onPlayingChange?: (p: boolean) => void;
  audio?: boolean;
  maxPixels?: number;
  className?: string;
  selectedId?: string | null;
  showSafeArea?: boolean;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  onCanvasPointerDown?: (e: React.PointerEvent<HTMLCanvasElement>, docX: number, docY: number) => void;
  onCanvasPointerMove?: (e: React.PointerEvent<HTMLCanvasElement>, docX: number, docY: number) => void;
  onCanvasPointerUp?: (e: React.PointerEvent<HTMLCanvasElement>) => void;
};

export default function Player(props: PlayerProps) {
  const { doc, autoPlay = true, loop = true, controls = true, quality = "auto", thumbnail = false, audio = false, maxPixels = 1280 * 720 } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const localCanvas = useRef<HTMLCanvasElement>(null);
  const canvas = props.canvasRef ?? localCanvas;
  const total = docDuration(doc);
  const [innerFrame, setInnerFrame] = useState(thumbnail ? (props.thumbFrame ?? Math.floor(total * 0.45)) : 0);
  const [innerPlaying, setInnerPlaying] = useState(autoPlay && !thumbnail);
  const [muted, setMuted] = useState(true);
  const [hover, setHover] = useState(false);
  const frame = props.frame ?? innerFrame;
  const playing = props.playing ?? (thumbnail ? hover : innerPlaying);
  const setFrame = useCallback((f: number) => { if (props.onFrameChange) props.onFrameChange(f); else setInnerFrame(f); }, [props]);
  const setPlaying = useCallback((p: boolean) => { if (props.onPlayingChange) props.onPlayingChange(p); else setInnerPlaying(p); }, [props]);
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const docRef = useRef(doc);
  docRef.current = doc;
  const [size, setSize] = useState({ w: 640, h: 360 });
  const [, force] = useState(0);

  useEffect(() => { const m = window.matchMedia("(prefers-reduced-motion: reduce)"); setReducedMotion(m.matches); const h = () => setReducedMotion(m.matches); m.addEventListener("change", h); return () => m.removeEventListener("change", h); }, []);
  useEffect(() => onAssetLoaded(() => force((x) => x + 1)), []);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const cw = el.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      let w = cw * dpr, h = (w * doc.height) / doc.width;
      const k = Math.sqrt(maxPixels / (w * h));
      if (k < 1) { w *= k; h *= k; }
      setSize({ w: Math.round(w), h: Math.round(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height, maxPixels]);

  // Draw whenever frame/doc/size changes.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (c.width !== size.w || c.height !== size.h) { c.width = size.w; c.height = size.h; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    renderFrame(ctx, doc, Math.min(frame, total - 1), { quality, requestRedraw: () => force((x) => x + 1), selectedId: props.selectedId, showSafeArea: props.showSafeArea });
  });

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = frameRef.current;
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * docRef.current.fps;
      last = now;
      const t = docDuration(docRef.current);
      if (acc >= t) { if (loop) acc = 0; else { acc = t - 1; setFrame(Math.floor(acc)); setPlaying(false); return; } }
      setFrame(Math.floor(acc));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, setFrame, setPlaying]);

  // Audio preview synced to play position.
  const audioKey = JSON.stringify(doc.audio ?? []);
  const mixRef = useRef<AudioBuffer | null>(null);
  useEffect(() => { mixRef.current = null; if (!audio || !doc.audio?.length) return; let alive = true; prepareAudio(doc).then(() => mixAudio(doc, total / doc.fps)).then((b) => { if (alive) mixRef.current = b; }).catch(() => {}); return () => { alive = false; }; }, [audioKey, audio, total]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (audio && playing && !muted) playMix(mixRef.current, frameRef.current / doc.fps); else stopMix(); return () => stopMix(); }, [playing, muted, audio, doc.fps]);

  const toDoc = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * doc.width, ((e.clientY - r.top) / r.height) * doc.height] as const; };
  const secs = (f: number) => `${Math.floor(f / doc.fps / 60)}:${String(Math.floor((f / doc.fps) % 60)).padStart(2, "0")}.${String(Math.floor(f % doc.fps)).padStart(2, "0")}`;

  return (
    <div className={`flex flex-col ${props.className ?? ""}`} onMouseEnter={() => { if (thumbnail) { setHover(true); } }} onMouseLeave={() => { if (thumbnail) { setHover(false); setInnerFrame(props.thumbFrame ?? Math.floor(total * 0.45)); } }}>
      <div ref={wrap} className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: `${doc.width} / ${doc.height}` }}>
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" role="img" aria-label={`Preview of ${doc.name}`}
          onPointerDown={(e) => { const [x, y] = toDoc(e); props.onCanvasPointerDown?.(e, x, y); }}
          onPointerMove={(e) => { const [x, y] = toDoc(e); props.onCanvasPointerMove?.(e, x, y); }}
          onPointerUp={(e) => props.onCanvasPointerUp?.(e)} />
      </div>
      {controls && (
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-zinc-100 hover:bg-white/10">{playing ? <Pause size={14} /> : <Play size={14} />}</button>
          <button type="button" aria-label="Restart" onClick={() => { setFrame(0); setPlaying(true); }} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-zinc-100 hover:bg-white/10"><RotateCcw size={14} /></button>
          {audio && doc.audio?.length ? <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-zinc-100 hover:bg-white/10">{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button> : null}
          <input aria-label="Seek" type="range" min={0} max={total - 1} value={Math.min(frame, total - 1)} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} className="h-1 flex-1 accent-indigo-400" />
          <span className="w-24 text-right font-mono tabular-nums">{secs(frame)} / {secs(total)}</span>
        </div>
      )}
    </div>
  );
}
