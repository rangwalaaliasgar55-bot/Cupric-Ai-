var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/bridge.ts
function getBridge() {
  if (typeof window === "undefined") return null;
  return window.cupric ?? window.northframe ?? null;
}
function getIpc() {
  return getBridge()?.ipc ?? null;
}

// src/lib/utils.ts
var uid = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

// src/lib/studio/media.ts
var registry = /* @__PURE__ */ new Map();
function getMedia(mediaId) {
  if (!mediaId) return null;
  return registry.get(mediaId) ?? null;
}

// src/lib/speech/transcript.ts
var cleanWord = (text) => text.trim();
function evenSplitDelays(startSec, endSec, words) {
  const cueDelayMs = Math.round(startSec * 1e3);
  const winMs = Math.max(0, Math.round((endSec - startSec) * 1e3));
  const n = words.length;
  const slot = n > 0 ? winMs / n : 0;
  return words.map((w, i) => ({ w: cleanWord(w), delayMs: cueDelayMs + Math.round(i * slot) }));
}

// src/lib/studio/doc.ts
function defaultTextClip(start, track) {
  return {
    id: uid(),
    kind: "text",
    track,
    startSec: start,
    durationSec: 3,
    name: "Text",
    transitionIn: "none",
    transitionOut: "none",
    opacity: 1,
    text: "Your headline",
    fontSizePct: 9,
    fontFamily: "Inter Variable",
    color: "#F4F1EA",
    weight: 800,
    align: "center",
    x: 0.5,
    y: 0.5,
    anim: "fade-up",
    captionStyle: null,
    highlightWord: null
  };
}

// src/lib/studio/textTools.ts
var TEXT_PRESETS = [
  { id: "title", label: "Title", patch: { fontSizePct: 9, weight: 800, align: "center", x: 0.5, y: 0.42, anim: "fade-up", captionStyle: null } },
  { id: "subtitle", label: "Subtitle", patch: { fontSizePct: 4.2, weight: 600, align: "center", x: 0.5, y: 0.56, anim: "fade-up", captionStyle: null } },
  { id: "lower-third", label: "Lower third", patch: { fontSizePct: 3.6, weight: 600, align: "left", x: 0.5, y: 0.8, anim: "slide-left", captionStyle: "standard" } },
  { id: "caption", label: "Caption", patch: { fontSizePct: 5.4, weight: 800, align: "center", x: 0.5, y: 0.72, anim: "word-reveal", captionStyle: "hormozi" } },
  { id: "quote", label: "Quote", patch: { fontSizePct: 5, weight: 400, align: "center", x: 0.5, y: 0.5, anim: "fade-up", captionStyle: "minimal", legibility: "on" } },
  { id: "cta", label: "Call to action", patch: { fontSizePct: 6.5, weight: 800, align: "center", x: 0.5, y: 0.66, anim: "pop", captionStyle: null, highlightWord: null } },
  { id: "kinetic", label: "Kinetic words", patch: { fontSizePct: 8, weight: 800, align: "center", x: 0.5, y: 0.5, anim: "kinetic", captionStyle: null } }
];
var CAPTION_PAUSE_SEC = 0.35;
function captionDelaysWithSource(words, startSec, durationSec, tokenCount) {
  if (tokenCount <= 0) return { delays: [], source: "even" };
  if (tokenCount === 1) return { delays: [0], source: words.length === 1 ? "word" : "even" };
  if (words.length === tokenCount) {
    const delays = words.map((w) => Math.max(0, Math.round((w.start - startSec) * 1e3)));
    const monotonic = delays.every((d, i) => i === 0 || d >= delays[i - 1]);
    const advances = delays[delays.length - 1] > 0;
    if (monotonic && advances) {
      const exact = new Set(delays).size === delays.length;
      return { delays, source: exact ? "word" : "phrase" };
    }
    const flat = delays.every((d) => d === delays[0]);
    return { delays: evenSplitDelays(0, Math.max(0.3, durationSec), new Array(tokenCount).fill("x")).map((w) => w.delayMs), source: flat ? "phrase" : "even" };
  }
  return { delays: evenSplitDelays(0, Math.max(0.3, durationSec), new Array(Math.max(1, tokenCount)).fill("x")).map((w) => w.delayMs), source: "even" };
}
function planCaptionLines(transcript, opts) {
  const maxWords = Math.max(1, opts.maxWords ?? 4);
  const maxChars = opts.maxChars && opts.maxChars > 0 ? Math.round(opts.maxChars) : null;
  const pauseSec = opts.pauseSec ?? CAPTION_PAUSE_SEC;
  const timed = opts.words?.length ? opts.words : null;
  const tokens = timed ? timed.map((w) => w.word.trim()).filter(Boolean) : transcript.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const chunks = [];
  let cur = [];
  let chars = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const width = tok.length + (cur.length ? 1 : 0);
    if (cur.length && maxChars && chars + width > maxChars) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(tok);
    chars += width;
    const pause = timed && i + 1 < tokens.length ? timed[i + 1].start - timed[i].end : 0;
    if (pause >= pauseSec || cur.length >= maxWords || /[.!?,;:]$/.test(tok)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
  }
  if (cur.length) chunks.push(cur);
  const weight = (w) => Math.max(1, w.replace(/[^a-z0-9]/gi, "").length / 3);
  const total = tokens.reduce((a, w) => a + weight(w), 0);
  let cursor = opts.startSec;
  let wi = 0;
  return chunks.map((chunk) => {
    let start = cursor;
    let dur;
    let delays = null;
    let source = "even";
    if (timed) {
      const mine = timed.slice(wi, wi + chunk.length);
      start = opts.startSec + mine[0].start;
      dur = Math.max(0.3, mine[mine.length - 1].end - mine[0].start);
      const calc = captionDelaysWithSource(mine, mine[0].start, dur, chunk.length);
      delays = calc.delays;
      source = calc.source;
    } else {
      dur = chunk.reduce((a, w) => a + weight(w), 0) / total * opts.durationSec;
    }
    wi += chunk.length;
    cursor = start + dur;
    return {
      text: chunk.join(" "),
      startSec: start,
      durationSec: Math.max(0.3, Math.round(dur * 100) / 100),
      wordDelaysMs: delays,
      timingSource: source,
      words: chunk.length
    };
  });
}
function captionsFromTranscript(transcript, opts) {
  return planCaptionLines(transcript, { startSec: opts.startSec, durationSec: opts.durationSec, maxWords: opts.maxWords, words: opts.words }).map((plan, i) => {
    const clip = defaultTextClip(Math.round(plan.startSec * 100) / 100, opts.track);
    return {
      ...clip,
      id: `cap-${i}-${clip.id}`,
      name: `Caption ${i + 1}`,
      text: plan.text,
      durationSec: plan.durationSec,
      timingSource: plan.timingSource,
      // The words land on the voice, so `word-reveal` and the karaoke tint
      // follow what was actually said instead of spreading evenly.
      ...plan.wordDelaysMs ? { anim: "word-reveal", wordDelaysMs: plan.wordDelaysMs } : {},
      ...TEXT_PRESETS.find((p) => p.id === "caption").patch
    };
  });
}

