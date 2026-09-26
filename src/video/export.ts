/* Export system: MP4 (H.264/AAC) / WebM (VP9/Opus, optional alpha) via Mediabunny + WebCodecs, PNG/WebP frames,
 * JSON templates, SRT captions. Frame-exact offline rendering (not real-time capture). */
import type { VideoDoc } from "@/core/types";
import { docDuration, exportDoc } from "@/core/scene-graph";
import { renderFrame, prepareDoc } from "@/render/compositor";
import { mixAudio } from "./audio";
import { toSRT } from "./captions";

export type RenderVideoOptions = {
  doc: VideoDoc;
  format: "mp4" | "webm";
  width?: number;
  height?: number;
  fps?: number;
  range?: [number, number]; // doc frames [start, end)
  alpha?: boolean; // WebM only
  includeAudio?: boolean;
  quality?: "low" | "medium" | "high" | "ultra";
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};
export type RenderVideoResult = { blob: Blob; mimeType: string; codec: string; audio: boolean; frames: number; seconds: number };

export async function canEncode(format: "mp4" | "webm", width = 1920, height = 1080) {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined") return { ok: false, reason: "WebCodecs is not available in this browser. Use a recent Chromium, Edge or Safari 17+." };
  const mb = await import("mediabunny");
  const fmt = format === "mp4" ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat();
  const codec = await mb.getFirstEncodableVideoCodec(fmt.getSupportedVideoCodecs(), { width, height });
  return codec ? { ok: true, codec } : { ok: false, reason: `No encodable video codec for ${format.toUpperCase()} in this browser.` };
}

export async function renderVideo(o: RenderVideoOptions): Promise<RenderVideoResult> {
  const mb = await import("mediabunny");
  const { doc } = o;
  const width = Math.round((o.width ?? doc.width) / 2) * 2, height = Math.round((o.height ?? doc.height) / 2) * 2;
  const fps = o.fps ?? doc.fps;
  const total = docDuration(doc);
  const [f0, f1] = o.range ?? [0, total];
  const seconds = (f1 - f0) / doc.fps;
  const frames = Math.max(1, Math.round(seconds * fps));
  await prepareDoc(doc);
  const format = o.format === "mp4" ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat();
  const codec = await mb.getFirstEncodableVideoCodec(format.getSupportedVideoCodecs(), { width, height });
  if (!codec) throw new Error(`This browser cannot encode ${o.format.toUpperCase()} at ${width}×${height}.`);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: !!o.alpha })!;
  const output = new mb.Output({ format, target: new mb.BufferTarget() });
  const source = new mb.CanvasSource(canvas, { codec, bitrate: o.quality === "low" ? mb.QUALITY_MEDIUM : o.quality === "ultra" ? mb.QUALITY_VERY_HIGH : mb.QUALITY_HIGH, ...(o.alpha && o.format === "webm" ? { alpha: "keep" as const } : {}) });
  output.addVideoTrack(source, { frameRate: fps });
  let audioOk = false;
  let audioBuf: AudioBuffer | null = null;
  if (o.includeAudio !== false && doc.audio?.some((a) => !a.muted)) {
    const ac = await mb.getFirstEncodableAudioCodec(format.getSupportedAudioCodecs());
    if (ac) {
      audioBuf = await mixAudio(doc, total / doc.fps);
      if (audioBuf) { const as = new mb.AudioBufferSource({ codec: ac, bitrate: mb.QUALITY_HIGH }); output.addAudioTrack(as); audioOk = true; (output as unknown as { __audio: typeof as }).__audio = as; }
    }
  }
  await output.start();
  for (let i = 0; i < frames; i++) {
    if (o.signal?.aborted) { await output.cancel(); throw new DOMException("Render cancelled", "AbortError"); }
    const docFrame = f0 + (i / fps) * doc.fps;
    renderFrame(ctx, doc, docFrame, { quality: o.quality ?? "high", transparent: !!o.alpha });
    await source.add(i / fps, 1 / fps);
    o.onProgress?.((i + 1) / frames);
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (audioOk && audioBuf) {
    const as = (output as unknown as { __audio: InstanceType<typeof mb.AudioBufferSource> }).__audio;
    const sr = audioBuf.sampleRate;
    const startS = Math.floor((f0 / doc.fps) * sr), len = Math.min(audioBuf.length - startS, Math.floor(seconds * sr));
    if (len > 0) {
      const slice = new AudioBuffer({ length: len, numberOfChannels: audioBuf.numberOfChannels, sampleRate: sr });
      for (let c = 0; c < audioBuf.numberOfChannels; c++) slice.copyToChannel(audioBuf.getChannelData(c).subarray(startS, startS + len), c);
      await as.add(slice);
    }
  }
  await output.finalize();
  const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer!;
  const mimeType = o.format === "mp4" ? "video/mp4" : "video/webm";
  return { blob: new Blob([buf], { type: mimeType }), mimeType, codec, audio: audioOk, frames, seconds };
}

export async function exportFrame(doc: VideoDoc, frame: number, type: "image/png" | "image/webp" = "image/png", scale = 1): Promise<Blob> {
  await prepareDoc(doc);
  const c = document.createElement("canvas");
  c.width = Math.round(doc.width * scale); c.height = Math.round(doc.height * scale);
  renderFrame(c.getContext("2d")!, doc, frame, { quality: "high" });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), type, 0.95));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export const exportTemplateJSON = (doc: VideoDoc) => new Blob([exportDoc(doc)], { type: "application/json" });
export const exportCaptionsSRT = (doc: VideoDoc) => new Blob([(doc.captions ?? []).map((c) => toSRT(c.cues)).join("\n\n")], { type: "text/plain" });
