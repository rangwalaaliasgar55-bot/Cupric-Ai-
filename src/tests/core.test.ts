import { describe, expect, it } from "vitest";
import { EASINGS, springValue, mulberry32, noise3, getEase, parseColor } from "@/core/math";
import { timeline } from "@/core/timeline";
import { createDoc, createNode, createScene, sceneSpans, docDuration, SceneGraph, splitNode, importDoc, exportDoc, sanitizeUrl } from "@/core/scene-graph";
import { evaluateNode } from "@/core/animation";
import { allMotionPresets, getMotionPreset } from "@/motion/presets";
import { parseSRT, parseVTT, parseCaptionJSON, toSRT } from "@/video/captions";
import { particleAt, PARTICLE_PRESETS } from "@/graphics/particles";
import { generatePalette, generateTheme } from "@/themes";

describe("math", () => {
  it("all easings map 0→0 and 1→1", () => { for (const [k, f] of Object.entries(EASINGS)) { if (k.startsWith("steps")) continue; expect(Math.abs(f(0))).toBeLessThan(1e-3); expect(Math.abs(f(1) - 1)).toBeLessThan(1e-3); } });
  it("cubic-bezier strings parse", () => { expect(getEase("cubic-bezier(0.2,0,0,1)")(0.5)).toBeGreaterThan(0.5); });
  it("springs settle at 1 and bouncy springs overshoot", () => { expect(springValue(5, { stiffness: 170, damping: 26 })).toBeCloseTo(1, 3); let mx = 0; for (let t = 0; t < 2; t += 0.01) mx = Math.max(mx, springValue(t, { stiffness: 300, damping: 10 })); expect(mx).toBeGreaterThan(1.05); });
  it("seeded RNG and noise are deterministic", () => { const a = mulberry32(42), b = mulberry32(42); for (let i = 0; i < 10; i++) expect(a()).toBe(b()); expect(noise3(1.2, 3.4, 5.6, 1)).toBe(noise3(1.2, 3.4, 5.6, 1)); });
  it("colors parse", () => { expect(parseColor("#ff0000")).toMatchObject({ r: 255, g: 0, b: 0 }); expect(parseColor("rgba(1,2,3,0.5)").a).toBe(0.5); });
});

describe("timeline", () => {
  it("seeks deterministically with labels, stagger and callbacks", () => {
    const s = { x: 0 }; const items = [{ o: 0 }, { o: 0 }, { o: 0 }]; let calls = 0;
    const tl = timeline().to(s, "x", { from: 0, to: 100, duration: 1, ease: "linear" }).addLabel("after").stagger(items, "o", { from: 0, to: 1, duration: 0.5, each: 0.25, ease: "linear" }, "after").call(() => calls++, 1.2);
    tl.seek(0.5); expect(s.x).toBeCloseTo(50);
    tl.seek(1.25); expect(items[0].o).toBeCloseTo(0.5); expect(items[1].o).toBeCloseTo(0);
    expect(calls).toBe(1);
    expect(tl.duration).toBeCloseTo(2);
    tl.seek(0.5); expect(s.x).toBeCloseTo(50);
  });
  it("supports repeat with reverse (yoyo)", () => {
    const s = { v: 0 }; const tl = timeline({ repeat: 1, repeatType: "reverse" }).to(s, "v", { from: 0, to: 10, duration: 1, ease: "linear" });
    tl.seek(1.5); expect(s.v).toBeCloseTo(5); tl.seek(0.25); expect(s.v).toBeCloseTo(2.5); expect(tl.duration).toBe(2);
  });
  it("tweens colors", () => { const s = { c: "#000000" }; timeline().to(s, "c", { from: "#000000", to: "#ffffff", duration: 1, ease: "linear" }).seek(0.5); expect(s.c).toContain("rgba(128,128,128"); });
});