// src/lib/studio/transcriptStore.ts
var transcriptStore_exports = {};
__export(transcriptStore_exports, {
  TRANSCRIPT_CACHE_LIMIT: () => TRANSCRIPT_CACHE_LIMIT,
  TRANSCRIPT_STORE_KEY: () => TRANSCRIPT_STORE_KEY,
  clearTranscriptCache: () => clearTranscriptCache,
  forgetTranscript: () => forgetTranscript,
  hasTranscript: () => hasTranscript,
  readTranscript: () => readTranscript,
  transcriptCacheStats: () => transcriptCacheStats,
  transcriptDrift: () => transcriptDrift,
  transcriptKeyOf: () => transcriptKeyOf,
  wordsAgree: () => wordsAgree,
  writeTranscript: () => writeTranscript
});
var TRANSCRIPT_STORE_KEY = "cupric.transcripts.v1";
var TRANSCRIPT_CACHE_LIMIT = 40;
function transcriptKeyOf(file, lang) {
  const where = file.localPath?.trim() || file.fileName;
  const size = Number.isFinite(file.bytes) ? Math.round(file.bytes) : 0;
  const seconds = Number.isFinite(file.durationSec) ? Math.round(file.durationSec * 100) : 0;
  return `${lang}|${where}|${size}|${seconds}`;
}
function wordsAgree(a, b, toleranceSec = 0.25) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].word.trim().toLowerCase() !== b[i].word.trim().toLowerCase()) return false;
    if (Math.abs(a[i].start - b[i].start) > toleranceSec) return false;
  }
  return true;
}
function transcriptDrift(before, after) {
  const byIndex = Math.max(before.length, after.length);
  let mismatched = 0;
  for (let i = 0; i < byIndex; i += 1) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.word.trim().toLowerCase() !== b.word.trim().toLowerCase()) mismatched += 1;
  }
  return { changed: mismatched > 0, words: mismatched };
}
var memory = null;
function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
function readAll() {
  const store = storage();
  if (!store) return memory ?? (memory = {});
  try {
    const raw = store.getItem(TRANSCRIPT_STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeAll(all) {
  const store = storage();
  if (!store) {
    memory = all;
    return;
  }
  try {
    store.setItem(TRANSCRIPT_STORE_KEY, JSON.stringify(all));
  } catch {
    memory = all;
  }
}
var isEntry = (value) => Boolean(value && typeof value === "object" && Array.isArray(value.words) && value.words.every((w) => typeof w?.word === "string"));
function readTranscript(key) {
  const all = readAll();
  const entry = all[key];
  if (!isEntry(entry)) return null;
  const counted = { ...entry, hits: (entry.hits ?? 0) + 1 };
  all[key] = counted;
  writeAll(all);
  return counted;
}
function hasTranscript(key) {
  return isEntry(readAll()[key]);
}
function writeTranscript(key, entry) {
  const all = readAll();
  const next = { words: entry.words, engine: entry.engine, timing: entry.timing, savedAt: entry.savedAt ?? Date.now(), hits: 0 };
  all[key] = next;
  const keys = Object.keys(all);
  if (keys.length > TRANSCRIPT_CACHE_LIMIT) {
    const oldest = keys.map((k) => ({ k, at: all[k]?.savedAt ?? 0 })).sort((a, b) => a.at - b.at).slice(0, keys.length - TRANSCRIPT_CACHE_LIMIT);
    for (const { k } of oldest) delete all[k];
  }
  writeAll(all);
  return next;
}
function forgetTranscript(key) {
  const all = readAll();
  delete all[key];
  writeAll(all);
}
function transcriptCacheStats() {
  const entries = Object.values(readAll()).filter(isEntry);
  return { files: entries.length, hits: entries.reduce((n, entry) => n + (entry.hits ?? 0), 0) };
}
function clearTranscriptCache() {
  memory = {};
  const store = storage();
  try {
    store?.removeItem(TRANSCRIPT_STORE_KEY);
  } catch {
  }
}

// src/lib/studio/autoCaptions.ts
function wordsToTimeline(words, clip) {
  const speed = clip.kind === "video" && clip.speed > 0 ? clip.speed : 1;
  const srcIn = clip.trimInSec;
  const srcOut = srcIn + clip.durationSec * speed;
  const toT = (s) => clip.startSec + (s - srcIn) / speed;
  return words.filter((w) => w.end > srcIn && w.start < srcOut).map((w) => ({ word: w.word, start: toT(Math.max(srcIn, w.start)), end: toT(Math.min(srcOut, w.end)) }));
}
function captionsForClip(doc, clip, words, maxWords = 4) {
  const timed = wordsToTimeline(words, clip);
  if (!timed.length) return { doc, captions: [] };
  const track = Math.min(23, doc.trackCount);
  const captions = captionsFromTranscript("", { startSec: 0, durationSec: 0, track, maxWords, words: timed });
  const clips = doc.clips.map((c) => c.id === clip.id ? { ...c, words: words.map((w) => ({ word: w.word, start: w.start, end: w.end })) } : c);
  return { doc: { ...doc, trackCount: Math.min(24, Math.max(doc.trackCount, track + 1)), clips: [...clips, ...captions] }, captions };
}
async function transcribeMediaPath(path, lang = "en") {
  const ipc = getIpc();
  if (!ipc) throw new Error("Auto-captions from audio need the desktop app (offline Whisper runs there). Paste a transcript below instead.");
  if (!path) throw new Error("This clip has no file on disk (downloaded or packaged), so its audio cannot be read. Re-import it from disk.");
  return await ipc.invoke("voice:transcribeMedia", { path, lang });
}
async function transcribeClip(clip, lang = "en", opts = {}) {
  const handle = getMedia(clip.mediaId);
  const path = handle?.localPath ?? clip.localPath ?? "";
  const base = path.split(/[\\/]/).pop() ?? "";
  const file = {
    // An unregistered handle and an empty path leave no name at all: 'clip' is
    // the honest placeholder, and it keeps the cache key stable.
    fileName: handle?.fileName ?? (base || "clip"),
    localPath: handle?.localPath ?? null,
    bytes: handle?.bytes,
    durationSec: handle?.durationSec
  };
  const key = transcriptKeyOf(file, lang);
  const previous = clip.words?.length ? clip.words.map((w) => ({ word: w.word, start: w.start, end: w.end })) : null;
  const driftOf = (next) => {
    if (!previous) return {};
    const drift = transcriptDrift(previous, next);
    return drift.changed ? { drift: { ...drift, previous } } : {};
  };
  if (!opts.refresh) {
    const hit = readTranscript(key);
    if (hit) return { words: hit.words, engine: hit.engine, timing: hit.timing, cached: true, ...driftOf(hit.words) };
  }
  const fresh = await transcribeMediaPath(path, lang);
  writeTranscript(key, { words: fresh.words, engine: fresh.engine, timing: fresh.timing });
  return { ...fresh, ...driftOf(fresh.words) };
}
export {
  captionsForClip,
  transcriptStore_exports as store,
  transcribeClip,
  transcribeMediaPath,
  wordsToTimeline
};
