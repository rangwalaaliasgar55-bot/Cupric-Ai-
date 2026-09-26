/* Audio: deterministic per-frame feature analysis (amplitude/bass/mid/treble/beat), procedural beat
 * generator, offline mixing (volume/fade/trim/offset/loop) for preview and export. */
import type { AudioTrack, VideoDoc } from "@/core/types";
import { sanitizeUrl } from "@/core/scene-graph";
import type { AudioFeatures } from "@/render/core";

export type Analysis = { fps: number; amp: Float32Array; bass: Float32Array; mid: Float32Array; treble: Float32Array; beat: Float32Array };
const buffers = new Map<string, AudioBuffer>();
const analyses = new Map<string, Analysis>();
export const ZERO: AudioFeatures = { amplitude: 0, bass: 0, mid: 0, treble: 0, beat: 0 };

async function decode(url: string): Promise<AudioBuffer | null> {
  const u = sanitizeUrl(url);
  if (!u || typeof window === "undefined") return null;
  if (buffers.has(u)) return buffers.get(u)!;
  const res = await fetch(u);
  const arr = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(arr);
  buffers.set(u, buf);
  return buf;
}

/** Analyse a decoded buffer into per-frame band envelopes using one-pole filters (deterministic). */
export function analyseBuffer(buf: AudioBuffer, fps: number): Analysis {
  const sr = buf.sampleRate, data = buf.getChannelData(0);
  const frames = Math.ceil((buf.length / sr) * fps);
  const spf = Math.floor(sr / fps);
  const a = { fps, amp: new Float32Array(frames), bass: new Float32Array(frames), mid: new Float32Array(frames), treble: new Float32Array(frames), beat: new Float32Array(frames) };
  const kLow = 1 - Math.exp((-2 * Math.PI * 150) / sr), kMid = 1 - Math.exp((-2 * Math.PI * 2000) / sr);
  let lp = 0, mp = 0;
  for (let f = 0; f < frames; f++) {
    let sA = 0, sB = 0, sM = 0, sT = 0;
    for (let i = f * spf; i < Math.min(data.length, (f + 1) * spf); i++) {
      const x = data[i]; lp += kLow * (x - lp); mp += kMid * (x - mp);
      sA += x * x; sB += lp * lp; sM += (mp - lp) ** 2; sT += (x - mp) ** 2;
    }
    a.amp[f] = Math.sqrt(sA / spf); a.bass[f] = Math.sqrt(sB / spf); a.mid[f] = Math.sqrt(sM / spf); a.treble[f] = Math.sqrt(sT / spf);
  }
  for (const k of ["amp", "bass", "mid", "treble"] as const) { const arr = a[k]; let mx = 1e-6; arr.forEach((v) => (mx = Math.max(mx, v))); for (let i = 0; i < arr.length; i++) arr[i] /= mx; }
  let avg = 0, decay = 0;
  for (let f = 0; f < frames; f++) { avg = avg * 0.9 + a.bass[f] * 0.1; decay *= 0.8; if (a.bass[f] > avg * 1.35 && a.bass[f] > 0.3) decay = 1; a.beat[f] = decay; }
  return a;
}

function beatFeatures(bpm: number, t: number): AudioFeatures {
  const period = 60 / bpm;
  const ph = (t % period) / period;
  const beat = Math.exp(-ph * 9);
  const off = Math.exp(-(((t + period / 2) % period) / period) * 14);
  return { amplitude: 0.4 + beat * 0.6, bass: beat, mid: 0.3 + off * 0.5, treble: off * 0.8, beat: ph < 0.12 ? 1 - ph / 0.12 : 0 };
}