describe("scene graph", () => {
  const doc = createDoc({ scenes: [createScene("Hero", 90, [createNode("text", { text: "Hi" }, { id: "t1", name: "Headline" })], { id: "s1" }), createScene("Product", 90, [createNode("ui", { kind: "dashboard" }, { id: "u1", name: "Dashboard" })], { id: "s2", transition: { type: "crossfade", duration: 15 } })] });
  it("computes spans with transition overlap", () => { const sp = sceneSpans(doc); expect(sp[1].start).toBe(75); expect(docDuration(doc)).toBe(165); });
  it("addresses nodes by path", () => { const g = new SceneGraph(doc); expect(g.get("hero.headline")?.id).toBe("t1"); expect(g.get("product.dashboard")?.id).toBe("u1"); expect(g.paths()).toContain("product.dashboard"); });
  it("splits nodes", () => { const d = splitNode(doc, "t1", 40); expect(d.scenes[0].nodes).toHaveLength(2); expect(d.scenes[0].nodes[1].timing.start).toBe(40); });
  it("round-trips through export/import", () => { const r = importDoc(exportDoc(doc)); expect(r.ok).toBe(true); });
  it("rejects invalid or unsafe documents", () => {
    expect(importDoc("{nope").ok).toBe(false);
    const bad = JSON.parse(JSON.stringify(doc)); bad.scenes[0].nodes[0].type = "script"; expect(importDoc(bad).ok).toBe(false);
    const x = JSON.parse(JSON.stringify(doc)); x.scenes[0].nodes[0].props.src = "javascript:alert(1)"; const r = importDoc(x); expect(r.ok && r.doc.scenes[0].nodes[0].props.src).toBe("");
  });
  it("sanitizes URLs", () => { expect(sanitizeUrl("https://a.com/x.png")).toBe("https://a.com/x.png"); expect(sanitizeUrl("javascript:alert(1)")).toBe(""); expect(sanitizeUrl("http://insecure")).toBe(""); expect(sanitizeUrl("/local.png")).toBe("/local.png"); expect(sanitizeUrl("//evil.com")).toBe(""); });
});

describe("motion presets", () => {
  it("has 100+ presets incl. required aliases", () => { expect(allMotionPresets().length).toBeGreaterThanOrEqual(100); for (const a of ["FADE_UP", "CINEMATIC", "SAAS", "LUXURY", "GLITCH", "ORBIT", "FLOAT"]) expect(getMotionPreset(a)).toBeTruthy(); });
  it("entrances settle to identity and are deterministic", () => {
    for (const p of allMotionPresets().filter((m) => m.kind === "entrance")) {
      const n = createNode("shape", {}, { id: "a", x: 100, y: 100, enter: { preset: p.id }, timing: { start: 0, duration: 400 } });
      const s = evaluateNode(n, 300, 30);
      expect(s.opacity, p.id).toBeGreaterThan(0.98);
      expect(Math.abs(s.x - 100), p.id).toBeLessThan(1);
      expect(JSON.stringify(evaluateNode(n, 7, 30))).toBe(JSON.stringify(evaluateNode(n, 7, 30)));
    }
  });
});

describe("captions", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\nHello world\n\n2\n00:00:03,000 --> 00:00:04,000\nMAYA: Second line";
  it("parses SRT/VTT/JSON", () => { const c = parseSRT(srt); expect(c).toHaveLength(2); expect(c[0].start).toBe(1); expect(c[1].speaker).toBe("MAYA"); expect(parseVTT("WEBVTT\n\n00:01.000 --> 00:02.000\nHi")).toHaveLength(1); expect(parseCaptionJSON('[{"start":0,"end":1,"text":"a"}]')).toHaveLength(1); expect(parseSRT(toSRT(c))).toHaveLength(2); });
});

describe("particles & themes", () => {
  it("particles are closed-form deterministic", () => { for (const p of Object.values(PARTICLE_PRESETS)) expect(JSON.stringify(particleAt(p.config, 5, 2.3, 7, 1.77))).toBe(JSON.stringify(particleAt(p.config, 5, 2.3, 7, 1.77))); });
  it("palette/theme generators produce valid hex colors", () => { const p = generatePalette("#22d3ee", "neon"); for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9a-f]{6}$/i); expect(generateTheme({ primary: "#ff0066", mode: "luxury" }).colors.primary).toMatch(/^#/); });
});