export function audioFeaturesAt(doc: VideoDoc, frame: number): AudioFeatures {
  const tracks = (doc.audio ?? []).filter((t) => !t.muted);
  if (!tracks.length) return ZERO;
  const out = { ...ZERO };
  for (const tr of tracks) {
    const lt = (frame - tr.start) / doc.fps + (tr.trimStart ?? 0);
    if (lt < 0 || (tr.duration && frame - tr.start > tr.duration)) continue;
    let f: AudioFeatures | null = null;
    if (tr.generator?.type === "beat") f = beatFeatures(tr.generator.bpm, lt);
    else if (tr.src) { const a = analyses.get(`${tr.src}|${doc.fps}`); if (a) { const i = Math.floor(lt * doc.fps) % (tr.loop ? a.amp.length : Number.MAX_SAFE_INTEGER); if (i < a.amp.length) f = { amplitude: a.amp[i], bass: a.bass[i], mid: a.mid[i], treble: a.treble[i], beat: a.beat[i] }; } }
    if (f) for (const k of Object.keys(out) as (keyof AudioFeatures)[]) out[k] = Math.max(out[k], f[k] * tr.volume);
  }
  return out;
}

export async function prepareAudio(doc: VideoDoc) {
  for (const tr of doc.audio ?? []) {
    if (!tr.src) continue;
    const key = `${tr.src}|${doc.fps}`;
    if (analyses.has(key)) continue;
    try { const buf = await decode(tr.src); if (buf) analyses.set(key, analyseBuffer(buf, doc.fps)); } catch (e) { console.warn("audio decode failed", e); }
  }
}

/** Offline mix of all tracks → AudioBuffer (used for preview playback and muxing into exports). */
export async function mixAudio(doc: VideoDoc, durationSec: number, sampleRate = 48000): Promise<AudioBuffer | null> {
  const tracks = (doc.audio ?? []).filter((t) => !t.muted);
  if (!tracks.length || typeof window === "undefined") return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(durationSec * sampleRate)), sampleRate);
  for (const tr of tracks) await scheduleTrack(ctx, tr, doc.fps, durationSec);
  return ctx.startRendering();
}

async function scheduleTrack(ctx: OfflineAudioContext, tr: AudioTrack, fps: number, total: number) {
  const start = tr.start / fps, end = tr.duration ? start + tr.duration / fps : total;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const fi = (tr.fadeIn ?? 0) / fps, fo = (tr.fadeOut ?? 0) / fps;
  gain.gain.setValueAtTime(fi > 0 ? 0 : tr.volume, start);
  if (fi > 0) gain.gain.linearRampToValueAtTime(tr.volume, start + fi);
  if (fo > 0) { gain.gain.setValueAtTime(tr.volume, Math.max(start, end - fo)); gain.gain.linearRampToValueAtTime(0, end); }
  if (tr.generator?.type === "beat") {
    const period = 60 / tr.generator.bpm;
    for (let t = start, i = 0; t < end; t += period, i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(gain); o.start(t); o.stop(t + 0.32);
      const pad = ctx.createOscillator(), pg = ctx.createGain();
      pad.type = "triangle"; pad.frequency.value = [220, 261.6, 196, 246.9][Math.floor(i / 4) % 4] * (tr.generator.key ?? 1);
      pg.gain.setValueAtTime(0.0001, t); pg.gain.linearRampToValueAtTime(0.06, t + 0.05); pg.gain.exponentialRampToValueAtTime(0.0001, t + period * 0.95);
      pad.connect(pg); pg.connect(gain); pad.start(t); pad.stop(t + period);
    }
    return;
  }
  if (!tr.src) return;
  const buf = await decode(tr.src).catch(() => null);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = !!tr.loop;
  src.connect(gain);
  src.start(start, tr.trimStart ?? 0);
  src.stop(end);
}

/* Preview playback synced to the player clock. */
let live: { ctx: AudioContext; node: AudioBufferSourceNode | null } | null = null;
export function playMix(buf: AudioBuffer | null, fromSec: number) {
  stopMix();
  if (!buf || typeof window === "undefined") return;
  live ??= { ctx: new AudioContext(), node: null };
  const node = live.ctx.createBufferSource();
  node.buffer = buf; node.connect(live.ctx.destination);
  node.start(0, Math.max(0, fromSec));
  live.node = node;
}
export function stopMix() { try { live?.node?.stop(); } catch { /* already stopped */ } if (live) live.node = null; }
